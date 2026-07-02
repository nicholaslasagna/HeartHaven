-- 0073_coop_party_game_reward_specs.sql
--
-- Reward spec seeds for the new shared-session co-op games. Gameplay sync
-- uses the existing game_moves append-only log and generic submit_game_move
-- path; rewards still need specs so start_game_run / claim_game_reward can
-- validate the new game keys.

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
) values
  (
    'moonbeam-bakeoff',
    'Moonbeam Bake-Off',
    1800,
    8,
    900,
    0.04,
    1000,
    1,
    95,
    4
  ),
  (
    'firefly-grove',
    'Firefly Grove',
    1750,
    8,
    900,
    0.04,
    950,
    1,
    95,
    4
  ),
  (
    'moonlight-melody',
    'Moonlight Melody',
    1850,
    8,
    900,
    0.04,
    1050,
    1,
    95,
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
