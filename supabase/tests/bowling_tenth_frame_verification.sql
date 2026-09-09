-- Bowling tenth-frame verification (run after 0102).
--
-- bowling_player_state says how many pins the next ball faces, and
-- submit_bowling_roll passes that straight to resolve_bowling_pins_v2 as the
-- rack to roll against. For the tenth frame with two balls thrown and a third
-- owed it returned a flat 10. Right after a spare, which resets the rack for
-- its bonus ball; wrong after a first-ball strike, where the third ball faces
-- only what the second ball left standing.
--
-- Prerequisites: migration 0102 applied.

-- 1) The tenth frame, reached with nine strikes. Expected, in order:
--    8, 10, 10, 10, 10, 6.
with nine as (select '[10,10,10,10,10,10,10,10,10'::text as head)
select label, (public.bowling_player_state((nine.head || tail || ']')::jsonb)->>'standingPins')::integer as standing
  from nine, (values
    ('strike then 2  -> 8 left standing', ',10,2'),
    ('strike then 0  -> all ten stand',   ',10,0'),
    ('strike then strike -> reset',       ',10,10'),
    ('spare -> reset for the bonus ball', ',7,3'),
    ('opening strike -> reset for ball 2',',10'),
    ('open frame     -> ball two faces 6',',4')
  ) as t(label, tail);

-- 2) The rule must be in the function rather than a flat ten.
--    Expected: follows_the_rack = true.
select prosrc like '%v_first = 10 and v_second < 10%' as follows_the_rack
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname = 'bowling_player_state';
