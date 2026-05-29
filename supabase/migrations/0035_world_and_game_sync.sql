-- 0035_world_and_game_sync.sql
--
-- Server-canonical room wall/floor surfaces, garden plot care, and
-- authoritative mini-game moves via game_moves + session metadata.

-- ------------------------------------------------------------------------
-- 1. room_surfaces_state
-- ------------------------------------------------------------------------

create table if not exists public.room_surfaces_state (
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  room_id text not null check (room_id ~ '^[a-z0-9_-]{1,64}$'),
  floor_id text not null default 'cream-checker',
  wall_id text not null default 'cream-plaster',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_friend_code text,
  primary key (host_profile_id, room_id)
);

alter table public.room_surfaces_state enable row level security;

create policy "authenticated read room surfaces"
  on public.room_surfaces_state for select to authenticated using (true);

create policy "deny direct room surface writes"
  on public.room_surfaces_state for all to authenticated using (false) with check (false);

-- ------------------------------------------------------------------------
-- 2. garden_plots_state
-- ------------------------------------------------------------------------

create table if not exists public.garden_plots_state (
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  garden_id text not null check (garden_id ~ '^[a-z0-9_-]{1,64}$'),
  plots jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_friend_code text,
  primary key (host_profile_id, garden_id)
);

alter table public.garden_plots_state enable row level security;

create policy "authenticated read garden plots"
  on public.garden_plots_state for select to authenticated using (true);

create policy "deny direct garden plot writes"
  on public.garden_plots_state for all to authenticated using (false) with check (false);

-- ------------------------------------------------------------------------
-- 3. game_moves — append-only move log per session
-- ------------------------------------------------------------------------

create table if not exists public.game_moves (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  move_index integer not null check (move_index >= 0),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  seat_index integer not null default 0 check (seat_index >= 0),
  move_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, move_index)
);

create index if not exists game_moves_session_idx
  on public.game_moves (session_id, move_index asc);

alter table public.game_moves enable row level security;

create policy "session members read game moves"
  on public.game_moves for select to authenticated
  using (public.is_game_session_member(session_id));

create policy "deny direct game move writes"
  on public.game_moves for insert to authenticated with check (false);

-- ------------------------------------------------------------------------
-- 4. Audit scope expansion
-- ------------------------------------------------------------------------

alter table public.multiplayer_state_audit
  drop constraint if exists multiplayer_state_audit_scope_check;

alter table public.multiplayer_state_audit
  add constraint multiplayer_state_audit_scope_check
  check (scope in ('room', 'garden', 'room_surfaces', 'garden_plots'));

-- ------------------------------------------------------------------------
-- 5. get_room_surfaces / save_room_surfaces
-- ------------------------------------------------------------------------

create or replace function public.get_room_surfaces(p_host_friend_code text, p_room_id text)
returns table (floor_id text, wall_id text, version integer, updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare v_host uuid;
begin
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then return; end if;
  return query
    select s.floor_id, s.wall_id, s.version, s.updated_at
    from public.room_surfaces_state s
    where s.host_profile_id = v_host and s.room_id = p_room_id;
end;
$$;

create or replace function public.save_room_surfaces(
  p_host_friend_code text,
  p_room_id text,
  p_floor_id text,
  p_wall_id text,
  p_expected_version integer
)
returns table (version integer, updated_at timestamptz, conflict boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_host uuid;
  v_caller uuid := auth.uid();
  v_caller_code text;
  v_can_edit boolean;
  v_current_version integer;
  v_new_version integer;
  v_now timestamptz := now();
  v_floor text := left(trim(coalesce(p_floor_id, '')), 64);
  v_wall text := left(trim(coalesce(p_wall_id, '')), 64);
begin
  if v_caller is null then raise exception 'sign in required'; end if;
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then raise exception 'unknown host'; end if;
  v_can_edit := public.is_room_editor(v_host, p_room_id, v_caller);
  if not v_can_edit then raise exception 'not authorized to edit this room'; end if;
  if v_floor = '' or v_wall = '' then raise exception 'invalid surface ids'; end if;

  select p.friend_code into v_caller_code from public.profiles p where p.id = v_caller;

  select s.version into v_current_version
    from public.room_surfaces_state s
    where s.host_profile_id = v_host and s.room_id = p_room_id;

  if v_current_version is null then
    if p_expected_version is not null and p_expected_version <> 0 then
      version := 0; updated_at := null; conflict := true; return next; return;
    end if;
    v_new_version := 1;
    insert into public.room_surfaces_state (
      host_profile_id, room_id, floor_id, wall_id, version, updated_at,
      updated_by_profile_id, updated_by_friend_code
    ) values (v_host, p_room_id, v_floor, v_wall, v_new_version, v_now, v_caller, v_caller_code);
  else
    if p_expected_version is not null and p_expected_version <> v_current_version then
      version := v_current_version; updated_at := null; conflict := true; return next; return;
    end if;
    v_new_version := v_current_version + 1;
    update public.room_surfaces_state
       set floor_id = v_floor, wall_id = v_wall, version = v_new_version,
           updated_at = v_now, updated_by_profile_id = v_caller, updated_by_friend_code = v_caller_code
     where host_profile_id = v_host and room_id = p_room_id;
  end if;

  insert into public.multiplayer_state_audit (
    host_profile_id, scope, scope_id, action, actor_profile_id, actor_friend_code, summary
  ) values (
    v_host, 'room_surfaces', p_room_id, 'save', v_caller, v_caller_code,
    jsonb_build_object('floor_id', v_floor, 'wall_id', v_wall, 'new_version', v_new_version)
  );

  version := v_new_version; updated_at := v_now; conflict := false;
  return next;
end;
$$;

-- ------------------------------------------------------------------------
-- 6. get_garden_plots / save_garden_plots / apply_garden_plot_action
-- ------------------------------------------------------------------------

create or replace function public.get_garden_plots(p_host_friend_code text, p_garden_id text)
returns table (plots jsonb, version integer, updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare v_host uuid;
begin
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then return; end if;
  return query
    select s.plots, s.version, s.updated_at
    from public.garden_plots_state s
    where s.host_profile_id = v_host and s.garden_id = p_garden_id;
end;
$$;

create or replace function public.save_garden_plots(
  p_host_friend_code text,
  p_garden_id text,
  p_plots jsonb,
  p_expected_version integer
)
returns table (version integer, updated_at timestamptz, conflict boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_host uuid;
  v_caller uuid := auth.uid();
  v_caller_code text;
  v_can_edit boolean;
  v_current_version integer;
  v_count integer;
  v_new_version integer;
  v_now timestamptz := now();
begin
  if v_caller is null then raise exception 'sign in required'; end if;
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then raise exception 'unknown host'; end if;
  v_can_edit := public.is_garden_editor(v_host, p_garden_id, v_caller);
  if not v_can_edit then raise exception 'not authorized to edit this garden'; end if;
  if jsonb_typeof(p_plots) <> 'array' then raise exception 'plots must be a json array'; end if;
  v_count := jsonb_array_length(p_plots);
  if v_count > 32 then raise exception 'too many plots (max 32)'; end if;

  select p.friend_code into v_caller_code from public.profiles p where p.id = v_caller;

  select s.version into v_current_version
    from public.garden_plots_state s
    where s.host_profile_id = v_host and s.garden_id = p_garden_id;

  if v_current_version is null then
    if p_expected_version is not null and p_expected_version <> 0 then
      version := 0; updated_at := null; conflict := true; return next; return;
    end if;
    v_new_version := 1;
    insert into public.garden_plots_state (
      host_profile_id, garden_id, plots, version, updated_at,
      updated_by_profile_id, updated_by_friend_code
    ) values (v_host, p_garden_id, p_plots, v_new_version, v_now, v_caller, v_caller_code);
  else
    if p_expected_version is not null and p_expected_version <> v_current_version then
      version := v_current_version; updated_at := null; conflict := true; return next; return;
    end if;
    v_new_version := v_current_version + 1;
    update public.garden_plots_state
       set plots = p_plots, version = v_new_version, updated_at = v_now,
           updated_by_profile_id = v_caller, updated_by_friend_code = v_caller_code
     where host_profile_id = v_host and garden_id = p_garden_id;
  end if;

  insert into public.multiplayer_state_audit (
    host_profile_id, scope, scope_id, action, actor_profile_id, actor_friend_code, summary
  ) values (
    v_host, 'garden_plots', p_garden_id, 'save', v_caller, v_caller_code,
    jsonb_build_object('plot_count', v_count, 'new_version', v_new_version)
  );

  version := v_new_version; updated_at := v_now; conflict := false;
  return next;
end;
$$;

create or replace function public.apply_garden_plot_action(
  p_host_friend_code text,
  p_garden_id text,
  p_plot_id text,
  p_action text,
  p_expected_version integer
)
returns table (plots jsonb, version integer, updated_at timestamptz, conflict boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_host uuid;
  v_caller uuid := auth.uid();
  v_caller_code text;
  v_can_edit boolean;
  v_current_version integer;
  v_plots jsonb;
  v_new_plots jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_plot_id text;
  v_progress integer;
  v_stage text;
  v_new_version integer;
  v_now timestamptz := now();
  v_action text := lower(trim(coalesce(p_action, '')));
  v_target text := left(trim(coalesce(p_plot_id, '')), 64);
  v_found boolean := false;
begin
  if v_caller is null then raise exception 'sign in required'; end if;
  if v_action not in ('water', 'harvest') then raise exception 'invalid plot action'; end if;

  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then raise exception 'unknown host'; end if;
  v_can_edit := public.is_garden_editor(v_host, p_garden_id, v_caller);
  if not v_can_edit then raise exception 'not authorized to edit this garden'; end if;

  select p.friend_code into v_caller_code from public.profiles p where p.id = v_caller;

  select s.plots, s.version into v_plots, v_current_version
    from public.garden_plots_state s
    where s.host_profile_id = v_host and s.garden_id = p_garden_id;

  if v_current_version is null then
    if p_expected_version is not null and p_expected_version <> 0 then
      plots := '[]'::jsonb; version := 0; updated_at := null; conflict := true; return next; return;
    end if;
    v_plots := '[]'::jsonb;
    v_current_version := 0;
  elsif p_expected_version is not null and p_expected_version <> v_current_version then
    plots := v_plots; version := v_current_version; updated_at := null; conflict := true; return next; return;
  end if;

  if jsonb_typeof(v_plots) <> 'array' then v_plots := '[]'::jsonb; end if;

  for v_elem in select value from jsonb_array_elements(v_plots)
  loop
    v_plot_id := coalesce(v_elem->>'id', '');
    if v_plot_id = v_target then
      v_found := true;
      v_progress := least(100, greatest(0, coalesce((v_elem->>'progress')::integer, 0)));
      v_stage := coalesce(v_elem->>'stage', 'Seed');
      if v_action = 'water' then
        v_progress := least(100, v_progress + 18);
        v_stage := case
          when v_progress >= 85 then 'Blooming'
          when v_progress >= 55 then 'Growing'
          when v_progress >= 25 then 'Sprout'
          else 'Seed'
        end;
        v_elem := v_elem || jsonb_build_object(
          'progress', v_progress, 'stage', v_stage, 'status', 'Watered'
        );
      else
        if v_progress >= 80 then
          v_progress := 12;
          v_stage := 'Seed';
          v_elem := v_elem || jsonb_build_object(
            'progress', v_progress, 'stage', v_stage, 'status', 'Harvested'
          );
        else
          v_elem := v_elem || jsonb_build_object('status', 'Not ready to harvest');
        end if;
      end if;
    end if;
    v_new_plots := v_new_plots || jsonb_build_array(v_elem);
  end loop;

  if not v_found then raise exception 'plot not found'; end if;

  v_new_version := coalesce(v_current_version, 0) + 1;

  insert into public.garden_plots_state (
    host_profile_id, garden_id, plots, version, updated_at,
    updated_by_profile_id, updated_by_friend_code
  ) values (
    v_host, p_garden_id, v_new_plots, v_new_version, v_now, v_caller, v_caller_code
  )
  on conflict (host_profile_id, garden_id) do update
    set plots = excluded.plots, version = excluded.version, updated_at = excluded.updated_at,
        updated_by_profile_id = excluded.updated_by_profile_id,
        updated_by_friend_code = excluded.updated_by_friend_code;

  insert into public.multiplayer_state_audit (
    host_profile_id, scope, scope_id, action, actor_profile_id, actor_friend_code, summary
  ) values (
    v_host, 'garden_plots', p_garden_id, 'save', v_caller, v_caller_code,
    jsonb_build_object('plot_id', v_target, 'action', v_action, 'new_version', v_new_version)
  );

  plots := v_new_plots; version := v_new_version; updated_at := v_now; conflict := false;
  return next;
end;
$$;

-- ------------------------------------------------------------------------
-- 7. Game session helpers
-- ------------------------------------------------------------------------

create or replace function public.get_game_session_state(p_session_id uuid)
returns table (
  session_id uuid,
  game_key text,
  status text,
  metadata jsonb,
  seats jsonb
)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.is_game_session_member(p_session_id) then raise exception 'not a session member'; end if;

  return query
    select
      gs.id,
      gs.game_key,
      gs.status,
      gs.metadata,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'profile_id', gsp.profile_id,
              'display_name', gsp.display_name,
              'seat_index', gsp.seat_index,
              'team_key', gsp.team_key,
              'ready', gsp.ready,
              'score', gsp.score
            ) order by gsp.seat_index
          )
          from public.game_session_players gsp
          where gsp.session_id = gs.id
        ),
        '[]'::jsonb
      )
    from public.game_sessions gs
    where gs.id = p_session_id;
end;
$$;

create or replace function public.get_game_moves(p_session_id uuid, p_since_index integer default 0)
returns table (
  move_index integer,
  profile_id uuid,
  seat_index integer,
  move_type text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if not public.is_game_session_member(p_session_id) then raise exception 'not a session member'; end if;

  return query
    select gm.move_index, gm.profile_id, gm.seat_index, gm.move_type, gm.payload, gm.created_at
    from public.game_moves gm
    where gm.session_id = p_session_id
      and gm.move_index >= greatest(0, coalesce(p_since_index, 0))
    order by gm.move_index asc;
end;
$$;

create or replace function public.ensure_play_game_session(p_game_key text, p_max_players integer default 2)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_session_id uuid;
  v_display text;
begin
  if v_caller is null then raise exception 'sign in required'; end if;

  select gs.id into v_session_id
    from public.game_sessions gs
    join public.game_session_players gsp on gsp.session_id = gs.id
    where gsp.profile_id = v_caller
      and gs.game_key = p_game_key
      and gs.status in ('waiting', 'active')
    order by gs.updated_at desc
    limit 1;

  if v_session_id is not null then
    return v_session_id;
  end if;

  select coalesce(p.display_name, 'Keeper') into v_display
    from public.profiles p where p.id = v_caller;

  insert into public.game_sessions (host_id, game_key, mode, status, max_players, metadata)
  values (
    v_caller,
    p_game_key,
    'play',
    'active',
    greatest(2, least(12, coalesce(p_max_players, 2))),
    '{}'::jsonb
  )
  returning id into v_session_id;

  insert into public.game_session_players (session_id, profile_id, display_name, seat_index, team_key, ready)
  values (v_session_id, v_caller, v_display, 0, 'team-1', true);

  return v_session_id;
end;
$$;

-- Garden Four authoritative drop (7 columns, 6 rows, seats alternate)
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
  v_winner integer;
  v_game_over boolean;
  v_rows constant integer := 6;
  v_cols constant integer := 7;
  v_now timestamptz := now();
begin
  if v_caller is null then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'sign in required';
    return next; return;
  end if;

  if not public.is_game_session_member(p_session_id) then
    ok := false; move_index := -1; metadata := '{}'::jsonb; error_message := 'not a session member';
    return next; return;
  end if;

  select coalesce(nullif(trim(gs.selected_game_key), ''), gs.game_key), gs.status, gs.metadata
    into v_game_key, v_status, v_meta
    from public.game_sessions gs
    where gs.id = p_session_id;

  -- Party lobbies store the playable id in selected_game_key (e.g. garden-four-party).
  if v_game_key like '%-party' then
    v_game_key := left(v_game_key, length(v_game_key) - 6);
  elsif v_game_key = 'lobby' then
    ok := false; move_index := -1; metadata := coalesce(v_meta, '{}'::jsonb);
    error_message := 'no game selected for this lobby';
    return next; return;
  end if;

  if v_status not in ('waiting', 'active') then
    ok := false; move_index := -1; metadata := v_meta; error_message := 'session not active';
    return next; return;
  end if;

  select gsp.seat_index into v_seat
    from public.game_session_players gsp
    where gsp.session_id = p_session_id and gsp.profile_id = v_caller;

  if v_seat is null then
    ok := false; move_index := -1; metadata := coalesce(v_meta, '{}'::jsonb);
    error_message := 'not seated in this session';
    return next; return;
  end if;

  select coalesce(max(gm.move_index), -1) + 1 into v_move_index
    from public.game_moves gm where gm.session_id = p_session_id;

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

    -- Simple win check omitted for brevity — clients also check; metadata flags gameOver on full board
    v_game_over := false;
    if v_move_index + 1 >= v_rows * v_cols then v_game_over := true; end if;

    v_meta := v_meta || jsonb_build_object(
      'board', v_board,
      'currentSeat', case when v_game_over then v_current_seat else (v_current_seat + 1) % 2 end,
      'gameOver', v_game_over,
      'lastColumn', v_column,
      'lastRow', v_row,
      'moveCount', v_move_index + 1
    );

    insert into public.game_moves (session_id, move_index, profile_id, seat_index, move_type, payload)
    values (p_session_id, v_move_index, v_caller, v_seat, p_move_type, p_payload);

    update public.game_sessions
       set metadata = v_meta, status = 'active', updated_at = v_now
     where id = p_session_id;

    ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
    return next; return;
  end if;

  -- Generic move log for other games (client applies reducer)
  insert into public.game_moves (session_id, move_index, profile_id, seat_index, move_type, payload)
  values (p_session_id, v_move_index, v_caller, coalesce(v_seat, 0), p_move_type, coalesce(p_payload, '{}'::jsonb));

  v_meta := coalesce(v_meta, '{}'::jsonb) || jsonb_build_object('lastMoveType', p_move_type, 'moveCount', v_move_index + 1);

  update public.game_sessions
     set metadata = v_meta, status = 'active', updated_at = v_now
   where id = p_session_id;

  ok := true; move_index := v_move_index; metadata := v_meta; error_message := null;
  return next;
end;
$$;

-- Patch start_party_lobby to embed session_id in navigation href + event payload
create or replace function public.start_party_lobby()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_session_id uuid;
  v_href text;
  v_max_players integer;
  v_occupied integer;
  v_ready integer;
begin
  if v_host is null then raise exception 'sign in required'; end if;

  select id, selected_game_href, max_players
    into v_session_id, v_href, v_max_players
  from public.game_sessions
  where host_id = v_host and status = 'waiting'
  order by updated_at desc
  limit 1;

  if v_session_id is null then raise exception 'no waiting lobby'; end if;
  if v_href is null or length(trim(v_href)) = 0 then raise exception 'pick a game before starting'; end if;

  select count(*)::integer, count(*) filter (where ready)::integer
    into v_occupied, v_ready
  from public.game_session_players
  where session_id = v_session_id;

  if v_occupied < v_max_players then
    raise exception 'waiting for players (%/% seats filled)', v_occupied, v_max_players;
  end if;
  if v_ready < v_max_players then
    raise exception 'everyone needs to ready up (%/% ready)', v_ready, v_max_players;
  end if;

  update public.game_sessions
     set status = 'active',
         started_at = now(),
         updated_at = now(),
         game_key = coalesce(nullif(trim(selected_game_key), ''), game_key)
   where id = v_session_id;

  if position('?' in v_href) > 0 then
    v_href := v_href || '&session=' || v_session_id::text;
  else
    v_href := v_href || '?session=' || v_session_id::text;
  end if;

  insert into public.lobby_events (session_id, kind, payload)
  values (
    v_session_id,
    'started',
    jsonb_build_object('game_href', v_href, 'session_id', v_session_id)
  );

  return v_href;
end;
$$;

revoke all on function public.start_party_lobby() from public;
grant execute on function public.start_party_lobby() to authenticated, service_role;

revoke all on function public.get_room_surfaces(text, text) from public;
revoke all on function public.save_room_surfaces(text, text, text, text, integer) from public;
revoke all on function public.get_garden_plots(text, text) from public;
revoke all on function public.save_garden_plots(text, text, jsonb, integer) from public;
revoke all on function public.apply_garden_plot_action(text, text, text, text, integer) from public;
revoke all on function public.get_game_session_state(uuid) from public;
revoke all on function public.get_game_moves(uuid, integer) from public;
revoke all on function public.ensure_play_game_session(text, integer) from public;
revoke all on function public.submit_game_move(uuid, text, jsonb) from public;

grant execute on function public.get_room_surfaces(text, text) to authenticated, service_role;
grant execute on function public.save_room_surfaces(text, text, text, text, integer) to authenticated, service_role;
grant execute on function public.get_garden_plots(text, text) to authenticated, service_role;
grant execute on function public.save_garden_plots(text, text, jsonb, integer) to authenticated, service_role;
grant execute on function public.apply_garden_plot_action(text, text, text, text, integer) to authenticated, service_role;
grant execute on function public.get_game_session_state(uuid) to authenticated, service_role;
grant execute on function public.get_game_moves(uuid, integer) to authenticated, service_role;
grant execute on function public.ensure_play_game_session(text, integer) to authenticated, service_role;
grant execute on function public.submit_game_move(uuid, text, jsonb) to authenticated, service_role;

-- Garden Four reward spec (was missing from 0033 seed)
insert into public.game_reward_specs (
  game_key, label, max_score, min_duration_seconds, max_duration_seconds,
  coins_per_point, hearts_score_threshold, hearts_per_threshold,
  daily_cap_coins, daily_cap_hearts
) values
  ('garden-four', 'Garden Four', 500, 8, 600, 0.20, 100, 1, 80, 5)
on conflict (game_key) do nothing;

-- Realtime publication for game_moves + world state tables
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.game_moves; exception when others then null; end;
    begin alter publication supabase_realtime add table public.room_surfaces_state; exception when others then null; end;
    begin alter publication supabase_realtime add table public.garden_plots_state; exception when others then null; end;
  end if;
end $$;
