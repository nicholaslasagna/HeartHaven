-- 0081_restrict_profile_phone_column.sql
--
-- Stop `profiles.phone` from travelling with the profile row.
--
-- THE ISSUE. Row-level security is exactly that: row level. The policy from
-- 0010 (`can_profiles_interact`) correctly narrows WHICH profile rows a
-- keeper may read — self, friends, played-with and partners — but once a row
-- is visible, every COLUMN on it is visible too. Phone numbers were added in
-- 0023 purely so bans could be enforced against a contact detail, and they
-- have been riding along ever since: any accepted friend could read the
-- phone number of anyone who supplied one.
--
-- That is a data-minimisation problem rather than a broken policy. The
-- number is collected for one narrow purpose and should be readable for
-- that purpose only, especially in a game with younger players where a
-- friend request is a low bar to clear.
--
-- THE FIX. Postgres can restrict a single column with a column-level grant,
-- which composes with RLS: the policy decides the rows, the grant decides
-- the columns.
--
--   • `authenticated` and `anon` lose SELECT on `phone` entirely.
--   • Writes are untouched, so sign-up still records the number.
--   • `service_role` keeps full access for the ban tooling.
--   • SECURITY DEFINER functions (is_phone_banned, ban_keeper, and friends)
--     execute as the owner, so ban enforcement is unaffected.
--   • A keeper reading their OWN number goes through `my_phone()` below.
--
-- CARE REQUIRED. A column-level revoke makes `select *` fail outright rather
-- than silently omitting the column, so this is only safe because every
-- query names its columns. That was checked across the app and the SQL
-- before writing this: no `select *` against profiles exists in either.

revoke select (phone) on public.profiles from authenticated;
revoke select (phone) on public.profiles from anon;

/*
 * A keeper's own number, and nobody else's.
 *
 * The account page shows you the phone you registered. That is legitimate,
 * so it needs a way through the revoke — but a narrow one that cannot be
 * pointed at another profile. There is no parameter to abuse: the row is
 * chosen by auth.uid() inside the function.
 */
create or replace function public.my_phone()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select phone from public.profiles where id = auth.uid();
$$;

revoke all on function public.my_phone() from public;
grant execute on function public.my_phone() to authenticated;

comment on function public.my_phone() is
  'Returns the calling keeper''s own phone number. Exists because SELECT on profiles.phone is revoked from authenticated so a friend cannot read it off a visible profile row.';
