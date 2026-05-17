# HeartHaven Ban Runbook

Operational playbook for issuing, reversing, and escalating moderation actions. **Bans are permanent.** Everything here runs from the Supabase SQL editor (service-role) — there is no in-app moderator UI by design.

## One-time setup

1. Apply migrations via `supabase db push` or paste each into Studio in order:
   - `supabase/migrations/0023_permanent_bans.sql` — core ban tables + RPCs.
   - `supabase/migrations/0026_ban_keeper_fix_and_instant_alerts.sql` — fixes the `auth.users` JOIN bug in `ban_keeper` and adds the realtime self-alert table that powers instant sign-out on the banned user's screen.
2. In Resend ([https://resend.com](https://resend.com)):
   - Add and verify the sending domain (e.g. `realfiction.store`).
   - Create an API key, save it as `RESEND_API_KEY`.
3. In your environment (Cloudflare Pages + local `.env.local`):
   - `SUPABASE_SERVICE_ROLE_KEY` — copy from Supabase project settings → API. **Never expose to the browser.**
   - `RESEND_API_KEY` — from step 2.
   - `INTERNAL_WEBHOOK_SECRET` — generate with `openssl rand -base64 48`.
   - `RESEND_FROM_ADDRESS` — optional, defaults to `HeartHaven Safety <safety@realfiction.store>`.
4. Confirm the privacy policy mentions optional phone collection at signup. The system stores nothing else new.

## Issuing a ban

Two-step process: SQL call creates the ban + reporter notifications; a separate curl tells the email route to send the notice.

### Step 1 — find the offender

In Studio's SQL editor:

```sql
-- All reports against a friend code:
select id, reporter_code, reason, created_at, details, chat_excerpt
from public.moderator_reports
where upper(offender_code) = 'HH-XXXXX-001'
order by created_at desc;

-- All reports of a category in the last 30 days (rank by unique reporters):
select offender_code, count(distinct reporter_profile_id) as reporters, max(created_at) as last
from public.moderator_reports
where created_at > now() - interval '30 days'
  and reason = 'harassment'
group by offender_code
order by reporters desc
limit 20;
```

### Step 2 — issue the ban

```sql
select public.ban_keeper(
  p_friend_code     => 'HH-XXXXX-001',
  p_reason          => 'Harassment of multiple keepers across rooms and gardens.',
  p_internal_notes  => 'Reports 2025-11-12 through 2025-11-15. Three distinct reporters.',
  p_admin           => 'nick',
  p_reason_category => 'harassment'
);
```

Returns the `ban_id` (UUID). Effects:

- A row is inserted into `permanent_bans` with the offender's email + phone copied out of `profiles`. The row stays even if the account is deleted.
- A row is inserted into `ban_self_alerts` scoped to the banned profile. If the keeper has a tab open right now, the realtime `BanWatchdog` listening on `postgres_changes` receives the INSERT within ~1s, signs them out, and redirects them to `/account-suspended?ref=<ban_id>` — no waiting for the next page navigation.
- Every distinct reporter who filed against this keeper gets a row in `ban_notifications` (reason_category only — never the free-text reason).
- All open / reviewing reports against this keeper are marked `actioned`.
- For idle / closed-tab keepers: the middleware ban check (cached 60s) catches them on their next protected-route request and redirects.
- New signups using the banned email or phone are rejected at the door (`is_email_banned` / `is_phone_banned` RPCs called by the signup action).

The call is **idempotent** — running it again with the same friend code returns the existing ban id and does nothing else.

### Step 3 — send the email notice

```bash
curl -X POST https://realfiction.store/api/internal/send-ban-email \
  -H "x-internal-secret: $INTERNAL_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"banId":"<ban_id-from-step-2>"}'
```

Response shapes:

- `{"ok":true,"messageId":"..."}` — sent. `permanent_bans.email_sent_at` is stamped.
- `{"ok":true,"alreadySent":true,"sentAt":"..."}` — idempotent skip.
- `{"error":"..."}` with 4xx/5xx — fix and retry. Common causes: bad secret, Resend domain unverified, malformed `banId`.

If the email fails repeatedly, the ban is still in force — the email is a courtesy, not the enforcement mechanism.

## Reversing a ban (rare)

```sql
-- Default: keep the reporter notifications visible.
select public.unban_keeper('HH-XXXXX-001', 'nick');

-- Aggressive: also wipe the reporter notifications.
select public.unban_keeper('HH-XXXXX-001', 'nick', true);
```

Returns `true` if a row was deleted. The function also stamps an audit note onto the original `moderator_reports` rows so the unban is discoverable later.

The user's session was invalidated at ban time, so they'll need to sign back in. Their email/phone are no longer in `permanent_bans`, so the door is open again.

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
-- Confirm a specific email or phone is banned:
select * from public.permanent_bans where lower(banned_email) = lower('user@example.com');
select * from public.permanent_bans where banned_phone = '+14155550100';

-- Last 30 bans you've issued:
select id, banned_friend_code, banned_email, reason, created_at, email_sent_at
from public.permanent_bans
order by created_at desc
limit 30;

-- Bans where the email didn't go out yet:
select id, banned_email, created_at
from public.permanent_bans
where email_sent_at is null
order by created_at desc;
```

## Notes on identifiers

- **Email** — primary ban identifier. Always recorded. Lowercased on insert.
- **Phone** — optional secondary identifier. Only populated when the keeper provided one at signup or on the Account page. Stored E.164.
- **Friend code** — never used as a ban identifier; it's just a label. A banned user creating a new account gets a new friend code.

A motivated banned user can always sign up with a new email + no phone. The system raises the cost; it doesn't make evasion impossible. For users who repeatedly evade, the right answer is a manual NCMEC / LE referral, not more identifiers.

## Things this system deliberately does NOT do

- **No automated reports to law enforcement.** Handled manually.
- **No IP-based bans.** Trivial to bypass via VPN; high false-positive rate.
- **No appeals UI.** Bans are permanent per project policy. If you want appeals, add a `ban_appeals` table later.
- **No in-app moderator role.** Bans are issued by direct service-role SQL only. A compromised app account can never issue or reverse a ban.
