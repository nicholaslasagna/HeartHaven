-- Prevent duplicate wallet payouts for the same completed game session
-- (e.g. refresh → new game_run → claim again with same session_id).

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

    if exists (
      select 1
        from public.game_reward_events e
       where e.profile_id = v_uid
         and e.game_session_id = p_session_id
         and e.game_key = v_run.game_key
    ) then
      update public.game_runs
         set status = 'cancelled', claimed_at = v_now, score = v_claim_score
       where id = p_run_id;
      select w.coins, w.hearts into v_new_coins, v_new_hearts
        from public.wallets w where w.profile_id = v_uid;
      coins := coalesce(v_new_coins, 0);
      hearts := coalesce(v_new_hearts, 0);
      coins_awarded := 0;
      hearts_awarded := 0;
      reason := 'already-claimed-session';
      return next;
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

revoke all on function public.claim_game_reward(uuid, integer, uuid) from public;
grant execute on function public.claim_game_reward(uuid, integer, uuid) to authenticated, service_role;
