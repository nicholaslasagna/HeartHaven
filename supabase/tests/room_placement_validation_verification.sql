-- Room placement validation verification (run after 0095).
--
-- save_room_placements used to check only that the payload was an array of
-- at most 200 entries and then store it verbatim. Everything else — ids,
-- lengths, coordinates on the map — was enforced only in the browser, and
-- the RPC is callable without it.
--
-- Verified on a scratch PostgreSQL 16 cluster before shipping, including the
-- property that matters most: every value hardenRoomPlacements produces,
-- clamped extremes included, is accepted unchanged.
--
-- Prerequisites: migration 0095 applied.

-- 1) The validator exists and the save uses it. Expected: both true.
select
  to_regprocedure('public.validate_room_placement_payload(jsonb)') is not null as validator_exists,
  (select prosrc like '%validate_room_placement_payload%'
     from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_room_placements') as save_uses_it;

-- 2) It accepts what the client produces, including every clamped extreme.
--    Expected: no error.
select public.validate_room_placement_payload('[
  {"id":"a","catalogItemId":"lamp","x":-200,"y":4000,"rotation":-360,"scale":0.1,"zIndex":0},
  {"id":"b","catalogItemId":"rug","x":12.5,"y":300.25,"rotation":360,"scale":5,"zIndex":10000}
]'::jsonb) as accepts_client_output;

-- 3) And refuses what it should. Each of these should raise; run them one at
--    a time, since the first error ends the statement.
-- select public.validate_room_placement_payload('[{"catalogItemId":"lamp","x":0,"y":0}]'::jsonb);        -- no id
-- select public.validate_room_placement_payload('[{"id":"a","catalogItemId":"lamp","x":"10","y":0}]'::jsonb); -- string coord
-- select public.validate_room_placement_payload('[{"id":"a","catalogItemId":"lamp","x":9e9,"y":0}]'::jsonb);  -- off the map

-- 4) Anything already stored that the new rules would refuse. These were
--    written before the validator existed and are not rewritten by it; they
--    will be refused the next time that room is saved, which is the point at
--    which a decorator would notice. Expected: no rows.
select
  s.host_profile_id,
  s.room_id,
  jsonb_array_length(s.placements) as entries
  from public.room_placements_state s
 where jsonb_typeof(s.placements) <> 'array'
    or jsonb_array_length(s.placements) > 200
    or exists (
      select 1
        from jsonb_array_elements(s.placements) as e(value)
       where jsonb_typeof(e.value) <> 'object'
          or coalesce(length(e.value ->> 'id'), 0) not between 1 and 80
          or coalesce(length(e.value ->> 'catalogItemId'), 0) not between 1 and 80
          or jsonb_typeof(e.value -> 'x') <> 'number'
          or jsonb_typeof(e.value -> 'y') <> 'number'
    );

-- 5) Row sizes, as a bandwidth check: every keeper in a room downloads this
--    and the client re-polls it every 1.2 seconds. Expected: comfortably small.
select
  room_id,
  jsonb_array_length(placements) as entries,
  pg_size_pretty(length(placements::text)::bigint) as payload
  from public.room_placements_state
 order by length(placements::text) desc
 limit 10;
