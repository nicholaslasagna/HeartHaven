-- 0100_pool_black_ball_ends_the_frame.sql
--
-- Pool had no black-ball rule. The frame ended when the table was cleared or
-- the shot allowance ran out, and ball-8 — the Moon, the black — was worth
-- exactly the same hundred points as any other ball, at any time.
--
-- THE RULE. Potting the black ends the frame, whenever it drops.
--
--   * Black last, table otherwise clear -> the proper finish. The clear
--     bonus (500 + shotsRemaining * 50) is paid as it always was.
--   * Black early, balls still up -> the frame ends there and then, and it
--     costs 200. Without a penalty the fastest route to a finished game is to
--     sink the black on the break, which is not a game.
--
-- The penalty and the ending both have to agree with the client to the point,
-- because submit_pool_shot recomputes the score delta and rejects a shot that
-- does not match. The matching half lives in scorePoolShot() in
-- src/lib/game/pool-physics.ts and is pinned by checks/pool.ts.
--
-- Nothing else in the function changes. Applies on top of 0099.

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
  -- Derived, never hardcoded: the rack is defined in exactly one place.
  v_ball_count integer := jsonb_array_length(public.pool_initial_metadata(2) -> 'balls');
  -- Both derived from the same rack the table is dealt from, so neither can
  -- drift away from it the way the two literals above them did.
  v_object_ball_count integer := (
    select count(*)::integer
      from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls') as b(value)
     where b.value->>'kind' = 'object'
  );
  v_black_ball_id constant text := 'ball-8';
  v_black_potted_this_shot boolean := false;
  v_valid_ball_ids text[] := (
    select array_agg(b.value->>'id')
      from jsonb_array_elements(public.pool_initial_metadata(2) -> 'balls') as b(value)
  );
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
  if jsonb_typeof(p_settled_balls) <> 'array' or jsonb_array_length(p_settled_balls) <> v_ball_count then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'invalid settled ball state'; return next; return;
  end if;
  if jsonb_typeof(coalesce(p_potted_ids, '[]'::jsonb)) <> 'array' then
    ok := false; move_index := -1; metadata := v_meta || jsonb_build_object('pool', v_pool); error_message := 'invalid potted ids'; return next; return;
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_settled_balls) as b(value)
     where not (coalesce(b.value->>'id', '') = any (v_valid_ball_ids))
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

  if (select count(distinct b.value->>'id') from jsonb_array_elements(p_settled_balls) as b(value)) <> v_ball_count then
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

  select exists (
           select 1
             from jsonb_array_elements(p_settled_balls) as b(value)
            where b.value->>'id' = v_black_ball_id
              and coalesce((b.value->>'potted')::boolean, false)
         )
         and not exists (
           select 1
             from jsonb_array_elements(coalesce(v_pool->'balls', '[]'::jsonb)) as old_ball(value)
            where old_ball.value->>'id' = v_black_ball_id
              and coalesce((old_ball.value->>'potted')::boolean, false)
         )
    into v_black_potted_this_shot;

  v_potted_this_shot := greatest(0, v_total_potted_count - v_previous_potted_count);
  v_remaining := greatest(0, v_object_ball_count - v_total_potted_count);
  v_current_shot_number := coalesce((v_pool->>'shotNumber')::integer, 0);
  v_current_shots_remaining := coalesce((v_pool->>'shotsRemaining')::integer, 12);
  v_shots_remaining := greatest(0, v_current_shots_remaining - 1);
  v_expected_delta :=
    (v_potted_this_shot * 100)
    + case when v_potted_this_shot > 1 then 250 else 0 end
    + case when v_remaining = 0 then 500 + (v_shots_remaining * 50) else 0 end
    - case when coalesce(p_scratched, false) then 100 else 0 end
    - case when v_black_potted_this_shot and v_remaining > 0 then 200 else 0 end;

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

  v_game_over := v_remaining = 0 or v_black_potted_this_shot or v_shots_remaining <= 0;
  v_next_seat := case when v_game_over then v_current_seat else ((v_current_seat + 1) % greatest(1, v_seat_count)) end;
  v_message := case
    when v_game_over and v_remaining = 0 then 'Black sunk last. Table cleared.'
    when v_game_over and v_black_potted_this_shot then 'The black went down early. Frame over.'
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

revoke all on function public.submit_pool_shot(uuid, double precision, double precision, jsonb, integer, jsonb, boolean) from public;
grant execute on function public.submit_pool_shot(uuid, double precision, double precision, jsonb, integer, jsonb, boolean) to authenticated, service_role;
