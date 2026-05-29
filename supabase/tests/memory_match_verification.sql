-- Manual verification for Memory Match server logic (run in SQL editor after 0036).
-- Replace session/player UUIDs with real values from your project.

-- 1) Shuffled board is stable per session and has 16 cards.
-- select public.memory_match_shuffled_board('00000000-0000-4000-8000-000000000001'::uuid);

-- 2) Init metadata builds turn order and scores.
-- select public.memory_match_init_metadata(
--   '00000000-0000-4000-8000-000000000001'::uuid,
--   '{}'::jsonb,
--   'couples'
-- );

-- 3) Flip validation expectations (via submit_game_move as authenticated user):
--    - flip while not your turn -> 'not your turn'
--    - flip matched card -> 'card already matched'
--    - flip same card twice -> 'card already revealed'
--    - flip index 99 -> 'invalid card index'
--    - flip after gameOver -> 'game over'

-- 4) Reward claim requires completed session:
--    claim_game_reward(run_id, 999, session_id) before gameOver -> 'memory match is not complete'
--    after gameOver -> score taken from metadata.finalScore, not client p_score
