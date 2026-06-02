-- 0060_start_party_lobby_host_implicit_ready.sql
--
-- BUG: with every seated player showing "Ready", the host still could not
-- press Start (button stayed greyed / RPC rejected).
--
-- ROOT CAUSE: the start gate required EVERY seat — including the host's own
-- seat — to have ready = true. That's the wrong model for a host-driven
-- lobby:
--   * The host clicking "Start" IS the host's readiness signal. Requiring
--     a separate host "ready" toggle is redundant and confusing.
--   * If the host's own ready flag was ever false or stale (e.g. they
--     toggled themselves to "Unready", or a prior ready write rolled back
--     before migration 0059 fixed the lobby_events constraint), Start was
--     permanently blocked even when all guests were ready.
--
-- FIX: only require the NON-host seated players to be ready. The host's
-- own readiness is implied by pressing Start. This mirrors the client
-- `startStatus` change so the button-enabled state and the server gate
-- agree (otherwise the button enables but the RPC rejects, or vice versa).
--
-- Everything else about start_party_lobby (0058) is preserved: party-mode
-- scoping, game-selected requirement, ?session= handoff param, the
-- 'started' lobby_event broadcast.

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
  v_started_href text;
  v_guest_seats integer;
  v_guest_ready integer;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;

  select lobby_session.id, lobby_session.selected_game_href
    into v_session_id, v_href
  from public.game_sessions as lobby_session
  where lobby_session.host_id = v_host
    and lobby_session.mode = 'party'
    and lobby_session.status = 'waiting'
  order by lobby_session.updated_at desc, lobby_session.created_at desc
  limit 1;

  if v_session_id is null then
    raise exception 'no waiting lobby';
  end if;
  if v_href is null or length(trim(v_href)) = 0 then
    raise exception 'pick a game before starting';
  end if;

  -- Count only the NON-host seated players. The host's readiness is
  -- implied by pressing Start, so we don't gate on their own flag.
  select count(*)::integer,
         count(*) filter (where seated_player.ready)::integer
    into v_guest_seats, v_guest_ready
  from public.game_session_players as seated_player
  where seated_player.session_id = v_session_id
    and seated_player.profile_id <> v_host;

  if v_guest_ready < v_guest_seats then
    raise exception 'all guests need to ready up (%/% ready)', v_guest_ready, v_guest_seats;
  end if;

  v_started_href := trim(v_href);
  if v_started_href !~ '(^|[?&])session=' then
    v_started_href := v_started_href
      || case when position('?' in v_started_href) > 0 then '&' else '?' end
      || 'session='
      || v_session_id::text;
  end if;

  update public.game_sessions as lobby_session
     set status = 'active', started_at = now(), updated_at = now()
   where lobby_session.id = v_session_id;

  insert into public.lobby_events (session_id, kind, payload)
  values (
    v_session_id,
    'started',
    jsonb_build_object(
      'game_href', v_started_href,
      'base_game_href', trim(v_href),
      'session_id', v_session_id
    )
  );

  return v_started_href;
end;
$$;

revoke all on function public.start_party_lobby() from public;
grant execute on function public.start_party_lobby() to authenticated, service_role;
