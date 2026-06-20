-- Read-only checks for 0068_bowling_pocket_physics.sql.
-- Run against the HeartHaven project after migration 0068 is applied.

with samples as (
  select seed,
    public.resolve_bowling_pins_v2(0.18, 0.84, 10, seed) as pocket,
    public.resolve_bowling_pins_v2(0, 0.84, 10, seed) as flat_center,
    public.resolve_bowling_pins_v2(0.18, 0.30, 10, seed) as too_soft,
    public.resolve_bowling_pins_v2(0.70, 0.84, 10, seed) as too_wide
  from generate_series(1, 100) as seed
)
select
  min(pocket) as pocket_min,
  max(pocket) as pocket_max,
  round(avg(pocket), 2) as pocket_average,
  max(flat_center) as flat_center_max,
  max(too_soft) as soft_max,
  max(too_wide) as wide_max,
  count(*) filter (where pocket = 10) as strikes_in_100
from samples;

select
  public.resolve_bowling_pins_v2(0.18, 0, 10, 47) as untouched_power_gutter,
  public.resolve_bowling_pins_v2(0.18, 0.84, 10, 47) as intentional_pocket_roll,
  public.resolve_bowling_pins_v2(0, 0.84, 10, 47) as flat_center_roll,
  public.resolve_bowling_pins_v2(1, 0.84, 10, 47) as outside_lane_gutter;

select
  p.proname,
  p.prosecdef as security_definer,
  pg_get_functiondef(p.oid) ilike '%for update%' as holds_session_row_lock,
  pg_get_functiondef(p.oid) ilike '%rollSeed%' as stores_shared_roll_seed,
  pg_get_functiondef(p.oid) ilike '%resolve_bowling_pins_v2%' as resolves_v2_server_side
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'submit_bowling_roll';

-- Expected:
-- - Pocket rolls vary naturally and include both strikes and near-strikes.
-- - Flat-center, soft, and wide averages are materially below pocket average.
-- - Untouched power and outside-lane examples return 0.
-- - submit_bowling_roll remains SECURITY DEFINER, row locked, stores rollSeed,
--   and resolves pin count through resolve_bowling_pins_v2.
