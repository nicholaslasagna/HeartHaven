-- 0079_bowling_spin_authoritative_wrapper.sql
--
-- Preserve the row-locked, server-authoritative bowling resolver while
-- accepting Moonberry Bowling's visual hook input. The original six-argument
-- overload remains available to older clients. This overload converts hook
-- into the effective pocket line used by the existing canonical resolver,
-- then records the original release line + spin for deterministic 3D replay.

create or replace function public.submit_bowling_roll(
  p_session_id uuid,
  p_pins integer,
  p_aim numeric,
  p_power numeric,
  p_frame integer,
  p_ball integer,
  p_spin numeric
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
  v_aim numeric := greatest(-1, least(1, coalesce(p_aim, 0)));
  v_spin numeric := greatest(-1, least(1, coalesce(p_spin, 0)));
  v_effective_aim numeric;
  v_result record;
begin
  -- A curved release changes the pocket line, but never bypasses the
  -- established server checks for membership, turn, frame, ball or status.
  v_effective_aim := greatest(-1, least(1, v_aim + v_spin * 0.16));

  select *
    into v_result
    from public.submit_bowling_roll(
      p_session_id,
      p_pins,
      v_effective_aim,
      p_power,
      p_frame,
      p_ball
    );

  if coalesce(v_result.ok, false) then
    update public.game_moves as gm
       set payload = coalesce(gm.payload, '{}'::jsonb) || jsonb_build_object(
         'aim', v_aim,
         'effectiveAim', v_effective_aim,
         'spin', v_spin,
         'releaseModel', 'moonberry-v2'
       )
     where gm.session_id = p_session_id
       and gm.move_index = v_result.move_index;
  end if;

  ok := coalesce(v_result.ok, false);
  move_index := coalesce(v_result.move_index, -1);
  metadata := coalesce(v_result.metadata, '{}'::jsonb);
  error_message := v_result.error_message;
  return next;
end;
$$;

revoke all on function public.submit_bowling_roll(
  uuid, integer, numeric, numeric, integer, integer, numeric
) from public;

grant execute on function public.submit_bowling_roll(
  uuid, integer, numeric, numeric, integer, integer, numeric
) to authenticated, service_role;

comment on function public.submit_bowling_roll(
  uuid, integer, numeric, numeric, integer, integer, numeric
) is
  'Moonberry Bowling authoritative roll. Delegates membership/turn/frame/result validation to the established six-argument resolver and stores spin only for deterministic visual replay.';
