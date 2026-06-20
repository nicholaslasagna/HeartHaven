-- 0068_bowling_pocket_physics.sql
--
-- Replace Bowling's automatic center-line strike/spare shortcuts with a
-- forgiving pocket-and-power model. Each accepted roll stores a deterministic
-- seed so every client replays the same lane drift and pin reactions.

create or replace function public.resolve_bowling_pins_v2(
  p_aim numeric,
  p_power numeric,
  p_standing integer,
  p_seed integer default 0
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
  v_seed_bucket integer := mod(abs(coalesce(p_seed, 0)::bigint), 1009)::integer;
  v_lane_unit numeric;
  v_variance_unit numeric;
  v_lane_drift numeric;
  v_effective_aim numeric;
  v_pocket_error numeric;
  v_pocket_quality numeric;
  v_power_quality numeric;
  v_force numeric;
  v_quality numeric;
  v_expected_ratio numeric;
  v_natural_variance integer;
  v_pins integer;
begin
  if v_standing <= 0 then return 0; end if;

  v_lane_unit := mod(v_seed_bucket * 53 + 29, 101)::numeric / 100;
  v_variance_unit := mod(v_seed_bucket * 37 + 17, 101)::numeric / 100;
  v_lane_drift := (v_lane_unit - 0.5) * 0.09;
  v_effective_aim := greatest(-1, least(1, v_aim + v_lane_drift));
  v_pocket_error := abs(abs(v_effective_aim) - 0.18);
  v_pocket_quality := greatest(0, least(1, 1 - v_pocket_error / 0.52));
  v_power_quality := case
    when v_power < 0.76 then v_power / 0.76
    when v_power <= 0.92 then 1
    else greatest(0, least(1, 1 - (v_power - 0.92) / 0.22))
  end;
  v_force := greatest(0, least(1, (v_power - 0.08) / 0.68));

  if abs(v_effective_aim) > 0.9 or v_power < 0.12 then return 0; end if;

  v_quality := v_pocket_quality * 0.58 + v_power_quality * 0.42;
  v_expected_ratio := 0.06 + 0.82 * v_force * v_quality;
  if v_pocket_error <= 0.08 and v_power between 0.74 and 0.95 then
    v_expected_ratio := v_expected_ratio + 0.08;
  end if;
  if abs(v_effective_aim) < 0.055 then
    v_expected_ratio := v_expected_ratio - 0.055;
  end if;
  v_expected_ratio := greatest(0, least(0.98, v_expected_ratio));

  v_natural_variance := case
    when v_variance_unit < 0.18 then -1
    when v_variance_unit > 0.9 then 1
    else 0
  end;
  v_pins := round(v_standing * v_expected_ratio)::integer + v_natural_variance;
  v_pins := greatest(0, least(v_standing, v_pins));

  if v_standing = 10 and v_pins >= 10 then
    if not (
      v_pocket_error <= 0.105
      and v_power between 0.68 and 0.97
      and v_variance_unit >= 0.48
    ) then
      v_pins := 9;
    end if;
  end if;
  return v_pins;
end;
$$;

-- Keep the original helper signature useful for diagnostics while routing new
-- behavior through the same model with a stable seed.
create or replace function public.resolve_bowling_pins(
  p_aim numeric,
  p_power numeric,
  p_standing integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select public.resolve_bowling_pins_v2(p_aim, p_power, p_standing, 0)
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
  v_roll_seed integer;
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
  -- p_pins remains only for deployed-client signature compatibility.
  v_move_index := public.next_game_move_index(p_session_id);
  v_roll_seed := abs(mod(
    hashtextextended(p_session_id::text || ':' || v_move_index::text || ':' || v_seat::text, 0),
    2147483647::bigint
  ))::integer;
  v_pins := public.resolve_bowling_pins_v2(v_aim, v_power, v_standing, v_roll_seed);

  v_payload := jsonb_build_object(
    'pins', v_pins,
    'aim', v_aim,
    'power', v_power,
    'rollSeed', v_roll_seed,
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

revoke all on function public.resolve_bowling_pins_v2(numeric, numeric, integer, integer) from public;
revoke all on function public.resolve_bowling_pins(numeric, numeric, integer) from public;
revoke all on function public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer) from public;
grant execute on function public.resolve_bowling_pins_v2(numeric, numeric, integer, integer) to service_role;
grant execute on function public.resolve_bowling_pins(numeric, numeric, integer) to service_role;
grant execute on function public.submit_bowling_roll(uuid, integer, numeric, numeric, integer, integer) to authenticated, service_role;
