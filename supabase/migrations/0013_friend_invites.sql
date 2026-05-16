-- 0013_friend_invites.sql
--
-- Real-time friend invites — the bridge that makes an invite land in the
-- recipient's inbox the moment it's sent, instead of requiring them to open
-- a shareable URL out-of-band.
--
-- Two changes:
--   1. `profiles.friend_code` — the locally-generated HH-XXXXX-NNN handle
--      lifted onto the profile so Postgres can do the recipient lookup.
--   2. `friend_invites` — a row per sent invite. RLS lets the sender INSERT
--      with their own auth.uid(), and lets the recipient SELECT rows whose
--      `to_code` matches the recipient's own `profiles.friend_code`. The
--      same policy is what the Supabase Realtime subscription filters on.

alter table public.profiles
  add column if not exists friend_code text;

create unique index if not exists profiles_friend_code_unique
  on public.profiles (friend_code)
  where friend_code is not null and friend_code <> '';

create table if not exists public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  sender_profile_id uuid not null references auth.users (id) on delete cascade,
  from_code text not null,
  from_display_name text not null,
  to_code text not null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'blocked', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists friend_invites_to_code_idx
  on public.friend_invites (to_code, created_at desc);

create index if not exists friend_invites_sender_idx
  on public.friend_invites (sender_profile_id, created_at desc);

alter table public.friend_invites enable row level security;

-- Sender can INSERT, but only attributed to themselves.
create policy "sender inserts own invite"
  on public.friend_invites
  for insert
  to authenticated
  with check (sender_profile_id = auth.uid());

-- Sender can read + update + cancel their own outgoing invites.
create policy "sender reads own outgoing"
  on public.friend_invites
  for select
  to authenticated
  using (sender_profile_id = auth.uid());

create policy "sender updates own outgoing"
  on public.friend_invites
  for update
  to authenticated
  using (sender_profile_id = auth.uid())
  with check (sender_profile_id = auth.uid());

-- Recipient can read invites addressed to their friend code, and update them
-- (to accept / decline / block).
create policy "recipient reads incoming"
  on public.friend_invites
  for select
  to authenticated
  using (
    to_code = (select friend_code from public.profiles where id = auth.uid())
  );

create policy "recipient updates incoming"
  on public.friend_invites
  for update
  to authenticated
  using (
    to_code = (select friend_code from public.profiles where id = auth.uid())
  )
  with check (
    to_code = (select friend_code from public.profiles where id = auth.uid())
  );

comment on table public.friend_invites is
  'Realtime-delivered friend invites. RLS: sender by uid, recipient by friend_code match.';
