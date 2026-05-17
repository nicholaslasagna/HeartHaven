-- 0024_multiplayer_state_sync.sql
--
-- Server-canonical state for room placements, garden decor, and the
-- decorator-permission grants that gate guest edits.
--
-- WHY this exists
-- ----------------
-- Before this migration, room layouts and garden decor lived only in the
-- host's localStorage, so guests who joined a room saw the cozy default
-- layout instead of the host's actual world. Multiplayer "presence" was
-- working, but multiplayer **state** wasn't — the data the host placed
-- never traveled.
--
-- Model
-- -----
-- The host owns canonical state. One row per (host, room) and (host,
-- garden). Guests with a decorator grant can write through `save_*`
-- RPCs which validate authorization server-side. Optimistic concurrency
-- is enforced via an integer version that both sides bump on write.
--
-- Reads are *public* per host friend code — anyone with the code (i.e.
-- the invite link recipient) can pull the layout. Writes are gated.

-- ------------------------------------------------------------------------
-- 1. room_placements_state — one row per (host, room)
-- ------------------------------------------------------------------------

create table if not exists public.room_placements_state (
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  room_id text not null check (room_id ~ '^[a-z0-9_-]{1,64}$'),
  /** Full placement list serialized as JSON. We cap the array length at
   *  200 (enforced in the save RPC) so a malicious caller can't blow up
   *  the table size by spamming items. */
  placements jsonb not null default '[]'::jsonb,
  /** Monotonic version. Bumped on every successful save. Callers pass
   *  the version they think they're editing; a mismatch aborts. */
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  /** The friend code of the keeper who made the most recent save. Kept
   *  for the activity feed; references could be reconstructed via
   *  updated_by_profile_id but the friend code is easier to surface. */
  updated_by_friend_code text,
  primary key (host_profile_id, room_id)
);

create index if not exists room_placements_state_updated_idx
  on public.room_placements_state (updated_at desc);

alter table public.room_placements_state enable row level security;

-- Anyone signed in can SELECT — gating on "knows the host friend code" is
-- enforced by the get_* RPC which takes the friend code as input. The
-- table itself is keyed on profile_id (an opaque UUID), so a guest can't
-- browse the table to discover other hosts.
create policy "authenticated read room placements"
  on public.room_placements_state
  for select
  to authenticated
  using (true);

-- All writes funnel through save_room_placements which checks authority.
create policy "deny direct room placement writes"
  on public.room_placements_state
  for insert
  to authenticated
  with check (false);

create policy "deny direct room placement updates"
  on public.room_placements_state
  for update
  to authenticated
  using (false)
  with check (false);

create policy "deny direct room placement deletes"
  on public.room_placements_state
  for delete
  to authenticated
  using (false);

-- ------------------------------------------------------------------------
-- 2. garden_decor_state — one row per (host, garden)
-- ------------------------------------------------------------------------

create table if not exists public.garden_decor_state (
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  garden_id text not null check (garden_id ~ '^[a-z0-9_-]{1,64}$'),
  decor jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_friend_code text,
  primary key (host_profile_id, garden_id)
);

create index if not exists garden_decor_state_updated_idx
  on public.garden_decor_state (updated_at desc);

alter table public.garden_decor_state enable row level security;

create policy "authenticated read garden decor"
  on public.garden_decor_state
  for select
  to authenticated
  using (true);

create policy "deny direct garden decor writes"
  on public.garden_decor_state
  for insert
  to authenticated
  with check (false);

create policy "deny direct garden decor updates"
  on public.garden_decor_state
  for update
  to authenticated
  using (false)
  with check (false);

create policy "deny direct garden decor deletes"
  on public.garden_decor_state
  for delete
  to authenticated
  using (false);

-- ------------------------------------------------------------------------
-- 3. room_decorator_grants — server mirror of the approved-decorator list
-- ------------------------------------------------------------------------

create table if not exists public.room_decorator_grants (
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  room_id text not null check (room_id ~ '^[a-z0-9_-]{1,64}$'),
  /** Friend code of the keeper the host has granted edit permission. */
  grantee_friend_code text not null,
  granted_at timestamptz not null default now(),
  primary key (host_profile_id, room_id, grantee_friend_code)
);

create index if not exists room_decorator_grants_grantee_idx
  on public.room_decorator_grants (grantee_friend_code);

alter table public.room_decorator_grants enable row level security;

create policy "authenticated read room grants"
  on public.room_decorator_grants
  for select
  to authenticated
  using (true);

-- Writes via RPC only.
create policy "deny direct room grant writes"
  on public.room_decorator_grants
  for all
  to authenticated
  using (false)
  with check (false);

-- ------------------------------------------------------------------------
-- 4. garden_decorator_grants
-- ------------------------------------------------------------------------

create table if not exists public.garden_decorator_grants (
  host_profile_id uuid not null references public.profiles(id) on delete cascade,
  garden_id text not null check (garden_id ~ '^[a-z0-9_-]{1,64}$'),
  grantee_friend_code text not null,
  granted_at timestamptz not null default now(),
  primary key (host_profile_id, garden_id, grantee_friend_code)
);

create index if not exists garden_decorator_grants_grantee_idx
  on public.garden_decorator_grants (grantee_friend_code);

alter table public.garden_decorator_grants enable row level security;

create policy "authenticated read garden grants"
  on public.garden_decorator_grants
  for select
  to authenticated
  using (true);

create policy "deny direct garden grant writes"
  on public.garden_decorator_grants
  for all
  to authenticated
  using (false)
  with check (false);

-- ------------------------------------------------------------------------
-- 5. multiplayer_state_audit — append-only audit trail
-- ------------------------------------------------------------------------

create table if not exists public.multiplayer_state_audit (
  id uuid primary key default gen_random_uuid(),
  host_profile_id uuid not null,
  scope text not null check (scope in ('room', 'garden')),
  scope_id text not null,
  action text not null check (action in ('save', 'grant', 'revoke')),
  actor_profile_id uuid not null,
  actor_friend_code text,
  /** Best-effort summary (e.g. item count, prior version) — never the
   *  full payload, so this table stays compact under heavy edits. */
  summary jsonb,
  created_at timestamptz not null default now()
);

create index if not exists multiplayer_state_audit_scope_idx
  on public.multiplayer_state_audit (host_profile_id, scope, scope_id, created_at desc);

alter table public.multiplayer_state_audit enable row level security;
-- Service-role only. Audit data isn't shown in-app.

-- ------------------------------------------------------------------------
-- 6. Helper: resolve a friend code to a profile_id
-- ------------------------------------------------------------------------

create or replace function public.profile_id_for_friend_code(p_friend_code text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id
  from public.profiles
  where upper(friend_code) = upper(trim(coalesce(p_friend_code, '')))
  limit 1;
$$;

revoke all on function public.profile_id_for_friend_code(text) from public;
grant execute on function public.profile_id_for_friend_code(text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 7. is_room_editor / is_garden_editor — authorization predicates
-- ------------------------------------------------------------------------

create or replace function public.is_room_editor(p_host_profile_id uuid, p_room_id text, p_caller_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select case
    when p_caller_profile_id is null then false
    when p_host_profile_id = p_caller_profile_id then true
    else exists (
      select 1
      from public.room_decorator_grants g
      join public.profiles p on upper(p.friend_code) = upper(g.grantee_friend_code)
      where g.host_profile_id = p_host_profile_id
        and g.room_id = p_room_id
        and p.id = p_caller_profile_id
    )
  end;
$$;

create or replace function public.is_garden_editor(p_host_profile_id uuid, p_garden_id text, p_caller_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select case
    when p_caller_profile_id is null then false
    when p_host_profile_id = p_caller_profile_id then true
    else exists (
      select 1
      from public.garden_decorator_grants g
      join public.profiles p on upper(p.friend_code) = upper(g.grantee_friend_code)
      where g.host_profile_id = p_host_profile_id
        and g.garden_id = p_garden_id
        and p.id = p_caller_profile_id
    )
  end;
$$;

revoke all on function public.is_room_editor(uuid, text, uuid) from public;
revoke all on function public.is_garden_editor(uuid, text, uuid) from public;
grant execute on function public.is_room_editor(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.is_garden_editor(uuid, text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 8. get_room_placements / get_garden_decor — readers
-- ------------------------------------------------------------------------

create or replace function public.get_room_placements(p_host_friend_code text, p_room_id text)
returns table (placements jsonb, version integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
begin
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then
    return; -- empty
  end if;

  return query
    select s.placements, s.version, s.updated_at
    from public.room_placements_state s
    where s.host_profile_id = v_host and s.room_id = p_room_id;
end;
$$;

create or replace function public.get_garden_decor(p_host_friend_code text, p_garden_id text)
returns table (decor jsonb, version integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
begin
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then
    return;
  end if;

  return query
    select s.decor, s.version, s.updated_at
    from public.garden_decor_state s
    where s.host_profile_id = v_host and s.garden_id = p_garden_id;
end;
$$;

revoke all on function public.get_room_placements(text, text) from public;
revoke all on function public.get_garden_decor(text, text) from public;
grant execute on function public.get_room_placements(text, text) to authenticated, service_role;
grant execute on function public.get_garden_decor(text, text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 9. save_room_placements — primary write path
-- ------------------------------------------------------------------------

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

  -- Size guard. JSONB arrays expose `jsonb_array_length`; non-arrays
  -- raise here and the caller is told the payload was malformed.
  if jsonb_typeof(p_placements) <> 'array' then
    raise exception 'placements must be a json array';
  end if;
  v_count := jsonb_array_length(p_placements);
  if v_count > 200 then
    raise exception 'too many placements (max 200, got %)', v_count;
  end if;

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

-- ------------------------------------------------------------------------
-- 10. save_garden_decor — same shape for gardens
-- ------------------------------------------------------------------------

create or replace function public.save_garden_decor(
  p_host_friend_code text,
  p_garden_id text,
  p_decor jsonb,
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

  v_can_edit := public.is_garden_editor(v_host, p_garden_id, v_caller);
  if not v_can_edit then
    raise exception 'not authorized to edit this garden';
  end if;

  if jsonb_typeof(p_decor) <> 'array' then
    raise exception 'decor must be a json array';
  end if;
  v_count := jsonb_array_length(p_decor);
  if v_count > 200 then
    raise exception 'too many decor items (max 200, got %)', v_count;
  end if;

  select p.friend_code into v_caller_code from public.profiles p where p.id = v_caller;

  select s.version into v_current_version
    from public.garden_decor_state s
    where s.host_profile_id = v_host and s.garden_id = p_garden_id;

  if v_current_version is null then
    if p_expected_version is not null and p_expected_version <> 0 then
      version := 0;
      updated_at := null;
      conflict := true;
      return next;
      return;
    end if;
    v_new_version := 1;
    insert into public.garden_decor_state (
      host_profile_id, garden_id, decor, version, updated_at,
      updated_by_profile_id, updated_by_friend_code
    ) values (
      v_host, p_garden_id, p_decor, v_new_version, v_now,
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
    update public.garden_decor_state
       set decor = p_decor,
           version = v_new_version,
           updated_at = v_now,
           updated_by_profile_id = v_caller,
           updated_by_friend_code = v_caller_code
     where host_profile_id = v_host and garden_id = p_garden_id;
  end if;

  insert into public.multiplayer_state_audit (
    host_profile_id, scope, scope_id, action,
    actor_profile_id, actor_friend_code, summary
  ) values (
    v_host, 'garden', p_garden_id, 'save',
    v_caller, v_caller_code,
    jsonb_build_object('item_count', v_count, 'new_version', v_new_version)
  );

  version := v_new_version;
  updated_at := v_now;
  conflict := false;
  return next;
end;
$$;

revoke all on function public.save_garden_decor(text, text, jsonb, integer) from public;
grant execute on function public.save_garden_decor(text, text, jsonb, integer) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 11. get_room_decorators / get_garden_decorators — read grant list
-- ------------------------------------------------------------------------

create or replace function public.get_room_decorators(p_host_friend_code text, p_room_id text)
returns table (grantee_friend_code text, granted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
begin
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then
    return;
  end if;
  return query
    select g.grantee_friend_code, g.granted_at
    from public.room_decorator_grants g
    where g.host_profile_id = v_host and g.room_id = p_room_id
    order by g.granted_at asc;
end;
$$;

create or replace function public.get_garden_decorators(p_host_friend_code text, p_garden_id text)
returns table (grantee_friend_code text, granted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
begin
  v_host := public.profile_id_for_friend_code(p_host_friend_code);
  if v_host is null then
    return;
  end if;
  return query
    select g.grantee_friend_code, g.granted_at
    from public.garden_decorator_grants g
    where g.host_profile_id = v_host and g.garden_id = p_garden_id
    order by g.granted_at asc;
end;
$$;

revoke all on function public.get_room_decorators(text, text) from public;
revoke all on function public.get_garden_decorators(text, text) from public;
grant execute on function public.get_room_decorators(text, text) to authenticated, service_role;
grant execute on function public.get_garden_decorators(text, text) to authenticated, service_role;

-- ------------------------------------------------------------------------
-- 12. set_room_decorator / set_garden_decorator — host toggles grants
-- ------------------------------------------------------------------------

create or replace function public.set_room_decorator(
  p_room_id text,
  p_grantee_friend_code text,
  p_grant boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_normalized text;
  v_existing_target_profile uuid;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;

  v_normalized := upper(trim(coalesce(p_grantee_friend_code, '')));
  if v_normalized !~ '^HH-[A-Z]{5}-[0-9]{3}$' then
    raise exception 'invalid friend code';
  end if;

  -- Don't let a host grant edit to a friend code that doesn't exist —
  -- otherwise abusive UIs could "stockpile" grants and surprise an
  -- unsuspecting user once they sign up under that code.
  select id into v_existing_target_profile
    from public.profiles
    where upper(friend_code) = v_normalized;
  if v_existing_target_profile is null then
    raise exception 'friend code not registered';
  end if;

  if p_grant then
    insert into public.room_decorator_grants (host_profile_id, room_id, grantee_friend_code)
    values (v_host, p_room_id, v_normalized)
    on conflict do nothing;

    insert into public.multiplayer_state_audit (
      host_profile_id, scope, scope_id, action,
      actor_profile_id, actor_friend_code, summary
    ) values (
      v_host, 'room', p_room_id, 'grant',
      v_host, null, jsonb_build_object('grantee', v_normalized)
    );
  else
    delete from public.room_decorator_grants
     where host_profile_id = v_host
       and room_id = p_room_id
       and grantee_friend_code = v_normalized;

    insert into public.multiplayer_state_audit (
      host_profile_id, scope, scope_id, action,
      actor_profile_id, actor_friend_code, summary
    ) values (
      v_host, 'room', p_room_id, 'revoke',
      v_host, null, jsonb_build_object('grantee', v_normalized)
    );
  end if;
end;
$$;

create or replace function public.set_garden_decorator(
  p_garden_id text,
  p_grantee_friend_code text,
  p_grant boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_normalized text;
  v_existing_target_profile uuid;
begin
  if v_host is null then
    raise exception 'sign in required';
  end if;

  v_normalized := upper(trim(coalesce(p_grantee_friend_code, '')));
  if v_normalized !~ '^HH-[A-Z]{5}-[0-9]{3}$' then
    raise exception 'invalid friend code';
  end if;

  select id into v_existing_target_profile
    from public.profiles
    where upper(friend_code) = v_normalized;
  if v_existing_target_profile is null then
    raise exception 'friend code not registered';
  end if;

  if p_grant then
    insert into public.garden_decorator_grants (host_profile_id, garden_id, grantee_friend_code)
    values (v_host, p_garden_id, v_normalized)
    on conflict do nothing;

    insert into public.multiplayer_state_audit (
      host_profile_id, scope, scope_id, action,
      actor_profile_id, actor_friend_code, summary
    ) values (
      v_host, 'garden', p_garden_id, 'grant',
      v_host, null, jsonb_build_object('grantee', v_normalized)
    );
  else
    delete from public.garden_decorator_grants
     where host_profile_id = v_host
       and garden_id = p_garden_id
       and grantee_friend_code = v_normalized;

    insert into public.multiplayer_state_audit (
      host_profile_id, scope, scope_id, action,
      actor_profile_id, actor_friend_code, summary
    ) values (
      v_host, 'garden', p_garden_id, 'revoke',
      v_host, null, jsonb_build_object('grantee', v_normalized)
    );
  end if;
end;
$$;

revoke all on function public.set_room_decorator(text, text, boolean) from public;
revoke all on function public.set_garden_decorator(text, text, boolean) from public;
grant execute on function public.set_room_decorator(text, text, boolean) to authenticated, service_role;
grant execute on function public.set_garden_decorator(text, text, boolean) to authenticated, service_role;
