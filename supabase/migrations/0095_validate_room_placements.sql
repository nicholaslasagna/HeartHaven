-- 0095_validate_room_placements.sql
--
-- Validate each placement, not just how many there are.
--
-- save_room_placements checked that the payload was a JSON array and that it
-- held at most 200 entries, then stored it verbatim. Everything else — that
-- an entry has an id, that the id is a reasonable length, that coordinates
-- are on the map — was enforced only by hardenRoomPlacements in the browser.
-- Client-side validation is a courtesy to the UI, not a boundary: the RPC is
-- callable directly, so the shape it accepts is the shape it will eventually
-- be given.
--
-- Two hundred entries with unbounded strings is a row that every other
-- keeper in the room then downloads, and a poll that re-downloads it every
-- 1.2 seconds. The reach is limited — is_room_editor means the caller is the
-- host or someone the host approved — so this is a durability and bandwidth
-- guard rather than a way in. It is still the kind of gap that only stays
-- harmless while everyone uses the app as written.
--
-- The rules mirror hardenRoomPlacements in src/lib/game/realtime-hardening.ts
-- exactly, so a payload the browser would have cleaned is one the server
-- accepts unchanged, and anything else is refused with a reason rather than
-- silently trimmed. Refusing rather than trimming matters: a silent trim
-- would hand a decorator a room that quietly differs from the one they just
-- arranged.

create or replace function public.validate_room_placement_payload(p_placements jsonb)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_entry jsonb;
  v_id text;
  v_catalog text;
begin
  if jsonb_typeof(p_placements) <> 'array' then
    raise exception 'placements must be a json array';
  end if;

  if jsonb_array_length(p_placements) > 200 then
    raise exception 'too many placements (max 200, got %)', jsonb_array_length(p_placements);
  end if;

  for v_entry in select value from jsonb_array_elements(p_placements)
  loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'each placement must be an object';
    end if;

    v_id := v_entry ->> 'id';
    v_catalog := v_entry ->> 'catalogItemId';
    if v_id is null or length(v_id) = 0 or length(v_id) > 80 then
      raise exception 'placement id must be 1-80 characters';
    end if;
    if v_catalog is null or length(v_catalog) = 0 or length(v_catalog) > 80 then
      raise exception 'placement catalogItemId must be 1-80 characters';
    end if;

    -- Numbers must BE numbers: a numeric string here would be stored as a
    -- string and compare differently on the way back out.
    if jsonb_typeof(v_entry -> 'x') <> 'number' or jsonb_typeof(v_entry -> 'y') <> 'number' then
      raise exception 'placement coordinates must be numbers';
    end if;
    if (v_entry ->> 'x')::numeric not between -200 and 4000
       or (v_entry ->> 'y')::numeric not between -200 and 4000 then
      raise exception 'placement coordinates are off the map';
    end if;

    if v_entry ? 'rotation' then
      if jsonb_typeof(v_entry -> 'rotation') <> 'number'
         or (v_entry ->> 'rotation')::numeric not between -360 and 360 then
        raise exception 'placement rotation must be a number between -360 and 360';
      end if;
    end if;
    if v_entry ? 'scale' then
      if jsonb_typeof(v_entry -> 'scale') <> 'number'
         or (v_entry ->> 'scale')::numeric not between 0.1 and 5 then
        raise exception 'placement scale must be a number between 0.1 and 5';
      end if;
    end if;
    if v_entry ? 'zIndex' then
      if jsonb_typeof(v_entry -> 'zIndex') <> 'number'
         or (v_entry ->> 'zIndex')::numeric not between 0 and 10000 then
        raise exception 'placement zIndex must be a number between 0 and 10000';
      end if;
    end if;
  end loop;
end;
$$;

comment on function public.validate_room_placement_payload(jsonb) is
  'Per-entry validation for room decor, mirroring hardenRoomPlacements in src/lib/game/realtime-hardening.ts. Raises rather than trimming, so a decorator is never handed a room that quietly differs from the one they arranged.';

revoke all on function public.validate_room_placement_payload(jsonb) from public;

create or replace function public.save_room_placements(
  p_host_friend_code text,
  p_room_id text,
  p_placements jsonb,
  p_expected_version integer
)
returns table (version integer, updated_at timestamptz, conflict boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_caller uuid := auth.uid();
  v_caller_code text;
  v_can_edit boolean;
  v_current_version integer;
  v_count integer;
  v_new_version integer;
  v_now timestamptz := now();
begin
  if v_caller is null then
    raise exception 'sign in required';
  end if;

  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then
    raise exception 'unknown host';
  end if;

  v_can_edit := public.is_room_editor(v_host, p_room_id, v_caller);
  if not v_can_edit then
    raise exception 'not authorized to edit this room';
  end if;

  -- Shape guard. Was a type check and a count; every other rule lived only
  -- in the browser, and the RPC is callable without it.
  perform public.validate_room_placement_payload(p_placements);
  v_count := jsonb_array_length(p_placements);

  -- Look up caller's friend code for the audit + updated_by_friend_code
  -- column. Best-effort; the save still proceeds if missing.
  select p.friend_code into v_caller_code from public.profiles p where p.id = v_caller;

  -- Optimistic concurrency. version=0 from the client means "creating
  -- fresh row, no prior state expected".
  select s.version into v_current_version
    from public.room_placements_state s
    where s.host_profile_id = v_host and s.room_id = p_room_id;

  if v_current_version is null then
    -- First save for this (host, room). Expect 0 for a clean create.
    if p_expected_version is not null and p_expected_version <> 0 then
      version := 0;
      updated_at := null;
      conflict := true;
      return next;
      return;
    end if;
    v_new_version := 1;
    insert into public.room_placements_state (
      host_profile_id, room_id, placements, version, updated_at,
      updated_by_profile_id, updated_by_friend_code
    ) values (
      v_host, p_room_id, p_placements, v_new_version, v_now,
      v_caller, v_caller_code
    );
  else
    if p_expected_version is not null and p_expected_version <> v_current_version then
      version := v_current_version;
      updated_at := null;
      conflict := true;
      return next;
      return;
    end if;
    v_new_version := v_current_version + 1;
    update public.room_placements_state
       set placements = p_placements,
           version = v_new_version,
           updated_at = v_now,
           updated_by_profile_id = v_caller,
           updated_by_friend_code = v_caller_code
     where host_profile_id = v_host and room_id = p_room_id;
  end if;

  insert into public.multiplayer_state_audit (
    host_profile_id, scope, scope_id, action,
    actor_profile_id, actor_friend_code, summary
  ) values (
    v_host, 'room', p_room_id, 'save',
    v_caller, v_caller_code,
    jsonb_build_object('item_count', v_count, 'new_version', v_new_version)
  );

  version := v_new_version;
  updated_at := v_now;
  conflict := false;
  return next;
end;
$$;

revoke all on function public.save_room_placements(text, text, jsonb, integer) from public;
grant execute on function public.save_room_placements(text, text, jsonb, integer) to authenticated, service_role;
