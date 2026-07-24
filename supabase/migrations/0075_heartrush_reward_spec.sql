-- 0075_heartrush_reward_spec.sql
--
-- Reward spec for HeartRush, the 2-8 player 3D obstacle race.
--
-- Score is derived client-side as `1000 - elapsedMs/100` (a ~40s run scores
-- ~600), but the payout is computed HERE from these numbers — the client
-- only ever reports a score, never a currency amount. See migration 0033.
--
-- min_duration_seconds = 12 because the course cannot physically be run
-- faster than that; anything quicker is a spoofed claim and gets rejected.

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
  'heartrush',
  'HeartRush',
  1000,
  12,
  900,
  0.06,
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
