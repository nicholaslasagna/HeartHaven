-- 0026_ban_keeper_fix_and_instant_alerts.sql
--
-- Two fixes:
--
-- 1. ban_keeper "no profile found" bug
-- ------------------------------------
-- The original `ban_keeper` (migration 0023) joins `public.profiles` to
-- `auth.users` inside a SECURITY DEFINER function. Depending on which
-- role owns the function in the Supabase project (postgres vs.
-- supabase_admin vs. service_role), that join can silently return zero
-- rows, which then trips the "no profile found for friend code …" raise
-- even though the profile clearly exists. We rewrite the function to
-- look up the profile first by friend code alone (no auth.users
-- involvement), then resolve the email as a best-effort second step. If
-- the email lookup fails for any reason, we fall back to a placeholder
-- so the ban still lands; the email value is used only for the outbound
-- notice, not for ban enforcement.
--
-- 2. Instant notification on the banned user's screen
-- ---------------------------------------------------
-- Today the keeper finds out they've been banned the next time the
-- middleware runs its 60-second-cached ban check. Per Nick's request
-- that should be instant: the moment `ban_keeper` runs, the keeper's
-- live tab should sign them out and bounce them to /account-suspended.
-- We achieve this by:
--   - Creating a thin `ban_self_alerts` table with one row per ban,
--     RLS-scoped so the banned user (and only the banned user) can
--     SELECT it.
--   - Inserting a row from inside ban_keeper.
--   - Adding the table to the supabase_realtime publication so a
--     postgres_changes subscription on the client receives the INSERT
--     event in real time.
-- The client watchdog (`BanWatchdog`) subscribes for the signed-in
-- keeper, hits sign-out + redirect on the first INSERT, and never has
-- to read any of the ban's sensitive columns directly.

-- ------------------------------------------------------------------------
-- 1. ban_self_alerts — realtime hook for the banned user themselves
-- ------------------------------------------------------------------------

create table if not exists public.ban_self_alerts (
  id uuid primary key default gen_random_uuid(),
  banned_profile_id uuid not null references auth.users(id) on delete cascade,
  ban_id uuid not null references public.permanent_bans(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ban_self_alerts_recipient_idx
  on public.ban_self_alerts (banned_profile_id, created_at desc);

alter table public.ban_self_alerts enable row level security;

-- The banned keeper can read their own alert (this is what Realtime
-- needs to deliver the INSERT to their browser via postgres_changes).
create policy "banned user reads own self alert"
  on public.ban_self_alerts
  for select
  to authenticated
  using (banned_profile_id = auth.uid());

-- No direct writes — the row is inserted by `ban_keeper` (SECURITY
-- DEFINER) only. No deletes either; alerts are immutable history.
create policy "deny direct inserts to ban self alerts"
  on public.ban_self_alerts
  for insert
  to authenticated
  with check (false);

create policy "deny updates to ban self alerts"
  on public.ban_self_alerts
  for update
  to authenticated
  using (false)
  with check (false);

create policy "deny deletes to ban self alerts"
  on public.ban_self_alerts
  for delete
  to authenticated
  using (false);

-- Add to the realtime publication so postgres_changes delivers INSERTs.
-- Wrapped in a DO block because Supabase may have the table in the
-- publication already (e.g. on a re-run); the duplicate add raises and
-- we silently ignore it.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.ban_self_alerts;
    exception when duplicate_object then
      null;
    when others then
      null;
    end;
  end if;
end $$;

-- ------------------------------------------------------------------------
-- 2. ban_keeper — rewritten with split profile + email lookups
-- ------------------------------------------------------------------------

create or replace function public.ban_keeper(
  p_friend_code text,
  p_reason text,
  p_internal_notes text,
  p_admin text,
  p_reason_category text default 'policy-violation'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_email text;
  v_phone text;
  v_friend_code text;
  v_existing_ban uuid;
  v_ban_id uuid;
begin
  if p_friend_code is null or length(trim(p_friend_code)) = 0 then
    raise exception 'friend code is required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason is required';
  end if;
  if p_admin is null or length(trim(p_admin)) = 0 then
    raise exception 'admin identifier is required';
  end if;

  v_friend_code := upper(trim(p_friend_code));

  -- Step 1: profile lookup — no auth.users join. Trim both sides so a
  -- stray whitespace on either input or stored value doesn't break the
  -- match.
  select id, phone
    into v_profile_id, v_phone
  from public.profiles
  where upper(trim(friend_code)) = v_friend_code;

  if v_profile_id is null then
    raise exception 'no profile found for friend code %', v_friend_code;
  end if;

  -- Step 2: email lookup. Best-effort — if SECURITY DEFINER can't read
  -- auth.users in this Supabase project's configuration, we still ban,
  -- just with a placeholder email. The email is only used for the
  -- outbound notice and as a secondary signup-block identifier; ban
  -- enforcement itself works off banned_profile_id + banned_phone.
  begin
    select lower(email::text)
      into v_email
    from auth.users
    where id = v_profile_id;
  exception when others then
    v_email := null;
  end;
  v_email := coalesce(nullif(trim(v_email), ''), 'unknown@hearthaven.local');

  -- Idempotency: an existing ban on the same profile is a no-op.
  select id into v_existing_ban
    from public.permanent_bans
    where banned_profile_id = v_profile_id
    limit 1;
  if v_existing_ban is not null then
    return v_existing_ban;
  end if;

  insert into public.permanent_bans (
    banned_email, banned_phone, banned_profile_id, banned_friend_code,
    reason, internal_notes, created_by_admin
  ) values (
    v_email, v_phone, v_profile_id, v_friend_code,
    trim(p_reason),
    nullif(trim(coalesce(p_internal_notes, '')), ''),
    trim(p_admin)
  )
  returning id into v_ban_id;

  -- Instant-notification hook. The banned user's tab is subscribed to
  -- postgres_changes on this table filtered by their profile_id; the
  -- INSERT delivers immediately and the client signs them out.
  insert into public.ban_self_alerts (banned_profile_id, ban_id)
  values (v_profile_id, v_ban_id);

  -- Reporter notifications (unchanged from 0023).
  insert into public.ban_notifications (recipient_profile_id, banned_friend_code, reason_category)
  select distinct mr.reporter_profile_id, v_friend_code, p_reason_category
  from public.moderator_reports mr
  where upper(mr.offender_code) = v_friend_code
    and mr.reporter_profile_id is not null;

  update public.moderator_reports
     set status = 'actioned',
         reviewed_at = now()
   where upper(offender_code) = v_friend_code
     and status in ('open', 'reviewing');

  return v_ban_id;
end;
$$;

revoke all on function public.ban_keeper(text, text, text, text, text) from public;
grant execute on function public.ban_keeper(text, text, text, text, text) to service_role;
