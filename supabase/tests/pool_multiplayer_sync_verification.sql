-- Pool multiplayer sync verification.
--
-- Safe to run as an inspection script. The transaction block at the bottom
-- is intentionally commented because it needs two real test profiles and an
-- authenticated RPC context in the Supabase dashboard/API client.

select
  p.proname,
  pg_get_function_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('pool_initial_metadata', 'submit_pool_shot', 'claim_game_reward')
order by p.proname;

select
  public.pool_initial_metadata(2)->>'currentSeat' as current_seat,
  jsonb_array_length(public.pool_initial_metadata(2)->'balls') as ball_count,
  public.pool_initial_metadata(2)->'balls'->1->>'id' as apex_ball,
  public.pool_initial_metadata(2)->'balls'->5->>'id' as center_ball,
  public.pool_initial_metadata(2)->>'shotsRemaining' as shots_remaining;

select
  game_key,
  label,
  max_score,
  min_duration_seconds,
  coins_per_point
from public.game_reward_specs
where game_key = 'pool';

select
  position('submit_pool_shot' in pg_get_functiondef('public.submit_pool_shot(uuid,double precision,double precision,jsonb,integer,jsonb,boolean)'::regprocedure)) > 0
    as submit_pool_shot_defined,
  position('v_requires_session := v_run.game_key in' in pg_get_functiondef('public.claim_game_reward(uuid,integer,uuid)'::regprocedure)) > 0
    as reward_session_gate_present,
  position('pool' in pg_get_functiondef('public.claim_game_reward(uuid,integer,uuid)'::regprocedure)) > 0
    as reward_mentions_pool;

-- Manual authenticated smoke test outline:
--
-- 1. Create/host a party lobby, seat two test keepers, pick Moonberry Pool,
--    and start. Copy the shared /app/pool?session=<uuid> URL.
-- 2. Confirm both players read the same row:
--
-- select
--   gs.id,
--   coalesce(nullif(trim(gs.selected_game_key), ''), gs.game_key) as game_key,
--   gs.status,
--   jsonb_array_length(coalesce(gs.metadata->'pool'->'balls', public.pool_initial_metadata(2)->'balls')) as balls,
--   gs.metadata->'pool'->>'currentSeat' as current_seat,
--   jsonb_agg(jsonb_build_object('profile_id', gsp.profile_id, 'seat', gsp.seat_index, 'score', gsp.score) order by gsp.seat_index) as seats
-- from public.game_sessions gs
-- join public.game_session_players gsp on gsp.session_id = gs.id
-- where gs.id = '<session uuid here>'::uuid
-- group by gs.id;
--
-- 3. Active player shoots in the browser. Re-run the query and confirm:
--    - metadata->pool->shotNumber increments by 1
--    - metadata->pool->currentSeat changes to the other seat
--    - metadata->pool->balls contains the canonical settled table
--    - game_moves has exactly one pool-shot at the next move_index
--
-- 4. Attempt a shot from the non-current player. submit_pool_shot should
--    return ok=false and error_message='not your turn'.
--
-- 5. Finish the game, claim reward once, refresh, and claim again. The
--    second claim should return already-claimed-session and not increase
--    wallet totals.
