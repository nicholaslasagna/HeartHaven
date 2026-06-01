-- 0054_fix_party_lobby_session_id_and_sync_fallback.sql
--
-- Fix live lobby creation failures caused by PL/pgSQL output-column
-- ambiguity. create_party_lobby returns a column named `session_id`; using a
-- bare `on conflict (session_id, profile_id)` inside the same function can
-- resolve ambiguously on some Postgres versions. Keep the uniqueness model,
-- but target the explicit primary-key constraint and return via RETURN QUERY.

create or replace function public.create_party_lobby(
  p_max_players integer default 4
)
returns table (session_id uuid, invite_code text, host_friend_code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_host uuid := auth.uid();
  v_host_code text;
  v_display text;
  v_cancelled_id uuid;
  v_created_session_id uuid;
  v_invite_code text;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;
  if p_max_players < 2 or p_max_players > 12 then
    raise exception 'max_players must be between 2 and 12';
  end if;

  select
    host_profile.friend_code,
    coalesce(nullif(trim(host_profile.username), ''), nullif(trim(host_profile.display_name), ''), 'Keeper')
    into v_host_code, v_display
  from public.profiles as host_profile
  where host_profile.id = v_host;

  if v_host_code is null then
    raise exception 'no profile row for host (sign out + sign back in to fix)';
  end if;

  for v_cancelled_id in
    update public.game_sessions as lobby_session
       set status = 'cancelled',
           updated_at = now(),
           metadata = coalesce(lobby_session.metadata, '{}'::jsonb)
             || jsonb_build_object('cancelledBy', 'host_started_new_lobby', 'cancelledAt', now())
     where lobby_session.host_id = v_host
       and lobby_session.status in ('waiting', 'active')
     returning lobby_session.id
  loop
    insert into public.lobby_events (session_id, kind, payload)
    values (v_cancelled_id, 'cancelled', jsonb_build_object('reason', 'host_started_new_lobby'));
  end loop;

  v_created_session_id := public.insert_game_session_with_unique_invite(
    v_host,
    'lobby',
    'party',
    'waiting',
    p_max_players,
    '{}'::jsonb,
    upper(v_host_code)
  );

  insert into public.game_session_players (
    session_id, profile_id, display_name, seat_index, team_key, ready
  ) values (
    v_created_session_id, v_host, coalesce(v_display, 'Keeper'), 0, 'host', true
  )
  on conflict on constraint game_session_players_pkey do update
    set display_name = excluded.display_name,
        ready = true,
        updated_at = now();

  select lobby_session.invite_code
    into v_invite_code
  from public.game_sessions as lobby_session
  where lobby_session.id = v_created_session_id;

  return query
  select v_created_session_id, v_invite_code, upper(v_host_code);
end;
$$;

revoke all on function public.create_party_lobby(integer) from public;
grant execute on function public.create_party_lobby(integer) to authenticated, service_role;
