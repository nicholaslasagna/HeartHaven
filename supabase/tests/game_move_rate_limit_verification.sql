-- Rate-limit verification for game_moves (run after 0083 in the SQL editor).
--
-- The logic in 0083 was already exercised against a throwaway PostgreSQL 16
-- cluster before it shipped: 50 rapid moves accepted, the 51st refused with
-- SQLSTATE 53400, the cap scoped per profile, service_role bypassing, an
-- unset JWT claim failing closed, the 500/5min cap biting, and rows older
-- than the window not counting. This script re-confirms it against the real
-- database, where the RLS and roles are the live ones.
--
-- Prerequisites:
--   - Migration 0083 applied

-- 1) The trigger is attached, and fires BEFORE INSERT on each row.
select tgname,
       tgenabled,
       pg_get_triggerdef(oid) as definition
  from pg_trigger
 where tgrelid = 'public.game_moves'::regclass
   and not tgisinternal;

-- 2) The supporting index exists. Without it the trigger seq-scans
--    game_moves on every single insert.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'game_moves'
   and indexname = 'game_moves_profile_recent_idx';

-- 3) The count really uses that index rather than scanning the table.
--    Expected: "Index Only Scan using game_moves_profile_recent_idx".
explain (costs off)
select count(*)
  from public.game_moves
 where profile_id = '<PROFILE_UUID>'
   and created_at >= now() - interval '10 seconds';

-- 4) Current standing of a profile against both caps. A healthy player mid
--    game sits in the low single digits for the burst window.
select
  count(*) filter (where created_at >= now() - interval '10 seconds') as burst_window,
  count(*) filter (where created_at >= now() - interval '5 minutes')  as sustained_window,
  50  as burst_cap,
  500 as sustained_cap
  from public.game_moves
 where profile_id = '<PROFILE_UUID>';

-- 5) Live trip test (service role, rolls back — nothing is kept).
--    Expected: the loop raises SQLSTATE 53400 partway through, and the
--    NOTICE reports how many landed first.
-- begin;
-- do $$
-- declare
--   sess uuid := '<SESSION_UUID>';
--   who  uuid := '<PROFILE_UUID>';
--   i integer;
--   base integer;
-- begin
--   -- Drop the service_role bypass for the duration, so the guard applies.
--   perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
--   select coalesce(max(move_index), -1) + 1 into base
--     from public.game_moves where session_id = sess;
--   for i in 0..80 loop
--     insert into public.game_moves (session_id, move_index, profile_id, move_type)
--     values (sess, base + i, who, 'ratelimit-probe');
--   end loop;
--   raise notice 'FAIL - 81 probe moves were all accepted';
-- exception when sqlstate '53400' then
--   raise notice 'rate limit tripped as expected: %', sqlerrm;
-- end $$;
-- rollback;

-- 6) Nobody should be sitting at the cap in normal play. A profile showing
--    up here is either scripted or a client stuck in a retry loop.
select profile_id,
       count(*) as moves_last_5_min
  from public.game_moves
 where created_at >= now() - interval '5 minutes'
 group by profile_id
having count(*) > 200
 order by moves_last_5_min desc;
