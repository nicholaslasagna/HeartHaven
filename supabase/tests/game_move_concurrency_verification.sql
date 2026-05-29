-- Concurrency verification for submit_game_move (run after 0037 in SQL editor).
--
-- Prerequisites:
--   - Migration 0037 applied
--   - unique (session_id, move_index) on public.game_moves

-- 1) Confirm unique constraint exists (prevents duplicate indexes at rest).
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.game_moves'::regclass
   and contype = 'u';

-- 2) Inspect submit_game_move uses row lock (function source contains FOR UPDATE).
select prosrc like '%for update%' as submit_game_move_uses_row_lock
  from pg_proc
 where proname = 'submit_game_move'
   and pronamespace = 'public'::regnamespace;

-- 3) Memory Match — concurrent first flips (manual, two clients same session)
--    Expected: one move_index N with revealed length 1; other either
--    - second card at N+1, or
--    - rejected with 'card already revealed' / 'not your turn' / 'resolve current pair first'
--    Never: two rows with same move_index, or revealed length > 2.
--
--    After burst, verify:
select session_id, move_index, move_type, payload->>'cardIndex' as card_index
  from public.game_moves
 where session_id = '<SESSION_UUID>'
 order by move_index;

select
  jsonb_array_length(coalesce(metadata->'revealed', '[]'::jsonb)) as revealed_len,
  metadata->'revealed' as revealed,
  metadata->'matched' as matched,
  metadata->>'currentTurnSeat' as turn_seat
  from public.game_sessions
 where id = '<SESSION_UUID>';

-- 4) Garden Four — double drop same column same turn (manual double-click)
--    Expected: first drop commits; second returns 'not your turn' (seat advanced)
--    or 'column full' if same column stacked incorrectly — never duplicate tokens
--    in the same cell.
select
  (metadata->'board'->5->3)::int as row5_col3,
  metadata->>'currentSeat' as current_seat,
  metadata->>'moveCount' as move_count
  from public.game_sessions
 where id = '<SESSION_UUID>';

-- 5) Simulated move_index conflict (service role only; rolls back if constraint holds)
--    Under FOR UPDATE this should not occur in production; tests commit_game_session_move guard.
-- begin;
-- select * from public.game_sessions where id = '<SESSION_UUID>' for update;
-- select public.commit_game_session_move(
--   '<SESSION_UUID>', 0, '<PROFILE_UUID>', 0, 'flip', '{"cardIndex":0}'::jsonb,
--   (select metadata from public.game_sessions where id = '<SESSION_UUID>'),
--   'active'
-- );
-- select public.commit_game_session_move(
--   '<SESSION_UUID>', 0, '<PROFILE_UUID>', 0, 'flip', '{"cardIndex":1}'::jsonb,
--   (select metadata from public.game_sessions where id = '<SESSION_UUID>'),
--   'active'
-- );  -- second call should return false → move_index_conflict at RPC layer
-- rollback;
