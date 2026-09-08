-- 0094_keeper_progress.sql
--
-- Persist achievement progress, earned badges and the daily streak.
--
-- These lived only in local storage, so clearing a browser lost every badge
-- and reset the streak, and none of it followed a keeper to another device.
-- That became more than a nuisance once the keeper abilities shipped: Second
-- Wind, Forage and Lantern Sense unlock off these same metrics, so a cleared
-- browser took every earned ability with it.
--
-- THE MERGE. Two devices can both play offline and neither is more correct,
-- so every field combines with a rule that does not depend on order:
--
--   * metrics    the larger of the two. They are counters, so this never
--                loses ground. It can under-count when two devices advance
--                the same metric independently — the honest cost of not
--                double-counting, where summing would inflate every total on
--                each sync.
--   * badges     the union. Earned is earned.
--   * earned-at  the earliest, so a re-sync cannot make an old badge new.
--   * streak     the larger; it is a high-water mark, not a running sum.
--   * gift date  the later; claiming today is what blocks a second claim.
--
-- Merging in SQL rather than in the client is what makes this safe: the
-- merge is atomic against the stored row, so a client that has been offline
-- for a week cannot overwrite progress made since with its stale copy. The
-- same rule is implemented in src/lib/game/keeper-progress.ts and checked
-- there, because the client merges locally before it syncs.
--
-- ON TRUST. The values are supplied by the client, as achievement progress
-- already was — the metrics have always been editable in local storage, and
-- the badge rewards they drive already pay out through the existing wallet
-- path. This changes where that state is kept, not how far it is trusted,
-- and the max-merge means a tampered value cannot be laundered into a larger
-- one by syncing repeatedly. Anything that should be authoritative belongs
-- in game_runs and claim_game_reward, which are unchanged.

create table if not exists public.keeper_progress (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  metrics jsonb not null default '{}'::jsonb,
  unlocked jsonb not null default '[]'::jsonb,
  unlocked_at jsonb not null default '{}'::jsonb,
  streak integer not null default 0 check (streak >= 0),
  gift_claimed_date date,
  updated_at timestamptz not null default now()
);

alter table public.keeper_progress enable row level security;

drop policy if exists "keepers read their own progress" on public.keeper_progress;
create policy "keepers read their own progress"
  on public.keeper_progress for select to authenticated
  using (auth.uid() = owner_id);

/* Writes go through sync_keeper_progress, which merges. A direct write would
   let a stale client replace the row wholesale, which is the one thing the
   merge exists to prevent. */
drop policy if exists "keepers do not write progress directly" on public.keeper_progress;
create policy "keepers do not write progress directly"
  on public.keeper_progress for all to authenticated
  using (false) with check (false);

create or replace function public.sync_keeper_progress(
  p_metrics jsonb default '{}'::jsonb,
  p_unlocked jsonb default '[]'::jsonb,
  p_unlocked_at jsonb default '{}'::jsonb,
  p_streak integer default 0,
  p_gift_claimed_date date default null
)
returns table (
  metrics jsonb,
  unlocked jsonb,
  unlocked_at jsonb,
  streak integer,
  gift_claimed_date date
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_now timestamptz := now();
  v_existing public.keeper_progress%rowtype;
  v_metrics jsonb;
  v_unlocked jsonb;
  v_unlocked_at jsonb;
  v_key text;
begin
  if v_owner is null then
    raise exception 'sign in required';
  end if;

  -- Anything unreadable is treated as absent rather than rejected: a sync
  -- must never fail in a way that loses the keeper's local progress.
  if jsonb_typeof(p_metrics) is distinct from 'object' then p_metrics := '{}'::jsonb; end if;
  if jsonb_typeof(p_unlocked) is distinct from 'array' then p_unlocked := '[]'::jsonb; end if;
  if jsonb_typeof(p_unlocked_at) is distinct from 'object' then p_unlocked_at := '{}'::jsonb; end if;

  insert into public.keeper_progress (owner_id) values (v_owner)
  on conflict (owner_id) do nothing;

  select * into v_existing from public.keeper_progress
   where owner_id = v_owner for update;

  -- metrics: the larger of the two, per key, over the union of keys.
  v_metrics := v_existing.metrics;
  for v_key in select jsonb_object_keys(p_metrics)
  loop
    if jsonb_typeof(p_metrics -> v_key) = 'number' then
      v_metrics := jsonb_set(
        v_metrics,
        array[v_key],
        to_jsonb(greatest(
          coalesce((v_metrics ->> v_key)::numeric, 0),
          greatest((p_metrics ->> v_key)::numeric, 0)
        )),
        true
      );
    end if;
  end loop;

  -- badges: the union, as a de-duplicated array.
  select coalesce(jsonb_agg(distinct value), '[]'::jsonb) into v_unlocked
    from jsonb_array_elements(v_existing.unlocked || p_unlocked) as t(value)
   where jsonb_typeof(value) = 'string';

  -- earned-at: the earliest per badge.
  v_unlocked_at := v_existing.unlocked_at;
  for v_key in select jsonb_object_keys(p_unlocked_at)
  loop
    if jsonb_typeof(p_unlocked_at -> v_key) = 'string' then
      if (v_unlocked_at ? v_key) is not true
         or (p_unlocked_at ->> v_key) < (v_unlocked_at ->> v_key) then
        v_unlocked_at := jsonb_set(v_unlocked_at, array[v_key], p_unlocked_at -> v_key, true);
      end if;
    end if;
  end loop;

  update public.keeper_progress
     set metrics = v_metrics,
         unlocked = v_unlocked,
         unlocked_at = v_unlocked_at,
         streak = greatest(coalesce(v_existing.streak, 0), greatest(coalesce(p_streak, 0), 0)),
         gift_claimed_date = greatest(v_existing.gift_claimed_date, p_gift_claimed_date),
         updated_at = v_now
   where owner_id = v_owner
   returning
     keeper_progress.metrics,
     keeper_progress.unlocked,
     keeper_progress.unlocked_at,
     keeper_progress.streak,
     keeper_progress.gift_claimed_date
   into metrics, unlocked, unlocked_at, streak, gift_claimed_date;

  return next;
end;
$$;

comment on function public.sync_keeper_progress(jsonb, jsonb, jsonb, integer, date) is
  'Merges a device''s achievement metrics, badges and daily streak into the keeper''s stored row and returns the merged result. Counters take the larger value, badges union, earn times keep the earliest, streak and gift date advance — so the merge is order-independent and safe to repeat, and a client that has been offline cannot overwrite newer progress. Mirrors mergeKeeperProgress in src/lib/game/keeper-progress.ts.';

revoke all on function public.sync_keeper_progress(jsonb, jsonb, jsonb, integer, date) from public;
grant execute on function public.sync_keeper_progress(jsonb, jsonb, jsonb, integer, date) to authenticated, service_role;
