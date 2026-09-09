-- 0102_bowling_tenth_frame_standing_pins.sql
--
-- The tenth-frame bonus ball was rolled at a full rack that was not there.
--
-- THE BUG. bowling_player_state returns how many pins the next ball faces.
-- For the tenth frame with two balls thrown and a third owed it returned a
-- flat 10. That is right after a spare, which resets the rack for its bonus
-- ball, but wrong after a first-ball strike: the second ball knocks at a
-- fresh rack of its own, and the third ball faces only what that ball left.
-- Strike then 2 leaves eight pins standing, and the server said ten.
--
-- It is not a display detail. submit_bowling_roll feeds this straight into
-- resolve_bowling_pins_v2 as the rack to roll against:
--
--     v_pins := public.resolve_bowling_pins_v2(v_aim, v_power, v_standing, ...)
--
-- so the bonus ball could knock down more pins than were standing, and
-- because resolve_bowling_pins_v2 treats a full rack specially it could even
-- score that ball as a strike on a rack missing pins. Free points on the last
-- ball of any game whose tenth frame opens with a strike, and the pins drawn
-- on screen disagreed with the pins scored.
--
-- THE FIX. Follow the same rule the client has always used, spelled out in
-- parseFrames() in src/lib/game/bowling-scoring.ts:
--
--     after a strike, a non-strike second bonus leaves only the pins it
--     missed standing for ball three.
--
-- Found by running 411 roll sequences through both scorers and diffing them.
-- Before: 11 disagreed, every one of them a tenth frame that opened with a
-- strike. After: none.
--
-- Nothing else in the function changes.

create or replace function public.bowling_player_state(p_rolls jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_rolls jsonb := case when jsonb_typeof(coalesce(p_rolls, '[]'::jsonb)) = 'array' then coalesce(p_rolls, '[]'::jsonb) else '[]'::jsonb end;
  v_n integer := jsonb_array_length(case when jsonb_typeof(coalesce(p_rolls, '[]'::jsonb)) = 'array' then coalesce(p_rolls, '[]'::jsonb) else '[]'::jsonb end);
  v_i integer := 0;
  v_f integer;
  v_first integer;
  v_second integer;
  v_remaining integer;
  v_bonus boolean;
  v_needed integer;
  v_standing integer;
begin
  for v_f in 0..9 loop
    if v_i >= v_n then
      return jsonb_build_object(
        'currentFrame', v_f,
        'ballInFrame', 0,
        'standingPins', 10,
        'complete', false
      );
    end if;

    v_first := least(10, greatest(0, coalesce((v_rolls->>v_i)::integer, 0)));

    if v_f < 9 then
      if v_first = 10 then
        v_i := v_i + 1;
        continue;
      end if;

      if v_i + 1 >= v_n then
        return jsonb_build_object(
          'currentFrame', v_f,
          'ballInFrame', 1,
          'standingPins', greatest(0, 10 - v_first),
          'complete', false
        );
      end if;

      v_i := v_i + 2;
      continue;
    end if;

    -- 10th frame.
    v_remaining := v_n - v_i;
    if v_remaining = 1 then
      v_standing := case when v_first = 10 then 10 else greatest(0, 10 - v_first) end;
      return jsonb_build_object(
        'currentFrame', v_f,
        'ballInFrame', 1,
        'standingPins', v_standing,
        'complete', false
      );
    end if;

    v_second := least(10, greatest(0, coalesce((v_rolls->>(v_i + 1))::integer, 0)));
    v_bonus := v_first = 10 or v_first + v_second = 10;
    v_needed := case when v_bonus then 3 else 2 end;

    if v_remaining >= v_needed then
      return jsonb_build_object(
        'currentFrame', 10,
        'ballInFrame', 0,
        'standingPins', 10,
        'complete', true
      );
    end if;

    -- Two balls thrown and a third owed. Only a spare resets the rack for
    -- that bonus ball; after a first-ball strike the second ball knocks at a
    -- fresh rack, and whatever it leaves is what the third ball faces.
    return jsonb_build_object(
      'currentFrame', v_f,
      'ballInFrame', v_remaining,
      'standingPins', case
        when v_first = 10 and v_second < 10 then greatest(0, 10 - v_second)
        else 10
      end,
      'complete', false
    );
  end loop;

  return jsonb_build_object(
    'currentFrame', 10,
    'ballInFrame', 0,
    'standingPins', 10,
    'complete', true
  );
end;
$$;

revoke all on function public.bowling_player_state(jsonb) from public;
grant execute on function public.bowling_player_state(jsonb) to authenticated, service_role;
