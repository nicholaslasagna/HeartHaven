-- 0012_moderator_reports.sql
--
-- Server-side mirror of in-game safety reports. Every report submitted via
-- the ReportDialog client component lands in this table so the admin (the
-- HeartHaven moderation team) has a queryable inbox.
--
-- Field-by-field, only PUBLIC identifiers + structured context are stored
-- here. Sensitive auth metadata (IP, email, user-agent) is NEVER auto-copied
-- — when responding to a legitimate legal-process request, an admin joins
-- this row against `auth.users.id = reporter_profile_id` (and, separately,
-- the offender's profile_id when we can resolve it) using the service role.
--
-- RLS rules:
--   • Any signed-in keeper can INSERT a row (must set reporter_profile_id =
--     auth.uid()).
--   • No keeper can SELECT/UPDATE/DELETE. Only the service role can read.

create table if not exists public.moderator_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_profile_id uuid not null references auth.users (id) on delete cascade,
  reporter_code text not null,
  offender_code text not null,
  offender_display_name text not null,
  reason text not null check (reason in (
    'harassment',
    'explicit-content',
    'grooming-suspected',
    'spam-or-scam',
    'hate-speech',
    'other'
  )),
  details text,
  chat_excerpt text,
  scene text,
  auto_flagged boolean not null default false,
  client_user_agent text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  reviewer_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists moderator_reports_offender_idx
  on public.moderator_reports (offender_code, created_at desc);

create index if not exists moderator_reports_reporter_idx
  on public.moderator_reports (reporter_profile_id, created_at desc);

create index if not exists moderator_reports_status_idx
  on public.moderator_reports (status, created_at desc);

alter table public.moderator_reports enable row level security;

-- Keepers can insert a report — but only ATTRIBUTED to themselves.
create policy "keepers insert their own reports"
  on public.moderator_reports
  for insert
  to authenticated
  with check (reporter_profile_id = auth.uid());

-- No SELECT/UPDATE/DELETE policy for `authenticated`. The service role
-- (admin tooling) bypasses RLS by default, which is exactly what we want.

comment on table public.moderator_reports is
  'In-app safety reports. Service-role admin only. Join against auth.users when responding to legal process.';
