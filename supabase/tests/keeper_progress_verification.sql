-- Keeper progress verification (run after 0094).
--
-- Verified on a scratch PostgreSQL 16 cluster before shipping: a second
-- device with lower counters but a longer streak merged without losing
-- either side, a badge kept the earliest of two earn times, a stale client
-- re-syncing its old state changed nothing, and a direct UPDATE by a keeper
-- was refused.
--
-- Prerequisites: migration 0094 applied.

-- 1) The table and its merge function exist.
select
  to_regclass('public.keeper_progress') is not null as table_exists,
  to_regprocedure('public.sync_keeper_progress(jsonb,jsonb,jsonb,integer,date)') is not null as merge_exists;

-- 2) Direct writes must be closed. The merge is the only way in — a direct
--    write would let a client that has been offline replace the row wholesale,
--    which is the one thing the merge exists to prevent. Expected: a policy
--    with qual `false`, and no permissive write policy.
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'keeper_progress'
 order by cmd;

-- 3) Progress at a glance. Metrics are counters, streak is a high-water mark.
select
  owner_id,
  jsonb_array_length(unlocked) as badges,
  streak,
  gift_claimed_date,
  updated_at
  from public.keeper_progress
 order by updated_at desc
 limit 20;

-- 4) Nothing should ever hold a negative counter — the merge takes the larger
--    of two values and floors at zero. Expected: no rows.
select owner_id, key, value
  from public.keeper_progress, jsonb_each(metrics) as m(key, value)
 where (value::text)::numeric < 0;

-- 5) A badge listed as earned should have an earn time, and vice versa.
--    Mismatches are harmless but suggest a client wrote a partial state.
select owner_id,
       jsonb_array_length(unlocked) as badge_count,
       (select count(*) from jsonb_object_keys(unlocked_at)) as earn_times
  from public.keeper_progress
 where jsonb_array_length(unlocked) <> (select count(*) from jsonb_object_keys(unlocked_at));

-- 6) Live merge test (rolls back — nothing is kept). Run signed in.
--    Expected: counters never decrease, and the second call changes nothing.
-- begin;
-- select 'before' as phase, metrics, streak from public.keeper_progress where owner_id = auth.uid();
-- select * from public.sync_keeper_progress('{"games-played": 1}'::jsonb, '[]'::jsonb, '{}'::jsonb, 0, null);
-- select * from public.sync_keeper_progress('{"games-played": 1}'::jsonb, '[]'::jsonb, '{}'::jsonb, 0, null);
-- select 'after' as phase, metrics, streak from public.keeper_progress where owner_id = auth.uid();
-- rollback;
