-- 0063_fix_reward_and_inventory_ambiguity.sql
--
-- Live verification found two PL/pgSQL ambiguity bugs:
--   1. claim_game_reward() used bare coins_awarded/hearts_awarded inside
--      aggregate queries while those names are also OUT parameters.
--   2. phase2_sync_inventory() still used a bare conflict target column name
--      that can collide with its OUT parameter names.
--
-- It also found reward spec caps that did not match server-authoritative
-- final scores:
--   - Memory Match stores finalScore around 1600 for a perfect board.
--   - RPS client scores around 540 for a best-of-five win.

update public.game_reward_specs
set max_score = 2000,
    hearts_score_threshold = 100,
    updated_at = now()
where game_key = 'memory-match';

update public.game_reward_specs
set max_score = 600,
    hearts_score_threshold = 300,
    updated_at = now()
where game_key = 'rock-paper-scissors';

create or replace function public.phase2_sync_inventory(p_items jsonb)
returns table (catalog_item_id text, quantity integer, equipped boolean, source text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_count integer;
begin
  if v_profile is null then
    raise exception 'sign in required';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'inventory payload must be an array';
  end if;

  v_count := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if v_count > 400 then
    raise exception 'too many inventory rows (max 400)';
  end if;

  create temporary table if not exists pg_temp.phase2_inventory_items (
    catalog_item_id text primary key,
    quantity integer not null,
    equipped boolean not null,
    source text not null
  ) on commit drop;

  truncate pg_temp.phase2_inventory_items;

  insert into pg_temp.phase2_inventory_items (catalog_item_id, quantity, equipped, source)
  select
    left(trim(item.catalog_item_id), 128) as catalog_item_id,
    least(999, sum(greatest(0, coalesce(item.quantity, 0))))::integer as quantity,
    bool_or(coalesce(item.equipped, false)) as equipped,
    left(max(coalesce(nullif(trim(item.source), ''), 'sync')), 40) as source
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    catalog_item_id text,
    quantity integer,
    equipped boolean,
    source text
  )
  join public.catalog_items catalog on catalog.id = item.catalog_item_id
  where catalog.active = true
    and coalesce(item.quantity, 0) > 0
  group by left(trim(item.catalog_item_id), 128);

  delete from public.inventory_items server_item
  where server_item.owner_id = v_profile
    and not exists (
      select 1
      from pg_temp.phase2_inventory_items next_item
      where next_item.catalog_item_id = server_item.catalog_item_id
    );

  insert into public.inventory_items (owner_id, catalog_item_id, quantity, equipped, source)
  select
    v_profile,
    next_item.catalog_item_id,
    next_item.quantity,
    next_item.equipped,
    next_item.source
  from pg_temp.phase2_inventory_items next_item
  on conflict on constraint inventory_items_owner_id_catalog_item_id_key do update set
    quantity = excluded.quantity,
    equipped = excluded.equipped,
    source = excluded.source,
    updated_at = now();

  return query
    select i.catalog_item_id, i.quantity, i.equipped, i.source, i.updated_at
    from public.inventory_items i
    where i.owner_id = v_profile
    order by i.updated_at desc;
end;
$$;

revoke all on function public.phase2_sync_inventory(jsonb) from public;
grant execute on function public.phase2_sync_inventory(jsonb) to authenticated, service_role;

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
      where gs.id = p_session_id
      for update;

    if v_session_game like '%-party' then
      v_session_game := left(v_session_game, length(v_session_game) - 6);
    end if;
    if v_session_game <> v_run.game_key then
      raise exception 'session is not a % game', v_run.game_key;
    end if;
    if not coalesce((v_session_meta->>'gameOver')::boolean, false) then
      raise exception '% is not complete', v_run.game_key;
    end if;

    if exists (
      select 1
        from public.game_reward_events event_row
       where event_row.profile_id = v_uid
         and event_row.game_session_id = p_session_id
         and event_row.game_key = v_run.game_key
    ) then
      update public.game_runs run_row
         set status = 'cancelled', claimed_at = v_now, score = v_claim_score
       where run_row.id = p_run_id;
      select w.coins, w.hearts into v_new_coins, v_new_hearts
        from public.wallets w where w.profile_id = v_uid;
      coins := coalesce(v_new_coins, 0);
      hearts := coalesce(v_new_hearts, 0);
      coins_awarded := 0;
      hearts_awarded := 0;
      reason := 'already-claimed-session';
      return next;
      return;
    end if;

    v_claim_score := greatest(0, coalesce((v_session_meta->>'finalScore')::integer, 0));
  end if;

  select s.* into v_spec from public.game_reward_specs s where s.game_key = v_run.game_key;
  if v_spec.game_key is null then
    raise exception 'spec missing for game_key %', v_run.game_key;
  end if;

  v_elapsed_seconds := greatest(0, extract(epoch from (v_now - v_run.started_at))::integer);

  if v_elapsed_seconds < v_spec.min_duration_seconds then
    update public.game_runs run_row
       set status = 'cancelled', claimed_at = v_now, score = v_claim_score
     where run_row.id = p_run_id;
    raise exception 'run too short (% < %)', v_elapsed_seconds, v_spec.min_duration_seconds;
  end if;
  if v_elapsed_seconds > v_spec.max_duration_seconds then
    update public.game_runs run_row
       set status = 'expired', claimed_at = v_now, score = v_claim_score
     where run_row.id = p_run_id;
    raise exception 'run too old (% > %)', v_elapsed_seconds, v_spec.max_duration_seconds;
  end if;

  if v_claim_score > v_spec.max_score then
    update public.game_runs run_row
       set status = 'cancelled', claimed_at = v_now, score = v_claim_score
     where run_row.id = p_run_id;
    raise exception 'score % exceeds max % for %', v_claim_score, v_spec.max_score, v_run.game_key;
  end if;

  v_coins := floor(v_claim_score * v_spec.coins_per_point)::integer;
  if v_spec.hearts_score_threshold > 0 and v_claim_score >= v_spec.hearts_score_threshold then
    v_hearts := v_spec.hearts_per_threshold;
  end if;

  if v_spec.daily_cap_coins is not null then
    select coalesce(sum(run_row.coins_awarded), 0) into v_daily_coins_today
      from public.game_runs run_row
     where run_row.profile_id = v_uid
       and run_row.game_key = v_run.game_key
       and run_row.status = 'claimed'
       and run_row.claimed_at >= date_trunc('day', v_now);
    if v_daily_coins_today + v_coins > v_spec.daily_cap_coins then
      v_coins := greatest(0, v_spec.daily_cap_coins - v_daily_coins_today);
    end if;
  end if;
  if v_spec.daily_cap_hearts is not null then
    select coalesce(sum(run_row.hearts_awarded), 0) into v_daily_hearts_today
      from public.game_runs run_row
     where run_row.profile_id = v_uid
       and run_row.game_key = v_run.game_key
       and run_row.status = 'claimed'
       and run_row.claimed_at >= date_trunc('day', v_now);
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

  update public.game_runs run_row
     set status = 'claimed', claimed_at = v_now, score = v_claim_score,
         coins_awarded = v_coins, hearts_awarded = v_hearts
   where run_row.id = p_run_id;

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

revoke all on function public.claim_game_reward(uuid, integer, uuid) from public;
grant execute on function public.claim_game_reward(uuid, integer, uuid) to authenticated, service_role;
