-- 0043_profile_studio_and_invite_code_fixes.sql
--
-- Production bug fixes:
--   1. Keep profiles.display_name non-null when username/account flows upsert.
--   2. Add an authoritative profile slot for Keeper Studio selections.
--   3. Make game_sessions.invite_code generation collision-safe instead of
--      reusing the host friend code or relying on a single default attempt.

alter table public.profiles
  add column if not exists keeper_customization jsonb not null default
    '{
      "characterId": "rose-waves",
      "bodyId": "female",
      "skinId": "fair",
      "hairStyleId": "long-waves",
      "hairColorId": "chestnut",
      "paletteId": "blush",
      "outfitId": "cardigan"
    }'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_keeper_customization_object_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_keeper_customization_object_chk
      check (jsonb_typeof(keeper_customization) = 'object');
  end if;
end;
$$;

update public.profiles
   set display_name = coalesce(nullif(trim(username), ''), nullif(trim(friend_code), ''), 'Keeper')
 where display_name is null or length(trim(display_name)) = 0;

comment on column public.profiles.keeper_customization is
  'Server-persisted Keeper Studio selection. Client localStorage remains a fast cache only.';

create or replace function public.generate_party_invite_code()
returns text
language plpgsql
as $$
declare
  v_letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text := '';
  v_bytes bytea;
  v_num integer;
  i integer;
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_letters, (get_byte(gen_random_bytes(1), 0) % length(v_letters)) + 1, 1);
  end loop;
  v_bytes := gen_random_bytes(2);
  v_num := ((get_byte(v_bytes, 0) * 256) + get_byte(v_bytes, 1)) % 10000;
  return 'HH-' || v_code || '-' || lpad(v_num::text, 4, '0');
end;
$$;

alter table public.game_sessions
  alter column invite_code set default public.generate_party_invite_code();

create or replace function public.insert_game_session_with_unique_invite(
  p_host_id uuid,
  p_game_key text,
  p_mode text,
  p_status text,
  p_max_players integer,
  p_metadata jsonb default '{}'::jsonb,
  p_host_friend_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_invite_code text;
  v_attempt integer := 0;
  v_constraint text;
begin
  loop
    v_attempt := v_attempt + 1;
    v_invite_code := public.generate_party_invite_code();
    begin
      insert into public.game_sessions (
        host_id,
        game_key,
        mode,
        status,
        max_players,
        metadata,
        host_friend_code,
        invite_code
      )
      values (
        p_host_id,
        p_game_key,
        p_mode,
        p_status,
        p_max_players,
        coalesce(p_metadata, '{}'::jsonb),
        p_host_friend_code,
        v_invite_code
      )
      returning id into v_session_id;

      return v_session_id;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'game_sessions_invite_code_key' then
        raise;
      end if;
      if v_attempt >= 10 then
        raise exception 'Could not create a unique lobby code. Please try again.';
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.insert_game_session_with_unique_invite(uuid, text, text, text, integer, jsonb, text) from public;

create or replace function public.create_party_lobby(p_max_players integer default 4)
returns table (session_id uuid, invite_code text, host_friend_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_host_code text;
  v_display text;
  v_existing_id uuid;
  v_new_id uuid;
  v_invite_code text;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;
  if p_max_players < 2 or p_max_players > 12 then
    raise exception 'max_players must be between 2 and 12';
  end if;

  select friend_code, coalesce(nullif(trim(username), ''), nullif(trim(display_name), ''), 'Keeper')
    into v_host_code, v_display
  from public.profiles
  where id = v_host;
  if v_host_code is null then
    raise exception 'no profile row for host (sign out + sign back in to fix)';
  end if;

  select id into v_existing_id
    from public.game_sessions
    where host_id = v_host and status in ('waiting', 'active');
  if v_existing_id is not null then
    update public.game_sessions
       set status = 'cancelled', updated_at = now()
     where id = v_existing_id;
    insert into public.lobby_events (session_id, kind, payload)
    values (v_existing_id, 'cancelled', jsonb_build_object('reason', 'host_started_new_lobby'));
  end if;

  v_new_id := public.insert_game_session_with_unique_invite(
    v_host,
    'lobby',
    'party',
    'waiting',
    p_max_players,
    '{}'::jsonb,
    upper(v_host_code)
  );

  insert into public.game_session_players (
    session_id, profile_id, display_name, seat_index, team_key
  ) values (
    v_new_id, v_host, v_display, 0, 'host'
  );

  select gs.invite_code into v_invite_code
    from public.game_sessions gs
    where gs.id = v_new_id;

  session_id := v_new_id;
  invite_code := v_invite_code;
  host_friend_code := upper(v_host_code);
  return next;
end;
$$;

revoke all on function public.create_party_lobby(integer) from public;
grant execute on function public.create_party_lobby(integer) to authenticated, service_role;

create or replace function public.ensure_play_game_session(
  p_game_key text,
  p_max_players integer default 2,
  p_init jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_session_id uuid;
  v_display text;
  v_meta jsonb;
begin
  if v_caller is null then raise exception 'sign in required'; end if;

  select gs.id into v_session_id
    from public.game_sessions gs
    join public.game_session_players gsp on gsp.session_id = gs.id
    where gsp.profile_id = v_caller
      and gs.game_key = p_game_key
      and gs.status in ('waiting', 'active')
    order by gs.updated_at desc
    limit 1;

  if v_session_id is not null then
    return v_session_id;
  end if;

  select coalesce(nullif(trim(p.username), ''), nullif(trim(p.display_name), ''), 'Keeper')
    into v_display
  from public.profiles p
  where p.id = v_caller;

  v_meta := '{}'::jsonb;

  v_session_id := public.insert_game_session_with_unique_invite(
    v_caller,
    p_game_key,
    'play',
    'active',
    greatest(2, least(12, coalesce(p_max_players, 2))),
    v_meta,
    null
  );

  insert into public.game_session_players (session_id, profile_id, display_name, seat_index, team_key, ready)
  values (v_session_id, v_caller, coalesce(v_display, 'Keeper'), 0, 'team-1', true);

  if p_game_key = 'memory-match' then
    v_meta := public.memory_match_init_metadata(
      v_session_id,
      '{}'::jsonb,
      coalesce(p_init->>'mode', 'couples')
    );

    update public.game_sessions
       set metadata = v_meta, updated_at = now()
     where id = v_session_id;
  end if;

  return v_session_id;
end;
$$;

revoke all on function public.ensure_play_game_session(text, integer, jsonb) from public;
grant execute on function public.ensure_play_game_session(text, integer, jsonb) to authenticated, service_role;
