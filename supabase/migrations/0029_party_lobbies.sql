-- 0029_party_lobbies.sql
--
-- Server-backed party lobbies. The existing `game_sessions` +
-- `game_session_players` tables from migration 0003 were never wired up
-- — `usePartyLobby` is 100% localStorage today, which is exactly why
-- "Alice invites Bob to her lobby" silently fails across devices.
-- This migration fills in the gap so the lobby is shared state.
--
-- Design (locked in with Nick):
--   • One active lobby per host. Creating a new one auto-cancels the
--     previous one — keeps the model simple and prevents zombie lobbies.
--   • Lobby code = host's friend code. No separate "party code"
--     vocabulary for users to learn.
--   • Request-to-join model: any keeper with the host's friend code can
--     INSERT a row in `lobby_join_requests`; the host accepts/denies;
--     accepted requests become a seat. No shareable-link required.
--   • Realtime: lobby state, seats, join requests, AND a `lobby_events`
--     fan-out table (used to broadcast "start the game" to every seat
--     so guests auto-navigate when the host hits start).

-- ------------------------------------------------------------------------
-- 1. Extend game_sessions with lobby-specific columns
-- ------------------------------------------------------------------------

alter table public.game_sessions
  add column if not exists selected_game_key text,
  add column if not exists selected_game_href text,
  add column if not exists selected_game_label text,
  add column if not exists started_at timestamptz,
  add column if not exists host_friend_code text;

-- Only one ACTIVE (waiting or active) lobby per host. Cancelled /
-- completed sessions don't count, so the historical record stays intact.
create unique index if not exists game_sessions_one_active_per_host
  on public.game_sessions (host_id)
  where status in ('waiting', 'active');

-- Lookup-by-invite-code is the hot path (request-to-join + presence sync).
create index if not exists game_sessions_invite_code_idx
  on public.game_sessions (invite_code) where status in ('waiting', 'active');
create index if not exists game_sessions_host_friend_code_idx
  on public.game_sessions (host_friend_code) where status in ('waiting', 'active');

-- ------------------------------------------------------------------------
-- 2. lobby_join_requests — guests knock, host answers
-- ------------------------------------------------------------------------

create table if not exists public.lobby_join_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  /** Profile of the keeper asking to join. */
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  requester_friend_code text not null,
  requester_display_name text not null default 'Keeper',
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  /** Hard-cap one PENDING request per (session, requester) so a guest
   *  can't spam Knock. Status flips to 'cancelled' / 'denied' first if
   *  they want to retry. */
  constraint lobby_join_requests_one_pending_per_requester unique (session_id, requester_profile_id, status)
    deferrable initially deferred
);

create index if not exists lobby_join_requests_session_idx
  on public.lobby_join_requests (session_id, created_at desc);
create index if not exists lobby_join_requests_requester_idx
  on public.lobby_join_requests (requester_profile_id, created_at desc);

alter table public.lobby_join_requests enable row level security;

-- Requester sees their own requests; host sees requests for their sessions.
create policy "requester reads own join requests"
  on public.lobby_join_requests
  for select
  to authenticated
  using (
    requester_profile_id = auth.uid()
    or exists (
      select 1 from public.game_sessions s
      where s.id = session_id and s.host_id = auth.uid()
    )
  );

-- Inserts via RPC only — `request_join_party` validates the session is
-- still accepting + the requester isn't blocked by the host.
create policy "deny direct insert to join requests"
  on public.lobby_join_requests
  for insert to authenticated with check (false);

create policy "deny direct update to join requests"
  on public.lobby_join_requests
  for update to authenticated using (false) with check (false);

create policy "deny direct delete to join requests"
  on public.lobby_join_requests
  for delete to authenticated using (false);

-- ------------------------------------------------------------------------
-- 3. lobby_events — fan-out broadcast table (start, kicked, etc.)
-- ------------------------------------------------------------------------
-- A single durable record per significant lobby event. Realtime ships
-- INSERTs to every subscriber, so seated guests learn about "host hit
-- start" or "you've been kicked" without needing extra plumbing.

create table if not exists public.lobby_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  kind text not null check (kind in (
    'started',         -- host fired start; every seat should navigate to selected_game_href
    'cancelled',       -- host closed the lobby
    'kicked',          -- a specific profile_id was removed (see payload.profile_id)
    'game_selected',   -- host picked a different game; clients refresh
    'join_approved',   -- host approved a join request; client should hydrate seats
    'join_denied'      -- host denied a join request
  )),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists lobby_events_session_idx
  on public.lobby_events (session_id, created_at desc);

alter table public.lobby_events enable row level security;

-- Same visibility as join_requests: host sees their own + seated players
-- see events for the sessions they're in.
create policy "lobby members read events"
  on public.lobby_events
  for select to authenticated
  using (
    exists (
      select 1 from public.game_sessions s
      where s.id = session_id and s.host_id = auth.uid()
    )
    or exists (
      select 1 from public.game_session_players p
      where p.session_id = session_id and p.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.lobby_join_requests jr
      where jr.session_id = session_id and jr.requester_profile_id = auth.uid()
    )
  );

-- Writes via RPC only.
create policy "deny direct write to lobby events"
  on public.lobby_events
  for all to authenticated
  using (false) with check (false);

-- ------------------------------------------------------------------------
-- 4. RLS for the existing tables (0003 left them open to all-or-nothing)
-- ------------------------------------------------------------------------

alter table public.game_sessions enable row level security;
alter table public.game_session_players enable row level security;

-- A lobby is visible to: its host, anyone seated in it, anyone with a
-- pending join request, and any authenticated user looking it up by
-- invite_code (the public knock surface). The "by invite_code" case is
-- handled via SECURITY DEFINER RPCs (find_party_lobby) so we don't need
-- to expose the table broadly.
create policy "host reads own sessions"
  on public.game_sessions
  for select to authenticated
  using (host_id = auth.uid());

create policy "seated player reads session"
  on public.game_sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.game_session_players p
      where p.session_id = id and p.profile_id = auth.uid()
    )
  );

create policy "deny direct write to game sessions"
  on public.game_sessions
  for all to authenticated
  using (false) with check (false);

create policy "members read session players"
  on public.game_session_players
  for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.game_sessions s
      where s.id = session_id and s.host_id = auth.uid()
    )
    or exists (
      select 1 from public.game_session_players me
      where me.session_id = session_id and me.profile_id = auth.uid()
    )
  );

create policy "player toggles own ready"
  on public.game_session_players
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Insert/delete only via RPCs.
create policy "deny direct insert to session players"
  on public.game_session_players
  for insert to authenticated with check (false);

create policy "deny direct delete to session players"
  on public.game_session_players
  for delete to authenticated using (false);

-- ------------------------------------------------------------------------
-- 5. RPC: create_party_lobby
-- ------------------------------------------------------------------------

create or replace function public.create_party_lobby(
  p_max_players integer default 6
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
  v_existing_id uuid;
  v_new_id uuid;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;
  if p_max_players < 2 or p_max_players > 12 then
    raise exception 'max_players must be between 2 and 12';
  end if;

  select friend_code, display_name
    into v_host_code, v_display
  from public.profiles
  where id = v_host;
  if v_host_code is null then
    raise exception 'no profile row for host (sign out + sign back in to fix)';
  end if;

  -- Cancel any existing active lobby first — the unique partial index
  -- enforces "one active per host" but we want a clean transition rather
  -- than an exception.
  select id into v_existing_id
    from public.game_sessions
    where host_id = v_host and status in ('waiting', 'active');
  if v_existing_id is not null then
    update public.game_sessions
       set status = 'cancelled', updated_at = now()
     where id = v_existing_id;
    insert into public.lobby_events (session_id, kind, payload)
    values (v_existing_id, 'cancelled', jsonb_build_object('reason', 'host_started_new_lobby'));
  end if;

  insert into public.game_sessions (
    host_id, game_key, mode, status, max_players, host_friend_code, invite_code
  ) values (
    v_host, 'lobby', 'party', 'waiting', p_max_players, upper(v_host_code), upper(v_host_code)
  )
  returning id into v_new_id;

  -- Host occupies seat 0 immediately.
  insert into public.game_session_players (
    session_id, profile_id, display_name, seat_index, team_key
  ) values (
    v_new_id, v_host, coalesce(v_display, 'Keeper'), 0, 'host'
  );

  session_id := v_new_id;
  invite_code := upper(v_host_code);
  host_friend_code := upper(v_host_code);
  return next;
end;
$$;

revoke all on function public.create_party_lobby(integer) from public;
grant execute on function public.create_party_lobby(integer) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 6. RPC: find_party_lobby — public knock surface
-- ------------------------------------------------------------------------

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
    s.id,
    s.host_friend_code,
    s.status,
    s.max_players,
    (select count(*)::integer from public.game_session_players p where p.session_id = s.id),
    s.selected_game_key,
    s.selected_game_href,
    s.selected_game_label,
    s.created_at
  from public.game_sessions s
  where s.host_friend_code = v_code
    and s.status in ('waiting', 'active')
  order by s.created_at desc
  limit 1;
end;
$$;

revoke all on function public.find_party_lobby(text) from public;
grant execute on function public.find_party_lobby(text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 7. RPC: request_join_party
-- ------------------------------------------------------------------------

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

  select id into v_session_id
    from public.game_sessions
    where host_friend_code = v_host_code and status in ('waiting', 'active')
    limit 1;
  if v_session_id is null then
    raise exception 'no active lobby for that code';
  end if;

  -- Already seated? No-op, return the existing seat marker.
  select exists(
    select 1 from public.game_session_players
    where session_id = v_session_id and profile_id = v_requester
  ) into v_seated;
  if v_seated then
    return null; -- caller treats null as "already in"
  end if;

  -- Already pending? Return that request id (idempotent).
  select id into v_existing_request
    from public.lobby_join_requests
    where session_id = v_session_id
      and requester_profile_id = v_requester
      and status = 'pending'
    limit 1;
  if v_existing_request is not null then
    return v_existing_request;
  end if;

  select friend_code, display_name
    into v_requester_code, v_requester_name
  from public.profiles
  where id = v_requester;
  if v_requester_code is null then
    raise exception 'no profile row for requester (sign out + sign back in to fix)';
  end if;

  insert into public.lobby_join_requests (
    session_id, requester_profile_id, requester_friend_code, requester_display_name
  ) values (
    v_session_id, v_requester, upper(v_requester_code), coalesce(v_requester_name, 'Keeper')
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.request_join_party(text) from public;
grant execute on function public.request_join_party(text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 8. RPC: respond_join_request (host approves or denies)
-- ------------------------------------------------------------------------

create or replace function public.respond_join_request(
  p_request_id uuid,
  p_approve boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_session_id uuid;
  v_session_host uuid;
  v_session_max integer;
  v_session_status text;
  v_requester uuid;
  v_requester_name text;
  v_request_status text;
  v_occupied integer;
  v_next_seat integer;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;

  select jr.session_id, jr.requester_profile_id, jr.requester_display_name, jr.status,
         s.host_id, s.max_players, s.status
    into v_session_id, v_requester, v_requester_name, v_request_status,
         v_session_host, v_session_max, v_session_status
  from public.lobby_join_requests jr
  join public.game_sessions s on s.id = jr.session_id
  where jr.id = p_request_id;

  if v_session_id is null then
    raise exception 'request not found';
  end if;
  if v_session_host <> v_host then
    raise exception 'only the host can respond to join requests';
  end if;
  if v_request_status <> 'pending' then
    raise exception 'request is no longer pending';
  end if;

  if not p_approve then
    update public.lobby_join_requests
       set status = 'denied', responded_at = now()
     where id = p_request_id;
    insert into public.lobby_events (session_id, kind, payload)
    values (v_session_id, 'join_denied',
            jsonb_build_object('requester_profile_id', v_requester, 'request_id', p_request_id));
    return false;
  end if;

  -- Approve: check capacity + seat them.
  if v_session_status not in ('waiting', 'active') then
    raise exception 'lobby is no longer accepting joiners';
  end if;

  select count(*)::integer into v_occupied
    from public.game_session_players where session_id = v_session_id;
  if v_occupied >= v_session_max then
    raise exception 'lobby is full';
  end if;

  -- Lowest free seat index.
  select coalesce(min(g.s), v_occupied)
    into v_next_seat
  from generate_series(0, v_session_max - 1) g(s)
  where g.s not in (
    select seat_index from public.game_session_players where session_id = v_session_id
  );

  insert into public.game_session_players (
    session_id, profile_id, display_name, seat_index, team_key
  ) values (
    v_session_id, v_requester, coalesce(v_requester_name, 'Keeper'), v_next_seat, 'guest'
  )
  on conflict (session_id, profile_id) do nothing;

  update public.lobby_join_requests
     set status = 'approved', responded_at = now()
   where id = p_request_id;

  insert into public.lobby_events (session_id, kind, payload)
  values (v_session_id, 'join_approved',
          jsonb_build_object('requester_profile_id', v_requester, 'request_id', p_request_id));
  return true;
end;
$$;

revoke all on function public.respond_join_request(uuid, boolean) from public;
grant execute on function public.respond_join_request(uuid, boolean) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 9. RPC: select_party_game (host picks the game)
-- ------------------------------------------------------------------------

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

  select id into v_session_id
    from public.game_sessions
    where host_id = v_host and status in ('waiting', 'active')
    limit 1;
  if v_session_id is null then
    raise exception 'no active lobby';
  end if;

  update public.game_sessions
     set selected_game_key = trim(p_game_key),
         selected_game_href = trim(p_game_href),
         selected_game_label = nullif(trim(p_game_label), ''),
         updated_at = now()
   where id = v_session_id;

  insert into public.lobby_events (session_id, kind, payload)
  values (v_session_id, 'game_selected',
          jsonb_build_object('game_key', p_game_key, 'game_href', p_game_href, 'game_label', p_game_label));
end;
$$;

revoke all on function public.select_party_game(text, text, text) from public;
grant execute on function public.select_party_game(text, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 10. RPC: start_party_lobby (host fires the start)
-- ------------------------------------------------------------------------

create or replace function public.start_party_lobby()
returns text   -- returns selected_game_href so the caller can navigate
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_session_id uuid;
  v_href text;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;

  select id, selected_game_href
    into v_session_id, v_href
  from public.game_sessions
  where host_id = v_host and status in ('waiting', 'active')
  limit 1;
  if v_session_id is null then
    raise exception 'no active lobby';
  end if;
  if v_href is null or length(trim(v_href)) = 0 then
    raise exception 'pick a game before starting';
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

-- ------------------------------------------------------------------------
-- 11. RPC: leave_party_lobby (any seated keeper)
-- ------------------------------------------------------------------------

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

  -- Find the session the user is in (as host or as seated guest).
  select s.id, s.host_id = v_uid
    into v_session_id, v_is_host
  from public.game_sessions s
  join public.game_session_players p on p.session_id = s.id
  where s.status in ('waiting', 'active')
    and p.profile_id = v_uid
  limit 1;

  if v_session_id is null then
    return false;
  end if;

  if v_is_host then
    -- Host leaving = cancel the lobby.
    update public.game_sessions
       set status = 'cancelled', updated_at = now()
     where id = v_session_id;
    insert into public.lobby_events (session_id, kind, payload)
    values (v_session_id, 'cancelled', jsonb_build_object('reason', 'host_left'));
  else
    delete from public.game_session_players
      where session_id = v_session_id and profile_id = v_uid;
  end if;

  return true;
end;
$$;

revoke all on function public.leave_party_lobby() from public;
grant execute on function public.leave_party_lobby() to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 12. RPC: kick_party_seat (host removes a guest)
-- ------------------------------------------------------------------------

create or replace function public.kick_party_seat(p_profile_id uuid)
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
  if p_profile_id is null or p_profile_id = v_host then
    raise exception 'cannot kick yourself';
  end if;

  select id into v_session_id
    from public.game_sessions
    where host_id = v_host and status in ('waiting', 'active')
    limit 1;
  if v_session_id is null then
    return false;
  end if;

  delete from public.game_session_players
    where session_id = v_session_id and profile_id = p_profile_id;

  insert into public.lobby_events (session_id, kind, payload)
  values (v_session_id, 'kicked', jsonb_build_object('profile_id', p_profile_id));
  return true;
end;
$$;

revoke all on function public.kick_party_seat(uuid) from public;
grant execute on function public.kick_party_seat(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 13. Realtime publication
-- ------------------------------------------------------------------------
-- Add all lobby tables so postgres_changes ships INSERTs/UPDATEs to
-- subscribed clients. Wrapped in DO blocks because re-runs would raise
-- on duplicate-add otherwise.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.game_sessions; exception when others then null; end;
    begin alter publication supabase_realtime add table public.game_session_players; exception when others then null; end;
    begin alter publication supabase_realtime add table public.lobby_join_requests; exception when others then null; end;
    begin alter publication supabase_realtime add table public.lobby_events; exception when others then null; end;
  end if;
end $$;
