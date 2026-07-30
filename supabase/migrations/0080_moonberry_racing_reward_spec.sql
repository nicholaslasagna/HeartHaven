-- 0080_moonberry_racing_reward_spec.sql
--
-- Reward spec for Moonberry Racing, the 2-8 player kart circuit.
--
-- Score is derived client-side as par/elapsed capped at 1000 (a 180s race
-- scores 1000), but the PAYOUT is computed here from these numbers — the
-- client only ever reports a score, never a currency amount. See 0033.
--
-- min_duration_seconds = 55 because three laps of the shortest circuit
-- (Sugargear, 999m) cannot physically be driven faster than that at the
-- kart's 26 m/s top speed: 3 x 999 / 26 is about 115s of pure straight-line
-- running, so anything under 55s is a spoofed claim and gets rejected.
insert into public.game_reward_specs (
  game_key, label, max_score,
  min_duration_seconds, max_duration_seconds,
  coins_per_point, hearts_score_threshold, hearts_per_threshold,
  daily_cap_coins, daily_cap_hearts
) values (
  'moonberry-racing', 'Moonberry Racing', 1000,
  55, 1800,
  0.05, 600, 1,
  120, 6
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
