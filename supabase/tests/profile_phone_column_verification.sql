-- Verification for profiles.phone column access (run after 0085).
--
-- 0081 tried to restrict the column with `revoke select (phone)` while a
-- table-wide SELECT grant was still in place, which PostgreSQL treats as a
-- no-op — the number stayed readable. 0085 drops the table-wide grant and
-- re-grants every other column. Queries 1 and 2 below are the ones that
-- actually prove which state you are in.

-- 1) THE decisive check. Expected after 0085:
--      phone = false, display_name = true
--    If phone is TRUE, 0085 has not been applied and any friend can still
--    read phone numbers.
select
  has_column_privilege('authenticated', 'public.profiles', 'phone', 'select') as auth_can_read_phone,
  has_column_privilege('anon',          'public.profiles', 'phone', 'select') as anon_can_read_phone,
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'select') as auth_can_read_name;

-- 2) The table-wide grant must be GONE for these roles, or the column
--    grants below are decorative. Expected: no rows.
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name = 'profiles'
   and privilege_type = 'SELECT'
   and grantee in ('authenticated', 'anon');

-- 3) MAINTENANCE. Any column added to profiles after 0085 needs its own
--    grant or reads of it fail. Expected: no rows other than `phone`.
select c.column_name,
       has_column_privilege('authenticated', 'public.profiles', c.column_name, 'select') as granted
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name = 'profiles'
   and not has_column_privilege('authenticated', 'public.profiles', c.column_name, 'select')
 order by c.ordinal_position;

-- 4) The keeper's own number still reads through the supported path.
--    Run as a signed-in user; expected: their own phone, or null.
select public.my_phone();

-- 5) Ban tooling is unaffected — these execute as owner.
select proname, prosecdef as security_definer
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('is_phone_banned', 'my_phone')
 order by proname;
