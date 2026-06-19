-- Read-only checks for 0067_bowling_authoritative_rolls.sql.
-- Run against the HeartHaven project after migration 0067 is applied.

select
  public.resolve_bowling_pins(0, 0.84, 10) as centered_strike,
  public.resolve_bowling_pins(1, 0.84, 10) as gutter_by_aim,
  public.resolve_bowling_pins(0, 0.70, 4) as centered_spare;

select
  (public.bowling_player_state('[10,10,10,10,10,10,10,10,10,10,6]'::jsonb)->>'standingPins')::integer as tenth_strike_then_six_standing,
  (public.bowling_player_state('[10,10,10,10,10,10,10,10,10,6,4]'::jsonb)->>'standingPins')::integer as tenth_spare_bonus_standing;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  pg_get_functiondef(p.oid) ilike '%for update%' as holds_session_row_lock,
  pg_get_functiondef(p.oid) ilike '%resolve_bowling_pins%' as resolves_pins_server_side,
  pg_get_functiondef(p.oid) ilike '%p_frame is not null%' as rejects_stale_frame,
  pg_get_functiondef(p.oid) ilike '%p_ball is not null%' as rejects_stale_ball
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'submit_bowling_roll';

select
  not has_function_privilege(
    'authenticated',
    'public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer)',
    'execute'
  ) as authenticated_can_submit,
  has_function_privilege(
    'anon',
    'public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer)',
    'execute'
  ) as anonymous_cannot_submit;

-- Expected:
-- centered_strike = 10, gutter_by_aim = 0, centered_spare = 4.
-- tenth_strike_then_six_standing = 4; tenth_spare_bonus_standing = 10.
-- submit_bowling_roll is SECURITY DEFINER and all four booleans are true.
-- authenticated_can_submit = true; anonymous_cannot_submit = false.
--
-- Two-account proof still required:
-- 1. Start Bowling from one party session and confirm both URLs contain the
--    same ?session=<uuid>.
-- 2. Roll from the active seat. Both clients must append the same game_moves
--    row and animate its pins/aim/power payload.
-- 3. Compare frame, ball, symbols, total, and next seat on both scoreboards.
-- 4. Attempt a second roll from the wrong seat; the RPC must return not your turn.
