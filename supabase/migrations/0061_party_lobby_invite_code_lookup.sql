-- 0061_party_lobby_invite_code_lookup.sql
--
-- BUG: party lobbies created with a unique lobby invite code (for example
-- HH-ABCDEF-1234), but request_join_party/find_party_lobby only looked up
-- game_sessions.host_friend_code after 0058. The Games UI copies/sends
-- invite_code, so guests saw "no active lobby for that code" and never
-- became seated. Ready/start then looked broken because the guest was not
-- actually in the lobby.
--
-- FIX: accept either host_friend_code or invite_code everywhere the lobby
-- join code is resolved. Keep party-mode scoping from 0058.

create or replace function public.find_party_lobby(p_friend_code text)
returns table (
  session_id uuid,
  host_friend_code text,
  status text,
  max_players integer,
  occupied_seats integer,
  selected_game_key text,
  selected_game_href text,
  selected_game_label text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_friend_code, '')));
begin
  if v_code !~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$' then
    return;
  end if;

  return query
  select
    lobby_session.id,
    lobby_session.host_friend_code,
    lobby_session.status,
    lobby_session.max_players,
    (
      select count(*)::integer
      from public.game_session_players as seated_player
      where seated_player.session_id = lobby_session.id
    ),
    lobby_session.selected_game_key,
    lobby_session.selected_game_href,
    lobby_session.selected_game_label,
    lobby_session.created_at
  from public.game_sessions as lobby_session
  where lobby_session.mode = 'party'
    and (
      lobby_session.host_friend_code = v_code
      or lobby_session.invite_code = v_code
    )
    and lobby_session.status in ('waiting', 'active')
  order by
    case when lobby_session.status = 'waiting' then 0 else 1 end,
    lobby_session.updated_at desc,
    lobby_session.created_at desc
  limit 1;
end;
$$;

revoke all on function public.find_party_lobby(text) from public;
grant execute on function public.find_party_lobby(text) to authenticated, service_role;

create or replace function public.request_join_party(p_host_friend_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid := auth.uid();
  v_join_code text := upper(trim(coalesce(p_host_friend_code, '')));
  v_session_id uuid;
  v_requester_code text;
  v_requester_name text;
  v_request_id uuid;
  v_seated boolean;
  v_existing_request uuid;
begin
  if v_requester is null then
    raise exception 'sign in required';
  end if;
  if v_join_code !~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$' then
    raise exception 'invalid lobby code';
  end if;

  select lobby_session.id
    into v_session_id
  from public.game_sessions as lobby_session
  where lobby_session.mode = 'party'
    and (
      lobby_session.host_friend_code = v_join_code
      or lobby_session.invite_code = v_join_code
    )
    and lobby_session.status = 'waiting'
  order by lobby_session.updated_at desc, lobby_session.created_at desc
  limit 1;

  if v_session_id is null then
    raise exception 'no active lobby for that code';
  end if;

  select exists(
    select 1
    from public.game_session_players as seated_player
    where seated_player.session_id = v_session_id
      and seated_player.profile_id = v_requester
  ) into v_seated;
  if v_seated then
    update public.game_sessions as lobby_session
       set updated_at = now()
     where lobby_session.id = v_session_id;
    return null;
  end if;

  select join_request.id
    into v_existing_request
  from public.lobby_join_requests as join_request
  where join_request.session_id = v_session_id
    and join_request.requester_profile_id = v_requester
    and join_request.status = 'pending'
  order by join_request.created_at desc
  limit 1;
  if v_existing_request is not null then
    return v_existing_request;
  end if;

  select
    requester_profile.friend_code,
    coalesce(nullif(trim(requester_profile.username), ''), nullif(trim(requester_profile.display_name), ''), 'Keeper')
    into v_requester_code, v_requester_name
  from public.profiles as requester_profile
  where requester_profile.id = v_requester;
  if v_requester_code is null then
    raise exception 'no profile row for requester (sign out + sign back in to fix)';
  end if;

  insert into public.lobby_join_requests (
    session_id, requester_profile_id, requester_friend_code, requester_display_name
  ) values (
    v_session_id, v_requester, upper(v_requester_code), coalesce(v_requester_name, 'Keeper')
  )
  returning lobby_join_requests.id into v_request_id;

  update public.game_sessions as lobby_session
     set updated_at = now()
   where lobby_session.id = v_session_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_join_party(text) from public;
grant execute on function public.request_join_party(text) to authenticated, service_role;
