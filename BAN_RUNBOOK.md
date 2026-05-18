# HeartHaven Ban Runbook

Operational playbook for issuing, reversing, extending, and escalating moderation actions. Everything runs from the Supabase SQL editor (service-role) — there is no in-app moderator UI by design.

Bans come in **two flavours**:

| Flavour | `expires_at` | Use when |
|---|---|---|
| **Permanent** | `NULL` | Repeat offender, severe single incident, harassment campaign |
| **Temporary** | timestamp in the future | Cool-off period (24h–30d), first offense, edge cases needing time to investigate |

A temporary ban auto-lifts the moment `expires_at <= now()`. The keeper can sign back in immediately; no admin action required.

## One-time setup

1. Apply migrations via `supabase db push` or paste each into Studio **in order**:
   - `0023_permanent_bans.sql` — core ban tables + RPCs.
   - `0026_ban_keeper_fix_and_instant_alerts.sql` — fixes the `auth.users` JOIN bug; adds the realtime self-alert table powering instant sign-out.
   - `0027_temporary_bans.sql` — adds `expires_at` + `set_ban_expiry`; updates all check RPCs to ignore expired bans.
   - `0028_profile_autocreate_and_ban_by_user_id.sql` — fixes `generate_friend_code` to produce the canonical `HH-XXXXX-NNN` shape; adds the `auth.users → profiles` auto-create trigger; backfills profile rows for keepers who signed up before the trigger existed; adds `ban_keeper_by_user_id` as an admin fallback.
2. In Resend ([https://resend.com](https://resend.com)):
   - Add + verify the sending domain (e.g. `realfiction.store`).
   - Create an API key.
3. In your environment (Cloudflare Pages + local `.env.local`):
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase project settings → API. **Never expose to the browser.**
   - `RESEND_API_KEY`.
   - `INTERNAL_WEBHOOK_SECRET` — generate with `openssl rand -base64 48`.
   - `RESEND_FROM_ADDRESS` — optional, defaults to `HeartHaven Safety <safety@realfiction.store>`.
4. Confirm the privacy policy mentions optional phone collection at signup.

## Issuing a ban

Two-step process: SQL call creates the ban + reporter notifications + realtime alert; a separate curl tells the email route to send the notice.

### Step 1 — find the offender

```sql
-- All reports against a friend code:
select id, reporter_code, reason, created_at, details, chat_excerpt
from public.moderator_reports
where upper(offender_code) = 'HH-XXXXX-001'
order by created_at desc;

-- Top harassment offenders in the last 30 days, by distinct reporters:
select offender_code, count(distinct reporter_profile_id) as reporters, max(created_at) as last
from public.moderator_reports
where created_at > now() - interval '30 days'
  and reason = 'harassment'
group by offender_code
order by reporters desc
limit 20;
```

### Step 2a — permanent ban (no expiry)

```sql
select public.ban_keeper(
  p_friend_code     => 'HH-XXXXX-001',
  p_reason          => 'Harassment of multiple keepers across rooms and gardens.',
  p_internal_notes  => 'Reports 2025-11-12 through 2025-11-15. Three distinct reporters.',
  p_admin           => 'nick',
  p_reason_category => 'harassment'
);
```

### Step 2b — temporary ban (auto-expires)

Pass `p_duration_seconds`. Common values:

| Duration | Seconds |
|---|---|
| 1 hour | `3600` |
| 24 hours | `86400` |
| 7 days | `604800` |
| 30 days | `2592000` |

```sql
select public.ban_keeper(
  p_friend_code      => 'HH-XXXXX-001',
  p_reason           => 'Cool-off period after escalating chat behavior.',
  p_internal_notes   => 'First offence, 24h timeout.',
  p_admin            => 'nick',
  p_reason_category  => 'chat-cooldown',
  p_duration_seconds => 86400
);
```

### Step 2c — fallback: ban by Supabase user_id

Use this if the friend code lookup fails ("no profile found …"). Get the `user_id` from Studio → Authentication → Users → click the user → copy the UID.

```sql
select public.ban_keeper_by_user_id(
  p_user_id          => '00000000-0000-0000-0000-000000000000'::uuid,
  p_reason           => 'Harassment of multiple keepers.',
  p_internal_notes   => 'See reports.',
  p_admin            => 'nick',
  p_reason_category  => 'harassment',
  p_duration_seconds => null   -- or seconds for a temporary ban
);
```

This function creates the missing `profiles` row inline if needed, then delegates to `ban_keeper`. Same return value, same downstream effects.

### What every ban call does

Returns the `ban_id` (UUID). Effects:

- A row in `permanent_bans` with the offender's email + phone copied out of `profiles` plus the `expires_at` (NULL for permanent, timestamp for temporary).
- A row in `ban_self_alerts` for the banned profile. If the keeper has a tab open, the realtime `BanWatchdog` receives the INSERT within ~1s, signs them out, and redirects them to `/account-suspended?ref=<ban_id>`.
- One row in `ban_notifications` per distinct reporter who filed against this keeper (reason_category only — never the free-text reason).
- All open / reviewing reports against this keeper marked `actioned`.
- For idle / closed-tab keepers, the middleware ban check (cached 60s) catches them on their next protected-route request.
- New signups using the banned email or phone are rejected at the door — but **only while the ban is active**. Expired temporary bans no longer block signup.

**Idempotency** — running `ban_keeper` again with the same friend code while a ban is **active** returns the existing ban id and does nothing else. Expired bans don't block re-issue, so you can ban → wait it out → re-ban without admin gymnastics.

### Step 3 — send the email notice (same for both flavours)

```bash
curl -X POST https://realfiction.store/api/internal/send-ban-email \
  -H "x-internal-secret: $INTERNAL_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"banId":"<ban_id-from-step-2>"}'
```

Responses:

- `{"ok":true,"messageId":"..."}` — sent. `permanent_bans.email_sent_at` stamped.
- `{"ok":true,"alreadySent":true,"sentAt":"..."}` — idempotent skip.
- `{"error":"..."}` 4xx/5xx — fix and retry. Common causes: bad secret, Resend domain unverified, malformed `banId`.

If the email fails repeatedly the ban is still in force — the email is a courtesy, not the enforcement mechanism.

## Changing the expiry of an existing ban

The most useful action besides issue + unban. Lets you extend a temp ban, shorten one, or upgrade-to-permanent without losing the audit trail.

```sql
-- Extend the active ban by 7 more days from now:
select public.set_ban_expiry(
  'HH-XXXXX-001',
  now() + interval '7 days',
  'nick'
);

-- Upgrade a temp ban to permanent:
select public.set_ban_expiry('HH-XXXXX-001', null, 'nick');

-- Convert a permanent ban into a 24h temp ban (rare):
select public.set_ban_expiry(
  'HH-XXXXX-001',
  now() + interval '24 hours',
  'nick'
);
```

Returns `true` if a row was updated, `false` if no ban exists for that code. A stamp lands in `moderator_reports.reviewer_notes` for audit purposes. A new `ban_self_alerts` row fires so an open keeper tab refreshes the suspension page if needed.

## Reversing a ban (unban)

```sql
-- Default: keep the reporter notifications visible.
select public.unban_keeper('HH-XXXXX-001', 'nick');

-- Aggressive: also wipe the reporter notifications.
select public.unban_keeper('HH-XXXXX-001', 'nick', true);
```

Returns `true` if a row was deleted. The function stamps an audit note onto the original `moderator_reports` rows so the unban is discoverable later. The user's session was invalidated at ban time, so they'll need to sign back in.

**Note for temporary bans:** unban is rarely needed — just wait for `expires_at` to pass and the system auto-lifts. Only use `unban_keeper` on a temporary ban if you want it gone *now*.

## Flagging a report for careful review

For reports that warrant manual review beyond a normal ban — anything you'd want to preserve a record of in case of a subpoena later, or that you intend to escalate externally yourself (NCMEC, law enforcement) — use:

```sql
select public.escalate_report(
  p_report_id      => '<moderator_reports.id>',
  p_severity       => 'critical',          -- 'high' or 'critical'
  p_internal_notes => 'Reason for flagging + any external case numbers',
  p_admin          => 'nick'
);
```

The `escalated_reports` table preserves the linkage. **No automated downstream action.** External reporting (NCMEC CyberTipline for confirmed CSAM, local LE for credible threats) is your manual decision, executed outside this system through whatever official channel is appropriate.

To view the queue:

```sql
select er.severity, er.escalated_at, er.internal_notes, mr.offender_code, mr.reason
from public.escalated_reports er
join public.moderator_reports mr on mr.id = er.source_report_id
where er.resolved_at is null
order by er.escalated_at desc;
```

When you've finished handling one:

```sql
update public.escalated_reports
set resolved_at = now(),
    resolution_notes = 'NCMEC report submitted, case #12345'
where id = '<escalated_reports.id>';
```

## Diagnostic queries

```sql
-- Is a specific email or phone currently banned?
select * from public.permanent_bans
where lower(banned_email) = lower('user@example.com')
  and (expires_at is null or expires_at > now());

select * from public.permanent_bans
where banned_phone = '+14155550100'
  and (expires_at is null or expires_at > now());

-- Bans active right now (permanent + non-expired temporary):
select id, banned_friend_code, banned_email, reason, expires_at, created_at
from public.permanent_bans
where expires_at is null or expires_at > now()
order by created_at desc;

-- Temporary bans expiring in the next 7 days:
select id, banned_friend_code, banned_email, expires_at
from public.permanent_bans
where expires_at is not null
  and expires_at > now()
  and expires_at < now() + interval '7 days'
order by expires_at asc;

-- Bans that have already expired (historical record):
select id, banned_friend_code, banned_email, reason, expires_at
from public.permanent_bans
where expires_at is not null
  and expires_at <= now()
order by expires_at desc
limit 30;

-- Bans where the email didn't go out yet:
select id, banned_email, created_at
from public.permanent_bans
where email_sent_at is null
order by created_at desc;
```

## Notes on identifiers

- **Email** — primary ban identifier. Always recorded. Lowercased on insert. Filtered by active status in signup checks.
- **Phone** — optional secondary identifier. Populated when the keeper provided one at signup or on the Account page. Stored E.164. Same active-status filter.
- **Friend code** — the lookup key for admins. Not used to enforce the ban itself.

A motivated banned user can always sign up with a new email + no phone. The system raises the cost; it doesn't make evasion impossible. For users who repeatedly evade, the right answer is a manual NCMEC / LE referral, not more identifiers.

## Things this system deliberately does NOT do

- **No automated reports to law enforcement.** Handled manually.
- **No IP-based bans.** Trivial to bypass via VPN; high false-positive rate.
- **No appeals UI.** If you want to extend or rescind a ban, use `set_ban_expiry` or `unban_keeper` directly.
- **No in-app moderator role.** Bans are issued by direct service-role SQL only. A compromised app account can never issue or reverse a ban.
