-- Server-side Garden Four win detection (4-in-a-row) and reward gating.

-- ---------------------------------------------------------------------------
-- Board helpers
-- ---------------------------------------------------------------------------

create or replace function public.garden_four_get_cell(
  p_board jsonb,
  p_row integer,
  p_col integer,
  p_rows integer default 6,
  p_cols integer default 7
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_row < 0 or p_row >= p_rows or p_col < 0 or p_col >= p_cols then
    return 0;
  end if;
  if jsonb_typeof(p_board) <> 'array' or jsonb_array_length(p_board) <= p_row then
    return 0;
  end if;
  return coalesce((p_board->p_row->p_col)::integer, 0);
end;
$$;

create or replace function public.garden_four_board_is_full(
  p_board jsonb,
  p_rows integer default 6,
  p_cols integer default 7
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_r integer;
  v_c integer;
begin
  for v_r in 0..(p_rows - 1) loop
    for v_c in 0..(p_cols - 1) loop
      if public.garden_four_get_cell(p_board, v_r, v_c, p_rows, p_cols) = 0 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- Returns {"won": true, "player": N, "winningCells": [[r,c], ...]} or null.
create or replace function public.garden_four_detect_win(
  p_board jsonb,
  p_row integer,
  p_col integer,
  p_player integer,
  p_rows integer default 6,
  p_cols integer default 7
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_dr integer[] := array[0, 1, 1, 1];
  v_dc integer[] := array[1, 0, 1, -1];
  v_dir integer;
  v_line jsonb;
  v_r integer;
  v_c integer;
begin
  if p_player not in (1, 2) then
    return null;
  end if;

  for v_dir in 1..4 loop
    v_line := jsonb_build_array(jsonb_build_array(p_row, p_col));

    v_r := p_row + v_dr[v_dir];
    v_c := p_col + v_dc[v_dir];
    while public.garden_four_get_cell(p_board, v_r, v_c, p_rows, p_cols) = p_player loop
      v_line := v_line || jsonb_build_array(jsonb_build_array(v_r, v_c));
      v_r := v_r + v_dr[v_dir];
      v_c := v_c + v_dc[v_dir];
    end loop;

    v_r := p_row - v_dr[v_dir];
    v_c := p_col - v_dc[v_dir];
    while public.garden_four_get_cell(p_board, v_r, v_c, p_rows, p_cols) = p_player loop
      v_line := jsonb_build_array(jsonb_build_array(v_r, v_c)) || v_line;
      v_r := v_r - v_dr[v_dir];
      v_c := v_c - v_dc[v_dir];
    end loop;

    if jsonb_array_length(v_line) >= 4 then
      return jsonb_build_object(
        'won', true,
        'player', p_player,
        'winningCells', v_line
      );
    end if;
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_game_move — Garden Four win / draw metadata (rest unchanged from 0037)
-- ---------------------------------------------------------------------------

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
    if v_board_arr is null or jsonb_typeof(v_board_arr) <> 'array' or jsonb_array_length(v_board_arr) < 16 then
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
    if v_card_index < 0 or v_card_index > 15 then
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

-- ---------------------------------------------------------------------------
-- claim_game_reward — garden-four also requires server gameOver + finalScore
-- ---------------------------------------------------------------------------

create or replace function public.claim_game_reward(
  p_run_id uuid,
  p_score integer,
  p_session_id uuid default null
)
returns table (coins integer, hearts integer, coins_awarded integer, hearts_awarded integer, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_run record;
  v_spec record;
  v_now timestamptz := now();
  v_elapsed_seconds integer;
  v_coins integer := 0;
  v_hearts integer := 0;
  v_daily_coins_today integer;
  v_daily_hearts_today integer;
  v_new_coins integer;
  v_new_hearts integer;
  v_claim_score integer;
  v_session_meta jsonb;
  v_session_game text;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;
  if p_run_id is null then
    raise exception 'run_id required';
  end if;
  if p_score is null or p_score < 0 then
    raise exception 'score must be non-negative';
  end if;

  v_claim_score := p_score;

  select r.* into v_run
    from public.game_runs r
   where r.id = p_run_id and r.profile_id = v_uid
   for update;
  if v_run.id is null then
    raise exception 'run not found';
  end if;
  if v_run.status <> 'open' then
    select w.coins, w.hearts into v_new_coins, v_new_hearts
      from public.wallets w where w.profile_id = v_uid;
    coins := coalesce(v_new_coins, 0);
    hearts := coalesce(v_new_hearts, 0);
    coins_awarded := coalesce(v_run.coins_awarded, 0);
    hearts_awarded := coalesce(v_run.hearts_awarded, 0);
    reason := 'already-claimed';
    return next;
    return;
  end if;

  if v_run.game_key in ('memory-match', 'garden-four') then
    if p_session_id is null then
      raise exception '% reward requires session_id', v_run.game_key;
    end if;
    if not public.is_game_session_member(p_session_id) then
      raise exception 'not a session member';
    end if;
    select coalesce(nullif(trim(gs.selected_game_key), ''), gs.game_key), gs.metadata
      into v_session_game, v_session_meta
      from public.game_sessions gs
      where gs.id = p_session_id;
    if v_session_game like '%-party' then
      v_session_game := left(v_session_game, length(v_session_game) - 6);
    end if;
    if v_session_game <> v_run.game_key then
      raise exception 'session is not a % game', v_run.game_key;
    end if;
    if not coalesce((v_session_meta->>'gameOver')::boolean, false) then
      raise exception '% is not complete', v_run.game_key;
    end if;
    v_claim_score := greatest(0, coalesce((v_session_meta->>'finalScore')::integer, 0));
  end if;

  select s.* into v_spec from public.game_reward_specs s where s.game_key = v_run.game_key;
  if v_spec.game_key is null then
    raise exception 'spec missing for game_key %', v_run.game_key;
  end if;

  v_elapsed_seconds := greatest(0, extract(epoch from (v_now - v_run.started_at))::integer);

  if v_elapsed_seconds < v_spec.min_duration_seconds then
    update public.game_runs set status = 'cancelled', claimed_at = v_now, score = v_claim_score
      where id = p_run_id;
    raise exception 'run too short (% < %)', v_elapsed_seconds, v_spec.min_duration_seconds;
  end if;
  if v_elapsed_seconds > v_spec.max_duration_seconds then
    update public.game_runs set status = 'expired', claimed_at = v_now, score = v_claim_score
      where id = p_run_id;
    raise exception 'run too old (% > %)', v_elapsed_seconds, v_spec.max_duration_seconds;
  end if;

  if v_claim_score > v_spec.max_score then
    update public.game_runs set status = 'cancelled', claimed_at = v_now, score = v_claim_score
      where id = p_run_id;
    raise exception 'score % exceeds max % for %', v_claim_score, v_spec.max_score, v_run.game_key;
  end if;

  v_coins := floor(v_claim_score * v_spec.coins_per_point)::integer;
  if v_spec.hearts_score_threshold > 0 and v_claim_score >= v_spec.hearts_score_threshold then
    v_hearts := v_spec.hearts_per_threshold;
  end if;

  if v_spec.daily_cap_coins is not null then
    select coalesce(sum(coins_awarded), 0) into v_daily_coins_today
      from public.game_runs
     where profile_id = v_uid
       and game_key = v_run.game_key
       and status = 'claimed'
       and claimed_at >= date_trunc('day', v_now);
    if v_daily_coins_today + v_coins > v_spec.daily_cap_coins then
      v_coins := greatest(0, v_spec.daily_cap_coins - v_daily_coins_today);
    end if;
  end if;
  if v_spec.daily_cap_hearts is not null then
    select coalesce(sum(hearts_awarded), 0) into v_daily_hearts_today
      from public.game_runs
     where profile_id = v_uid
       and game_key = v_run.game_key
       and status = 'claimed'
       and claimed_at >= date_trunc('day', v_now);
    if v_daily_hearts_today + v_hearts > v_spec.daily_cap_hearts then
      v_hearts := greatest(0, v_spec.daily_cap_hearts - v_daily_hearts_today);
    end if;
  end if;

  insert into public.wallets (profile_id, coins, hearts)
  values (v_uid, 500, 5)
  on conflict (profile_id) do nothing;

  update public.wallets w
     set coins = w.coins + v_coins,
         hearts = w.hearts + v_hearts,
         updated_at = v_now
   where w.profile_id = v_uid
   returning w.coins, w.hearts
   into v_new_coins, v_new_hearts;

  update public.game_runs
     set status = 'claimed', claimed_at = v_now, score = v_claim_score,
         coins_awarded = v_coins, hearts_awarded = v_hearts
   where id = p_run_id;

  insert into public.game_reward_events (
    profile_id, game_session_id, game_key, score, coins, hearts, metadata
  ) values (
    v_uid,
    case when v_run.game_key in ('memory-match', 'garden-four') then p_session_id else null end,
    v_spec.game_key,
    v_claim_score,
    v_coins,
    v_hearts,
    jsonb_build_object(
      'label', v_spec.label,
      'run_id', p_run_id,
      'elapsed_seconds', v_elapsed_seconds,
      'validated', true,
      'server_authoritative', true
    )
  );

  coins := v_new_coins;
  hearts := v_new_hearts;
  coins_awarded := v_coins;
  hearts_awarded := v_hearts;
  reason := 'awarded';
  return next;
end;
$$;

revoke all on function public.garden_four_get_cell(jsonb, integer, integer, integer, integer) from public;
revoke all on function public.garden_four_board_is_full(jsonb, integer, integer) from public;
revoke all on function public.garden_four_detect_win(jsonb, integer, integer, integer, integer, integer) from public;
revoke all on function public.submit_game_move(uuid, text, jsonb) from public;
revoke all on function public.claim_game_reward(uuid, integer, uuid) from public;

grant execute on function public.garden_four_get_cell(jsonb, integer, integer, integer, integer) to authenticated, service_role;
grant execute on function public.garden_four_board_is_full(jsonb, integer, integer) to authenticated, service_role;
grant execute on function public.garden_four_detect_win(jsonb, integer, integer, integer, integer, integer) to authenticated, service_role;
grant execute on function public.submit_game_move(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.claim_game_reward(uuid, integer, uuid) to authenticated, service_role;
