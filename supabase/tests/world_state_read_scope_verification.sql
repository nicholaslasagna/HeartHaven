-- Verification for world-state read scope (run after 0086).
--
-- 0024/0035 gave six tables a SELECT policy of `using (true)`, which let any
-- signed-in player fetch every row with one unfiltered request. 0086 scopes
-- each to the owning host. Demonstrated on a scratch PostgreSQL 16 cluster:
-- before, a second user read another player's room outright; after, they see
-- only their own row, while the SECURITY DEFINER guest-visit RPC still
-- resolves the host's room exactly as before.

-- 1) THE decisive check: no SELECT policy on these tables may be `true`.
--    Expected: every row shows (auth.uid() = host_profile_id).
select tablename, policyname, qual as using_expression
  from pg_policies
 where schemaname = 'public'
   and cmd = 'SELECT'
   and tablename in (
     'room_placements_state', 'room_surfaces_state', 'room_decorator_grants',
     'garden_decor_state', 'garden_plots_state', 'garden_decorator_grants')
 order by tablename;

-- 2) Anything still permissive shows up here. Expected: no rows.
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and cmd = 'SELECT'
   and coalesce(qual, 'true') = 'true'
   and tablename in (
     'room_placements_state', 'room_surfaces_state', 'room_decorator_grants',
     'garden_decor_state', 'garden_plots_state', 'garden_decorator_grants');

-- 3) The guest-visit path must remain SECURITY DEFINER, or scoping the
--    policies would break visiting a friend's room. Expected: all true.
select proname, prosecdef as security_definer
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('get_room_placements', 'get_garden_decor',
                   'get_room_surfaces', 'get_garden_plots')
 order by proname;

-- 4) Sanity, signed in as a normal player: you see only your own rows.
--    Expected: every row's host_profile_id equals your auth.uid().
select host_profile_id = auth.uid() as is_mine, count(*)
  from public.room_placements_state
 group by 1;
