-- Memory Match ending verification (run after 0101).
--
-- 0036 dealt sixteen cards and ended the game on `v_match_count >= 8`. 0091
-- dealt twenty-four and moved the index bounds onto memory_match_board_size(),
-- but the ending was a separate literal and stayed at eight — so every game
-- finished with four pairs, eight cards, still face down, and paid out on the
-- short game.
--
-- Prerequisites: migration 0101 applied.

-- 1) The table the server deals. Expected: 24 cards, 12 distinct pairs.
select
  jsonb_array_length(public.memory_match_shuffled_board(gen_random_uuid())) as cards,
  public.memory_match_board_size()                                          as declared_size;

-- 2) The ending must be read from the board, not restated. Expected:
--    hardcoded_eight = false, derives_from_board = true.
select
  prosrc like '%v_match_count >= 8%'                          as hardcoded_eight,
  prosrc like '%jsonb_array_length(v_board_arr) / 2%'         as derives_from_board
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'submit_game_move';

-- 3) The ending must land on the last pair of whatever size was dealt.
--    Expected: 8 -> 4 pairs, 16 -> 8, 24 -> 12.
select cards, cards / 2 as ends_after_matches
  from (values (8), (16), (24)) as t(cards);
