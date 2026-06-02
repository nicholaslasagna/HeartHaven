-- 0058_party_lobby_mode_scoping_and_close.sql
--
-- Keep party-lobby UI state scoped to actual party sessions. The older
-- helper RPCs could hydrate any waiting/active game_session row for the
-- caller, including direct solo play sessions. That made /app/games show a
-- "lobby" with no selected game even after the host picked one.

create or replace function public.get_my_party_lobby()
returns table (
  session_id uuid,
  host_profile_id uuid,
  host_friend_code text,
  invite_code text,
  status text,
  max_players integer,
  selected_game_key text,
  selected_game_href text,
  selected_game_label text,
  updated_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;

  return query
  select
    lobby_session.id as session_id,
    lobby_session.host_id as host_profile_id,
    lobby_session.host_friend_code,
    lobby_session.invite_code,
    lobby_session.status,
    lobby_session.max_players,
    lobby_session.selected_game_key,
    lobby_session.selected_game_href,
    lobby_session.selected_game_label,
    lobby_session.updated_at,
    lobby_session.created_at
  from public.game_sessions as lobby_session
  where lobby_session.mode = 'party'
    and lobby_session.status in ('waiting', 'active')
    and (
      lobby_session.host_id = v_uid
      or exists (
        select 1
        from public.game_session_players as seated_player
        where seated_player.session_id = lobby_session.id
          and seated_player.profile_id = v_uid
      )
    )
  order by lobby_session.updated_at desc, lobby_session.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_my_party_lobby() from public;
grant execute on function public.get_my_party_lobby() to authenticated, service_role;

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
    and lobby_session.host_friend_code = v_code
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
  v_session_id uuid;
  v_host_code text := upper(trim(coalesce(p_host_friend_code, '')));
  v_requester_code text;
  v_requester_name text;
  v_request_id uuid;
  v_seated boolean;
  v_existing_request uuid;
begin
  if v_requester is null then
    raise exception 'sign in required';
  end if;
  if v_host_code !~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$' then
    raise exception 'invalid lobby code';
  end if;

  select lobby_session.id
    into v_session_id
  from public.game_sessions as lobby_session
  where lobby_session.mode = 'party'
    and lobby_session.host_friend_code = v_host_code
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

  select lobby_session.id
    into v_session_id
  from public.game_sessions as lobby_session
  where lobby_session.host_id = v_host
    and lobby_session.mode = 'party'
    and lobby_session.status = 'waiting'
  order by lobby_session.updated_at desc, lobby_session.created_at desc
  limit 1;

  if v_session_id is null then
    raise exception 'no active lobby';
  end if;

  update public.game_sessions as lobby_session
     set selected_game_key = trim(p_game_key),
         selected_game_href = trim(p_game_href),
         selected_game_label = nullif(trim(p_game_label), ''),
         updated_at = now()
   where lobby_session.id = v_session_id;

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
  v_occupied integer;
  v_ready integer;
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

  select count(*)::integer,
         count(*) filter (where seated_player.ready)::integer
    into v_occupied, v_ready
  from public.game_session_players as seated_player
  where seated_player.session_id = v_session_id;

  if v_occupied < 1 then
    raise exception 'no players seated';
  end if;
  if v_ready < v_occupied then
    raise exception 'all seated players need to ready up (%/% ready)', v_ready, v_occupied;
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

create or replace function public.close_party_lobby(p_session_id uuid default null)
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
     set status = 'cancelled',
         updated_at = now(),
         metadata = coalesce(lobby_session.metadata, '{}'::jsonb)
           || jsonb_build_object('cancelledBy', 'host_closed_lobby', 'cancelledAt', now())
   where lobby_session.id = v_session_id;

  insert into public.lobby_events (session_id, kind, payload)
  values (v_session_id, 'cancelled', jsonb_build_object('reason', 'host_closed_lobby'));

  return true;
end;
$$;

revoke all on function public.close_party_lobby(uuid) from public;
grant execute on function public.close_party_lobby(uuid) to authenticated, service_role;

create or replace function public.leave_party_lobby()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_is_host boolean;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;

  select lobby_session.id, lobby_session.host_id = v_uid
    into v_session_id, v_is_host
  from public.game_sessions as lobby_session
  join public.game_session_players as seated_player
    on seated_player.session_id = lobby_session.id
  where lobby_session.mode = 'party'
    and lobby_session.status in ('waiting', 'active')
    and seated_player.profile_id = v_uid
  order by lobby_session.updated_at desc, lobby_session.created_at desc
  limit 1;

  if v_session_id is null then
    return false;
  end if;

  if v_is_host then
    return public.close_party_lobby(v_session_id);
  end if;

  delete from public.game_session_players as seated_player
   where seated_player.session_id = v_session_id
     and seated_player.profile_id = v_uid;

  update public.game_sessions as lobby_session
     set updated_at = now()
   where lobby_session.id = v_session_id;

  return true;
end;
$$;

revoke all on function public.leave_party_lobby() from public;
grant execute on function public.leave_party_lobby() to authenticated, service_role;
