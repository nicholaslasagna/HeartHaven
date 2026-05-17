-- 0022_security_hardening.sql
--
-- Patch-up pass after the cybersecurity audit:
--
--   1. `keeper_blocks` — add an explicit SELECT policy. The original
--      migration relied on the `FOR ALL` policy's USING clause to cover
--      SELECT, which it DOES technically, but being explicit removes
--      any ambiguity for future readers and Supabase tooling.
--
--   2. `announcements` — explicit deny on UPDATE/DELETE for the
--      `authenticated` role. The migration intentionally omitted them
--      (default-deny when RLS is enabled with no policy), but a future
--      contributor adding even one permissive policy could open the
--      gate. Explicit deny shuts the door.
--
--   3. `announcement_claims` — server-side rate limit. The unique
--      constraint already prevents duplicate claims for the same
--      announcement, but a determined client could spam INSERTs for
--      DIFFERENT announcement ids (or with random UUIDs that FK-fail).
--      Cap to 60 claim attempts per minute per keeper.
--
--   4. `keeper_blocks` — server-side cap. Block list size is bounded
--      to 200 client-side, but server should enforce too so a malicious
--      client can't bulk-insert thousands of rows.

-- 1. keeper_blocks SELECT policy
create policy "keeper reads own blocks"
  on public.keeper_blocks
  for select
  to authenticated
  using (blocker_profile_id = auth.uid());

-- 2. announcements explicit deny
create policy "authenticated cannot modify announcements"
  on public.announcements
  for update
  to authenticated
  using (false)
  with check (false);

create policy "authenticated cannot delete announcements"
  on public.announcements
  for delete
  to authenticated
  using (false);

-- 3. announcement_claims rate limit
create or replace function public.can_insert_announcement_claim(
  claimer_uid uuid
) returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.announcement_claims
  where profile_id = claimer_uid
    and claimed_at >= now() - interval '60 seconds';
  return recent_count < 60;
end;
$$;

drop policy if exists "keepers insert their own claims" on public.announcement_claims;
create policy "keepers insert their own claims"
  on public.announcement_claims
  for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and public.can_insert_announcement_claim(profile_id)
  );

-- 4. keeper_blocks server-side cap
create or replace function public.can_insert_keeper_block(
  blocker_uid uuid
) returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
as $$
declare
  total integer;
  recent integer;
begin
  -- Hard cap on total block list size.
  select count(*) into total
  from public.keeper_blocks
  where blocker_profile_id = blocker_uid;
  if total >= 300 then
    return false;
  end if;
  -- Burst limit so a malicious client can't loop-add.
  select count(*) into recent
  from public.keeper_blocks
  where blocker_profile_id = blocker_uid
    and created_at >= now() - interval '60 seconds';
  return recent < 10;
end;
$$;

drop policy if exists "keeper manages own blocks" on public.keeper_blocks;
-- Split FOR ALL into explicit INSERT / UPDATE / DELETE so the
-- rate-limit guard only runs on INSERT (it's the only mutating path
-- that matters — deletes are cheap and self-correcting).
create policy "keeper inserts own block with cap"
  on public.keeper_blocks
  for insert
  to authenticated
  with check (
    blocker_profile_id = auth.uid()
    and public.can_insert_keeper_block(blocker_profile_id)
  );

create policy "keeper updates own block"
  on public.keeper_blocks
  for update
  to authenticated
  using (blocker_profile_id = auth.uid())
  with check (blocker_profile_id = auth.uid());

create policy "keeper deletes own block"
  on public.keeper_blocks
  for delete
  to authenticated
  using (blocker_profile_id = auth.uid());

comment on function public.can_insert_announcement_claim is
  'Rate-limit guard: 60 claim attempts per 60s per keeper. Stops spam-INSERT abuse.';

comment on function public.can_insert_keeper_block is
  'Rate-limit guard: 300 total blocks per keeper, 10 new per 60s. Stops bulk-add abuse.';
