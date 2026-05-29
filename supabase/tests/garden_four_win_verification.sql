-- Garden Four win detection verification (run in SQL editor after 0038).

-- 1) Horizontal win (player 1, last token at row 0 col 3)
select
  (public.garden_four_detect_win(
    '[
      [1,1,1,1,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0]
    ]'::jsonb,
    0, 3, 1, 6, 7
  )->>'won') = 'true' as horizontal_win;

-- 2) Vertical win (player 2, last token row 3 col 2)
select
  (public.garden_four_detect_win(
    '[
      [0,0,2,0,0,0,0],
      [0,0,2,0,0,0,0],
      [0,0,2,0,0,0,0],
      [0,0,2,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0]
    ]'::jsonb,
    3, 2, 2, 6, 7
  )->>'won') = 'true' as vertical_win;

-- 3) Diagonal win (player 1)
select
  (public.garden_four_detect_win(
    '[
      [1,0,0,0,0,0,0],
      [0,1,0,0,0,0,0],
      [0,0,1,0,0,0,0],
      [0,0,0,1,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0]
    ]'::jsonb,
    3, 3, 1, 6, 7
  )->>'won') = 'true' as diagonal_win;

-- 4) No win yet (only three in a row)
select
  public.garden_four_detect_win(
    '[
      [1,1,1,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0]
    ]'::jsonb,
    0, 2, 1, 6, 7
  ) is null as no_win_yet;

-- 5) Full board without win → is_draw path in submit_game_move
select public.garden_four_board_is_full(
  '[
    [1,2,1,2,1,2,1],
    [2,1,2,1,2,1,2],
    [1,2,1,2,1,2,1],
    [2,1,2,1,2,1,2],
    [1,2,1,2,1,2,1],
    [2,1,2,1,2,1,2]
  ]'::jsonb,
  6, 7
) as full_board_no_four;

-- 6) Live session checks (replace UUID)
-- select metadata->>'gameOver', metadata->>'winnerSeat', metadata->'winningCells',
--        metadata->>'finalScore', metadata->>'completedAt', metadata->>'isDraw'
--   from public.game_sessions where id = '<SESSION_UUID>';

-- 7) Post-game drop must fail
-- select * from public.submit_game_move('<SESSION_UUID>', 'drop', '{"column":3}'::jsonb);
-- Expected: ok = false, error_message = 'game over'

-- 8) claim before gameOver must fail; after gameOver uses server finalScore
-- select * from public.claim_game_reward('<RUN_UUID>', 999, '<SESSION_UUID>');
