-- 0033_trusted_reward_validation.sql
--
-- Server-validated mini-game rewards. The existing `phase2_credit_wallet`
-- (migration 0031) trusts the client to pass `coins`/`hearts` directly —
-- a malicious browser console can drop `creditWallet({coins:99999})` and
-- the server happily mints. This migration flips the model so the server
-- DERIVES the reward from the game result:
--
--   1. Game start: client calls `start_game_run(game_key)`. Server returns
--      a run id + timestamp.
--   2. Game end: client calls `claim_game_reward(run_id, score)`. Server
--      looks up the per-game spec, validates score is plausible, validates
--      the run elapsed time is plausible, computes the reward, credits the
--      wallet, marks the run claimed.
--
-- Each game has a `game_reward_specs` row tuning:
--   - max_score (rejects impossible reports)
--   - min_duration_seconds (rejects "instant-win" exploits)
--   - max_duration_seconds (forces a fresh run rather than letting tokens
--     hang around indefinitely)
--   - coins_per_point + hearts_per_threshold (the actual payout formula)
--   - daily_cap_coins / daily_cap_hearts (rate-limit total daily earnings
--     per game)
--
-- `phase2_credit_wallet` stays in place for non-game grants (pet care,
-- daily gift, achievements) where the client legitimately decides. We
-- just stop using it from mini-games.

-- ------------------------------------------------------------------------
-- 1. game_reward_specs — per-game payout rules
-- ------------------------------------------------------------------------

create table if not exists public.game_reward_specs (
  game_key text primary key,
  /** Display name shown in the wallet ledger entry. */
  label text not null,
  /** Hard ceiling on a single-run score. Anything above is rejected as
   *  an obvious cheat report. */
  max_score integer not null check (max_score > 0),
  /** Wall-clock seconds the run must take at minimum. Stops "open the
   *  page, immediately claim 99 wins" attacks. */
  min_duration_seconds integer not null default 3 check (min_duration_seconds >= 0),
  /** Wall-clock seconds the run is valid for. After this expires the
   *  token can't be claimed; the keeper has to start a new run. */
  max_duration_seconds integer not null default 600 check (max_duration_seconds > 0),
  /** Linear payout — coins per single point of score. Use fractions via
   *  the score being scaled, or use thresholds via the metadata column
   *  if more complex curves are needed later. */
  coins_per_point numeric(8, 4) not null default 0 check (coins_per_point >= 0),
  /** Score threshold at which a heart is awarded. 0 disables. */
  hearts_score_threshold integer not null default 0 check (hearts_score_threshold >= 0),
  /** Number of hearts awarded if the threshold is met. */
  hearts_per_threshold integer not null default 0 check (hearts_per_threshold >= 0),
  /** Cap on coins earned per UTC day per game, per keeper. NULL = no cap. */
  daily_cap_coins integer check (daily_cap_coins is null or daily_cap_coins >= 0),
  daily_cap_hearts integer check (daily_cap_hearts is null or daily_cap_hearts >= 0),
  /** Free-form metadata for future per-game tuning without schema churn. */
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.game_reward_specs enable row level security;
create policy "anyone reads game reward specs"
  on public.game_reward_specs for select to authenticated using (true);
-- Writes via service role only (Studio).
create policy "deny direct write to specs"
  on public.game_reward_specs for all to authenticated
  using (false) with check (false);

-- ------------------------------------------------------------------------
-- 2. Seed sensible defaults for the mini-games currently in the app
-- ------------------------------------------------------------------------

insert into public.game_reward_specs (
  game_key, label, max_score, min_duration_seconds, max_duration_seconds,
  coins_per_point, hearts_score_threshold, hearts_per_threshold,
  daily_cap_coins, daily_cap_hearts
) values
  ('memory-match',       'Memory Match',       60,   8, 600, 0.50, 30, 1, 80, 5),
  ('bowling',            'Bowling',            300, 10, 600, 0.30, 200, 1, 80, 5),
  ('petal-catch',        'Petal Catch',        2000, 15, 600, 0.04, 500, 1, 100, 5),
  ('heart-hunt',         'Heart Hunt',         500, 10, 600, 0.10, 100, 1, 60, 5),
  ('lantern-relay',      'Lantern Relay',      500, 10, 600, 0.10, 100, 1, 60, 5),
  ('rock-paper-scissors','Rock, Paper, Scissors', 5, 5, 600, 4,   3,    1, 30, 3),
  ('fashion-show',       'Fashion Show',       100, 5,  600, 0.30, 80,  1, 50, 5)
on conflict (game_key) do nothing;

-- ------------------------------------------------------------------------
-- 3. game_runs — issued tokens + their outcomes (anti-replay record)
-- ------------------------------------------------------------------------

create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_key text not null references public.game_reward_specs(game_key) on delete restrict,
  status text not null default 'open' check (status in ('open', 'claimed', 'expired', 'cancelled')),
  started_at timestamptz not null default now(),
  claimed_at timestamptz,
  score integer,
  coins_awarded integer,
  hearts_awarded integer
);

create index if not exists game_runs_profile_idx
  on public.game_runs (profile_id, started_at desc);
create index if not exists game_runs_open_idx
  on public.game_runs (profile_id, game_key) where status = 'open';

alter table public.game_runs enable row level security;

create policy "keeper reads own runs"
  on public.game_runs for select to authenticated
  using (profile_id = auth.uid());

create policy "deny direct write to game runs"
  on public.game_runs for all to authenticated
  using (false) with check (false);

-- ------------------------------------------------------------------------
-- 4. start_game_run — issue a token
-- ------------------------------------------------------------------------

create or replace function public.start_game_run(p_game_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_spec_exists boolean;
  v_run_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in required';
  end if;
  if p_game_key is null or length(trim(p_game_key)) = 0 then
    raise exception 'game_key required';
  end if;

  select exists(select 1 from public.game_reward_specs where game_key = p_game_key)
    into v_spec_exists;
  if not v_spec_exists then
    raise exception 'unknown game_key %', p_game_key;
  end if;

  -- Expire any stale OPEN runs for the same (keeper, game) — keeps the
  -- table tidy and stops an attacker from collecting tokens over time.
  update public.game_runs
     set status = 'expired'
   where profile_id = v_uid
     and game_key = p_game_key
     and status = 'open'
     and started_at < now() - interval '1 hour';

  insert into public.game_runs (profile_id, game_key, status)
  values (v_uid, p_game_key, 'open')
  returning id into v_run_id;
  return v_run_id;
end;
$$;

revoke all on function public.start_game_run(text) from public;
grant execute on function public.start_game_run(text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 5. claim_game_reward — validate + credit
-- ------------------------------------------------------------------------
-- The client passes (run_id, score). Server reads the spec, validates the
-- score and elapsed time, computes the reward, credits the wallet,
-- inserts a game_reward_events row, and marks the run claimed.
--
-- Return shape mirrors `phase2_credit_wallet` so the calling code can be
-- a near drop-in swap.

create or replace function public.claim_game_reward(
  p_run_id uuid,
  p_score integer
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

  -- Look up + lock the run row. Lock prevents a double-claim race.
  select r.* into v_run
    from public.game_runs r
   where r.id = p_run_id and r.profile_id = v_uid
   for update;
  if v_run.id is null then
    raise exception 'run not found';
  end if;
  if v_run.status <> 'open' then
    -- Idempotent: a second claim returns the previously-awarded values
    -- without re-crediting. Lets the client safely retry on network blips.
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

  select s.* into v_spec from public.game_reward_specs s where s.game_key = v_run.game_key;
  if v_spec.game_key is null then
    raise exception 'spec missing for game_key %', v_run.game_key;
  end if;

  v_elapsed_seconds := greatest(0, extract(epoch from (v_now - v_run.started_at))::integer);

  -- Validate elapsed time. Outside the valid window → expire + reject.
  if v_elapsed_seconds < v_spec.min_duration_seconds then
    update public.game_runs set status = 'cancelled', claimed_at = v_now, score = p_score
      where id = p_run_id;
    raise exception 'run too short (% < %)', v_elapsed_seconds, v_spec.min_duration_seconds;
  end if;
  if v_elapsed_seconds > v_spec.max_duration_seconds then
    update public.game_runs set status = 'expired', claimed_at = v_now, score = p_score
      where id = p_run_id;
    raise exception 'run too old (% > %)', v_elapsed_seconds, v_spec.max_duration_seconds;
  end if;

  -- Validate score. Anything above max_score is impossible per the
  -- spec — treat as a cheat report, mark cancelled, raise.
  if p_score > v_spec.max_score then
    update public.game_runs set status = 'cancelled', claimed_at = v_now, score = p_score
      where id = p_run_id;
    raise exception 'score % exceeds max % for %', p_score, v_spec.max_score, v_run.game_key;
  end if;

  -- Compute reward from the spec.
  v_coins := floor(p_score * v_spec.coins_per_point)::integer;
  if v_spec.hearts_score_threshold > 0 and p_score >= v_spec.hearts_score_threshold then
    v_hearts := v_spec.hearts_per_threshold;
  end if;

  -- Apply daily caps (UTC day). Sum already-awarded today + this run's
  -- proposed award; if it exceeds the cap, clamp the award.
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

  -- Ensure wallet row exists, credit it.
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

  -- Record the run's outcome + a ledger row for the existing wallet UI.
  update public.game_runs
     set status = 'claimed', claimed_at = v_now, score = p_score,
         coins_awarded = v_coins, hearts_awarded = v_hearts
   where id = p_run_id;

  insert into public.game_reward_events (
    profile_id, game_session_id, game_key, score, coins, hearts, metadata
  ) values (
    v_uid, null, v_spec.game_key, p_score, v_coins, v_hearts,
    jsonb_build_object(
      'label', v_spec.label,
      'run_id', p_run_id,
      'elapsed_seconds', v_elapsed_seconds,
      'validated', true
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

revoke all on function public.claim_game_reward(uuid, integer) from public;
grant execute on function public.claim_game_reward(uuid, integer) to authenticated, service_role;
