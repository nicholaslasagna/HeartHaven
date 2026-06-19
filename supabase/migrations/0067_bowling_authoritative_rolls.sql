-- 0067_bowling_authoritative_rolls.sql
--
-- Bowling clients previously supplied `pins`, so two clients could animate
-- different predictions before the accepted move arrived. Resolve pins from
-- aim + power inside the row-locked RPC and store that canonical result in
-- game_moves. Both lanes now replay the same accepted payload.

create or replace function public.resolve_bowling_pins(
  p_aim numeric,
  p_power numeric,
  p_standing integer
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  v_standing integer := greatest(0, least(10, coalesce(p_standing, 0)));
  v_aim numeric := greatest(-1, least(1, coalesce(p_aim, 0)));
  v_power numeric := greatest(0, least(1, coalesce(p_power, 0)));
  v_aim_error numeric;
  v_power_error numeric;
  v_aim_quality numeric;
  v_power_quality numeric;
  v_base integer;
  v_hook_penalty numeric;
  v_power_penalty integer;
begin
  v_aim_error := abs(v_aim);
  v_power_error := abs(v_power - 0.84);
  v_aim_quality := greatest(0, least(1, 1 - v_aim_error / 0.92));
  v_power_quality := greatest(0, least(1, 1 - v_power_error / 0.84));

  if v_standing <= 0 then return 0; end if;
  if v_aim_error > 0.78 or v_power < 0.14 then return 0; end if;
  if v_standing = 10 and v_aim_error <= 0.13 and v_power between 0.72 and 0.98 then return 10; end if;
  if v_standing < 10 and v_aim_error <= 0.22 and v_power >= 0.55 then return v_standing; end if;

  v_base := round(v_standing * (0.12 + v_aim_quality * 0.52 + v_power_quality * 0.34));
  v_hook_penalty := greatest(0, v_aim_error - 0.42) * 3;
  v_power_penalty := case when v_power < 0.35 then 2 when v_power > 0.98 then 1 else 0 end;
  return greatest(0, least(v_standing, v_base - round(v_hook_penalty)::integer - v_power_penalty));
end;
$$;

-- Correct 10th-frame rack state: after X,6 the third ball sees four pins,
-- while after a spare the bonus ball receives a fresh rack.
create or replace function public.bowling_player_state(p_rolls jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_rolls jsonb := case when jsonb_typeof(coalesce(p_rolls, '[]'::jsonb)) = 'array' then coalesce(p_rolls, '[]'::jsonb) else '[]'::jsonb end;
  v_n integer := jsonb_array_length(case when jsonb_typeof(coalesce(p_rolls, '[]'::jsonb)) = 'array' then coalesce(p_rolls, '[]'::jsonb) else '[]'::jsonb end);
  v_i integer := 0;
  v_f integer;
  v_first integer;
  v_second integer;
  v_remaining integer;
  v_bonus boolean;
  v_needed integer;
  v_standing integer;
begin
  for v_f in 0..9 loop
    if v_i >= v_n then
      return jsonb_build_object('currentFrame', v_f, 'ballInFrame', 0, 'standingPins', 10, 'complete', false);
    end if;
    v_first := least(10, greatest(0, coalesce((v_rolls->>v_i)::integer, 0)));

    if v_f < 9 then
      if v_first = 10 then v_i := v_i + 1; continue; end if;
      if v_i + 1 >= v_n then
        return jsonb_build_object('currentFrame', v_f, 'ballInFrame', 1, 'standingPins', greatest(0, 10 - v_first), 'complete', false);
      end if;
      v_i := v_i + 2;
      continue;
    end if;

    v_remaining := v_n - v_i;
    if v_remaining = 1 then
      v_standing := case when v_first = 10 then 10 else greatest(0, 10 - v_first) end;
      return jsonb_build_object('currentFrame', v_f, 'ballInFrame', 1, 'standingPins', v_standing, 'complete', false);
    end if;

    v_second := least(10, greatest(0, coalesce((v_rolls->>(v_i + 1))::integer, 0)));
    v_bonus := v_first = 10 or v_first + v_second = 10;
    v_needed := case when v_bonus then 3 else 2 end;
    if v_remaining >= v_needed then
      return jsonb_build_object('currentFrame', 10, 'ballInFrame', 0, 'standingPins', 10, 'complete', true);
    end if;

    v_standing := case
      when v_first = 10 and v_second < 10 then greatest(0, 10 - v_second)
      else 10
    end;
    return jsonb_build_object('currentFrame', v_f, 'ballInFrame', v_remaining, 'standingPins', v_standing, 'complete', false);
  end loop;

  return jsonb_build_object('currentFrame', 10, 'ballInFrame', 0, 'standingPins', 10, 'complete', true);
end;
$$;

create or replace function public.submit_bowling_roll(
  p_session_id uuid,
  p_pins integer,
  p_aim numeric default 0,
  p_power numeric default 0,
  p_frame integer default null,
  p_ball integer default null
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
  v_host uuid;
  v_seat integer;
  v_seat_count integer;
  v_state jsonb;
  v_next_state jsonb;
  v_current_seat integer;
  v_current_frame integer;
  v_ball_in_frame integer;
  v_standing integer;
  v_pins integer;
  v_aim numeric;
  v_power numeric;
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

  select gsp.seat_index into v_seat
    from public.game_session_players as gsp
   where gsp.session_id = p_session_id
     and gsp.profile_id = v_caller;

  if v_seat is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'not seated in this session';
    return next; return;
  end if;

  select
    coalesce(nullif(trim(gs.selected_game_key), ''), gs.game_key),
    gs.status,
    coalesce(gs.metadata, '{}'::jsonb),
    gs.host_id
    into v_game_key, v_status, v_meta, v_host
    from public.game_sessions as gs
   where gs.id = p_session_id
   for update;

  if v_game_key is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'session not found';
    return next; return;
  end if;
  if v_game_key like '%-party' then v_game_key := left(v_game_key, length(v_game_key) - 6); end if;
  if v_game_key <> 'bowling' then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'session is not a bowling game';
    return next; return;
  end if;
  if v_status not in ('waiting', 'active') then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'session not active';
    return next; return;
  end if;

  select greatest(1, count(*)::integer) into v_seat_count
    from public.game_session_players as gsp
   where gsp.session_id = p_session_id;

  v_state := public.bowling_session_state(p_session_id, v_seat_count);
  if coalesce((v_state->>'gameOver')::boolean, false) then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('bowling', v_state, 'gameOver', true);
    error_message := 'game over'; return next; return;
  end if;

  v_current_seat := coalesce((v_state->>'currentSeat')::integer, 0);
  v_current_frame := coalesce((v_state->>'currentFrame')::integer, 0);
  v_ball_in_frame := coalesce((v_state->>'ballInFrame')::integer, 0);
  if v_seat is distinct from v_current_seat then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('bowling', v_state);
    error_message := 'not your turn'; return next; return;
  end if;
  if p_frame is not null and p_frame is distinct from v_current_frame then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('bowling', v_state);
    error_message := 'lane advanced; refresh before rolling'; return next; return;
  end if;
  if p_ball is not null and p_ball is distinct from v_ball_in_frame then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('bowling', v_state);
    error_message := 'lane advanced; refresh before rolling'; return next; return;
  end if;

  v_standing := coalesce((v_state->>'standingPins')::integer, 10);
  v_aim := greatest(-1, least(1, coalesce(p_aim, 0)));
  v_power := greatest(0, least(1, coalesce(p_power, 0)));
  -- p_pins remains in the signature for deployed-client compatibility. It
  -- is intentionally ignored: the server owns the accepted pin count.
  v_pins := public.resolve_bowling_pins(v_aim, v_power, v_standing);

  v_move_index := public.next_game_move_index(p_session_id);
  v_payload := jsonb_build_object(
    'pins', v_pins,
    'aim', v_aim,
    'power', v_power,
    'frame', v_current_frame,
    'ball', v_ball_in_frame,
    'standingBefore', v_standing
  );
  v_next_state := public.bowling_session_state(p_session_id, v_seat_count, v_seat, v_pins);
  v_commit_status := case when coalesce((v_next_state->>'gameOver')::boolean, false) then 'completed' else 'active' end;
  v_meta := v_meta || jsonb_build_object(
    'bowling', v_next_state,
    'gameOver', coalesce((v_next_state->>'gameOver')::boolean, false),
    'lastMoveType', 'roll',
    'moveCount', v_move_index + 1
  );

  if not public.commit_game_session_move(
    p_session_id, v_move_index, v_caller, v_seat, 'roll', v_payload, v_meta, v_commit_status
  ) then
    select coalesce(gs.metadata, '{}'::jsonb) into v_meta
      from public.game_sessions as gs where gs.id = p_session_id;
    ok := false; move_index := -1; metadata := v_meta; error_message := 'move_index_conflict';
    return next; return;
  end if;

  ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
  return next;
end;
$$;

revoke all on function public.resolve_bowling_pins(numeric, numeric, integer) from public;
revoke all on function public.bowling_player_state(jsonb) from public;
revoke all on function public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer) from public;
grant execute on function public.resolve_bowling_pins(numeric, numeric, integer) to service_role;
grant execute on function public.bowling_player_state(jsonb) to service_role;
grant execute on function public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer) to authenticated, service_role;
