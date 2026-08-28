-- Memory Match board verification (run after 0091).
--
-- Covers two changes: the watching player can now see the second card of a
-- turn, and the table grew from eight pairs to twelve.
--
-- Prerequisites: migration 0091 applied.

-- 1) THE decisive check. Expected: 24, 24, 12 pairs, each appearing twice.
select
  public.memory_match_board_size() as board_size,
  jsonb_array_length(public.memory_match_shuffled_board(gen_random_uuid())) as cards_dealt;

with deal as (
  select value, count(*) as copies
    from jsonb_array_elements_text(public.memory_match_shuffled_board(gen_random_uuid()))
   group by value
)
select count(*) as distinct_pairs, min(copies) as fewest, max(copies) as most from deal;

-- 2) The bounds must derive from the board size, not be hardcoded. The card
--    index guard rejected anything above 15, so on a 24-card board the last
--    eight cards were unflippable. Expected: derives = true, hardcoded = false.
select
  prosrc like '%memory_match_board_size()%' as derives_bounds,
  (prosrc like '%v_card_index > 15%' or prosrc like '%v_board_arr) < 16%') as hardcoded_bounds
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'submit_game_move';

-- 3) The resolved pair must be recorded, or the other player never sees the
--    second card. Expected: true.
select prosrc like '%lastPair%' as records_resolved_pair
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'submit_game_move';

-- 4) The deal must be stable for a session — every client rebuilds the board
--    from the same session id, so an unstable shuffle means players see
--    different cards. Expected: true.
select public.memory_match_shuffled_board('11111111-1111-1111-1111-111111111111')
     = public.memory_match_shuffled_board('11111111-1111-1111-1111-111111111111') as deal_is_stable;

-- 5) Sessions dealt before 0091 still hold a 16-card board. The client now
--    requires 24 and will show "Waiting for the server board...", so those
--    tables are stuck. Expected: no rows.
select id, status, jsonb_array_length(metadata->'board') as cards
  from public.game_sessions
 where game_key = 'memory-match'
   and status in ('waiting', 'active')
   and jsonb_array_length(metadata->'board') is distinct from public.memory_match_board_size();

-- 5a) Remediation for anything listed above. Those boards cannot be played
--     under the new client, and no shot at recovering them is meaningful —
--     the deal itself is the wrong size. Cancelling lets the lobby clear
--     them and the players deal a fresh table. Left commented: it writes to
--     live sessions, so run it deliberately.
--
-- update public.game_sessions
--    set status = 'cancelled',
--        updated_at = now()
--  where game_key = 'memory-match'
--    and status in ('waiting', 'active')
--    and jsonb_array_length(metadata->'board') is distinct from public.memory_match_board_size();
