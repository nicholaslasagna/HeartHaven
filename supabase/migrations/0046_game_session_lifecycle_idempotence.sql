-- 0046_game_session_lifecycle_idempotence.sql
--
-- Fix direct game routes that can collide with the broad
-- game_sessions_one_active_per_host partial unique index.
--
-- Lifecycle policy:
--   - Direct play reuses an existing active session for the same host/game.
--   - Direct play cancels old host-only/solo play sessions for another game
--     before creating a new one.
--   - Direct play never cancels an active party/lobby with seated guests.
--   - Exact ?session= handoff validates and returns the provided session.

drop function if exists public.ensure_play_game_session(text, integer);
drop function if exists public.ensure_play_game_session(text, integer, jsonb);

create or replace function public.ensure_play_game_session(
  p_game_key text,
  p_max_players integer default 2,
  p_init jsonb default '{}'::jsonb,
  p_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_game_key text := lower(trim(coalesce(p_game_key, '')));
  v_session_id uuid;
  v_display text;
  v_meta jsonb;
  v_effective_game_key text;
  v_exact_status text;
  v_blocking_id uuid;
  v_blocking_mode text;
  v_blocking_game_key text;
  v_blocking_seats integer;
  v_attempt integer;
  v_constraint text;
begin
  if v_caller is null then
    raise exception 'sign in required';
  end if;

  if v_game_key = '' then
    raise exception 'game key required';
  end if;

  if v_game_key like '%-party' then
    v_game_key := left(v_game_key, length(v_game_key) - 6);
  end if;

  -- Exact session handoff path for /app/<game>?session=<uuid>. This keeps
  -- party lobbies on the same canonical game_sessions row.
  if p_session_id is not null then
    select
      gs.id,
      gs.status,
      lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key)))
      into v_session_id, v_exact_status, v_effective_game_key
    from public.game_sessions gs
    where gs.id = p_session_id
      and (
        gs.host_id = v_caller
        or exists (
          select 1
          from public.game_session_players gsp
          where gsp.session_id = gs.id
            and gsp.profile_id = v_caller
        )
      )
    limit 1;

    if v_session_id is null then
      raise exception 'game session was not found or you are not seated in it';
    end if;

    if v_effective_game_key like '%-party' then
      v_effective_game_key := left(v_effective_game_key, length(v_effective_game_key) - 6);
    elsif v_effective_game_key = 'lobby' then
      raise exception 'this lobby has not started a game yet';
    end if;

    if v_effective_game_key <> v_game_key then
      raise exception 'this session belongs to a different game';
    end if;

    if v_exact_status = 'cancelled' then
      raise exception 'this game session is no longer available';
    end if;

    return v_session_id;
  end if;

  for v_attempt in 1..2 loop
    -- Prefer an already-active host session for this same playable game.
    select gs.id
      into v_session_id
    from public.game_sessions gs
    where gs.host_id = v_caller
      and gs.status in ('waiting', 'active')
      and (
        case
          when lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key))) like '%-party'
            then left(
              lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key))),
              length(lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key)))) - 6
            )
          else lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key)))
        end
      ) = v_game_key
      and (gs.mode = 'play' or gs.status = 'active')
    order by gs.updated_at desc
    limit 1;

    if v_session_id is not null then
      if v_game_key = 'memory-match' then
        select coalesce(metadata, '{}'::jsonb)
          into v_meta
        from public.game_sessions
        where id = v_session_id
        for update;

        if v_meta->'board' is null or jsonb_typeof(v_meta->'board') <> 'array' then
          v_meta := public.memory_match_init_metadata(
            v_session_id,
            v_meta,
            coalesce(p_init->>'mode', 'couples')
          );

          update public.game_sessions
             set metadata = v_meta,
                 updated_at = now()
           where id = v_session_id;
        elsif jsonb_array_length(v_meta->'board') < 16 then
          v_meta := public.memory_match_init_metadata(
            v_session_id,
            v_meta,
            coalesce(p_init->>'mode', 'couples')
          );

          update public.game_sessions
             set metadata = v_meta,
                 updated_at = now()
           where id = v_session_id;
        end if;
      end if;

      return v_session_id;
    end if;

    -- If another active host session exists, only replace direct/solo or
    -- host-only party rows. Never cancel a real party with guests.
    select
      gs.id,
      gs.mode,
      lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key))),
      (
        select count(*)::integer
        from public.game_session_players gsp
        where gsp.session_id = gs.id
      )
      into v_blocking_id, v_blocking_mode, v_blocking_game_key, v_blocking_seats
    from public.game_sessions gs
    where gs.host_id = v_caller
      and gs.status in ('waiting', 'active')
    order by gs.updated_at desc
    limit 1;

    if v_blocking_id is not null then
      if v_blocking_mode = 'play' or coalesce(v_blocking_seats, 0) <= 1 then
        update public.game_sessions
           set status = 'cancelled',
               updated_at = now(),
               metadata = coalesce(metadata, '{}'::jsonb)
                 || jsonb_build_object('cancelledBy', 'direct_game_replaced', 'cancelledAt', now())
         where id = v_blocking_id;
      else
        if v_blocking_game_key like '%-party' then
          v_blocking_game_key := left(v_blocking_game_key, length(v_blocking_game_key) - 6);
        end if;

        raise exception
          'You already have an active party session. Finish or leave it before starting another game.';
      end if;
    end if;

    select coalesce(nullif(trim(p.username), ''), nullif(trim(p.display_name), ''), 'Keeper')
      into v_display
    from public.profiles p
    where p.id = v_caller;

    v_meta := '{}'::jsonb;

    begin
      v_session_id := public.insert_game_session_with_unique_invite(
        v_caller,
        v_game_key,
        'play',
        'active',
        greatest(2, least(12, coalesce(p_max_players, 2))),
        v_meta,
        null
      );
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'game_sessions_one_active_per_host' and v_attempt < 2 then
        continue;
      end if;
      if v_constraint = 'game_sessions_one_active_per_host' then
        select gs.id
          into v_session_id
        from public.game_sessions gs
        where gs.host_id = v_caller
          and gs.status in ('waiting', 'active')
          and (
            case
              when lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key))) like '%-party'
                then left(
                  lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key))),
                  length(lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key)))) - 6
                )
              else lower(trim(coalesce(nullif(gs.selected_game_key, ''), gs.game_key)))
            end
          ) = v_game_key
        order by gs.updated_at desc
        limit 1;

        if v_session_id is not null then
          return v_session_id;
        end if;

        raise exception
          'You already have another active HeartHaven game. Finish it or wait a moment, then try again.';
      end if;
      raise;
    end;

    insert into public.game_session_players (session_id, profile_id, display_name, seat_index, team_key, ready)
    values (v_session_id, v_caller, coalesce(v_display, 'Keeper'), 0, 'team-1', true)
    on conflict (session_id, profile_id) do update
      set display_name = excluded.display_name,
          ready = true,
          updated_at = now();

    if v_game_key = 'memory-match' then
      v_meta := public.memory_match_init_metadata(
        v_session_id,
        '{}'::jsonb,
        coalesce(p_init->>'mode', 'couples')
      );

      update public.game_sessions
         set metadata = v_meta,
             updated_at = now()
       where id = v_session_id;
    end if;

    return v_session_id;
  end loop;

  raise exception 'Could not start the game session. Please try again.';
end;
$$;

revoke all on function public.ensure_play_game_session(text, integer, jsonb, uuid) from public;
grant execute on function public.ensure_play_game_session(text, integer, jsonb, uuid) to authenticated, service_role;
