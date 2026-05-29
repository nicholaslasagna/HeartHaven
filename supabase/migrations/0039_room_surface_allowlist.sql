-- Server allowlist for room wallpaper (wall) and flooring IDs.

-- Must stay in sync with src/lib/game/room-surfaces.ts
create or replace function public.allowed_room_floor_ids()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'cream-checker',
    'lavender-diamond',
    'honey-oak',
    'blush-mosaic',
    'garden-stone'
  ]::text[];
$$;

create or replace function public.allowed_room_wall_ids()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'cream-plaster',
    'blush-floral',
    'lavender-stripe',
    'sage-beadboard',
    'night-stars',
    'honey-stucco'
  ]::text[];
$$;

create or replace function public.validate_room_surface_id(p_id text, p_kind text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_id text;
begin
  if p_id is null or trim(p_id) = '' then
    raise exception 'empty % surface id', v_kind;
  end if;

  v_id := left(trim(p_id), 64);

  if length(v_id) > 48 then
    raise exception '% surface id too long', v_kind;
  end if;

  if v_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'malformed % surface id', v_kind;
  end if;

  if v_kind = 'floor' then
    if not (v_id = any(public.allowed_room_floor_ids())) then
      raise exception 'unknown floor surface id: %', v_id;
    end if;
  elsif v_kind = 'wall' then
    if not (v_id = any(public.allowed_room_wall_ids())) then
      raise exception 'unknown wall surface id: %', v_id;
    end if;
  else
    raise exception 'invalid surface kind';
  end if;

  return v_id;
end;
$$;

create or replace function public.save_room_surfaces(
  p_host_friend_code text,
  p_room_id text,
  p_floor_id text,
  p_wall_id text,
  p_expected_version integer
)
returns table (version integer, updated_at timestamptz, conflict boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_host uuid;
  v_caller uuid := auth.uid();
  v_caller_code text;
  v_can_edit boolean;
  v_current_version integer;
  v_new_version integer;
  v_now timestamptz := now();
  v_floor text;
  v_wall text;
begin
  if v_caller is null then raise exception 'sign in required'; end if;
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then raise exception 'unknown host'; end if;
  v_can_edit := public.is_room_editor(v_host, p_room_id, v_caller);
  if not v_can_edit then raise exception 'not authorized to edit this room'; end if;

  v_floor := public.validate_room_surface_id(p_floor_id, 'floor');
  v_wall := public.validate_room_surface_id(p_wall_id, 'wall');

  select p.friend_code into v_caller_code from public.profiles p where p.id = v_caller;

  select s.version into v_current_version
    from public.room_surfaces_state s
    where s.host_profile_id = v_host and s.room_id = p_room_id;

  if v_current_version is null then
    if p_expected_version is not null and p_expected_version <> 0 then
      version := 0; updated_at := null; conflict := true; return next; return;
    end if;
    v_new_version := 1;
    insert into public.room_surfaces_state (
      host_profile_id, room_id, floor_id, wall_id, version, updated_at,
      updated_by_profile_id, updated_by_friend_code
    ) values (v_host, p_room_id, v_floor, v_wall, v_new_version, v_now, v_caller, v_caller_code);
  else
    if p_expected_version is not null and p_expected_version <> v_current_version then
      version := v_current_version; updated_at := null; conflict := true; return next; return;
    end if;
    v_new_version := v_current_version + 1;
    update public.room_surfaces_state
       set floor_id = v_floor, wall_id = v_wall, version = v_new_version,
           updated_at = v_now, updated_by_profile_id = v_caller, updated_by_friend_code = v_caller_code
     where host_profile_id = v_host and room_id = p_room_id;
  end if;

  insert into public.multiplayer_state_audit (
    host_profile_id, scope, scope_id, action, actor_profile_id, actor_friend_code, summary
  ) values (
    v_host, 'room_surfaces', p_room_id, 'save', v_caller, v_caller_code,
    jsonb_build_object('floor_id', v_floor, 'wall_id', v_wall, 'new_version', v_new_version)
  );

  version := v_new_version; updated_at := v_now; conflict := false;
  return next;
end;
$$;

revoke all on function public.allowed_room_floor_ids() from public;
revoke all on function public.allowed_room_wall_ids() from public;
revoke all on function public.validate_room_surface_id(text, text) from public;
revoke all on function public.save_room_surfaces(text, text, text, text, integer) from public;

grant execute on function public.allowed_room_floor_ids() to authenticated, service_role;
grant execute on function public.allowed_room_wall_ids() to authenticated, service_role;
grant execute on function public.validate_room_surface_id(text, text) to authenticated, service_role;
grant execute on function public.save_room_surfaces(text, text, text, text, integer) to authenticated, service_role;
