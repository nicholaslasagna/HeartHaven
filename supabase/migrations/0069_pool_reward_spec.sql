-- 0069_pool_reward_spec.sql
--
-- Moonberry Pool is local-first in this phase, but rewards still flow
-- through the trusted game_runs / claim_game_reward path. This seed lets
-- production validate the new `pool` game key without granting arbitrary
-- client-side currency.

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
  'pool',
  'Moonberry Pool',
  2500,
  8,
  900,
  0.035,
  1200,
  1,
  90,
  4
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
      daily_cap_hearts = excluded.daily_cap_hearts;
