-- 0052_party_lobby_invite_and_solo_start.sql
--
-- Fix the live party lobby chain:
--   1. Join requests must target the newest waiting lobby for the host,
--      not any arbitrary waiting/active game_sessions row with the same
--      friend code.
--   2. Party invite cards must carry a usable /app/games?join=<host-code>
--      target instead of a bare /app/games route.
--   3. Hosts can start once all currently seated players are ready. A
--      chosen lobby size is a cap, not a requirement, so solo play works.

drop policy if exists "requester reads own join requests" on public.lobby_join_requests;
drop policy if exists "requester_or_host_reads_join_requests" on public.lobby_join_requests;
create policy "requester_or_host_reads_join_requests"
  on public.lobby_join_requests
  for select
  to authenticated
  using (
    public.lobby_join_requests.requester_profile_id = auth.uid()
    or exists (
      select 1
      from public.game_sessions as lobby_session
      where lobby_session.id = public.lobby_join_requests.session_id
        and lobby_session.host_id = auth.uid()
    )
  );

create or replace function public.create_party_lobby(
  p_max_players integer default 4
)
returns table (session_id uuid, invite_code text, host_friend_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_host_code text;
  v_display text;
  v_cancelled_id uuid;
  v_new_id uuid;
  v_invite_code text;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;
  if p_max_players < 2 or p_max_players > 12 then
    raise exception 'max_players must be between 2 and 12';
  end if;

  select profiles.friend_code, coalesce(nullif(trim(profiles.username), ''), nullif(trim(profiles.display_name), ''), 'Keeper')
    into v_host_code, v_display
  from public.profiles
  where profiles.id = v_host;
  if v_host_code is null then
    raise exception 'no profile row for host (sign out + sign back in to fix)';
  end if;

  for v_cancelled_id in
    update public.game_sessions
       set status = 'cancelled',
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('cancelledBy', 'host_started_new_lobby', 'cancelledAt', now())
     where host_id = v_host
       and status in ('waiting', 'active')
     returning id
  loop
    insert into public.lobby_events (session_id, kind, payload)
    values (v_cancelled_id, 'cancelled', jsonb_build_object('reason', 'host_started_new_lobby'));
  end loop;

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
    session_id, profile_id, display_name, seat_index, team_key, ready
  ) values (
    v_new_id, v_host, coalesce(v_display, 'Keeper'), 0, 'host', true
  )
  on conflict (session_id, profile_id) do update
    set display_name = excluded.display_name,
        ready = true,
        updated_at = now();

  select game_session.invite_code
    into v_invite_code
  from public.game_sessions as game_session
  where game_session.id = v_new_id;

  session_id := v_new_id;
  invite_code := v_invite_code;
  host_friend_code := upper(v_host_code);
  return next;
end;
$$;

revoke all on function public.create_party_lobby(integer) from public;
grant execute on function public.create_party_lobby(integer) to authenticated, service_role;

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
  where lobby_session.host_friend_code = v_code
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
  where lobby_session.host_friend_code = v_host_code
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
    update public.game_sessions
       set updated_at = now()
     where id = v_session_id;
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

  select profiles.friend_code, coalesce(nullif(trim(profiles.username), ''), nullif(trim(profiles.display_name), ''), 'Keeper')
    into v_requester_code, v_requester_name
  from public.profiles
  where profiles.id = v_requester;
  if v_requester_code is null then
    raise exception 'no profile row for requester (sign out + sign back in to fix)';
  end if;

  insert into public.lobby_join_requests (
    session_id, requester_profile_id, requester_friend_code, requester_display_name
  ) values (
    v_session_id, v_requester, upper(v_requester_code), coalesce(v_requester_name, 'Keeper')
  )
  returning lobby_join_requests.id into v_request_id;

  update public.game_sessions
     set updated_at = now()
   where id = v_session_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_join_party(text) from public;
grant execute on function public.request_join_party(text) to authenticated, service_role;

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
    and lobby_session.status = 'waiting'
    and lobby_session.mode = 'party'
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

  update public.game_sessions
     set status = 'active', started_at = now(), updated_at = now()
   where id = v_session_id;

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

create or replace function public.invite_friend_to_current_place(
  p_friend_code text,
  p_invite_type text,
  p_target_url text,
  p_target_session_id uuid default null,
  p_garden_id text default null,
  p_room_id text default null
)
returns table (
  invite_id uuid,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter_profile_id uuid := auth.uid();
  v_recipient_profile_id uuid;
  v_friend_code text := upper(trim(coalesce(p_friend_code, '')));
  v_invite_type text := lower(trim(coalesce(p_invite_type, '')));
  v_target_url text := trim(coalesce(p_target_url, ''));
  v_host_friend_code text;
  v_existing_invite_id uuid;
  v_existing_expires_at timestamptz;
  v_target_session record;
begin
  if v_inviter_profile_id is null then
    raise exception 'sign in required';
  end if;

  if v_invite_type not in ('room', 'garden', 'park', 'party', 'game') then
    raise exception 'invalid invite type';
  end if;

  if v_target_url not like '/app/%' or char_length(v_target_url) > 512 then
    raise exception 'invalid target url';
  end if;

  select recipient_profile.id
    into v_recipient_profile_id
    from public.profiles as recipient_profile
   where upper(recipient_profile.friend_code) = v_friend_code
   limit 1;

  if v_recipient_profile_id is null then
    raise exception 'friend not found';
  end if;

  if v_recipient_profile_id = v_inviter_profile_id then
    raise exception 'cannot invite yourself';
  end if;

  if not exists (
    select 1
      from public.friendships as friendship
     where friendship.status = 'accepted'
       and least(friendship.requester_id, friendship.friend_id) = least(v_inviter_profile_id, v_recipient_profile_id)
       and greatest(friendship.requester_id, friendship.friend_id) = greatest(v_inviter_profile_id, v_recipient_profile_id)
  ) then
    raise exception 'only friends can be invited';
  end if;

  select inviter_profile.friend_code
    into v_host_friend_code
    from public.profiles as inviter_profile
   where inviter_profile.id = v_inviter_profile_id;

  if v_host_friend_code is null or trim(v_host_friend_code) = '' then
    raise exception 'host friend code is missing';
  end if;

  if v_invite_type in ('room', 'garden', 'park') then
    v_target_url := regexp_replace(v_target_url, '([?&])visit=[^&]*&?', '\1', 'g');
    v_target_url := regexp_replace(v_target_url, '[?&]$', '');
    v_target_url := v_target_url ||
      case when position('?' in v_target_url) > 0 then '&' else '?' end ||
      'visit=' || v_host_friend_code;
  elsif v_invite_type = 'party' then
    if p_target_session_id is null then
      raise exception 'party invite missing lobby session';
    end if;

    select lobby_session.id, lobby_session.host_id, lobby_session.status
      into v_target_session
    from public.game_sessions as lobby_session
    where lobby_session.id = p_target_session_id
    limit 1;

    if v_target_session.id is null then
      raise exception 'party lobby not found';
    end if;
    if v_target_session.host_id <> v_inviter_profile_id then
      raise exception 'only the lobby host can invite friends';
    end if;
    if v_target_session.status <> 'waiting' then
      raise exception 'party lobby is no longer accepting invites';
    end if;

    v_target_url := '/app/games?join=' || v_host_friend_code;
  end if;

  if v_target_url not like '/app/%' or char_length(v_target_url) > 512 then
    raise exception 'invalid target url';
  end if;

  update public.current_place_invites as place_invite
     set target_session_id = p_target_session_id,
         host_profile_id = v_inviter_profile_id,
         host_friend_code = v_host_friend_code,
         garden_id = nullif(trim(coalesce(p_garden_id, '')), ''),
         room_id = nullif(trim(coalesce(p_room_id, '')), ''),
         expires_at = now() + interval '15 minutes',
         accepted_at = null,
         declined_at = null
   where place_invite.inviter_id = v_inviter_profile_id
     and place_invite.recipient_id = v_recipient_profile_id
     and place_invite.invite_type = v_invite_type
     and place_invite.target_url = v_target_url
     and place_invite.status = 'pending'
   returning place_invite.id, place_invite.expires_at
        into v_existing_invite_id, v_existing_expires_at;

  if v_existing_invite_id is not null then
    invite_id := v_existing_invite_id;
    status := 'pending';
    expires_at := v_existing_expires_at;
    return next;
    return;
  end if;

  insert into public.current_place_invites as inserted_invite (
    inviter_id,
    recipient_id,
    invite_type,
    target_url,
    target_session_id,
    host_profile_id,
    host_friend_code,
    garden_id,
    room_id
  )
  values (
    v_inviter_profile_id,
    v_recipient_profile_id,
    v_invite_type,
    v_target_url,
    p_target_session_id,
    v_inviter_profile_id,
    v_host_friend_code,
    nullif(trim(coalesce(p_garden_id, '')), ''),
    nullif(trim(coalesce(p_room_id, '')), '')
  )
  returning inserted_invite.id, inserted_invite.expires_at
       into invite_id, expires_at;

  status := 'pending';
  return next;
end;
$$;

revoke all on function public.invite_friend_to_current_place(text, text, text, uuid, text, text) from public;
grant execute on function public.invite_friend_to_current_place(text, text, text, uuid, text, text) to authenticated, service_role;

with canonical_party_invites as (
  select
    place_invite.id,
    '/app/games?join=' || place_invite.host_friend_code as canonical_target_url,
    row_number() over (
      partition by
        place_invite.inviter_id,
        place_invite.recipient_id,
        place_invite.invite_type,
        '/app/games?join=' || place_invite.host_friend_code
      order by place_invite.created_at desc, place_invite.id desc
    ) as canonical_rank
  from public.current_place_invites as place_invite
  where place_invite.status = 'pending'
    and place_invite.invite_type = 'party'
    and place_invite.target_session_id is not null
    and place_invite.host_friend_code is not null
    and trim(place_invite.host_friend_code) <> ''
)
update public.current_place_invites as place_invite
   set target_url = canonical_party_invites.canonical_target_url
  from canonical_party_invites
 where place_invite.id = canonical_party_invites.id
   and canonical_party_invites.canonical_rank = 1
   and place_invite.target_url <> canonical_party_invites.canonical_target_url
   and not exists (
     select 1
       from public.current_place_invites as conflicting_invite
      where conflicting_invite.id <> place_invite.id
        and conflicting_invite.inviter_id = place_invite.inviter_id
        and conflicting_invite.recipient_id = place_invite.recipient_id
        and conflicting_invite.invite_type = place_invite.invite_type
        and conflicting_invite.target_url = canonical_party_invites.canonical_target_url
        and conflicting_invite.status = 'pending'
   );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.lobby_join_requests; exception when others then null; end;
    begin alter publication supabase_realtime add table public.lobby_events; exception when others then null; end;
    begin alter publication supabase_realtime add table public.current_place_invites; exception when others then null; end;
  end if;
end $$;
