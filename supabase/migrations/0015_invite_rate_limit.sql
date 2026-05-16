-- 0015_invite_rate_limit.sql
--
-- Server-side rate limiting for `friend_invites` inserts. Client-side
-- limits in `social.ts` keep honest users from spamming, but a determined
-- attacker can call the Supabase REST API directly. RLS WITH-CHECK that
-- counts the sender's recent inserts shuts that down at the DB layer.
--
-- Caps (mirrors client-side):
--   • 5 invites per 60 seconds
--   • 30 invites per 60 minutes
--
-- We also block sending the SAME `(from_code, to_code)` more than once
-- while pending — a duplicate guard the client already enforces, but
-- enforcing on the server stops a custom client from creating duplicate
-- rows that would clutter the recipient's inbox.

create or replace function public.can_insert_friend_invite(
  sender_uid uuid,
  sender_code text,
  recipient_code text
) returns boolean
  language plpgsql
  stable
  security invoker
as $$
declare
  burst_count integer;
  hourly_count integer;
  pending_count integer;
begin
  -- Burst window
  select count(*) into burst_count
  from public.friend_invites
  where sender_profile_id = sender_uid
    and created_at >= now() - interval '60 seconds';
  if burst_count >= 5 then
    return false;
  end if;

  -- Hourly window
  select count(*) into hourly_count
  from public.friend_invites
  where sender_profile_id = sender_uid
    and created_at >= now() - interval '60 minutes';
  if hourly_count >= 30 then
    return false;
  end if;

  -- Existing pending duplicate
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

-- Replace the existing insert policy with one that uses the function.
drop policy if exists "sender inserts own invite" on public.friend_invites;
create policy "sender inserts own invite"
  on public.friend_invites
  for insert
  to authenticated
  with check (
    sender_profile_id = auth.uid()
    and public.can_insert_friend_invite(sender_profile_id, from_code, to_code)
  );

comment on function public.can_insert_friend_invite is
  'Rate-limit guard for friend_invites INSERTs. Caps to 5/min, 30/hour, and rejects duplicate pending rows.';
