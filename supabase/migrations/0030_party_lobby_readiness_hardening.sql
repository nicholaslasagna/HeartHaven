-- 0030_party_lobby_readiness_hardening.sql
--
-- Public-repo follow-up for the party lobby system:
--   1. Remove permissive legacy policies from migration 0003 that still
--      OR with the stricter 0029 policies.
--   2. Make the server, not just the UI, enforce "selected player count
--      is full and everyone is ready" before a host can start.

drop policy if exists "Players host game sessions" on public.game_sessions;
drop policy if exists "Hosts update game sessions" on public.game_sessions;
drop policy if exists "Players join sessions as themselves" on public.game_session_players;
drop policy if exists "Players update their own game seat" on public.game_session_players;

create or replace function public.start_party_lobby()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_session_id uuid;
  v_href text;
  v_max_players integer;
  v_occupied integer;
  v_ready integer;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;

  select id, selected_game_href, max_players
    into v_session_id, v_href, v_max_players
  from public.game_sessions
  where host_id = v_host and status = 'waiting'
  order by updated_at desc
  limit 1;

  if v_session_id is null then
    raise exception 'no waiting lobby';
  end if;
  if v_href is null or length(trim(v_href)) = 0 then
    raise exception 'pick a game before starting';
  end if;

  select count(*)::integer,
         count(*) filter (where ready)::integer
    into v_occupied, v_ready
  from public.game_session_players
  where session_id = v_session_id;

  if v_occupied < v_max_players then
    raise exception 'waiting for players (%/% seats filled)', v_occupied, v_max_players;
  end if;
  if v_ready < v_max_players then
    raise exception 'everyone needs to ready up (%/% ready)', v_ready, v_max_players;
  end if;

  update public.game_sessions
     set status = 'active', started_at = now(), updated_at = now()
   where id = v_session_id;

  insert into public.lobby_events (session_id, kind, payload)
  values (v_session_id, 'started', jsonb_build_object('game_href', v_href));

  return v_href;
end;
$$;

revoke all on function public.start_party_lobby() from public;
grant execute on function public.start_party_lobby() to authenticated, service_role;
