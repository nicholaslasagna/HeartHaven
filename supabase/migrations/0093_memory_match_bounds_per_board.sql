-- 0093_memory_match_bounds_per_board.sql
--
-- Bound a card index by the board that session was actually dealt.
--
-- 0091 replaced two hardcoded bounds with memory_match_board_size(), which
-- was the right move away from the literal 15 and 16 but still describes ONE
-- table size. A session dealt before 0091 holds sixteen cards while the
-- function now answers twenty-four, so indices 16..23 passed the guard,
-- resolved to a null card, compared null to null, and were recorded as a
-- miss — passing the turn by flipping cards that are not on the table.
--
-- The board each session holds is the only correct bound, and it is right
-- there in the metadata. This also means the guard needs no attention if the
-- deal size ever changes again.
--
-- The client was made independent of the deal size at the same time: it
-- renders whatever coherent board arrives rather than demanding a
-- particular count, so a sixteen-card session and a twenty-four-card one
-- both play and neither the migration nor the deploy has to land first.

do $$
declare
  v_src text;
begin
  select prosrc into v_src
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'submit_game_move';

  if v_src is null then
    raise exception 'submit_game_move not found — apply the earlier migrations first';
  end if;

  if position('memory_match_board_size()' in v_src) = 0 then
    raise notice 'submit_game_move does not use memory_match_board_size(); apply 0091 first';
  end if;
end $$;

create or replace function public.memory_match_board_size()
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select 24 $$;

comment on function public.memory_match_board_size() is
  'The size of a NEWLY dealt Memory Match table. It is not a bound on existing sessions: a session dealt earlier holds whatever it was dealt, and submit_game_move bounds card indices by that board''s own length (0093). Must equal MEMORY_MATCH_BOARD_SIZE in src/lib/game/memory-match-deck.ts, which is the size this client deals.';

create or replace function public.submit_game_move(
  p_session_id uuid,
  p_move_type text,
  p_payload jsonb
)
returns table (
  ok boolean,
  move_index integer,
  metadata jsonb,
  error_message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_game_key text;
  v_status text;
  v_meta jsonb;
  v_move_index integer;
  v_seat integer;
  v_current_seat integer;
  v_column integer;
  v_row integer;
  v_board jsonb;
  v_cell integer;
  v_player integer;
  v_game_over boolean;
  v_rows constant integer := 6;
  v_cols constant integer := 7;
  v_now timestamptz := now();
  v_host uuid;
  v_session_found boolean := false;
  v_mode text;
  v_card_index integer;
  v_board_arr jsonb;
  v_matched jsonb;
  v_revealed jsonb;
  v_scores jsonb;
  v_turn_order jsonb;
  v_first integer;
  v_second integer;
  v_pair_a text;
  v_pair_b text;
  v_match_count integer;
  v_moves integer;
  v_score_idx integer;
  v_points integer;
  v_winner_seats jsonb;
  v_final_score integer;
  v_max_score integer;
  v_commit_status text;
  -- garden four win
  v_win_result jsonb;
  v_winner_seat integer;
  v_winning_cells jsonb;
  v_is_draw boolean;
  v_move_count integer;
begin
  if v_caller is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'sign in required';
    return next; return;
  end if;

  if not public.is_game_session_member(p_session_id) then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'not a session member';
    return next; return;
  end if;

  select gsp.seat_index into v_seat
    from public.game_session_players gsp
    where gsp.session_id = p_session_id and gsp.profile_id = v_caller;

  if v_seat is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'not seated in this session';
    return next; return;
  end if;

  select
    coalesce(nullif(trim(gs.selected_game_key), ''), gs.game_key),
    gs.status,
    gs.metadata,
    gs.host_id,
    true
    into v_game_key, v_status, v_meta, v_host, v_session_found
    from public.game_sessions gs
    where gs.id = p_session_id
    for update;

  if not coalesce(v_session_found, false) then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'session not found';
    return next; return;
  end if;

  v_meta := coalesce(v_meta, '{}'::jsonb);

  if v_game_key like '%-party' then
    v_game_key := left(v_game_key, length(v_game_key) - 6);
  elsif v_game_key = 'lobby' then
    ok := false; move_index := -1; metadata := v_meta;
    error_message := 'no game selected for this lobby';
    return next; return;
  end if;

  if v_status not in ('waiting', 'active') then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'session not active';
    return next; return;
  end if;

  v_move_index := public.next_game_move_index(p_session_id);

  if v_game_key = 'memory-match' then
    v_board_arr := v_meta->'board';
    if v_board_arr is null or jsonb_typeof(v_board_arr) <> 'array' or jsonb_array_length(v_board_arr) < 4 or jsonb_array_length(v_board_arr) % 2 <> 0 then
      v_meta := public.memory_match_init_metadata(
        p_session_id, v_meta, coalesce(p_payload->>'mode', v_meta->>'mode')
      );
    end if;

    if p_move_type = 'init' then
      if coalesce((v_meta->>'moves')::integer, 0) > 0 or coalesce((v_meta->>'matchCount')::integer, 0) > 0 then
        ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'game already started';
        return next; return;
      end if;
      if v_caller is distinct from v_host then
        ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'only host can reconfigure';
        return next; return;
      end if;
      v_meta := public.memory_match_init_metadata(
        p_session_id, v_meta, coalesce(p_payload->>'mode', v_meta->>'mode')
      );
      if not public.commit_game_session_move(
        p_session_id, v_move_index, v_caller, v_seat, p_move_type, p_payload, v_meta, 'active'
      ) then
        select gs.metadata into v_meta from public.game_sessions gs where gs.id = p_session_id;
        ok := false; move_index := -1; metadata := coalesce(v_meta, '{}'::jsonb);
        error_message := 'move_index_conflict'; return next; return;
      end if;
      ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
      return next; return;
    end if;

    if p_move_type <> 'flip' then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'unsupported move type';
      return next; return;
    end if;

    v_game_over := coalesce((v_meta->>'gameOver')::boolean, false);
    if v_game_over then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'game over';
      return next; return;
    end if;

    v_current_seat := coalesce((v_meta->>'currentTurnSeat')::integer, 0);
    if v_seat is distinct from v_current_seat then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'not your turn';
      return next; return;
    end if;

    v_card_index := coalesce((p_payload->>'cardIndex')::integer, -1);
    -- Bound by the board THIS session holds, not by the size a new deal
    -- would use: an older session holds fewer cards than the current deal.
    if v_card_index < 0 or v_card_index >= coalesce(jsonb_array_length(v_meta->'board'), 0) then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'invalid card index';
      return next; return;
    end if;

    v_board_arr := v_meta->'board';
    v_matched := coalesce(v_meta->'matched', '[]'::jsonb);
    v_revealed := coalesce(v_meta->'revealed', '[]'::jsonb);
    v_scores := coalesce(v_meta->'scores', '[]'::jsonb);
    v_turn_order := coalesce(v_meta->'turnOrder', public.memory_match_turn_order(p_session_id, v_meta->>'mode'));
    v_mode := coalesce(v_meta->>'mode', 'couples');

    if v_matched @> to_jsonb(v_card_index) then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'card already matched';
      return next; return;
    end if;

    if v_revealed @> to_jsonb(v_card_index) then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'card already revealed';
      return next; return;
    end if;

    if jsonb_array_length(v_revealed) >= 2 then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'resolve current pair first';
      return next; return;
    end if;

    v_revealed := v_revealed || to_jsonb(v_card_index);

    if jsonb_array_length(v_revealed) = 1 then
      v_meta := v_meta || jsonb_build_object('revealed', v_revealed, 'lastFlip', v_card_index);
      if not public.commit_game_session_move(
        p_session_id, v_move_index, v_caller, v_seat, p_move_type, p_payload, v_meta, 'active'
      ) then
        select gs.metadata into v_meta from public.game_sessions gs where gs.id = p_session_id;
        ok := false; move_index := -1; metadata := coalesce(v_meta, '{}'::jsonb);
        error_message := 'move_index_conflict'; return next; return;
      end if;
      ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
      return next; return;
    end if;

    v_first := (v_revealed->>0)::integer;
    v_second := (v_revealed->>1)::integer;
    v_pair_a := v_board_arr->>v_first;
    v_pair_b := v_board_arr->>v_second;
    v_moves := coalesce((v_meta->>'moves')::integer, 0) + 1;
    v_match_count := coalesce((v_meta->>'matchCount')::integer, 0);

    if v_pair_a = v_pair_b then
      v_matched := v_matched || jsonb_build_array(v_first, v_second);
      v_match_count := v_match_count + 1;
      v_points := case when v_mode = 'couples' then 2 else 1 end;
      for v_score_idx in 0..(jsonb_array_length(v_turn_order) - 1) loop
        if (v_turn_order->>v_score_idx)::integer = v_current_seat then
          v_scores := jsonb_set(
            v_scores,
            array[v_score_idx::text],
            to_jsonb(coalesce((v_scores->>v_score_idx)::integer, 0) + v_points),
            true
          );
          exit;
        end if;
      end loop;
      v_revealed := '[]'::jsonb;
    else
      v_revealed := '[]'::jsonb;
      v_current_seat := public.memory_match_next_seat(v_turn_order, v_current_seat);
    end if;

    v_game_over := v_match_count >= 8;
    v_commit_status := case when v_game_over then 'completed' else 'active' end;

    if v_game_over then
      v_max_score := 0;
      for v_score_idx in 0..(jsonb_array_length(v_scores) - 1) loop
        if coalesce((v_scores->>v_score_idx)::integer, 0) >= v_max_score then
          v_max_score := coalesce((v_scores->>v_score_idx)::integer, 0);
        end if;
      end loop;
      v_winner_seats := '[]'::jsonb;
      for v_score_idx in 0..(jsonb_array_length(v_scores) - 1) loop
        if coalesce((v_scores->>v_score_idx)::integer, 0) = v_max_score then
          v_winner_seats := v_winner_seats || to_jsonb((v_turn_order->>v_score_idx)::integer);
        end if;
      end loop;
      v_final_score := greatest(0, v_max_score * 100 - v_moves);
    end if;

    v_meta := v_meta || jsonb_build_object(
      'matched', v_matched,
      'revealed', v_revealed,
      'scores', v_scores,
      'moves', v_moves,
      'matchCount', v_match_count,
      'currentTurnSeat', v_current_seat,
      'gameOver', v_game_over,
      'lastFlip', v_card_index,
      -- The pair this turn actually turned over. `revealed` is emptied just
      -- above, so without this the watching player never sees the second card.
      'lastPair', jsonb_build_array(v_first, v_second),
      'lastResult', case when v_pair_a = v_pair_b then 'match' else 'miss' end
    )
    || case when v_game_over then jsonb_build_object(
      'finalScore', v_final_score,
      'winnerSeats', v_winner_seats
    ) else '{}'::jsonb end;

    perform public.memory_match_sync_player_scores(p_session_id, v_scores, v_turn_order);

    if not public.commit_game_session_move(
      p_session_id, v_move_index, v_caller, v_seat, p_move_type, p_payload, v_meta, v_commit_status
    ) then
      select gs.metadata into v_meta from public.game_sessions gs where gs.id = p_session_id;
      ok := false; move_index := -1; metadata := coalesce(v_meta, '{}'::jsonb);
      error_message := 'move_index_conflict'; return next; return;
    end if;

    ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
    return next; return;
  end if;

  if v_game_key = 'garden-four' and p_move_type = 'drop' then
    v_current_seat := coalesce((v_meta->>'currentSeat')::integer, 0);
    v_game_over := coalesce((v_meta->>'gameOver')::boolean, false);
    v_board := coalesce(v_meta->'board', '[]'::jsonb);

    if v_game_over then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'game over';
      return next; return;
    end if;

    if v_seat is distinct from v_current_seat then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'not your turn';
      return next; return;
    end if;

    v_column := coalesce((p_payload->>'column')::integer, -1);
    if v_column < 0 or v_column >= v_cols then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'invalid column';
      return next; return;
    end if;

    v_player := (v_seat % 2) + 1;
    if jsonb_typeof(v_board) <> 'array' or jsonb_array_length(v_board) < v_rows then
      v_board := '[]'::jsonb;
      for r in 0..v_rows-1 loop
        v_board := v_board || jsonb_build_array(jsonb_build_array(0,0,0,0,0,0,0));
      end loop;
    end if;

    v_row := -1;
    for r in reverse (v_rows - 1)..0 loop
      v_cell := coalesce((v_board->r->v_column)::integer, 0);
      if v_cell = 0 then v_row := r; exit; end if;
    end loop;

    if v_row = -1 then
      ok := false; move_index := v_move_index; metadata := v_meta; error_message := 'column full';
      return next; return;
    end if;

    v_board := jsonb_set(v_board, array[v_row::text, v_column::text], to_jsonb(v_player), true);
    v_move_count := v_move_index + 1;

    v_win_result := public.garden_four_detect_win(v_board, v_row, v_column, v_player, v_rows, v_cols);
    v_game_over := false;
    v_winner_seat := null;
    v_winning_cells := '[]'::jsonb;
    v_is_draw := false;
    v_final_score := null;

    if v_win_result is not null and coalesce((v_win_result->>'won')::boolean, false) then
      v_game_over := true;
      v_winner_seat := v_seat;
      v_winning_cells := coalesce(v_win_result->'winningCells', '[]'::jsonb);
      v_final_score := greatest(0, 500 - v_move_count);
    elsif public.garden_four_board_is_full(v_board, v_rows, v_cols) then
      v_game_over := true;
      v_is_draw := true;
      v_final_score := 250;
    end if;

    v_commit_status := case when v_game_over then 'completed' else 'active' end;

    v_meta := v_meta || jsonb_build_object(
      'board', v_board,
      'currentSeat', case when v_game_over then v_current_seat else (v_current_seat + 1) % 2 end,
      'gameOver', v_game_over,
      'lastColumn', v_column,
      'lastRow', v_row,
      'moveCount', v_move_count,
      'winnerSeat', v_winner_seat,
      'winningCells', v_winning_cells,
      'isDraw', v_is_draw,
      'finalScore', v_final_score
    );

    if v_game_over then
      v_meta := v_meta || jsonb_build_object(
        'completedAt', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      );
    end if;

    if not public.commit_game_session_move(
      p_session_id, v_move_index, v_caller, v_seat, p_move_type, p_payload, v_meta, v_commit_status
    ) then
      select gs.metadata into v_meta from public.game_sessions gs where gs.id = p_session_id;
      ok := false; move_index := -1; metadata := coalesce(v_meta, '{}'::jsonb);
      error_message := 'move_index_conflict'; return next; return;
    end if;

    ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
    return next; return;
  end if;

  v_meta := v_meta || jsonb_build_object('lastMoveType', p_move_type, 'moveCount', v_move_index + 1);

  if not public.commit_game_session_move(
    p_session_id, v_move_index, v_caller, v_seat, p_move_type, p_payload, v_meta, 'active'
  ) then
    select gs.metadata into v_meta from public.game_sessions gs where gs.id = p_session_id;
    ok := false; move_index := -1; metadata := coalesce(v_meta, '{}'::jsonb);
    error_message := 'move_index_conflict'; return next; return;
  end if;

  ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
  return next;
end;
$$;

revoke all on function public.memory_match_board_size() from public;
grant execute on function public.memory_match_board_size() to authenticated, service_role;
