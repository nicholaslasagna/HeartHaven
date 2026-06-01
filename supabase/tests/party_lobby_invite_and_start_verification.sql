-- party_lobby_invite_and_start_verification.sql
--
-- Safe verification for migration 0052. This uses existing non-production
-- profiles/friendships and rolls back all writes.

-- 1) Host can read pending join requests for their lobby.
select
  policyname,
  cmd,
  qual
from pg_policies
where schemaname = 'public'
  and tablename = 'lobby_join_requests'
order by policyname;

-- 2) Party RPCs are still SECURITY DEFINER and executable by authenticated users.
select
  proc.proname,
  proc.prosecdef as security_definer,
  pg_get_function_arguments(proc.oid) as arguments,
  pg_get_function_result(proc.oid) as result_signature
from pg_proc as proc
join pg_namespace as ns
  on ns.oid = proc.pronamespace
where ns.nspname = 'public'
  and proc.proname in (
    'create_party_lobby',
    'request_join_party',
    'respond_join_request',
    'start_party_lobby',
    'invite_friend_to_current_place',
    'get_my_pending_place_invites',
    'respond_to_place_invite'
  )
order by proc.proname;

-- 3) Transactional smoke test.
--
-- Requirements:
--   - At least two non-production profiles exist.
--   - They have one accepted public.friendships row.
--
-- Checks:
--   - host creates one waiting party lobby
--   - recipient requests to join by host friend code
--   - host can see the pending request row
--   - host approves it
--   - host can start with currently seated ready players, not full max seats
--   - individual party invite creates one pending invite for selected friend
--   - invite target is /app/games?join=<lobby-invite-code>
--   - recipient polling RPC sees the invite
begin;

create temporary table hh_party_test_pair on commit drop as
select
  friendship.requester_id as host_profile_id,
  friendship.friend_id as guest_profile_id,
  host_profile.friend_code as host_friend_code,
  guest_profile.friend_code as guest_friend_code
from public.friendships as friendship
join public.profiles as host_profile
  on host_profile.id = friendship.requester_id
join public.profiles as guest_profile
  on guest_profile.id = friendship.friend_id
where friendship.status = 'accepted'
order by friendship.updated_at desc, friendship.created_at desc
limit 1;

select
  'accepted_friend_pair_available' as check_name,
  count(*) = 1 as passed,
  count(*) as observed
from hh_party_test_pair;

select set_config('request.jwt.claim.sub', host_profile_id::text, true) from hh_party_test_pair;
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table hh_party_created on commit drop as
select created.*
from hh_party_test_pair as pair
cross join lateral public.create_party_lobby(4) as created;

create temporary table hh_party_invite on commit drop as
select invite_result.*
from hh_party_test_pair as pair
join hh_party_created as created on true
cross join lateral public.invite_friend_to_current_place(
  pair.guest_friend_code,
  'party',
  '/app/games',
  created.session_id,
  null,
  null
) as invite_result;

select set_config('request.jwt.claim.sub', guest_profile_id::text, true) from hh_party_test_pair;

create temporary table hh_party_request on commit drop as
select public.request_join_party(pair.host_friend_code) as request_id
from hh_party_test_pair as pair;

select
  'guest_request_inserted' as check_name,
  bool_and(request_id is not null) as passed,
  array_agg(request_id) as observed
from hh_party_request;

select set_config('request.jwt.claim.sub', host_profile_id::text, true) from hh_party_test_pair;

select
  'host_sees_pending_join_request' as check_name,
  count(join_request.id) = 1 as passed,
  count(join_request.id) as observed
from hh_party_created as created
join public.lobby_join_requests as join_request
  on join_request.session_id = created.session_id
 and join_request.status = 'pending';

select public.respond_join_request(request_id, true)
from hh_party_request;

update public.game_session_players as seated_player
   set ready = true
  from hh_party_created as created
 where seated_player.session_id = created.session_id;

select public.select_party_game('garden-four', '/app/garden-four', 'Garden Four');

create temporary table hh_party_started on commit drop as
select public.start_party_lobby() as started_href;

select
  'start_returns_same_session_href' as check_name,
  bool_and(started_href like ('/app/garden-four?session=' || created.session_id::text)) as passed,
  array_agg(started_href) as observed
from hh_party_started
cross join hh_party_created as created;

select
  'party_invite_selected_friend_only' as check_name,
  count(current_place_invite.id) = 1 as passed,
  count(current_place_invite.id) as observed
from hh_party_test_pair as pair
join public.current_place_invites as current_place_invite
  on current_place_invite.recipient_id = pair.guest_profile_id
 and current_place_invite.invite_type = 'party'
 and current_place_invite.status = 'pending';

select
  'party_invite_target_has_join_code' as check_name,
  bool_and(current_place_invite.target_url = '/app/games?join=' || created.invite_code) as passed,
  array_agg(current_place_invite.target_url) as observed
from hh_party_test_pair as pair
join hh_party_created as created on true
join public.current_place_invites as current_place_invite
  on current_place_invite.recipient_id = pair.guest_profile_id
 and current_place_invite.invite_type = 'party'
 and current_place_invite.status = 'pending';

select set_config('request.jwt.claim.sub', guest_profile_id::text, true) from hh_party_test_pair;

select
  'recipient_pending_invite_rpc_sees_party_invite' as check_name,
  count(pending_invite.id) = 1 as passed,
  count(pending_invite.id) as observed
from public.get_my_pending_place_invites() as pending_invite
where pending_invite.invite_type = 'party';

rollback;
