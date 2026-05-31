-- 0045_current_place_invites.sql
--
-- Server-backed "invite this friend to where I am right now" flow.
-- Friend requests, copyable visit links, and party request codes all still
-- exist, but this table/RPC pair is the single direct invite path used by
-- room, garden, park, and party lobby buttons.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.current_place_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  invite_type text not null check (invite_type in ('room', 'garden', 'park', 'party', 'game')),
  target_url text not null check (
    char_length(target_url) between 5 and 512
    and target_url like '/app/%'
  ),
  target_session_id uuid references public.game_sessions(id) on delete cascade,
  host_profile_id uuid references public.profiles(id) on delete cascade,
  host_friend_code text,
  garden_id text,
  room_id text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  accepted_at timestamptz,
  declined_at timestamptz,
  check (inviter_id <> recipient_id)
);

create index if not exists current_place_invites_recipient_idx
  on public.current_place_invites (recipient_id, status, expires_at desc);

create index if not exists current_place_invites_inviter_idx
  on public.current_place_invites (inviter_id, created_at desc);

create unique index if not exists current_place_invites_one_pending_target
  on public.current_place_invites (inviter_id, recipient_id, invite_type, target_url)
  where status = 'pending';

alter table public.current_place_invites enable row level security;

drop policy if exists "place invite participants read" on public.current_place_invites;
create policy "place invite participants read"
  on public.current_place_invites
  for select
  to authenticated
  using (auth.uid() in (inviter_id, recipient_id));

drop policy if exists "deny direct place invite insert" on public.current_place_invites;
create policy "deny direct place invite insert"
  on public.current_place_invites
  for insert
  to authenticated
  with check (false);

drop policy if exists "deny direct place invite update" on public.current_place_invites;
create policy "deny direct place invite update"
  on public.current_place_invites
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "deny direct place invite delete" on public.current_place_invites;
create policy "deny direct place invite delete"
  on public.current_place_invites
  for delete
  to authenticated
  using (false);

create or replace function public.touch_current_place_invite_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists current_place_invites_touch_updated_at on public.current_place_invites;
create trigger current_place_invites_touch_updated_at
  before update on public.current_place_invites
  for each row
  execute function public.touch_current_place_invite_updated_at();

create or replace function public.invite_friend_to_current_place(
  p_friend_code text,
  p_invite_type text,
  p_target_url text,
  p_target_session_id uuid default null,
  p_garden_id text default null,
  p_room_id text default null
)
returns table (
  id uuid,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter uuid := auth.uid();
  v_recipient uuid;
  v_friend_code text := upper(trim(coalesce(p_friend_code, '')));
  v_invite_type text := lower(trim(coalesce(p_invite_type, '')));
  v_target_url text := trim(coalesce(p_target_url, ''));
  v_host_code text;
  v_existing_id uuid;
  v_existing_expires_at timestamptz;
begin
  if v_inviter is null then
    raise exception 'sign in required';
  end if;

  if v_invite_type not in ('room', 'garden', 'park', 'party', 'game') then
    raise exception 'invalid invite type';
  end if;

  if v_target_url not like '/app/%' or char_length(v_target_url) > 512 then
    raise exception 'invalid target url';
  end if;

  select id into v_recipient
  from public.profiles
  where upper(friend_code) = v_friend_code
  limit 1;

  if v_recipient is null then
    raise exception 'friend not found';
  end if;

  if v_recipient = v_inviter then
    raise exception 'cannot invite yourself';
  end if;

  if not exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.friend_id) = least(v_inviter, v_recipient)
      and greatest(f.requester_id, f.friend_id) = greatest(v_inviter, v_recipient)
  ) then
    raise exception 'only friends can be invited';
  end if;

  select friend_code into v_host_code
  from public.profiles
  where id = v_inviter;

  update public.current_place_invites cpi
     set target_session_id = p_target_session_id,
         host_profile_id = v_inviter,
         host_friend_code = v_host_code,
         garden_id = nullif(trim(coalesce(p_garden_id, '')), ''),
         room_id = nullif(trim(coalesce(p_room_id, '')), ''),
         expires_at = now() + interval '15 minutes',
         accepted_at = null,
         declined_at = null
   where cpi.inviter_id = v_inviter
     and cpi.recipient_id = v_recipient
     and cpi.invite_type = v_invite_type
     and cpi.target_url = v_target_url
     and cpi.status = 'pending'
   returning cpi.id, cpi.expires_at into v_existing_id, v_existing_expires_at;

  if v_existing_id is not null then
    id := v_existing_id;
    status := 'pending';
    expires_at := v_existing_expires_at;
    return next;
    return;
  end if;

  insert into public.current_place_invites (
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
    v_inviter,
    v_recipient,
    v_invite_type,
    v_target_url,
    p_target_session_id,
    v_inviter,
    v_host_code,
    nullif(trim(coalesce(p_garden_id, '')), ''),
    nullif(trim(coalesce(p_room_id, '')), '')
  )
  returning current_place_invites.id, current_place_invites.expires_at
    into id, expires_at;

  status := 'pending';
  return next;
end;
$$;

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

  update public.current_place_invites
     set status = 'expired'
   where recipient_id = v_uid
     and status = 'pending'
     and expires_at <= now();

  return query
  select
    cpi.id,
    cpi.invite_type,
    cpi.target_url,
    cpi.target_session_id,
    cpi.host_friend_code,
    cpi.garden_id,
    cpi.room_id,
    inviter.friend_code as inviter_friend_code,
    coalesce(nullif(trim(inviter.username), ''), nullif(trim(inviter.display_name), ''), 'Keeper') as inviter_display_name,
    cpi.expires_at,
    cpi.created_at
  from public.current_place_invites cpi
  join public.profiles inviter on inviter.id = cpi.inviter_id
  where cpi.recipient_id = v_uid
    and cpi.status = 'pending'
    and cpi.expires_at > now()
  order by cpi.created_at desc
  limit 20;
end;
$$;

create or replace function public.respond_to_place_invite(
  p_invite_id uuid,
  p_response text
)
returns table (
  ok boolean,
  status text,
  target_url text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_response text := lower(trim(coalesce(p_response, '')));
  v_invite public.current_place_invites%rowtype;
  v_session public.game_sessions%rowtype;
  v_display_name text;
  v_occupied integer;
  v_next_seat integer;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;

  if v_response not in ('accepted', 'declined') then
    raise exception 'response must be accepted or declined';
  end if;

  select *
    into v_invite
  from public.current_place_invites
  where id = p_invite_id
    and recipient_id = v_uid
  for update;

  if not found then
    ok := false;
    status := 'missing';
    target_url := null;
    message := 'Invite not found.';
    return next;
    return;
  end if;

  if v_invite.status <> 'pending' then
    ok := false;
    status := v_invite.status;
    target_url := v_invite.target_url;
    message := 'Invite is no longer pending.';
    return next;
    return;
  end if;

  if v_invite.expires_at <= now() then
    update public.current_place_invites
       set status = 'expired'
     where id = v_invite.id;
    ok := false;
    status := 'expired';
    target_url := null;
    message := 'Invite expired.';
    return next;
    return;
  end if;

  if v_response = 'declined' then
    update public.current_place_invites
       set status = 'declined',
           declined_at = now()
     where id = v_invite.id;
    ok := true;
    status := 'declined';
    target_url := null;
    message := 'Invite declined.';
    return next;
    return;
  end if;

  if v_invite.invite_type = 'party' and v_invite.target_session_id is not null then
    select *
      into v_session
    from public.game_sessions
    where id = v_invite.target_session_id
    for update;

    if not found or v_session.status not in ('waiting', 'active') then
      ok := false;
      status := 'missing';
      target_url := null;
      message := 'Lobby is no longer available.';
      return next;
      return;
    end if;

    if not exists (
      select 1
      from public.game_session_players
      where session_id = v_session.id
        and profile_id = v_uid
    ) then
      select count(*)::integer
        into v_occupied
      from public.game_session_players
      where session_id = v_session.id;

      if v_occupied >= v_session.max_players then
        ok := false;
        status := 'full';
        target_url := null;
        message := 'Lobby is full.';
        return next;
        return;
      end if;

      select coalesce(min(g.s), v_occupied)
        into v_next_seat
      from generate_series(0, v_session.max_players - 1) g(s)
      where g.s not in (
        select seat_index
        from public.game_session_players
        where session_id = v_session.id
      );

      select coalesce(nullif(trim(username), ''), nullif(trim(display_name), ''), 'Keeper')
        into v_display_name
      from public.profiles
      where id = v_uid;

      insert into public.game_session_players (
        session_id,
        profile_id,
        display_name,
        seat_index,
        team_key,
        ready
      )
      values (
        v_session.id,
        v_uid,
        coalesce(v_display_name, 'Keeper'),
        v_next_seat,
        'guest',
        false
      )
      on conflict (session_id, profile_id) do nothing;

      insert into public.lobby_events (session_id, kind, payload)
      values (
        v_session.id,
        'join_approved',
        jsonb_build_object('profile_id', v_uid, 'source', 'place_invite')
      );
    end if;
  end if;

  update public.current_place_invites
     set status = 'accepted',
         accepted_at = now()
   where id = v_invite.id;

  ok := true;
  status := 'accepted';
  target_url := v_invite.target_url;
  message := 'Invite accepted.';
  return next;
end;
$$;

revoke all on function public.invite_friend_to_current_place(text, text, text, uuid, text, text) from public;
revoke all on function public.get_my_pending_place_invites() from public;
revoke all on function public.respond_to_place_invite(uuid, text) from public;

grant execute on function public.invite_friend_to_current_place(text, text, text, uuid, text, text) to authenticated, service_role;
grant execute on function public.get_my_pending_place_invites() to authenticated, service_role;
grant execute on function public.respond_to_place_invite(uuid, text) to authenticated, service_role;

do $$
begin
  alter publication supabase_realtime add table public.current_place_invites;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
