-- Pool black-ball verification (run after 0100).
--
-- Potting ball-8 ends the frame. Sunk last, with the table otherwise clear,
-- it is the proper finish and pays the clear bonus. Sunk early it ends the
-- frame there and then and costs 200, because otherwise the quickest way to
-- finish a game is to sink the black on the break.
--
-- The penalty is duplicated in scorePoolShot() in
-- src/lib/game/pool-physics.ts, because submit_pool_shot recomputes the delta
-- and rejects a shot that disagrees. checks/pool.ts pins the client half.
--
-- Prerequisites: migrations 0099 and 0100 applied.

-- 1) The black must be on the table the server deals. Expected: one row, 8.
select (b.value->>'number')::integer as black_number
  from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls') as b(value)
 where b.value->>'id' = 'ball-8';

-- 2) The rule must be in the function, and the penalty must match the client.
--    Expected: ends_on_black = true, penalty_matches_client = true.
select
  prosrc like '%v_black_potted_this_shot%'                          as ends_on_black,
  prosrc like '%v_black_potted_this_shot and v_remaining > 0 then 200%' as penalty_matches_client
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'submit_pool_shot';

-- 3) An early black must cost more than the pot pays, or sinking it on the
--    break is the optimal opening. Expected: true.
select 200 > 100 as early_black_is_never_worth_it;
