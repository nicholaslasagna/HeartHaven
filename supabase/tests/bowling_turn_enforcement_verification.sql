-- Read-only verification for 0064_bowling_turn_enforcement.sql.
--
-- Run this in the HeartHaven Supabase project after applying migration 0064.
-- It verifies that the Bowling-specific server RPC exists and that only
-- signed-in users can call it. Live turn enforcement still needs the
-- two-account browser smoke test described below.

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('submit_bowling_roll', 'bowling_session_state', 'bowling_player_state')
order by p.proname;

select
  has_function_privilege(
    'authenticated',
    'public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer)',
    'execute'
  ) as authenticated_can_submit_bowling_roll,
  has_function_privilege(
    'anon',
    'public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer)',
    'execute'
  ) as anon_can_submit_bowling_roll,
  has_function_privilege(
    'authenticated',
    'public.bowling_session_state(uuid, integer, integer, integer)',
    'execute'
  ) as authenticated_can_call_bowling_session_state;

-- Expected:
-- - submit_bowling_roll exists and security_definer = true.
-- - authenticated_can_submit_bowling_roll = true.
-- - anon_can_submit_bowling_roll = false.
-- - authenticated_can_call_bowling_session_state = false.
--
-- Manual two-account smoke after applying 0064:
-- 1. Host opens /app/games, picks Moonberry Bowling, creates a 2-player lobby.
-- 2. Guest joins by lobby invite/code and readies.
-- 3. Host starts; both land on /app/bowling?session=<same uuid>.
-- 4. Host rolls once. Host cannot roll again until the guest finishes their frame.
-- 5. Guest rolls. Guest cannot keep appending rolls after their frame ends.
-- 6. Both scoreboards show the same frame symbols and totals after polling/realtime sync.
