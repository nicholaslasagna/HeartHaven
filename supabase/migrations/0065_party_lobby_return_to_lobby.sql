-- 0065_party_lobby_return_to_lobby.sql
--
-- Let a host leave a party game and bring everyone back to the same lobby
-- instead of forcing the host to close/recreate it. The session remains the
-- same canonical party row, so invite codes, seats, and friend handoff stay
-- intact while the host chooses another game.

create or replace function public.return_party_lobby_to_waiting(p_session_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_session_id uuid;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;

  select lobby_session.id
    into v_session_id
  from public.game_sessions as lobby_session
  where lobby_session.host_id = v_host
    and lobby_session.mode = 'party'
    and lobby_session.status in ('waiting', 'active')
    and (p_session_id is null or lobby_session.id = p_session_id)
  order by lobby_session.updated_at desc, lobby_session.created_at desc
  limit 1;

  if v_session_id is null then
    return false;
  end if;

  update public.game_sessions as lobby_session
     set status = 'waiting',
         updated_at = now(),
         metadata = coalesce(lobby_session.metadata, '{}'::jsonb)
           || jsonb_build_object('returnedToLobbyAt', now())
   where lobby_session.id = v_session_id;

  -- Guests need to ready up again before the next game. The host pressing
  -- Start remains the host's readiness signal.
  update public.game_session_players as seated_player
     set ready = (seated_player.profile_id = v_host),
         updated_at = now()
   where seated_player.session_id = v_session_id;

  insert into public.lobby_events (session_id, kind, payload)
  values (v_session_id, 'returned_to_lobby', jsonb_build_object('reason', 'host_returned'));

  return true;
end;
$$;

revoke all on function public.return_party_lobby_to_waiting(uuid) from public;
grant execute on function public.return_party_lobby_to_waiting(uuid) to authenticated, service_role;

create or replace function public.select_party_game(
  p_game_key text,
  p_game_href text,
  p_game_label text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_session_id uuid;
  v_previous_status text;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;
  if p_game_key is null or length(trim(p_game_key)) = 0 then
    raise exception 'game_key required';
  end if;
  if p_game_href !~ '^/' then
    raise exception 'game_href must be a same-origin path';
  end if;

  select lobby_session.id, lobby_session.status
    into v_session_id, v_previous_status
  from public.game_sessions as lobby_session
  where lobby_session.host_id = v_host
    and lobby_session.mode = 'party'
    and lobby_session.status in ('waiting', 'active')
  order by lobby_session.updated_at desc, lobby_session.created_at desc
  limit 1;

  if v_session_id is null then
    raise exception 'no active lobby';
  end if;

  update public.game_sessions as lobby_session
     set status = 'waiting',
         selected_game_key = trim(p_game_key),
         selected_game_href = trim(p_game_href),
         selected_game_label = nullif(trim(p_game_label), ''),
         updated_at = now(),
         metadata = coalesce(lobby_session.metadata, '{}'::jsonb)
           || case
                when v_previous_status = 'active'
                  then jsonb_build_object('returnedToLobbyAt', now())
                else '{}'::jsonb
              end
   where lobby_session.id = v_session_id;

  if v_previous_status = 'active' then
    update public.game_session_players as seated_player
       set ready = (seated_player.profile_id = v_host),
           updated_at = now()
     where seated_player.session_id = v_session_id;

    insert into public.lobby_events (session_id, kind, payload)
    values (v_session_id, 'returned_to_lobby', jsonb_build_object('reason', 'host_selected_new_game'));
  end if;

  insert into public.lobby_events (session_id, kind, payload)
  values (
    v_session_id,
    'game_selected',
    jsonb_build_object('game_key', p_game_key, 'game_href', p_game_href, 'game_label', p_game_label)
  );
end;
$$;

revoke all on function public.select_party_game(text, text, text) from public;
grant execute on function public.select_party_game(text, text, text) to authenticated, service_role;
