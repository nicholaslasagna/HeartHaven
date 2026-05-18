-- 0028_profile_autocreate_and_ban_by_user_id.sql
--
-- Three fixes layered together:
--
-- 1. `generate_friend_code()` was producing 10-char hex strings
--    (`A3F2B1C9D4`) — incompatible with the `HH-XXXXX-NNN` shape check
--    added in migration 0017. Any profile that fell back to the column
--    default would have a friend_code that fails the constraint, so the
--    insert silently failed in some code paths. Rewrite the function to
--    actually produce the canonical shape, with retry-on-collision.
--
-- 2. No `auth.users → profiles` trigger existed. A new keeper signing
--    up could end up with NO profile row at all (the app didn't always
--    create one explicitly). Without a profile row, the client-side
--    `syncFriendCodeToProfile` UPDATE silently affected zero rows, and
--    server-side lookups by friend code returned nothing — which is
--    exactly why `ban_keeper('HH-YJQUB-775', …)` raised "no profile
--    found" even though the user clearly exists in `auth.users`.
--    Adding `handle_new_user()` as an AFTER INSERT trigger fixes the
--    forward case; a one-shot backfill handles existing orphans.
--
-- 3. `ban_keeper_by_user_id` — admin fallback for cases where the
--    friend code is unknown or doesn't resolve. Pass the
--    `auth.users.id` (visible in the Supabase Studio Authentication
--    tab) and the function handles everything else. Internally calls
--    `ban_keeper` once the friend code is resolved.

-- ------------------------------------------------------------------------
-- 1. generate_friend_code — proper HH-XXXXX-NNN shape, retry-on-collision
-- ------------------------------------------------------------------------

create or replace function public.generate_friend_code()
returns text
language plpgsql
as $$
declare
  v_code text;
  v_letters text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';  -- 24 letters, no I/O
  v_digits text  := '23456789';                  -- 8 digits, no 0/1
  v_attempts int := 0;
begin
  loop
    v_attempts := v_attempts + 1;
    v_code := 'HH-' ||
      substr(v_letters, 1 + floor(random() * 24)::int, 1) ||
      substr(v_letters, 1 + floor(random() * 24)::int, 1) ||
      substr(v_letters, 1 + floor(random() * 24)::int, 1) ||
      substr(v_letters, 1 + floor(random() * 24)::int, 1) ||
      substr(v_letters, 1 + floor(random() * 24)::int, 1) ||
      '-' ||
      substr(v_digits, 1 + floor(random() * 8)::int, 1) ||
      substr(v_digits, 1 + floor(random() * 8)::int, 1) ||
      substr(v_digits, 1 + floor(random() * 8)::int, 1);

    -- The unique constraint will reject collisions on insert; loop
    -- catches the rare collision pre-insert so the caller never sees it.
    if not exists (select 1 from public.profiles where friend_code = v_code) then
      return v_code;
    end if;

    if v_attempts > 10 then
      raise exception 'unable to generate unique friend code after 10 attempts';
    end if;
  end loop;
end;
$$;

-- ------------------------------------------------------------------------
-- 2a. handle_new_user — AFTER INSERT trigger on auth.users
-- ------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  -- Display name precedence: email prefix → first 8 chars of UUID.
  -- The username column stays NULL until the keeper picks one on the
  -- Account page; display_name is just the seeded label.
  v_display_name := substr(
    coalesce(split_part(new.email, '@', 1), new.id::text),
    1, 24
  );
  if length(trim(v_display_name)) = 0 then
    v_display_name := 'Keeper';
  end if;

  -- ON CONFLICT DO NOTHING because the keeper might already have a row
  -- (e.g. created via this migration's backfill below) — we don't want
  -- the trigger to raise on re-runs.
  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Replace any prior trigger of the same name so re-runs are idempotent.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------------
-- 2b. Backfill: create profile rows for orphaned auth.users entries
-- ------------------------------------------------------------------------
-- This is the migration that unblocks @test2 (and anyone else who signed
-- up before the trigger existed). Each missing profile gets a fresh
-- HH-XXXXX-NNN friend_code via the rewritten generate_friend_code().
-- The client's `syncFriendCodeToProfile` will overwrite it on next page
-- load with whatever's in their localStorage — that's the right move:
-- the keeper keeps their pre-existing public identity.

insert into public.profiles (id, display_name)
select
  u.id,
  substr(coalesce(nullif(split_part(u.email, '@', 1), ''), u.id::text), 1, 24)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- ------------------------------------------------------------------------
-- 3. ban_keeper_by_user_id — admin fallback that bypasses friend_code
-- ------------------------------------------------------------------------
-- Usage from Studio:
--
--   select public.ban_keeper_by_user_id(
--     p_user_id          => '00000000-0000-0000-0000-000000000000'::uuid,
--     p_reason           => 'Harassment of multiple keepers.',
--     p_internal_notes   => 'See reports.',
--     p_admin            => 'nick',
--     p_reason_category  => 'harassment',
--     p_duration_seconds => null  -- permanent; pass seconds for temp ban
--   );
--
-- Find the user_id in Studio → Authentication → Users → click the user.

create or replace function public.ban_keeper_by_user_id(
  p_user_id uuid,
  p_reason text,
  p_internal_notes text,
  p_admin text,
  p_reason_category text default 'policy-violation',
  p_duration_seconds bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_friend_code text;
  v_display_name text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  -- Read existing friend code. If the user has no profile row yet (the
  -- exact case that broke @test2), create one inline so ban_keeper has
  -- a friend code to lock onto.
  select friend_code into v_friend_code
  from public.profiles
  where id = p_user_id;

  if v_friend_code is null then
    select substr(coalesce(nullif(split_part(email, '@', 1), ''), id::text), 1, 24)
      into v_display_name
    from auth.users
    where id = p_user_id;

    if v_display_name is null then
      raise exception 'no auth.users row for id %', p_user_id;
    end if;

    insert into public.profiles (id, display_name)
    values (p_user_id, v_display_name)
    on conflict (id) do nothing;

    select friend_code into v_friend_code
    from public.profiles
    where id = p_user_id;
  end if;

  if v_friend_code is null then
    raise exception 'could not resolve friend code for user_id %', p_user_id;
  end if;

  -- Delegate to the canonical ban function so all the
  -- audit/notification/realtime-alert plumbing fires identically.
  return public.ban_keeper(
    v_friend_code,
    p_reason,
    p_internal_notes,
    p_admin,
    p_reason_category,
    p_duration_seconds
  );
end;
$$;

revoke all on function public.ban_keeper_by_user_id(uuid, text, text, text, text, bigint) from public;
grant execute on function public.ban_keeper_by_user_id(uuid, text, text, text, text, bigint) to service_role;
