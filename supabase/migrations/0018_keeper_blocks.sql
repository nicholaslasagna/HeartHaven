-- 0018_keeper_blocks.sql
--
-- Server-side block list. Two reasons we need this beyond the localStorage
-- block list:
--
--   1. Cross-device: if you block someone from your phone, your laptop
--      session should also have them blocked. localStorage doesn't sync.
--   2. Server-enforced: with blocks in Postgres, the friend_invites RLS
--      can reject INSERTs whose recipient has the sender blocked. The
--      row never lands in the table, so even if a blocked sender uses
--      the REST API directly they can't get an invite onto the
--      recipient's account.
--
-- Schema is intentionally minimal: blocker → blocked_code. We don't store
-- the offender's display name here (we have it in safety reports already)
-- because the canonical record is "this code is blocked, no exceptions."

create table if not exists public.keeper_blocks (
  blocker_profile_id uuid not null references auth.users (id) on delete cascade,
  blocked_code text not null check (blocked_code ~ '^HH-[A-Z]{4,6}-[0-9]{2,4}$'),
  display_name_at_block text,
  created_at timestamptz not null default now(),
  primary key (blocker_profile_id, blocked_code)
);

create index if not exists keeper_blocks_blocked_code_idx
  on public.keeper_blocks (blocked_code);

alter table public.keeper_blocks enable row level security;

-- Blocker can manage their own blocks.
create policy "keeper manages own blocks"
  on public.keeper_blocks
  for all
  to authenticated
  using (blocker_profile_id = auth.uid())
  with check (blocker_profile_id = auth.uid());

-- The recipient of a `friend_invites` INSERT also needs to be able to
-- check "did the recipient block this sender?" — but exposing the block
-- list to ANYONE would leak it to senders, defeating the purpose. So we
-- run the check INSIDE a SECURITY DEFINER function called from the
-- friend_invites RLS, which can read across blockers without exposing the
-- list to the caller's policy context.

create or replace function public.is_recipient_blocking(
  recipient_code text,
  sender_code text
) returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  hit_count integer;
begin
  select count(*) into hit_count
  from public.keeper_blocks b
  join public.profiles p on p.id = b.blocker_profile_id
  where p.friend_code = recipient_code
    and b.blocked_code = sender_code;
  return hit_count > 0;
end;
$$;

-- Now layer that check into the existing rate-limit guard. The previous
-- `can_insert_friend_invite` becomes:
--
--   • duplicate-pending check (same as before)
--   • per-sender rate limit (same as before)
--   • recipient-block check (NEW)
--
create or replace function public.can_insert_friend_invite(
  sender_uid uuid,
  sender_code text,
  recipient_code text
) returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  burst_count integer;
  hourly_count integer;
  pending_count integer;
begin
  -- Recipient blocked the sender? Refuse to land the row at all.
  if public.is_recipient_blocking(recipient_code, sender_code) then
    return false;
  end if;

  select count(*) into burst_count
  from public.friend_invites
  where sender_profile_id = sender_uid
    and created_at >= now() - interval '60 seconds';
  if burst_count >= 5 then
    return false;
  end if;

  select count(*) into hourly_count
  from public.friend_invites
  where sender_profile_id = sender_uid
    and created_at >= now() - interval '60 minutes';
  if hourly_count >= 30 then
    return false;
  end if;

  select count(*) into pending_count
  from public.friend_invites
  where from_code = sender_code
    and to_code = recipient_code
    and status = 'pending';
  if pending_count > 0 then
    return false;
  end if;

  return true;
end;
$$;

comment on table public.keeper_blocks is
  'Server-side block list. Cross-device + RLS-enforceable. friend_invites RLS checks this before allowing inserts.';
