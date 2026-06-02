-- 0055_lobby_invite_polling_and_rls_recursion.sql
--
-- Live multiplayer repair:
--   1. get_my_pending_place_invites() used bare expires_at/status names
--      inside a RETURNS TABLE function. Postgres resolved expires_at
--      ambiguously between the output column and current_place_invites.
--   2. The browser lobby hook read game_sessions and game_session_players
--      directly. Their RLS policies refer to each other, which can recurse
--      for direct PostgREST reads. Keep the policies, but expose narrow
--      SECURITY DEFINER RPCs for the lobby UI.

create or replace function public.get_my_pending_place_invites()
returns table (
  id uuid,
  invite_type text,
  target_url text,
  target_session_id uuid,
  host_friend_code text,
  garden_id text,
  room_id text,
  inviter_friend_code text,
  inviter_display_name text,
  expires_at timestamptz,
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

  update public.current_place_invites as pending_invite
     set status = 'expired'
   where pending_invite.recipient_id = v_uid
     and pending_invite.status = 'pending'
     and pending_invite.expires_at <= now();

  return query
  select
    place_invite.id,
    place_invite.invite_type,
    place_invite.target_url,
    place_invite.target_session_id,
    place_invite.host_friend_code,
    place_invite.garden_id,
    place_invite.room_id,
    inviter_profile.friend_code as inviter_friend_code,
    coalesce(nullif(trim(inviter_profile.username), ''), nullif(trim(inviter_profile.display_name), ''), 'Keeper') as inviter_display_name,
    place_invite.expires_at,
    place_invite.created_at
  from public.current_place_invites as place_invite
  join public.profiles as inviter_profile
    on inviter_profile.id = place_invite.inviter_id
  where place_invite.recipient_id = v_uid
    and place_invite.status = 'pending'
    and place_invite.expires_at > now()
  order by place_invite.created_at desc
  limit 20;
end;
$$;

revoke all on function public.get_my_pending_place_invites() from public;
grant execute on function public.get_my_pending_place_invites() to authenticated, service_role;

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
  where lobby_session.status in ('waiting', 'active')
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

create or replace function public.get_party_lobby_seats(p_session_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  seat_index integer,
  team_key text,
  ready boolean
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
  if p_session_id is null then
    raise exception 'session required';
  end if;

  if not exists (
    select 1
    from public.game_sessions as lobby_session
    where lobby_session.id = p_session_id
      and lobby_session.status in ('waiting', 'active')
      and (
        lobby_session.host_id = v_uid
        or exists (
          select 1
          from public.game_session_players as caller_seat
          where caller_seat.session_id = lobby_session.id
            and caller_seat.profile_id = v_uid
        )
      )
  ) then
    raise exception 'not a lobby member';
  end if;

  return query
  select
    seated_player.profile_id,
    seated_player.display_name,
    seated_player.seat_index,
    seated_player.team_key,
    seated_player.ready
  from public.game_session_players as seated_player
  where seated_player.session_id = p_session_id
  order by seated_player.seat_index asc;
end;
$$;

revoke all on function public.get_party_lobby_seats(uuid) from public;
grant execute on function public.get_party_lobby_seats(uuid) to authenticated, service_role;

create or replace function public.set_party_lobby_ready(
  p_session_id uuid,
  p_ready boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;
  if p_session_id is null then
    raise exception 'session required';
  end if;

  update public.game_session_players as seated_player
     set ready = coalesce(p_ready, false),
         updated_at = now()
   where seated_player.session_id = p_session_id
     and seated_player.profile_id = v_uid;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'not seated in this lobby';
  end if;

  update public.game_sessions as lobby_session
     set updated_at = now()
   where lobby_session.id = p_session_id;

  insert into public.lobby_events (session_id, kind, payload)
  values (
    p_session_id,
    'ready_changed',
    jsonb_build_object('profile_id', v_uid, 'ready', coalesce(p_ready, false))
  );

  return true;
end;
$$;

revoke all on function public.set_party_lobby_ready(uuid, boolean) from public;
grant execute on function public.set_party_lobby_ready(uuid, boolean) to authenticated, service_role;
