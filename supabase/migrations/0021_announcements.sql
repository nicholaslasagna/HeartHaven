-- 0021_announcements.sql
--
-- Developer-managed announcements. Replaces the Memory Book's "add a new
-- page" UX with a one-way channel from the HeartHaven team to every
-- keeper. Some announcements come with rewards (coins, hearts, login
-- bonuses) — keepers see a "Claim" button and can claim once per
-- announcement.
--
-- Two tables:
--   • `announcements` — the announcement itself. Authored by the service
--     role from admin tooling. Authenticated keepers can SELECT active
--     rows.
--   • `announcement_claims` — append-only "this keeper claimed this
--     announcement". Lets us guard against double-claim AND gives the
--     admin a view of who has read what.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  /** Short headline (≤80 chars). Shown in the list + nav badge tooltip. */
  title text not null check (char_length(title) between 1 and 80),
  /** Markdown body (kept simple — no script tags allowed by the client). */
  body text not null check (char_length(body) between 1 and 4000),
  /** Visual kind — affects icon + tint + sort priority. */
  kind text not null default 'info' check (kind in (
    'info',          -- general note (release, event teaser)
    'reward',        -- one-time reward (coins/hearts/item)
    'login-bonus',   -- claimable login bonus (daily-style)
    'event',         -- seasonal event announcement
    'maintenance'    -- downtime / breaking change notice
  )),
  /** Optional reward payload. Shape depends on `kind` — the client
   *  ignores anything it doesn't recognize. */
  reward_coins integer not null default 0 check (reward_coins >= 0 and reward_coins <= 10000),
  reward_hearts integer not null default 0 check (reward_hearts >= 0 and reward_hearts <= 500),
  reward_catalog_item_id text references public.catalog_items(id),
  /** Toggle to hide an announcement without deleting it. */
  active boolean not null default true,
  /** Don't show until this timestamp (defaults to now). */
  publishes_at timestamptz not null default now(),
  /** Auto-expire after this timestamp. NULL = no expiry. */
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists announcements_active_publishes_idx
  on public.announcements (active, publishes_at desc)
  where active = true;

create table if not exists public.announcement_claims (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

alter table public.announcements enable row level security;
alter table public.announcement_claims enable row level security;

-- Everyone signed in can read active, in-window announcements.
create policy "all keepers read active announcements"
  on public.announcements
  for select
  to authenticated
  using (
    active = true
    and publishes_at <= now()
    and (expires_at is null or expires_at > now())
  );

-- Service-role (admin tooling) bypasses RLS; no INSERT/UPDATE/DELETE
-- policy means authenticated keepers can never modify announcements.

-- Keepers manage their OWN claims only.
create policy "keepers insert their own claims"
  on public.announcement_claims
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "keepers read their own claims"
  on public.announcement_claims
  for select
  to authenticated
  using (profile_id = auth.uid());

comment on table public.announcements is
  'Dev-managed announcements (releases, events, rewards). Service-role writes; authenticated keepers read active rows.';

comment on table public.announcement_claims is
  'Append-only "this keeper claimed this announcement" log. Used to prevent double-claim and to mark the announcement as read.';
