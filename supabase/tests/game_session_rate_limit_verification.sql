-- Rate-limit verification for game_sessions (run after 0084 in the SQL editor).
--
-- Verified against a throwaway PostgreSQL 16 cluster before shipping: 25
-- sessions in a minute accepted, the 26th refused with SQLSTATE 53400, the
-- cap scoped per host, service_role bypassing, and on the hour cap the 150th
-- accepted with the 151st refused.
--
-- Prerequisites:
--   - Migration 0084 applied

-- 1) The trigger is attached.
select tgname, tgenabled, pg_get_triggerdef(oid) as definition
  from pg_trigger
 where tgrelid = 'public.game_sessions'::regclass
   and not tgisinternal;

-- 2) The supporting index exists, or the trigger seq-scans on every insert.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'game_sessions'
   and indexname = 'game_sessions_host_recent_idx';

-- 3) The count uses it. Expected: "Index Only Scan using
--    game_sessions_host_recent_idx".
explain (costs off)
select count(*)
  from public.game_sessions
 where host_id = '<PROFILE_UUID>'
   and created_at >= now() - interval '1 minute';

-- 4) Where a host currently stands against both caps.
select
  count(*) filter (where created_at >= now() - interval '1 minute') as burst_window,
  count(*) filter (where created_at >= now() - interval '1 hour')   as sustained_window,
  25  as burst_cap,
  150 as sustained_cap
  from public.game_sessions
 where host_id = '<PROFILE_UUID>';

-- 5) Anyone approaching the hour cap in normal play is worth a look: either
--    scripted, or a client stuck remounting and re-opening sessions.
select host_id, count(*) as sessions_last_hour
  from public.game_sessions
 where created_at >= now() - interval '1 hour'
 group by host_id
having count(*) > 60
 order by sessions_last_hour desc;
