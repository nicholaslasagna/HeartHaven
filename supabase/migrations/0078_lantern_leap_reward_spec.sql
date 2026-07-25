-- 0078_lantern_leap_reward_spec.sql
--
-- Reward spec for Lantern Leap, the 2-8 player co-op platformer.
--
-- Score is derived client-side as (coins * 12, capped at 600) + a par-relative
-- time bonus (capped at 400), so a perfect run tops out at max_score. The
-- payout is computed HERE from these numbers — the client only ever reports a
-- score, never a currency amount. See migration 0033.
--
-- min_duration_seconds = 35, and this one is arithmetic rather than taste:
--
--   The reward clock runs from page load to the last level's finish, so it
--   covers the whole co-op run, not one level. The shipped levels are 92 and
--   78 tiles wide; PHYSICS.RUN_SPEED is 9.4 tiles/second. Even pretending both
--   levels were flat, empty corridors that a player sprinted end to end
--   without a single jump, that is (92 + 78) / 9.4 = 18.1 seconds of pure
--   horizontal travel. They are not corridors: both need climbs, jump arcs and
--   hazard detours, and horizontal speed collapses during every one of them,
--   which comfortably doubles that floor. 35s therefore sits above the
--   theoretical sprint minimum and far below any run a human can actually
--   produce — a claim faster than this is forged, not fast.
--
--   The floor is tied to level width and RUN_SPEED, not to parTime, so it
--   survives level re-tuning. If the level set is ever cut down to something
--   materially shorter than ~170 tiles of travel, revisit this number.
--
-- max_duration_seconds = 2400 because co-op is slow on purpose: eight players
-- wait for each other, and a bubbled keeper sits still until a teammate walks
-- over to pop them. A patient party should still be paid.

insert into public.game_reward_specs (
  game_key,
  label,
  max_score,
  min_duration_seconds,
  max_duration_seconds,
  coins_per_point,
  hearts_score_threshold,
  hearts_per_threshold,
  daily_cap_coins,
  daily_cap_hearts
) values (
  'lantern-leap',
  'Lantern Leap',
  1000,
  35,
  2400,
  0.05,
  500,
  1,
  120,
  6
)
on conflict (game_key) do update
  set label = excluded.label,
      max_score = excluded.max_score,
      min_duration_seconds = excluded.min_duration_seconds,
      max_duration_seconds = excluded.max_duration_seconds,
      coins_per_point = excluded.coins_per_point,
      hearts_score_threshold = excluded.hearts_score_threshold,
      hearts_per_threshold = excluded.hearts_per_threshold,
      daily_cap_coins = excluded.daily_cap_coins,
      daily_cap_hearts = excluded.daily_cap_hearts,
      updated_at = now();
