-- 0062_allow_completed_game_session_status.sql
--
-- Garden Four and Memory Match both mark a finished authoritative session
-- with status = 'completed' inside submit_game_move. The original
-- game_sessions_status_check only allowed 'complete', so the final winning
-- move failed with:
--
--   new row for relation "game_sessions" violates check constraint
--   "game_sessions_status_check"
--
-- Keep the historical 'complete' value valid, and also allow the
-- authoritative game RPC's 'completed' value. Both are non-active states,
-- so they do not count against one-active-session uniqueness.

alter table public.game_sessions
  drop constraint if exists game_sessions_status_check;

alter table public.game_sessions
  add constraint game_sessions_status_check
  check (status in ('waiting', 'active', 'complete', 'completed', 'cancelled'));

