-- 0092_meaningful_garden_watering.sql
--
-- Watering a plot did almost nothing, and harvesting paid nothing at all.
--
-- WHAT IT WAS. `water` added 18 progress with no cooldown and no limit, so a
-- plot went from nothing to bloom in six clicks taken as fast as you could
-- press the button. `harvest` checked progress >= 80, reset the plot to 12,
-- and set the status string to 'Harvested'. No coins, no hearts, no record.
-- The entire loop returned a piece of text.
--
-- WHAT IT IS NOW. A plot is something you keep, not a button you clear:
--
--   * Watering has a cadence. A plot takes water once every two hours; ask
--     again inside that and the soil is still damp and nothing changes. Four
--     waterings carry a plot from bare soil to bloom, so a plot is a day's
--     tending rather than six seconds of clicking.
--   * Neglect costs something. A plot left twenty hours goes thirsty and
--     loses progress for every further day of drought. Watering now prevents
--     a loss as well as making a gain, which is what makes doing it matter.
--   * Harvesting pays. Coins are computed HERE, from the plot's own record of
--     how often it was watered this cycle — the client never names an amount.
--     A plot brought all the way to full also yields a heart.
--
-- The payout is deliberately modest and the cooldown is what bounds it: four
-- plots at roughly eight hours a cycle is a daily rhythm, not a coin press.
--
-- Both new fields are also carried by GardenPlotState in
-- src/lib/game/garden-plots.ts. hardenGardenPlots rebuilds every plot from a
-- fixed field list on both read and save, so a field it does not know is
-- stripped in both directions and the cadence would silently reset.

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
  -- Tuning. Four waterings from bare soil to bloom.
  c_water_step    constant integer  := 25;
  c_water_every   constant interval := interval '2 hours';
  c_thirsty_after constant interval := interval '20 hours';
  c_drought_loss  constant integer  := 12;   -- progress lost per day of drought
  c_harvest_at    constant integer  := 80;
  c_reward_base   constant integer  := 12;
  c_reward_per    constant integer  := 3;    -- per watering this cycle
  c_reward_cap    constant integer  := 5;    -- waterings that count

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
  v_status text;
  v_watered_at timestamptz;
  v_tended integer;
  v_new_version integer;
  v_now timestamptz := now();
  v_action text := lower(trim(coalesce(p_action, '')));
  v_target text := left(trim(coalesce(p_plot_id, '')), 64);
  v_found boolean := false;
  v_drought_days integer;
  v_reward_coins integer := 0;
  v_reward_hearts integer := 0;
  v_ready_in text;
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

    /* Drought applies to EVERY plot on any action, not just the one being
       tended. Otherwise a neglected plot would sit untouched forever simply
       because nobody pressed a button on it. */
    v_progress := least(100, greatest(0, coalesce((v_elem->>'progress')::integer, 0)));
    v_watered_at := nullif(v_elem->>'wateredAt', '')::timestamptz;
    v_tended := greatest(0, coalesce((v_elem->>'tended')::integer, 0));

    if v_watered_at is not null and v_now - v_watered_at > c_thirsty_after and v_progress > 0 then
      v_drought_days := floor(extract(epoch from (v_now - v_watered_at - c_thirsty_after)) / 86400)::integer + 1;
      v_progress := greatest(0, v_progress - c_drought_loss * v_drought_days);
      v_elem := v_elem || jsonb_build_object('progress', v_progress, 'status', 'Thirsty');
    end if;

    if v_plot_id = v_target then
      v_found := true;
      v_stage := coalesce(v_elem->>'stage', 'Seed');

      if v_action = 'water' then
        if v_watered_at is not null and v_now - v_watered_at < c_water_every then
          -- Still damp. Say when it will take water again rather than
          -- silently doing nothing.
          /* Total minutes, not to_char's 'MI' field — that prints only the
             minutes COMPONENT, so a one-hour-fifty-nine wait read as
             "59 min" and looked like the cooldown was under an hour. */
          v_ready_in := (
            select case
              when m >= 60 then (m / 60)::text || 'h ' || lpad((m % 60)::text, 2, '0') || 'm'
              else m::text || ' min'
            end
            from (select greatest(1, ceil(extract(epoch from (v_watered_at + c_water_every - v_now)) / 60)::integer) as m) t
          );
          v_elem := v_elem || jsonb_build_object('status', 'Soil still damp · ' || v_ready_in);
        else
          v_progress := least(100, v_progress + c_water_step);
          v_tended := v_tended + 1;
          v_stage := case
            when v_progress >= 85 then 'Blooming'
            when v_progress >= 55 then 'Growing'
            when v_progress >= 25 then 'Sprout'
            else 'Seed'
          end;
          v_status := case when v_progress >= c_harvest_at then 'Ready to harvest' else 'Watered' end;
          v_elem := v_elem || jsonb_build_object(
            'progress', v_progress,
            'stage', v_stage,
            'status', v_status,
            'wateredAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'tended', v_tended
          );
        end if;

      else -- harvest
        if v_progress >= c_harvest_at then
          /* The payout is computed from the plot's own tending record. The
             caller never supplies an amount, so there is nothing to inflate. */
          v_reward_coins := c_reward_base + c_reward_per * least(v_tended, c_reward_cap);
          v_reward_hearts := case when v_progress >= 100 then 1 else 0 end;

          v_progress := 12;
          v_stage := 'Seed';
          v_elem := v_elem || jsonb_build_object(
            'progress', v_progress,
            'stage', v_stage,
            'status', 'Harvested · +' || v_reward_coins || ' coins',
            'tended', 0,
            'wateredAt', null
          );
        else
          v_elem := v_elem || jsonb_build_object(
            'status', 'Not ready · ' || v_progress || '/' || c_harvest_at
          );
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

  /* Pay the harvester, not the garden's owner: tending someone else's garden
     as an approved decorator should reward the person who did the work. */
  if v_reward_coins > 0 then
    insert into public.wallets (profile_id, coins, hearts)
    values (v_caller, 500, 5)
    on conflict (profile_id) do nothing;

    update public.wallets w
       set coins = w.coins + v_reward_coins,
           hearts = w.hearts + v_reward_hearts,
           updated_at = v_now
     where w.profile_id = v_caller;
  end if;

  insert into public.multiplayer_state_audit (
    host_profile_id, scope, scope_id, action, actor_profile_id, actor_friend_code, summary
  ) values (
    v_host, 'garden_plots', p_garden_id, 'save', v_caller, v_caller_code,
    jsonb_build_object(
      'plot_id', v_target, 'action', v_action, 'new_version', v_new_version,
      'coins', v_reward_coins, 'hearts', v_reward_hearts
    )
  );

  plots := v_new_plots; version := v_new_version; updated_at := v_now; conflict := false;
  return next;
end;
$$;

comment on function public.apply_garden_plot_action(text, text, text, text, integer) is
  'Waters or harvests one plot. Watering is limited to once every two hours and four waterings bring a plot to bloom; a plot left twenty hours goes thirsty and loses progress per day of drought. Harvest coins are computed here from the plot''s own tending record, never supplied by the caller, and are credited to whoever did the tending rather than the garden owner.';

revoke all on function public.apply_garden_plot_action(text, text, text, text, integer) from public;
grant execute on function public.apply_garden_plot_action(text, text, text, text, integer) to authenticated, service_role;
