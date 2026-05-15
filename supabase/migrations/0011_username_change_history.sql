-- 0011_username_change_history.sql
--
-- Adds a `username_changes` column to `profiles` that stores the ISO
-- timestamps of every accepted username change. The server-side
-- `updateUsernameAction` reads this column, prunes entries older than the
-- 365-day rolling window, and rejects the change if the keeper has already
-- used their three slots.
--
-- The column is intentionally a plain text[] so RLS policies stay simple
-- and JSON parsing isn't required. Default is an empty array so existing
-- rows are immediately compatible.
--
-- A case-insensitive uniqueness index on `username` is also added so two
-- keepers cannot land on the same handle even with mixed casing.

alter table public.profiles
  add column if not exists username_changes text[] not null default '{}'::text[];

create unique index if not exists profiles_username_unique_ci
  on public.profiles (lower(username))
  where username is not null and username <> '';

comment on column public.profiles.username_changes is
  'ISO timestamps of accepted username changes. Used to enforce the 3-changes-per-365-days rate limit.';
