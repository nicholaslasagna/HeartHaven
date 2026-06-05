-- 0066_rps_authoritative_picks.sql
--
-- Moonstone RPS is a simultaneous secret-pick game, so it cannot safely use
-- the generic alternating-turn submit_game_move path. This RPC locks the
-- shared session row and enforces one pick per seated player per round.

create or replace function public.submit_rps_pick(
  p_session_id uuid,
  p_choice text
)
returns table (
  ok boolean,
  move_index integer,
  metadata jsonb,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_game_key text;
  v_status text;
  v_meta jsonb;
  v_rps jsonb;
  v_host uuid;
  v_seat integer;
  v_seat_count integer;
  v_choice text := lower(trim(coalesce(p_choice, '')));
  v_round integer;
  v_scores jsonb;
  v_score_0 integer;
  v_score_1 integer;
  v_picks jsonb;
  v_rounds jsonb;
  v_blush text;
  v_lavender text;
  v_winner text;
  v_winner_seat integer;
  v_game_over boolean;
  v_final_score integer;
  v_move_index integer;
  v_payload jsonb;
  v_commit_status text;
begin
  if v_caller is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'sign in required';
    return next; return;
  end if;

  if not public.is_game_session_member(p_session_id) then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'not a session member';
    return next; return;
  end if;

  if v_choice not in ('rock', 'paper', 'scissors') then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'invalid choice';
    return next; return;
  end if;

  select seated_player.seat_index
    into v_seat
    from public.game_session_players as seated_player
   where seated_player.session_id = p_session_id
     and seated_player.profile_id = v_caller;

  if v_seat is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'not seated in this session';
    return next; return;
  end if;

  select
    coalesce(nullif(trim(session_row.selected_game_key), ''), session_row.game_key),
    session_row.status,
    coalesce(session_row.metadata, '{}'::jsonb),
    session_row.host_id
    into v_game_key, v_status, v_meta, v_host
    from public.game_sessions as session_row
   where session_row.id = p_session_id
   for update;

  if v_game_key is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'session not found';
    return next; return;
  end if;

  if v_game_key like '%-party' then
    v_game_key := left(v_game_key, length(v_game_key) - 6);
  end if;

  if v_game_key <> 'rock-paper-scissors' then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'session is not a Moonstone RPS game';
    return next; return;
  end if;

  if v_status not in ('waiting', 'active') then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'session not active';
    return next; return;
  end if;

  select count(*)::integer
    into v_seat_count
    from public.game_session_players as seated_player
   where seated_player.session_id = p_session_id;

  if v_seat_count < 2 then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'Moonstone RPS needs two seated players';
    return next; return;
  end if;

  v_rps := case
    when jsonb_typeof(v_meta->'rps') = 'object' then v_meta->'rps'
    else '{}'::jsonb
  end;
  v_round := greatest(1, coalesce((v_rps->>'round')::integer, 1));
  v_scores := case
    when jsonb_typeof(v_rps->'scores') = 'array' and jsonb_array_length(v_rps->'scores') >= 2 then v_rps->'scores'
    else '[0,0]'::jsonb
  end;
  v_score_0 := coalesce((v_scores->>0)::integer, 0);
  v_score_1 := coalesce((v_scores->>1)::integer, 0);
  v_picks := case
    when jsonb_typeof(v_rps->'currentPicks') = 'object' then v_rps->'currentPicks'
    else '{}'::jsonb
  end;
  v_rounds := case
    when jsonb_typeof(v_rps->'rounds') = 'array' then v_rps->'rounds'
    else '[]'::jsonb
  end;
  v_game_over := coalesce((v_rps->>'gameOver')::boolean, coalesce((v_meta->>'gameOver')::boolean, false));

  if v_game_over then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'game over';
    return next; return;
  end if;

  if v_picks ? v_seat::text then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'your pick is already locked';
    return next; return;
  end if;

  v_move_index := public.next_game_move_index(p_session_id);
  v_payload := jsonb_build_object('round', v_round, 'choice', v_choice);
  v_picks := v_picks || jsonb_build_object(v_seat::text, v_choice);
  v_winner := null;
  v_winner_seat := null;
  v_final_score := null;

  if (v_picks ? '0') and (v_picks ? '1') then
    v_blush := v_picks->>'0';
    v_lavender := v_picks->>'1';

    if v_blush = v_lavender then
      v_winner := 'tie';
    elsif
      (v_blush = 'rock' and v_lavender = 'scissors') or
      (v_blush = 'paper' and v_lavender = 'rock') or
      (v_blush = 'scissors' and v_lavender = 'paper')
    then
      v_winner := 'blush';
      v_winner_seat := 0;
      v_score_0 := v_score_0 + 1;
    else
      v_winner := 'lavender';
      v_winner_seat := 1;
      v_score_1 := v_score_1 + 1;
    end if;

    v_scores := jsonb_build_array(v_score_0, v_score_1);
    v_rounds := v_rounds || jsonb_build_array(jsonb_build_object(
      'round', v_round,
      'blush', v_blush,
      'lavender', v_lavender,
      'winner', v_winner,
      'winnerSeat', v_winner_seat
    ));
    v_game_over := greatest(v_score_0, v_score_1) >= 3;
    if v_game_over then
      v_final_score := 300 + greatest(v_score_0, v_score_1) * 80;
    end if;
    v_rps := jsonb_build_object(
      'round', case when v_game_over then v_round else v_round + 1 end,
      'scores', v_scores,
      'currentPicks', '{}'::jsonb,
      'rounds', v_rounds,
      'gameOver', v_game_over,
      'matchWinnerSeat', case when v_game_over then v_winner_seat else null end,
      'finalScore', v_final_score
    );
  else
    v_rps := jsonb_build_object(
      'round', v_round,
      'scores', v_scores,
      'currentPicks', v_picks,
      'rounds', v_rounds,
      'gameOver', false,
      'matchWinnerSeat', null,
      'finalScore', null
    );
  end if;

  v_meta := v_meta || jsonb_build_object(
    'rps', v_rps,
    'gameOver', v_game_over,
    'finalScore', v_final_score,
    'winnerSeat', case when v_game_over then v_winner_seat else null end,
    'moveCount', v_move_index + 1,
    'lastMoveType', 'pick'
  );
  v_commit_status := case when v_game_over then 'completed' else 'active' end;

  if not public.commit_game_session_move(
    p_session_id,
    v_move_index,
    v_caller,
    v_seat,
    'pick',
    v_payload,
    v_meta,
    v_commit_status
  ) then
    select coalesce(session_row.metadata, '{}'::jsonb)
      into v_meta
      from public.game_sessions as session_row
     where session_row.id = p_session_id;
    ok := false; move_index := -1; metadata := v_meta; error_message := 'move_index_conflict';
    return next; return;
  end if;

  ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
  return next;
end;
$$;

revoke all on function public.submit_rps_pick(uuid, text) from public;
grant execute on function public.submit_rps_pick(uuid, text) to authenticated, service_role;

-- Safe verification outline (run with real test users in Supabase SQL/RPC tools):
-- 1. Create a two-seat rock-paper-scissors party session.
-- 2. Seat 0 calls submit_rps_pick(session, 'rock') -> ok.
-- 3. Seat 0 calls submit_rps_pick(session, 'paper') -> ok=false, "your pick is already locked".
-- 4. Seat 1 calls submit_rps_pick(session, 'scissors') -> ok, round advances, scores update.
-- 5. Repeat until one score reaches 3 -> game_sessions.status = 'completed'.
