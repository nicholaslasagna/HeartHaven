-- party_lobby_session_id_ambiguity_verification.sql
--
-- Safe verification for migration 0054. Run from the Supabase SQL editor
-- against the confirmed HeartHaven project. The transactional smoke section
-- rolls back all writes.

-- 1) The repaired function is SECURITY DEFINER and still returns the public
-- lobby identifiers expected by the app.
select
  proc.proname,
  proc.prosecdef as security_definer,
  pg_get_function_arguments(proc.oid) as arguments,
  pg_get_function_result(proc.oid) as result_signature
from pg_proc as proc
join pg_namespace as ns
  on ns.oid = proc.pronamespace
where ns.nspname = 'public'
  and proc.proname = 'create_party_lobby';

-- 2) Transactional smoke test: creating a lobby must not throw
-- "column reference session_id is ambiguous", must create exactly one host
-- seat, and must remain joinable by the long invite code.
begin;

create temporary table hh_lobby_fix_host on commit drop as
select
  profile.id as host_profile_id,
  profile.friend_code as host_friend_code
from public.profiles as profile
where profile.friend_code is not null
order by profile.updated_at desc nulls last, profile.created_at desc nulls last
limit 1;

select
  'host_profile_available' as check_name,
  count(*) = 1 as passed,
  count(*) as observed
from hh_lobby_fix_host;

select set_config('request.jwt.claim.sub', host_profile_id::text, true) from hh_lobby_fix_host;
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table hh_lobby_fix_created on commit drop as
select created.*
from public.create_party_lobby(4) as created;

select
  'create_party_lobby_returns_one_row' as check_name,
  count(*) = 1 as passed,
  count(*) as observed
from hh_lobby_fix_created;

select
  'host_seat_created_once' as check_name,
  count(player.profile_id) = 1 as passed,
  count(player.profile_id) as observed
from hh_lobby_fix_created as created
join hh_lobby_fix_host as host on true
left join public.game_session_players as player
  on player.session_id = created.session_id
 and player.profile_id = host.host_profile_id
 and player.seat_index = 0;

select
  'lobby_invite_code_is_long_code' as check_name,
  bool_and(created.invite_code ~ '^HH-[A-Z]{5,6}-[0-9]{3,4}$') as passed,
  array_agg(created.invite_code) as observed
from hh_lobby_fix_created as created;

rollback;
