-- room_visit_realtime_verification.sql
--
-- Safe manual verification helpers for room visit realtime. This file has
-- no production secrets and performs no writes unless you uncomment the
-- optional transaction block at the bottom.

-- Replace HH-ABCDE-234 below with the host's friend code before running.
with params as (
  select 'HH-ABCDE-234'::text as host_friend_code, 'moonlit-loft'::text as room_id
)
-- 1) Confirm the host and guest should resolve the same app channel.
-- Expected: both host and guest use this exact room channel.
select
  upper(regexp_replace(params.host_friend_code, '[^A-Z0-9-]', '', 'g')) as resolved_host_code,
  'room:' || upper(regexp_replace(params.host_friend_code, '[^A-Z0-9-]', '', 'g')) as expected_room_channel
from params;

-- 2) Confirm the host profile exists and can own room placement state.
with params as (
  select 'HH-ABCDE-234'::text as host_friend_code, 'moonlit-loft'::text as room_id
)
select
  profile.id as host_profile_id,
  profile.username,
  profile.friend_code
from public.profiles as profile
cross join params
where profile.friend_code = upper(regexp_replace(params.host_friend_code, '[^A-Z0-9-]', '', 'g'));

-- 3) Confirm room placements update and versions increment for the host.
with params as (
  select 'HH-ABCDE-234'::text as host_friend_code, 'moonlit-loft'::text as room_id
)
select
  state.room_id,
  state.version,
  jsonb_array_length(state.placements) as placement_count,
  state.updated_at,
  state.updated_by_friend_code
from public.room_placements_state as state
join public.profiles as profile
  on profile.id = state.host_profile_id
cross join params
where profile.friend_code = upper(regexp_replace(params.host_friend_code, '[^A-Z0-9-]', '', 'g'))
  and state.room_id = coalesce(nullif(params.room_id, ''), 'moonlit-loft')
order by state.updated_at desc;

-- 4) Confirm direct writes are still denied. Guests must save through the
--    save_room_placements RPC, which checks host/decorator permission.
select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'room_placements_state'
order by policyname;

-- 5) Confirm approved room decorators for the same host + room.
with params as (
  select 'HH-ABCDE-234'::text as host_friend_code, 'moonlit-loft'::text as room_id
)
select
  grant_row.room_id,
  grant_row.grantee_friend_code,
  grant_row.granted_at
from public.room_decorator_grants as grant_row
join public.profiles as profile
  on profile.id = grant_row.host_profile_id
cross join params
where profile.friend_code = upper(regexp_replace(params.host_friend_code, '[^A-Z0-9-]', '', 'g'))
  and grant_row.room_id = coalesce(nullif(params.room_id, ''), 'moonlit-loft')
order by grant_row.granted_at desc;

-- Optional smoke test, wrapped in a rollback:
--   1. Set host_friend_code to a non-production host.
--   2. Set room_id to moonlit-loft.
--   3. Run this block as the host user by setting request.jwt.claim.sub.
--
-- begin;
-- select set_config('request.jwt.claim.sub', profile.id::text, true)
-- from public.profiles as profile
-- where profile.friend_code = 'HH-ABCDE-234';
--
-- select *
-- from public.save_room_placements(
--   'HH-ABCDE-234',
--   'moonlit-loft',
--   '[]'::jsonb,
--   0
-- );
--
-- rollback;
