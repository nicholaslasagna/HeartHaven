-- 0023_permanent_bans.sql
--
-- Permanent ban infrastructure for HeartHaven.
--
-- Bans are issued from the Supabase Studio SQL editor running as the
-- service-role. There is NO in-app moderator route — this is intentional:
-- a compromised app account can never issue bans because the app's anon /
-- authenticated roles have no privilege to call `ban_keeper(...)`.
--
-- This migration adds:
--
--   1. `profiles.phone` — optional E.164 phone number used as a secondary
--      ban identifier so a banned keeper can't trivially bypass by signing
--      up with a new email.
--
--   2. `permanent_bans` — one row per ban. Email + phone are copied OUT of
--      profiles at ban time so the ban survives account deletion.
--
--   3. `ban_notifications` — in-app feed shown to every reporter who
--      filed against a now-banned keeper. RLS-scoped to the recipient.
--
--   4. `escalated_reports` — a flag-and-preserve queue for cases the
--      admin needs to review carefully. NO automated downstream action —
--      external reporting (NCMEC for confirmed CSAM, local LE, etc.) is
--      the admin's manual decision, made outside this system.
--
--   5. RPC functions:
--        - `is_email_banned(email)` / `is_phone_banned(phone)` — used by
--          the signup server action to reject banned identities at the
--          door. Callable by anon (no PII leaked — bool only).
--        - `is_current_user_banned()` — used by the middleware to detect
--          banned sessions and force a sign-out.
--        - `get_ban_summary(ban_id)` — read-only view of `{reason,
--          created_at}` for /account-suspended. No PII.
--        - `ban_keeper(...)` — admin entry point. SERVICE-ROLE ONLY.
--        - `unban_keeper(...)` — admin counterpart for reversing
--          mistakes. SERVICE-ROLE ONLY.
--        - `escalate_report(...)` — admin entry point for flagging a
--          report for careful review. SERVICE-ROLE ONLY.

-- ------------------------------------------------------------------------
-- 1. profiles.phone — optional E.164 secondary identifier
-- ------------------------------------------------------------------------

alter table public.profiles
  add column if not exists phone text;

-- Partial unique index — only constrains rows where phone is set. Null
-- phones (the majority) coexist freely.
create unique index if not exists profiles_phone_unique
  on public.profiles (phone) where phone is not null;

-- Shape check: E.164 (+ followed by 1-15 digits, first digit non-zero).
-- We don't verify ownership via SMS in this MVP — phone is optional and
-- self-reported. The value still has to look like a phone number so a
-- mistyped value fails closed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_phone_e164_chk'
  ) then
    alter table public.profiles
      add constraint profiles_phone_e164_chk
      check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');
  end if;
end $$;

-- ------------------------------------------------------------------------
-- 2. permanent_bans
-- ------------------------------------------------------------------------

create table if not exists public.permanent_bans (
  id uuid primary key default gen_random_uuid(),
  /** Banned email — lowercased on insert. The PRIMARY ban identifier. */
  banned_email text not null,
  /** Banned phone in E.164 — optional secondary identifier. */
  banned_phone text,
  /** Profile that was banned. NULL after the account is deleted, but the
   *  email/phone identifiers above still block future signups. */
  banned_profile_id uuid,
  /** Friend code captured at ban time — used in reporter notifications so
   *  reporters can correlate the ban back to whoever they reported. */
  banned_friend_code text not null,
  /** Free-text reason. Shown verbatim on /account-suspended AND in the
   *  outbound email to the banned user. Keep it factual, not theatrical. */
  reason text not null check (char_length(reason) between 1 and 500),
  /** Notes for the admin only — never shown to the banned user. */
  internal_notes text,
  created_at timestamptz not null default now(),
  /** Who issued the ban. Free-text string set by the admin call. */
  created_by_admin text not null,
  /** Set by the email-sending API route once Resend confirms acceptance. */
  email_sent_at timestamptz,
  email_message_id text
);

create index if not exists permanent_bans_email_idx
  on public.permanent_bans (lower(banned_email));
create index if not exists permanent_bans_phone_idx
  on public.permanent_bans (banned_phone) where banned_phone is not null;
create index if not exists permanent_bans_friend_code_idx
  on public.permanent_bans (banned_friend_code);

alter table public.permanent_bans enable row level security;
-- No policies — only the service role reads/writes this table.

-- ------------------------------------------------------------------------
-- 3. ban_notifications — in-app feed for reporters
-- ------------------------------------------------------------------------

create table if not exists public.ban_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references auth.users(id) on delete cascade,
  /** Friend code of the banned keeper — reporters already know this since
   *  they're the ones who filed the report. We deliberately do NOT include
   *  the banned user's email/phone here. */
  banned_friend_code text not null,
  /** Single-word category the admin sets for the notification. The full
   *  free-text reason from `permanent_bans.reason` is NOT exposed because
   *  it may contain identifying details. */
  reason_category text not null check (char_length(reason_category) between 1 and 60),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index if not exists ban_notifications_recipient_idx
  on public.ban_notifications (recipient_profile_id, created_at desc);

alter table public.ban_notifications enable row level security;

create policy "keepers read own ban notifications"
  on public.ban_notifications
  for select
  to authenticated
  using (recipient_profile_id = auth.uid());

create policy "keepers acknowledge own ban notifications"
  on public.ban_notifications
  for update
  to authenticated
  using (recipient_profile_id = auth.uid())
  with check (recipient_profile_id = auth.uid());

-- Insert is service-role only — the `ban_keeper` function fills this in.
create policy "deny direct inserts to ban notifications"
  on public.ban_notifications
  for insert
  to authenticated
  with check (false);

create policy "deny deletes on ban notifications"
  on public.ban_notifications
  for delete
  to authenticated
  using (false);

-- ------------------------------------------------------------------------
-- 4. escalated_reports — flag-and-preserve queue, NO automation downstream
-- ------------------------------------------------------------------------

create table if not exists public.escalated_reports (
  id uuid primary key default gen_random_uuid(),
  source_report_id uuid not null references public.moderator_reports(id) on delete cascade,
  severity text not null check (severity in ('high', 'critical')),
  internal_notes text not null check (char_length(internal_notes) between 1 and 2000),
  escalated_at timestamptz not null default now(),
  escalated_by text not null,
  resolved_at timestamptz,
  resolution_notes text
);

create index if not exists escalated_reports_source_idx
  on public.escalated_reports (source_report_id);
create index if not exists escalated_reports_severity_idx
  on public.escalated_reports (severity, escalated_at desc);

alter table public.escalated_reports enable row level security;
-- No policies — service-role only.

-- ------------------------------------------------------------------------
-- 5a. is_email_banned / is_phone_banned — pre-signup gates
-- ------------------------------------------------------------------------

create or replace function public.is_email_banned(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.permanent_bans
    where lower(banned_email) = lower(coalesce(p_email, ''))
  );
$$;

create or replace function public.is_phone_banned(p_phone text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.permanent_bans
    where banned_phone = coalesce(p_phone, '')
  );
$$;

revoke all on function public.is_email_banned(text) from public;
revoke all on function public.is_phone_banned(text) from public;
grant execute on function public.is_email_banned(text) to anon, authenticated, service_role;
grant execute on function public.is_phone_banned(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------------
-- 5b. is_current_user_banned — middleware fast-path
-- ------------------------------------------------------------------------

create or replace function public.is_current_user_banned()
returns table (banned boolean, reason text, ban_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
  v_ban record;
begin
  if v_uid is null then
    banned := false;
    reason := null;
    ban_id := null;
    return next;
    return;
  end if;

  select u.email::text, p.phone
    into v_email, v_phone
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = v_uid;

  select b.id, b.reason
    into v_ban
  from public.permanent_bans b
  where lower(b.banned_email) = lower(coalesce(v_email, ''))
     or (v_phone is not null and b.banned_phone = v_phone)
  order by b.created_at desc
  limit 1;

  if v_ban.id is null then
    banned := false;
    reason := null;
    ban_id := null;
  else
    banned := true;
    reason := v_ban.reason;
    ban_id := v_ban.id;
  end if;
  return next;
end;
$$;

revoke all on function public.is_current_user_banned() from public;
grant execute on function public.is_current_user_banned() to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 5c. get_ban_summary — read-only `{reason, created_at}` for the public
-- /account-suspended page. Used after sign-out, so callable by anon.
-- Returns NOTHING for unknown ids (no enumeration leak).
-- ------------------------------------------------------------------------

create or replace function public.get_ban_summary(p_ban_id uuid)
returns table (reason text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select b.reason, b.created_at
  from public.permanent_bans b
  where b.id = p_ban_id;
$$;

revoke all on function public.get_ban_summary(uuid) from public;
grant execute on function public.get_ban_summary(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------------------
-- 6. ban_keeper — admin entry point
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

  select p.id, lower(u.email::text), p.phone
    into v_profile_id, v_email, v_phone
  from public.profiles p
  join auth.users u on u.id = p.id
  where upper(p.friend_code) = v_friend_code;

  if v_profile_id is null then
    raise exception 'no profile found for friend code %', v_friend_code;
  end if;

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

  -- Notify every distinct reporter who filed against this keeper. We pass
  -- a curated category (not the full reason) so the reporter sees an
  -- acknowledgement without learning identifying details about the ban.
  insert into public.ban_notifications (recipient_profile_id, banned_friend_code, reason_category)
  select distinct mr.reporter_profile_id, v_friend_code, p_reason_category
  from public.moderator_reports mr
  where upper(mr.offender_code) = v_friend_code
    and mr.reporter_profile_id is not null;

  -- Mark every report against this keeper as actioned for housekeeping.
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

-- ------------------------------------------------------------------------
-- 7. unban_keeper — counterpart for reversing mistakes
-- ------------------------------------------------------------------------

create or replace function public.unban_keeper(
  p_friend_code text,
  p_admin text,
  p_clear_notifications boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_friend_code text;
  v_deleted int;
begin
  v_friend_code := upper(trim(coalesce(p_friend_code, '')));
  if length(v_friend_code) = 0 then
    raise exception 'friend code is required';
  end if;
  if p_admin is null or length(trim(p_admin)) = 0 then
    raise exception 'admin identifier is required';
  end if;

  delete from public.permanent_bans
   where upper(banned_friend_code) = v_friend_code;
  get diagnostics v_deleted = row_count;

  if p_clear_notifications then
    delete from public.ban_notifications
     where upper(banned_friend_code) = v_friend_code;
  end if;

  -- Stamp an audit trail into the original reports so the unban is
  -- discoverable by future reviewers.
  update public.moderator_reports
     set reviewer_notes = coalesce(reviewer_notes || E'\n', '') ||
         '[' || now()::text || '] UNBANNED by ' || trim(p_admin)
   where upper(offender_code) = v_friend_code
     and status = 'actioned';

  return v_deleted > 0;
end;
$$;

revoke all on function public.unban_keeper(text, text, boolean) from public;
grant execute on function public.unban_keeper(text, text, boolean) to service_role;

-- ------------------------------------------------------------------------
-- 8. escalate_report — flag for careful review, no automated downstream
-- ------------------------------------------------------------------------

create or replace function public.escalate_report(
  p_report_id uuid,
  p_severity text,
  p_internal_notes text,
  p_admin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_severity not in ('high', 'critical') then
    raise exception 'severity must be high or critical';
  end if;
  if p_admin is null or length(trim(p_admin)) = 0 then
    raise exception 'admin identifier is required';
  end if;

  insert into public.escalated_reports (
    source_report_id, severity, internal_notes, escalated_by
  ) values (
    p_report_id, p_severity, p_internal_notes, trim(p_admin)
  )
  returning id into v_id;

  update public.moderator_reports
     set status = 'reviewing'
   where id = p_report_id and status = 'open';

  return v_id;
end;
$$;

revoke all on function public.escalate_report(uuid, text, text, text) from public;
grant execute on function public.escalate_report(uuid, text, text, text) to service_role;

-- ------------------------------------------------------------------------
-- 9. mark_ban_email_sent — called by /api/internal/send-ban-email after
-- Resend accepts the message. Records the message id for traceability.
-- ------------------------------------------------------------------------

create or replace function public.mark_ban_email_sent(
  p_ban_id uuid,
  p_message_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.permanent_bans
     set email_sent_at = now(),
         email_message_id = p_message_id
   where id = p_ban_id;
$$;

revoke all on function public.mark_ban_email_sent(uuid, text) from public;
grant execute on function public.mark_ban_email_sent(uuid, text) to service_role;
