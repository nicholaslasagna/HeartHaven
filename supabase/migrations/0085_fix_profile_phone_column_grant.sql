-- 0085_fix_profile_phone_column_grant.sql
--
-- Repairs 0081, which did not do what it claimed.
--
-- THE BUG. 0081 restricted `profiles.phone` with:
--
--     revoke select (phone) on public.profiles from authenticated;
--
-- That is a no-op here. PostgreSQL treats a table-level privilege and a
-- column-level privilege as separate grants, and `GRANT SELECT ON table`
-- already carries the right to read every column. A column-level REVOKE
-- cannot subtract from a table-level grant — it only removes a column-level
-- grant, and there was none. `authenticated` holds table-wide SELECT on
-- profiles, so the phone number stayed readable and 0081 changed nothing.
--
-- Demonstrated on a scratch PostgreSQL 16 cluster: after granting table
-- SELECT and running exactly the 0081 revoke, `select phone from profiles`
-- still returned the number, and has_column_privilege(...,'phone','select')
-- still reported true.
--
-- THE FIX. To restrict a column you must drop the table-wide grant and
-- re-grant the columns you do want, which is what this does. Verified the
-- same way: phone becomes "permission denied", every other column still
-- reads, and has_column_privilege reports false for phone and true for the
-- rest.
--
-- CONSEQUENCE. `select *` on profiles now genuinely fails for authenticated
-- and anon, where under 0081 it silently kept working. That was re-audited
-- across the app and the SQL when this was written: every query names its
-- columns, no `select *` against profiles exists in either, and the account
-- page already reads the keeper's own number through `my_phone()` from 0081,
-- which remains the supported path.
--
-- MAINTENANCE. A column added to `profiles` after this migration will NOT be
-- readable until it is granted. That is the cost of column-level control.
-- `supabase/tests/profile_phone_column_verification.sql` has a query that
-- lists any column missing the grant — run it after changing this table.

do $$
declare
  target_role text;
  col text;
begin
  foreach target_role in array array['authenticated', 'anon']
  loop
    -- Drop the table-wide grant that made the 0081 revoke meaningless.
    execute format('revoke select on public.profiles from %I', target_role);

    -- Re-grant every column except the one being protected.
    for col in
      select column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'profiles'
         and column_name <> 'phone'
       order by ordinal_position
    loop
      execute format('grant select (%I) on public.profiles to %I', col, target_role);
    end loop;
  end loop;
end $$;

comment on column public.profiles.phone is
  'Collected only as a secondary ban-match key (0023). NOT readable by authenticated or anon: they hold per-column SELECT grants that deliberately exclude this one (0085, repairing 0081). Read your own number via my_phone(); ban tooling reads it as service_role or through SECURITY DEFINER functions. A new column on this table needs its own grant — see 0085.';
