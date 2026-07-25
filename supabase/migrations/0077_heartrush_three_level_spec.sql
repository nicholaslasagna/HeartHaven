-- 0077_heartrush_three_level_spec.sql
--
-- HeartRush now runs THREE generated courses back to back on one clock, so
-- the reward spec from 0075 no longer matches the game it is guarding.
--
-- What changes and why:
--
--   min_duration_seconds 12 -> 45
--     This is the anti-spoof floor: a run shorter than this is a lie, not a
--     record. One course could plausibly be cleared in ~15s; three cannot
--     be cleared in under ~45s even by someone who never misses a jump, so
--     raising the floor closes the window that a single-level time would
--     otherwise have left wide open.
--
--   Score is now par-relative on the client (PAR_MS 150s -> 1000 points,
--     scaling down from there), not `1000 - elapsedMs/100`. Under the old
--     formula every honest three-level run scored 0. max_score stays 1000,
--     so coins_per_point still tops out at the same 60-coin payout.
--
--   max_duration_seconds 900 -> 1200
--     Three courses plus respawns is a long session for a new player, and a
--     slow run should pay out, not silently score nothing.

update public.game_reward_specs
   set min_duration_seconds = 45,
       max_duration_seconds = 1200,
       updated_at = now()
 where game_key = 'heartrush';
