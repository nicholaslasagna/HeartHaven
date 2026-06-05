-- 0064_bowling_turn_enforcement.sql
--
-- Bowling used the generic submit_game_move path, which records moves but
-- does not know whose frame/ball is active. That let a seated player append
-- repeated rolls if their client got ahead of the shared move log.
--
-- Add a Bowling-specific RPC that derives the current frame/seat from the
-- authoritative game_moves log while holding the game_sessions row lock.

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
      return jsonb_build_object(
        'currentFrame', v_f,
        'ballInFrame', 0,
        'standingPins', 10,
        'complete', false
      );
    end if;

    v_first := least(10, greatest(0, coalesce((v_rolls->>v_i)::integer, 0)));

    if v_f < 9 then
      if v_first = 10 then
        v_i := v_i + 1;
        continue;
      end if;

      if v_i + 1 >= v_n then
        return jsonb_build_object(
          'currentFrame', v_f,
          'ballInFrame', 1,
          'standingPins', greatest(0, 10 - v_first),
          'complete', false
        );
      end if;

      v_i := v_i + 2;
      continue;
    end if;

    -- 10th frame.
    v_remaining := v_n - v_i;
    if v_remaining = 1 then
      v_standing := case when v_first = 10 then 10 else greatest(0, 10 - v_first) end;
      return jsonb_build_object(
        'currentFrame', v_f,
        'ballInFrame', 1,
        'standingPins', v_standing,
        'complete', false
      );
    end if;

    v_second := least(10, greatest(0, coalesce((v_rolls->>(v_i + 1))::integer, 0)));
    v_bonus := v_first = 10 or v_first + v_second = 10;
    v_needed := case when v_bonus then 3 else 2 end;

    if v_remaining >= v_needed then
      return jsonb_build_object(
        'currentFrame', 10,
        'ballInFrame', 0,
        'standingPins', 10,
        'complete', true
      );
    end if;

    return jsonb_build_object(
      'currentFrame', v_f,
      'ballInFrame', v_remaining,
      'standingPins', 10,
      'complete', false
    );
  end loop;

  return jsonb_build_object(
    'currentFrame', 10,
    'ballInFrame', 0,
    'standingPins', 10,
    'complete', true
  );
end;
$$;

create or replace function public.bowling_session_state(
  p_session_id uuid,
  p_seat_count integer,
  p_pending_seat integer default null,
  p_pending_pins integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat_count integer := greatest(1, least(8, coalesce(p_seat_count, 1)));
  v_seat integer;
  v_frame integer;
  v_rolls jsonb;
  v_state jsonb;
  v_states jsonb := '[]'::jsonb;
  v_current_seat integer := -1;
  v_current_frame integer := 0;
  v_ball_in_frame integer := 0;
  v_standing integer := 10;
  v_game_over boolean := true;
begin
  for v_seat in 0..(v_seat_count - 1) loop
    select coalesce(jsonb_agg(to_jsonb(least(10, greatest(0, coalesce((gm.payload->>'pins')::integer, 0)))) order by gm.move_index), '[]'::jsonb)
      into v_rolls
      from public.game_moves gm
     where gm.session_id = p_session_id
       and gm.seat_index = v_seat
       and gm.move_type = 'roll';

    if p_pending_seat is not null and p_pending_seat = v_seat then
      v_rolls := v_rolls || to_jsonb(least(10, greatest(0, coalesce(p_pending_pins, 0))));
    end if;

    v_state := public.bowling_player_state(v_rolls) || jsonb_build_object('seat', v_seat, 'rolls', v_rolls);
    v_states := v_states || v_state;
    if not coalesce((v_state->>'complete')::boolean, false) then
      v_game_over := false;
    end if;
  end loop;

  if not v_game_over then
    <<turn_scan>>
    for v_frame in 0..9 loop
      for v_seat in 0..(v_seat_count - 1) loop
        v_state := v_states->v_seat;
        if coalesce((v_state->>'currentFrame')::integer, 0) <= v_frame then
          v_current_seat := v_seat;
          v_current_frame := v_frame;
          if coalesce((v_state->>'currentFrame')::integer, 0) = v_frame then
            v_ball_in_frame := coalesce((v_state->>'ballInFrame')::integer, 0);
            v_standing := coalesce((v_state->>'standingPins')::integer, 10);
          else
            v_ball_in_frame := 0;
            v_standing := 10;
          end if;
          exit turn_scan;
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'players', v_states,
    'currentSeat', v_current_seat,
    'currentFrame', v_current_frame,
    'ballInFrame', v_ball_in_frame,
    'standingPins', v_standing,
    'gameOver', v_game_over
  );
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
  v_standing integer;
  v_pins integer;
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
    from public.game_session_players gsp
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
    from public.game_sessions gs
   where gs.id = p_session_id
   for update;

  if v_game_key is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'session not found';
    return next; return;
  end if;

  if v_game_key like '%-party' then
    v_game_key := left(v_game_key, length(v_game_key) - 6);
  end if;

  if v_game_key <> 'bowling' then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'session is not a bowling game';
    return next; return;
  end if;

  if v_status not in ('waiting', 'active') then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'session not active';
    return next; return;
  end if;

  select greatest(1, count(*)::integer)
    into v_seat_count
    from public.game_session_players gsp
   where gsp.session_id = p_session_id;

  v_state := public.bowling_session_state(p_session_id, v_seat_count);
  if coalesce((v_state->>'gameOver')::boolean, false) then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('bowling', v_state, 'gameOver', true);
    error_message := 'game over';
    return next; return;
  end if;

  v_current_seat := coalesce((v_state->>'currentSeat')::integer, 0);
  if v_seat is distinct from v_current_seat then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('bowling', v_state);
    error_message := 'not your turn';
    return next; return;
  end if;

  v_standing := coalesce((v_state->>'standingPins')::integer, 10);
  v_pins := least(10, greatest(0, coalesce(p_pins, 0)));
  if v_pins > v_standing then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('bowling', v_state);
    error_message := 'too many pins for this ball';
    return next; return;
  end if;

  v_move_index := public.next_game_move_index(p_session_id);
  v_payload := jsonb_build_object(
    'pins', v_pins,
    'aim', greatest(-1, least(1, coalesce(p_aim, 0))),
    'power', greatest(0, least(1, coalesce(p_power, 0))),
    'frame', p_frame,
    'ball', p_ball
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
      from public.game_sessions gs
     where gs.id = p_session_id;
    ok := false; move_index := -1; metadata := v_meta; error_message := 'move_index_conflict';
    return next; return;
  end if;

  ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
  return next;
end;
$$;

revoke all on function public.bowling_player_state(jsonb) from public;
revoke all on function public.bowling_session_state(uuid, integer, integer, integer) from public;
revoke all on function public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer) from public;

grant execute on function public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer) to authenticated, service_role;
grant execute on function public.bowling_player_state(jsonb) to service_role;
grant execute on function public.bowling_session_state(uuid, integer, integer, integer) to service_role;
