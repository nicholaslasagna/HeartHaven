-- 0027_temporary_bans.sql
--
-- Adds temporary (auto-expiring) bans alongside the permanent bans
-- introduced in 0023. The table keeps its `permanent_bans` name — the
-- field that distinguishes the two is `expires_at`:
--
--   • expires_at IS NULL          → permanent ban
--   • expires_at > now()          → temporary ban, still active
--   • expires_at <= now()         → temporary ban, has expired (no
--                                    longer blocks signup or sign-in)
--
-- Every authoritative check (`is_email_banned`, `is_phone_banned`,
-- `is_current_user_banned`) now filters out expired bans. `ban_keeper`
-- gains an optional `p_duration_seconds` parameter; passing NULL keeps
-- the historical permanent-ban behaviour, passing a positive number
-- issues a time-limited ban. A new `set_ban_expiry` RPC lets the admin
-- extend, shorten, or upgrade-to-permanent an existing ban without
-- losing the audit trail of who reported it (which `unban_keeper`
-- preserves but `delete + re-issue` would not).

-- ------------------------------------------------------------------------
-- 1. Schema additions
-- ------------------------------------------------------------------------

alter table public.permanent_bans
  add column if not exists expires_at timestamptz,
  add column if not exists original_duration_seconds bigint;

-- An index that the active-ban filters hit on every signup attempt and
-- session check. Cheap to maintain; the table is tiny.
create index if not exists permanent_bans_active_idx
  on public.permanent_bans (banned_profile_id)
  where expires_at is null or expires_at > now();

comment on column public.permanent_bans.expires_at is
  'NULL = permanent ban (the historical default). A timestamp = temporary ban; the row is treated as inactive once now() >= expires_at.';
comment on column public.permanent_bans.original_duration_seconds is
  'Captured at issue time so the /account-suspended page can show "30-day ban" rather than reverse-engineering it from expires_at - created_at.';

-- ------------------------------------------------------------------------
-- 2. is_email_banned / is_phone_banned — ignore expired bans
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
      and (expires_at is null or expires_at > now())
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
      and (expires_at is null or expires_at > now())
  );
$$;

revoke all on function public.is_email_banned(text) from public;
revoke all on function public.is_phone_banned(text) from public;
grant execute on function public.is_email_banned(text) to anon, authenticated, service_role;
grant execute on function public.is_phone_banned(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------------
-- 3. is_current_user_banned — ignore expired bans, return expires_at
-- ------------------------------------------------------------------------

create or replace function public.is_current_user_banned()
returns table (banned boolean, reason text, ban_id uuid, expires_at timestamptz)
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
    expires_at := null;
    return next;
    return;
  end if;

  select u.email::text, p.phone
    into v_email, v_phone
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = v_uid;

  select b.id, b.reason, b.expires_at
    into v_ban
  from public.permanent_bans b
  where (
      lower(b.banned_email) = lower(coalesce(v_email, ''))
      or (v_phone is not null and b.banned_phone = v_phone)
    )
    and (b.expires_at is null or b.expires_at > now())
  order by b.created_at desc
  limit 1;

  if v_ban.id is null then
    banned := false;
    reason := null;
    ban_id := null;
    expires_at := null;
  else
    banned := true;
    reason := v_ban.reason;
    ban_id := v_ban.id;
    expires_at := v_ban.expires_at;
  end if;
  return next;
end;
$$;

revoke all on function public.is_current_user_banned() from public;
grant execute on function public.is_current_user_banned() to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 4. get_ban_summary — include expires_at so /account-suspended can
-- distinguish permanent / temporary-active / temporary-expired
-- ------------------------------------------------------------------------

create or replace function public.get_ban_summary(p_ban_id uuid)
returns table (reason text, created_at timestamptz, expires_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select b.reason, b.created_at, b.expires_at
  from public.permanent_bans b
  where b.id = p_ban_id;
$$;

revoke all on function public.get_ban_summary(uuid) from public;
grant execute on function public.get_ban_summary(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------------------
-- 5. ban_keeper — accepts an optional duration in seconds
-- ------------------------------------------------------------------------
-- Drop the prior 5-arg overload before recreating with an extra param.
-- Postgres treats overloads with different argument signatures as
-- distinct functions; without the drop we'd have two ban_keeper variants
-- and the runbook examples become ambiguous.

drop function if exists public.ban_keeper(text, text, text, text, text);

create or replace function public.ban_keeper(
  p_friend_code text,
  p_reason text,
  p_internal_notes text,
  p_admin text,
  p_reason_category text default 'policy-violation',
  /** When NULL = permanent ban (historical behaviour). When a positive
   *  number = temporary ban that auto-expires after that many seconds. */
  p_duration_seconds bigint default null
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
  v_expires_at timestamptz;
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
  if p_duration_seconds is not null and p_duration_seconds <= 0 then
    raise exception 'duration must be positive (or omitted for permanent ban)';
  end if;

  if p_duration_seconds is not null then
    v_expires_at := now() + make_interval(secs => p_duration_seconds);
  end if;

  v_friend_code := upper(trim(p_friend_code));

  -- Profile lookup — no auth.users join (see 0026 for why).
  select id, phone
    into v_profile_id, v_phone
  from public.profiles
  where upper(trim(friend_code)) = v_friend_code;

  if v_profile_id is null then
    raise exception 'no profile found for friend code %', v_friend_code;
  end if;

  -- Best-effort email lookup.
  begin
    select lower(email::text)
      into v_email
    from auth.users
    where id = v_profile_id;
  exception when others then
    v_email := null;
  end;
  v_email := coalesce(nullif(trim(v_email), ''), 'unknown@hearthaven.local');

  -- Idempotency: only ACTIVE bans block re-issue. A user whose temporary
  -- ban has expired can be banned again without admin gymnastics.
  select id into v_existing_ban
    from public.permanent_bans
    where banned_profile_id = v_profile_id
      and (expires_at is null or expires_at > now())
    limit 1;
  if v_existing_ban is not null then
    return v_existing_ban;
  end if;

  insert into public.permanent_bans (
    banned_email, banned_phone, banned_profile_id, banned_friend_code,
    reason, internal_notes, created_by_admin, expires_at, original_duration_seconds
  ) values (
    v_email, v_phone, v_profile_id, v_friend_code,
    trim(p_reason),
    nullif(trim(coalesce(p_internal_notes, '')), ''),
    trim(p_admin),
    v_expires_at,
    p_duration_seconds
  )
  returning id into v_ban_id;

  insert into public.ban_self_alerts (banned_profile_id, ban_id)
  values (v_profile_id, v_ban_id);

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

revoke all on function public.ban_keeper(text, text, text, text, text, bigint) from public;
grant execute on function public.ban_keeper(text, text, text, text, text, bigint) to service_role;

-- ------------------------------------------------------------------------
-- 6. set_ban_expiry — extend, shorten, or upgrade-to-permanent without
-- destroying the audit history.
-- ------------------------------------------------------------------------
-- Usage:
--   • Extend a temp ban by 7 more days:
--       select set_ban_expiry('HH-XXXXX-001', now() + interval '7 days', 'nick');
--   • Convert a temp ban to permanent:
--       select set_ban_expiry('HH-XXXXX-001', null, 'nick');
--   • Convert a permanent ban to a 24h temp ban (rarely useful):
--       select set_ban_expiry('HH-XXXXX-001', now() + interval '24 hours', 'nick');
--
-- Operates on the most recent ban for the friend code. Returns true when
-- a row was updated, false when no ban exists.

create or replace function public.set_ban_expiry(
  p_friend_code text,
  p_new_expires_at timestamptz,
  p_admin text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_friend_code text;
  v_ban_id uuid;
  v_profile_id uuid;
begin
  if p_admin is null or length(trim(p_admin)) = 0 then
    raise exception 'admin identifier is required';
  end if;
  v_friend_code := upper(trim(coalesce(p_friend_code, '')));
  if length(v_friend_code) = 0 then
    raise exception 'friend code is required';
  end if;

  select id, banned_profile_id
    into v_ban_id, v_profile_id
  from public.permanent_bans
  where upper(banned_friend_code) = v_friend_code
  order by created_at desc
  limit 1;

  if v_ban_id is null then
    return false;
  end if;

  update public.permanent_bans
     set expires_at = p_new_expires_at,
         original_duration_seconds = case
           when p_new_expires_at is null then null
           else greatest(0, extract(epoch from (p_new_expires_at - created_at))::bigint)
         end
   where id = v_ban_id;

  -- Audit trail in moderator_reports so reviewers can see the change.
  update public.moderator_reports
     set reviewer_notes = coalesce(reviewer_notes || E'\n', '') ||
         '[' || now()::text || '] BAN EXPIRY UPDATED by ' || trim(p_admin) ||
         ' to ' || coalesce(p_new_expires_at::text, 'PERMANENT')
   where upper(offender_code) = v_friend_code
     and status = 'actioned';

  -- If the user's tab is open + currently banned, re-firing the self-alert
  -- nudges the watchdog to refresh its understanding. The watchdog signs
  -- out on any new alert, which is the safe action for an expiry change
  -- that re-tightens the ban; for an extension that's also fine because
  -- they were already signed out via the prior alert.
  if p_new_expires_at is null or p_new_expires_at > now() then
    insert into public.ban_self_alerts (banned_profile_id, ban_id)
    values (v_profile_id, v_ban_id);
  end if;

  return true;
end;
$$;

revoke all on function public.set_ban_expiry(text, timestamptz, text) from public;
grant execute on function public.set_ban_expiry(text, timestamptz, text) to service_role;
