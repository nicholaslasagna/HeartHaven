-- 0053_multiplayer_delivery_and_chat_sync.sql
--
-- Tighten the live multiplayer delivery chain:
--   1. Party join accepts either a host friend code (HH-ABCDE-123) or the
--      actual lobby invite code (HH-ABCDEF-1234).
--   2. Hosts can read pending lobby join requests through a SECURITY DEFINER
--      RPC, so the UI does not depend on fragile Realtime/RLS table reads.
--   3. Party direct invites carry the lobby invite code in their target URL.
--   4. Room/garden/park chat is persisted briefly server-side and can be
--      polled, so chat sync does not depend only on broadcast packets.

create table if not exists public.place_chat_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  place_type text not null check (place_type in ('room', 'garden', 'park', 'partner-garden')),
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  host_friend_code text not null,
  place_id text not null,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_friend_code text not null,
  sender_display_name text not null default 'Keeper',
  body text not null check (char_length(body) between 1 and 240),
  created_at timestamptz not null default now()
);

create index if not exists place_chat_messages_place_idx
  on public.place_chat_messages (host_friend_code, place_type, place_id, created_at desc);

create index if not exists place_chat_messages_sender_idx
  on public.place_chat_messages (sender_id, created_at desc);

alter table public.place_chat_messages enable row level security;

drop policy if exists "place chat participants read" on public.place_chat_messages;
create policy "place chat participants read"
  on public.place_chat_messages
  for select
  to authenticated
  using (
    sender_id = auth.uid()
    or host_profile_id = auth.uid()
    or exists (
      select 1
      from public.friendships as friendship
      where friendship.status = 'accepted'
        and least(friendship.requester_id, friendship.friend_id) = least(auth.uid(), host_profile_id)
        and greatest(friendship.requester_id, friendship.friend_id) = greatest(auth.uid(), host_profile_id)
    )
  );

drop policy if exists "deny direct place chat insert" on public.place_chat_messages;
create policy "deny direct place chat insert"
  on public.place_chat_messages
  for insert
  to authenticated
  with check (false);

drop policy if exists "deny direct place chat update" on public.place_chat_messages;
create policy "deny direct place chat update"
  on public.place_chat_messages
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "deny direct place chat delete" on public.place_chat_messages;
create policy "deny direct place chat delete"
  on public.place_chat_messages
  for delete
  to authenticated
  using (false);

create or replace function public.can_chat_in_host_place(
  p_host_profile_id uuid,
  p_sender_profile_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    p_host_profile_id = p_sender_profile_id
    or exists (
      select 1
      from public.friendships as friendship
      where friendship.status = 'accepted'
        and least(friendship.requester_id, friendship.friend_id) = least(p_host_profile_id, p_sender_profile_id)
        and greatest(friendship.requester_id, friendship.friend_id) = greatest(p_host_profile_id, p_sender_profile_id)
    );
$$;

revoke all on function public.can_chat_in_host_place(uuid, uuid) from public;
grant execute on function public.can_chat_in_host_place(uuid, uuid) to authenticated, service_role;

create or replace function public.send_place_chat_message(
  p_place_type text,
  p_host_friend_code text,
  p_place_id text,
  p_body text
)
returns table (
  id uuid,
  place_type text,
  place_id text,
  host_friend_code text,
  sender_friend_code text,
  sender_display_name text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_place_type text := lower(trim(coalesce(p_place_type, '')));
  v_host_friend_code text := upper(trim(coalesce(p_host_friend_code, '')));
  v_place_id text := regexp_replace(trim(coalesce(p_place_id, '')), '[^a-zA-Z0-9_-]', '', 'g');
  v_body text := trim(coalesce(p_body, ''));
  v_host_profile_id uuid;
  v_sender_friend_code text;
  v_sender_display_name text;
begin
  if v_sender_id is null then
    raise exception 'sign in required';
  end if;
  if v_place_type not in ('room', 'garden', 'park', 'partner-garden') then
    raise exception 'invalid chat place';
  end if;
  if v_host_friend_code !~ '^HH-[A-Z]{5}-[0-9]{3}$' then
    raise exception 'invalid host code';
  end if;
  if v_place_id = '' then
    raise exception 'missing place id';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 240 then
    raise exception 'message must be 1-240 characters';
  end if;

  select host_profile.id
    into v_host_profile_id
  from public.profiles as host_profile
  where upper(host_profile.friend_code) = v_host_friend_code
  limit 1;

  if v_host_profile_id is null then
    raise exception 'host not found';
  end if;
  if not public.can_chat_in_host_place(v_host_profile_id, v_sender_id) then
    raise exception 'only friends can chat in this place';
  end if;

  select
    sender_profile.friend_code,
    coalesce(nullif(trim(sender_profile.username), ''), nullif(trim(sender_profile.display_name), ''), 'Keeper')
    into v_sender_friend_code, v_sender_display_name
  from public.profiles as sender_profile
  where sender_profile.id = v_sender_id;

  if v_sender_friend_code is null then
    raise exception 'sender profile is missing';
  end if;

  return query
  insert into public.place_chat_messages (
    place_type,
    host_profile_id,
    host_friend_code,
    place_id,
    sender_id,
    sender_friend_code,
    sender_display_name,
    body
  )
  values (
    v_place_type,
    v_host_profile_id,
    v_host_friend_code,
    v_place_id,
    v_sender_id,
    upper(v_sender_friend_code),
    v_sender_display_name,
    v_body
  )
  returning
    place_chat_messages.id,
    place_chat_messages.place_type,
    place_chat_messages.place_id,
    place_chat_messages.host_friend_code,
    place_chat_messages.sender_friend_code,
    place_chat_messages.sender_display_name,
    place_chat_messages.body,
    place_chat_messages.created_at;
end;
$$;

revoke all on function public.send_place_chat_message(text, text, text, text) from public;
grant execute on function public.send_place_chat_message(text, text, text, text) to authenticated, service_role;

create or replace function public.get_place_chat_messages(
  p_place_type text,
  p_host_friend_code text,
  p_place_id text,
  p_limit integer default 30
)
returns table (
  id uuid,
  place_type text,
  place_id text,
  host_friend_code text,
  sender_friend_code text,
  sender_display_name text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid := auth.uid();
  v_place_type text := lower(trim(coalesce(p_place_type, '')));
  v_host_friend_code text := upper(trim(coalesce(p_host_friend_code, '')));
  v_place_id text := regexp_replace(trim(coalesce(p_place_id, '')), '[^a-zA-Z0-9_-]', '', 'g');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_host_profile_id uuid;
begin
  if v_sender_id is null then
    raise exception 'sign in required';
  end if;
  if v_place_type not in ('room', 'garden', 'park', 'partner-garden') then
    raise exception 'invalid chat place';
  end if;
  if v_host_friend_code !~ '^HH-[A-Z]{5}-[0-9]{3}$' then
    raise exception 'invalid host code';
  end if;
  if v_place_id = '' then
    raise exception 'missing place id';
  end if;

  select host_profile.id
    into v_host_profile_id
  from public.profiles as host_profile
  where upper(host_profile.friend_code) = v_host_friend_code
  limit 1;

  if v_host_profile_id is null then
    raise exception 'host not found';
  end if;
  if not public.can_chat_in_host_place(v_host_profile_id, v_sender_id) then
    raise exception 'only friends can read this chat';
  end if;

  return query
  select
    message.id,
    message.place_type,
    message.place_id,
    message.host_friend_code,
    message.sender_friend_code,
    message.sender_display_name,
    message.body,
    message.created_at
  from public.place_chat_messages as message
  where message.place_type = v_place_type
    and message.host_friend_code = v_host_friend_code
    and message.place_id = v_place_id
  order by message.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.get_place_chat_messages(text, text, text, integer) from public;
grant execute on function public.get_place_chat_messages(text, text, text, integer) to authenticated, service_role;

create or replace function public.get_my_lobby_join_requests(p_session_id uuid)
returns table (
  id uuid,
  session_id uuid,
  requester_profile_id uuid,
  requester_friend_code text,
  requester_display_name text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid := auth.uid();
begin
  if v_host_id is null then
    raise exception 'sign in required';
  end if;

  if not exists (
    select 1
    from public.game_sessions as lobby_session
    where lobby_session.id = p_session_id
      and lobby_session.host_id = v_host_id
  ) then
    raise exception 'only the host can read join requests';
  end if;

  return query
  select
    join_request.id,
    join_request.session_id,
    join_request.requester_profile_id,
    join_request.requester_friend_code,
    join_request.requester_display_name,
    join_request.status,
    join_request.created_at
  from public.lobby_join_requests as join_request
  where join_request.session_id = p_session_id
    and join_request.status = 'pending'
  order by join_request.created_at asc;
end;
$$;

revoke all on function public.get_my_lobby_join_requests(uuid) from public;
grant execute on function public.get_my_lobby_join_requests(uuid) to authenticated, service_role;

create or replace function public.request_join_party(p_host_friend_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid := auth.uid();
  v_session_id uuid;
  v_join_code text := upper(trim(coalesce(p_host_friend_code, '')));
  v_requester_code text;
  v_requester_name text;
  v_request_id uuid;
  v_seated boolean;
  v_existing_request uuid;
begin
  if v_requester is null then
    raise exception 'sign in required';
  end if;
  if v_join_code !~ '^HH-[A-Z]{5,6}-[0-9]{3,4}$' then
    raise exception 'invalid lobby code';
  end if;

  select lobby_session.id
    into v_session_id
  from public.game_sessions as lobby_session
  where (lobby_session.host_friend_code = v_join_code or lobby_session.invite_code = v_join_code)
    and lobby_session.status = 'waiting'
  order by lobby_session.updated_at desc, lobby_session.created_at desc
  limit 1;

  if v_session_id is null then
    raise exception 'no open lobby for that code';
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
     where game_sessions.id = v_session_id;
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
    update public.game_sessions
       set updated_at = now()
     where game_sessions.id = v_session_id;
    return v_existing_request;
  end if;

  select
    profiles.friend_code,
    coalesce(nullif(trim(profiles.username), ''), nullif(trim(profiles.display_name), ''), 'Keeper')
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
   where game_sessions.id = v_session_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_join_party(text) from public;
grant execute on function public.request_join_party(text) to authenticated, service_role;

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

    select lobby_session.id, lobby_session.host_id, lobby_session.status, lobby_session.invite_code
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

    v_target_url := '/app/games?join=' || v_target_session.invite_code;
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.current_place_invites; exception when others then null; end;
    begin alter publication supabase_realtime add table public.lobby_join_requests; exception when others then null; end;
    begin alter publication supabase_realtime add table public.lobby_events; exception when others then null; end;
    begin alter publication supabase_realtime add table public.place_chat_messages; exception when others then null; end;
  end if;
end $$;
