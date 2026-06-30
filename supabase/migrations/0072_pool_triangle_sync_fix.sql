-- 0072_pool_triangle_sync_fix.sql
--
-- Pool follow-up:
--   1. Use a real 15-object-ball triangle rack instead of the temporary
--      9-ball diamond.
--   2. Keep submit_pool_shot aligned with the client payload size.
--   3. Preserve the existing server-authoritative turn/reward flow.

create or replace function public.pool_initial_metadata(p_player_count integer default 2)
returns jsonb
language sql
stable
set search_path = public
as $$
  with constants as (
    select
      270::numeric as cue_x,
      290::numeric as cue_y,
      620::numeric as rack_x,
      290::numeric as rack_y,
      12::numeric as r,
      (sqrt(3::numeric) * 12::numeric * 1.02)::numeric as x_step,
      (12::numeric * 2.04)::numeric as y_step,
      greatest(1, least(8, coalesce(p_player_count, 2)))::integer as player_count
  ),
  rack(number, label, color, stripe, row_num, offset_num) as (
    values
      (1, 'Rose', '#dc7f92', null, 0::numeric, 0::numeric),
      (2, 'Honey', '#e7b64b', null, 1::numeric, -0.5::numeric),
      (3, 'Lavender', '#9274c9', null, 1::numeric, 0.5::numeric),
      (4, 'Mint', '#77aa66', null, 2::numeric, -1::numeric),
      (8, 'Moon', '#3c2d35', '#f6e4b8', 2::numeric, 0::numeric),
      (5, 'Sky', '#6ca7c3', null, 2::numeric, 1::numeric),
      (10, 'Peony', '#ee9db4', '#fff1d6', 3::numeric, -1.5::numeric),
      (6, 'Cocoa', '#8b5748', null, 3::numeric, -0.5::numeric),
      (11, 'Sage', '#6f9f5d', '#fff1d6', 3::numeric, 0.5::numeric),
      (7, 'Blush', '#e4a2ad', null, 3::numeric, 1.5::numeric),
      (12, 'Dusk', '#6e5da8', '#fff1d6', 4::numeric, -2::numeric),
      (9, 'Cream', '#f6d98e', '#b66a82', 4::numeric, -1::numeric),
      (13, 'Cider', '#c98243', '#fff1d6', 4::numeric, 0::numeric),
      (14, 'River', '#568eaa', '#fff1d6', 4::numeric, 1::numeric),
      (15, 'Truffle', '#765043', '#fff1d6', 4::numeric, 2::numeric)
  ),
  balls as (
    select jsonb_build_array(
      jsonb_build_object(
        'id', 'cue', 'kind', 'cue', 'number', null, 'label', 'Cue', 'color', '#fffdf5',
        'x', constants.cue_x, 'y', constants.cue_y, 'vx', 0, 'vy', 0, 'radius', constants.r, 'potted', false
      )
    ) || coalesce(jsonb_agg(
      jsonb_build_object(
        'id', 'ball-' || rack.number::text,
        'kind', 'object',
        'number', rack.number,
        'label', rack.label,
        'color', rack.color,
        'stripe', rack.stripe,
        'x', round((constants.rack_x + rack.row_num * constants.x_step)::numeric, 2),
        'y', round((constants.rack_y + rack.offset_num * constants.y_step)::numeric, 2),
        'vx', 0,
        'vy', 0,
        'radius', constants.r,
        'potted', false
      )
      order by rack.row_num, rack.offset_num
    ), '[]'::jsonb) as value
    from constants, rack
    group by constants.cue_x, constants.cue_y, constants.r
  )
  select jsonb_build_object(
    'balls', balls.value,
    'currentSeat', 0,
    'scores', (
      select jsonb_agg(0 order by ord)
      from generate_series(1, constants.player_count) as ord
    ),
    'shotNumber', 0,
    'shotsRemaining', 12,
    'gameOver', false,
    'finalScore', 0
  )
  from balls, constants;
$$;

create or replace function public.submit_pool_shot(
  p_session_id uuid,
  p_angle double precision,
  p_power double precision,
  p_settled_balls jsonb,
  p_score_delta integer,
  p_potted_ids jsonb default '[]'::jsonb,
  p_scratched boolean default false
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
  v_session public.game_sessions%rowtype;
  v_game_key text;
  v_meta jsonb;
  v_pool jsonb;
  v_seat integer;
  v_seat_count integer;
  v_current_seat integer;
  v_current_shot_number integer;
  v_current_shots_remaining integer;
  v_shots_remaining integer;
  v_previous_potted_count integer;
  v_total_potted_count integer;
  v_potted_this_shot integer;
  v_remaining integer;
  v_expected_delta integer;
  v_score_array jsonb;
  v_next_scores jsonb := '[]'::jsonb;
  v_updated_score integer := 0;
  v_max_score integer := 0;
  v_index integer;
  v_next_seat integer;
  v_game_over boolean;
  v_message text;
  v_potted_diff_ids jsonb;
  v_next_pool jsonb;
  v_move_index integer;
  v_commit_status text;
  v_commit_payload jsonb;
begin
  if v_caller is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'sign in required'; return next; return;
  end if;

  select * into v_session
    from public.game_sessions as gs
   where gs.id = p_session_id
   for update;
  if v_session.id is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'session not found'; return next; return;
  end if;

  v_game_key := coalesce(nullif(trim(v_session.selected_game_key), ''), v_session.game_key);
  if v_game_key like '%-party' then
    v_game_key := left(v_game_key, length(v_game_key) - 6);
  end if;
  if v_game_key <> 'pool' then
    ok := false; move_index := -1; metadata := coalesce(v_session.metadata, '{}'::jsonb); error_message := 'session is not Pool'; return next; return;
  end if;
  if v_session.status not in ('waiting', 'active') then
    ok := false; move_index := -1; metadata := coalesce(v_session.metadata, '{}'::jsonb); error_message := 'Pool session is not active'; return next; return;
  end if;

  select gsp.seat_index into v_seat
    from public.game_session_players as gsp
   where gsp.session_id = p_session_id
     and gsp.profile_id = v_caller;
  if v_seat is null then
    ok := false; move_index := -1; metadata := coalesce(v_session.metadata, '{}'::jsonb); error_message := 'not seated in this Pool session'; return next; return;
  end if;

  select greatest(1, count(*))::integer into v_seat_count
    from public.game_session_players as gsp
   where gsp.session_id = p_session_id;

  v_meta := coalesce(v_session.metadata, '{}'::jsonb);
  v_pool := case
    when jsonb_typeof(v_meta->'pool') = 'object' then v_meta->'pool'
    else public.pool_initial_metadata(v_seat_count)
  end;

  if coalesce((v_pool->>'gameOver')::boolean, false) then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'Pool game is already over'; return next; return;
  end if;

  v_current_seat := coalesce((v_pool->>'currentSeat')::integer, 0);
  if v_seat is distinct from v_current_seat then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'not your turn'; return next; return;
  end if;

  if p_angle is null or p_angle < -6.28319 or p_angle > 6.28319 then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'invalid aim angle'; return next; return;
  end if;
  if p_power is null or p_power < 0.08 or p_power > 1.0 then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'invalid shot power'; return next; return;
  end if;
  if jsonb_typeof(p_settled_balls) <> 'array' or jsonb_array_length(p_settled_balls) <> 16 then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'invalid settled ball state'; return next; return;
  end if;
  if jsonb_typeof(coalesce(p_potted_ids, '[]'::jsonb)) <> 'array' then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'invalid potted ids'; return next; return;
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_settled_balls) as b(value)
     where not (
            coalesce(b.value->>'id', '') = 'cue'
         or coalesce(b.value->>'id', '') ~ '^ball-([1-9]|1[0-5])$'
       )
        or coalesce(b.value->>'kind', '') not in ('cue', 'object')
        or coalesce((b.value->>'radius')::numeric, 0) < 8
        or coalesce((b.value->>'radius')::numeric, 0) > 18
        or coalesce((b.value->>'x')::numeric, -9999) < 8
        or coalesce((b.value->>'x')::numeric, 9999) > 952
        or coalesce((b.value->>'y')::numeric, -9999) < 20
        or coalesce((b.value->>'y')::numeric, 9999) > 560
  ) then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'settled ball bounds invalid'; return next; return;
  end if;

  if (select count(distinct b.value->>'id') from jsonb_array_elements(p_settled_balls) as b(value)) <> 16 then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'settled ball ids are not unique'; return next; return;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_settled_balls) as b(value)
     where b.value->>'id' = 'cue'
       and coalesce((b.value->>'potted')::boolean, false)
  ) then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'cue ball must be reset after scratch'; return next; return;
  end if;

  select count(*)::integer into v_previous_potted_count
    from jsonb_array_elements(coalesce(v_pool->'balls', '[]'::jsonb)) as b(value)
   where b.value->>'kind' = 'object'
     and coalesce((b.value->>'potted')::boolean, false);
  select count(*)::integer into v_total_potted_count
    from jsonb_array_elements(p_settled_balls) as b(value)
   where b.value->>'kind' = 'object'
     and coalesce((b.value->>'potted')::boolean, false);

  if v_total_potted_count < v_previous_potted_count then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'potted balls cannot return'; return next; return;
  end if;

  v_potted_this_shot := greatest(0, v_total_potted_count - v_previous_potted_count);
  v_remaining := greatest(0, 15 - v_total_potted_count);
  v_current_shot_number := coalesce((v_pool->>'shotNumber')::integer, 0);
  v_current_shots_remaining := coalesce((v_pool->>'shotsRemaining')::integer, 12);
  v_shots_remaining := greatest(0, v_current_shots_remaining - 1);
  v_expected_delta :=
    (v_potted_this_shot * 100)
    + case when v_potted_this_shot > 1 then 250 else 0 end
    + case when v_remaining = 0 then 500 + (v_shots_remaining * 50) else 0 end
    - case when coalesce(p_scratched, false) then 100 else 0 end;

  if coalesce(p_score_delta, -999999) <> v_expected_delta then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'score delta mismatch'; return next; return;
  end if;

  select coalesce(jsonb_agg(next_ball.id order by next_ball.id), '[]'::jsonb)
    into v_potted_diff_ids
    from (
      select b.value->>'id' as id
        from jsonb_array_elements(p_settled_balls) as b(value)
       where b.value->>'kind' = 'object'
         and coalesce((b.value->>'potted')::boolean, false)
         and not exists (
           select 1
             from jsonb_array_elements(coalesce(v_pool->'balls', '[]'::jsonb)) as old_ball(value)
            where old_ball.value->>'id' = b.value->>'id'
              and coalesce((old_ball.value->>'potted')::boolean, false)
         )
    ) as next_ball;

  v_score_array := case when jsonb_typeof(v_pool->'scores') = 'array' then v_pool->'scores' else '[]'::jsonb end;
  for v_index in 0..(v_seat_count - 1) loop
    v_updated_score := greatest(
      0,
      coalesce((v_score_array->>v_index)::integer, 0)
      + case when v_index = v_seat then v_expected_delta else 0 end
    );
    if v_updated_score > v_max_score then
      v_max_score := v_updated_score;
    end if;
    v_next_scores := v_next_scores || to_jsonb(v_updated_score);
  end loop;

  v_game_over := v_remaining = 0 or v_shots_remaining <= 0;
  v_next_seat := case when v_game_over then v_current_seat else ((v_current_seat + 1) % greatest(1, v_seat_count)) end;
  v_message := case
    when v_game_over and v_remaining = 0 then 'Table cleared.'
    when v_game_over then 'Round complete.'
    when coalesce(p_scratched, false) then 'Scratch. Cue reset; turn passed.'
    when v_potted_this_shot > 1 then 'Combo pocket.'
    when v_potted_this_shot = 1 then 'Nice pocket.'
    else 'Balls settled.'
  end;

  v_next_pool := v_pool || jsonb_build_object(
    'balls', p_settled_balls,
    'currentSeat', v_next_seat,
    'scores', v_next_scores,
    'shotNumber', v_current_shot_number + 1,
    'shotsRemaining', v_shots_remaining,
    'gameOver', v_game_over,
    'finalScore', case when v_game_over then v_max_score else coalesce((v_pool->>'finalScore')::integer, 0) end,
    'lastShot', jsonb_build_object(
      'seat', v_seat,
      'angle', p_angle,
      'power', p_power,
      'pottedIds', coalesce(v_potted_diff_ids, p_potted_ids, '[]'::jsonb),
      'scratched', coalesce(p_scratched, false),
      'scoreDelta', v_expected_delta,
      'message', v_message,
      'submittedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );

  v_move_index := public.next_game_move_index(p_session_id);
  v_commit_status := case when v_game_over then 'completed' else 'active' end;
  v_commit_payload := jsonb_build_object(
    'angle', p_angle,
    'power', p_power,
    'scoreDelta', v_expected_delta,
    'pottedIds', coalesce(v_potted_diff_ids, p_potted_ids, '[]'::jsonb),
    'scratched', coalesce(p_scratched, false),
    'shotNumber', v_current_shot_number + 1
  );
  v_meta := v_meta || jsonb_build_object(
    'pool', v_next_pool,
    'gameOver', v_game_over,
    'finalScore', case when v_game_over then v_max_score else coalesce((v_meta->>'finalScore')::integer, 0) end,
    'lastMoveType', 'pool-shot',
    'moveCount', v_move_index + 1
  );

  if not public.commit_game_session_move(
    p_session_id,
    v_move_index,
    v_caller,
    v_seat,
    'pool-shot',
    v_commit_payload,
    v_meta,
    v_commit_status
  ) then
    select coalesce(gs.metadata, '{}'::jsonb) into v_meta
      from public.game_sessions as gs where gs.id = p_session_id;
    ok := false; move_index := -1; metadata := v_meta; error_message := 'move_index_conflict';
    return next; return;
  end if;

  update public.game_session_players as gsp
     set score = greatest(0, coalesce((v_next_scores->>v_seat)::integer, 0)),
         updated_at = now()
   where gsp.session_id = p_session_id
     and gsp.profile_id = v_caller;

  ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
  return next;
exception
  when others then
    ok := false;
    move_index := -1;
    metadata := coalesce(v_meta, '{}'::jsonb);
    error_message := sqlerrm;
    return next;
end;
$$;

update public.game_reward_specs
   set max_score = greatest(max_score, 3500),
       updated_at = now()
 where game_key = 'pool';

revoke all on function public.pool_initial_metadata(integer) from public;
revoke all on function public.submit_pool_shot(uuid, double precision, double precision, jsonb, integer, jsonb, boolean) from public;
grant execute on function public.pool_initial_metadata(integer) to authenticated, service_role;
grant execute on function public.submit_pool_shot(uuid, double precision, double precision, jsonb, integer, jsonb, boolean) to authenticated, service_role;
