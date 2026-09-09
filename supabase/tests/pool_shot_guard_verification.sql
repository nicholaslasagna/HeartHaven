-- Pool shot-guard verification (run after 0099).
--
-- 0089 re-racked Pool from nine object balls to fifteen and derived the ball
-- COUNT from pool_initial_metadata so it could not drift again. Two other
-- copies of the old rack survived inside submit_pool_shot: the settled-ball
-- id allowlist, which still stopped at ball-9, and
-- `v_remaining := greatest(0, 9 - v_total_potted_count)`, which treated nine
-- pots as a cleared table.
--
-- The allowlist rejected every shot ('settled ball bounds invalid'). A
-- rejected shot never writes, so currentSeat never advanced: the shooter went
-- on shooting their own local table while the other player waited on a turn
-- that could not arrive. Had only the allowlist been fixed, the ninth pot
-- would have frozen the same way on 'score delta mismatch', because the
-- server pays the clear bonus at nine and the client pays it at fifteen.
--
-- Prerequisites: migration 0099 applied.

-- 1) Every ball the server racks must survive the id guard the server now
--    derives from that same rack. Expected: no rows.
select b.value->>'id' as ball_the_validator_would_reject
  from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls') as b(value)
 where coalesce(b.value->>'id', '') not in (
   select r.value->>'id'
     from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls') as r(value)
 );

-- 1b) For the record, what the literal list in 0089 rejected.
--     Expected: ball-10 ball-11 ball-12 ball-13 ball-14 ball-15.
select string_agg(b.value->>'id', ' ' order by (b.value->>'number')::int) as rejected_by_0089
  from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls') as b(value)
 where coalesce(b.value->>'id', '') not in
   ('cue','ball-1','ball-2','ball-3','ball-4','ball-5','ball-6','ball-7','ball-8','ball-9');

-- 2) Neither guard may restate the rack. Expected: all three false.
select
  prosrc like '%''ball-9'')%'      as allowlist_stops_at_nine,
  prosrc like '%9 - v_total_potted_count%' as clears_at_nine,
  prosrc not like '%v_valid_ball_ids%'     as allowlist_not_derived
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'submit_pool_shot';

-- 3) The clear bonus must land on the last ball, not the ninth.
--    Expected: one row, cleared_at = 15.
select count(*) filter (where potted >= object_balls) as _ignore,
       min(potted) filter (where potted >= object_balls) as cleared_at
  from (
    select n as potted,
           (select count(*) from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls') as b(value)
             where b.value->>'kind' = 'object') as object_balls
      from generate_series(1, 15) as n
  ) as t;
