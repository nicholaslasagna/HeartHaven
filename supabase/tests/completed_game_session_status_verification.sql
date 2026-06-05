-- completed_game_session_status_verification.sql
--
-- Safe verification for migration 0062. Run in the HeartHaven Supabase SQL
-- editor after applying 0062.

select
  conname,
  pg_get_constraintdef(oid) as constraint_def
from pg_constraint
where conrelid = 'public.game_sessions'::regclass
  and conname = 'game_sessions_status_check';

-- Expected constraint_def contains all five values:
--   'waiting', 'active', 'complete', 'completed', 'cancelled'
--
-- Manual live check:
-- 1. Start a Garden Four party session.
-- 2. Play a vertical win.
-- 3. The final move should return ok=true.
-- 4. game_sessions.status should become 'completed'.
-- 5. claim_game_reward should no longer fail with "garden-four is not complete".

