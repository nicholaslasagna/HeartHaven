-- Room surface allowlist verification (run after 0039).

-- 1) Defaults remain allowed
select public.validate_room_surface_id('cream-checker', 'floor') = 'cream-checker' as default_floor_ok;
select public.validate_room_surface_id('cream-plaster', 'wall') = 'cream-plaster' as default_wall_ok;

-- 2) Unknown IDs rejected
-- select public.validate_room_surface_id('fake-floor', 'floor');  -- unknown floor surface id
-- select public.validate_room_surface_id('fake-wall', 'wall');    -- unknown wall surface id

-- 3) Malformed IDs rejected
-- select public.validate_room_surface_id('Bad Floor', 'floor');   -- malformed floor surface id
-- select public.validate_room_surface_id('../etc/passwd', 'wall'); -- malformed wall surface id

-- 4) Empty / too long rejected
-- select public.validate_room_surface_id('', 'floor');            -- empty floor surface id
-- select public.validate_room_surface_id(repeat('a', 49), 'wall'); -- wall surface id too long

-- 5) Allowlist arrays match product set
select cardinality(public.allowed_room_floor_ids()) = 5 as floor_count;
select cardinality(public.allowed_room_wall_ids()) = 6 as wall_count;
