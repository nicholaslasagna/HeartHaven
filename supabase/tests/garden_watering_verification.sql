-- Garden watering verification (run after 0092).
--
-- Watering used to add 18 progress with no cooldown and no limit, and
-- harvesting reset the plot and paid nothing. The loop returned a text
-- string. Verified on a scratch PostgreSQL 16 cluster before shipping:
-- four waterings from bare soil to bloom, a second watering inside the
-- cooldown refused with the time remaining, harvest at full paying 24 coins
-- and a heart, and a plot left three days losing 36 progress to drought.
--
-- Prerequisites: migration 0092 applied.

-- 1) The function carries the new mechanics. Expected: all true.
select
  prosrc like '%c_water_every%'   as has_cooldown,
  prosrc like '%c_thirsty_after%' as has_drought,
  prosrc like '%wallets%'         as pays_out
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'apply_garden_plot_action';

-- 2) Plots in flight. `tended` drives the harvest payout and `wateredAt`
--    drives both the cooldown and the drought, so both must be present on
--    plots that have been watered since 0092.
select
  s.host_profile_id,
  s.garden_id,
  p->>'id'         as plot,
  p->>'progress'   as progress,
  p->>'stage'      as stage,
  p->>'tended'     as tended,
  p->>'wateredAt'  as watered_at,
  p->>'status'     as status
  from public.garden_plots_state s,
       jsonb_array_elements(s.plots) p
 order by s.updated_at desc
 limit 20;

-- 3) Plots watered before 0092 have no wateredAt, so they read as never
--    watered: the first watering after the migration starts their cadence
--    and they are not treated as in drought. Expected: informational only,
--    these heal themselves the first time someone waters them.
select count(*) as plots_awaiting_first_watering
  from public.garden_plots_state s,
       jsonb_array_elements(s.plots) p
 where p->>'wateredAt' is null;

-- 4) Harvest payouts, from the audit trail. Expected: coins only on
--    harvests, and never larger than base 12 + 3 x 5 = 27.
select
  summary->>'action' as action,
  count(*)           as times,
  max((summary->>'coins')::integer)  as max_coins,
  max((summary->>'hearts')::integer) as max_hearts
  from public.multiplayer_state_audit
 where scope = 'garden_plots'
   and summary ? 'coins'
 group by summary->>'action'
 order by action;

-- 5) Anything above the ceiling would mean the payout is not being computed
--    from the plot's own record. Expected: no rows.
select id, summary
  from public.multiplayer_state_audit
 where scope = 'garden_plots'
   and (summary->>'coins')::integer > 27;
