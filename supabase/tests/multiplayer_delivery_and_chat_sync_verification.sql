-- multiplayer_delivery_and_chat_sync_verification.sql
--
-- Safe verification for migration 0053. Run from the SQL editor against a
-- non-production or staging copy with at least one accepted friendship. The
-- transactional smoke section rolls back all writes.

-- 1) Delivery/chat RPCs exist, are SECURITY DEFINER, and are executable.
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
    'request_join_party',
    'get_my_lobby_join_requests',
    'invite_friend_to_current_place',
    'get_my_pending_place_invites',
    'respond_to_place_invite',
    'send_place_chat_message',
    'get_place_chat_messages'
  )
order by proc.proname;

-- 2) Chat table denies direct client writes. Chat must go through RPCs.
select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'place_chat_messages'
order by policyname;

-- 3) Transactional invite, lobby-code, and chat smoke test.
begin;

create temporary table hh_delivery_pair on commit drop as
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
from hh_delivery_pair;

-- Host creates a lobby and sends one direct party invite to the selected guest.
select set_config('request.jwt.claim.sub', host_profile_id::text, true) from hh_delivery_pair;
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table hh_delivery_lobby on commit drop as
select created.*
from public.create_party_lobby(4) as created;

create temporary table hh_delivery_invite on commit drop as
select invite_result.*
from hh_delivery_pair as pair
cross join hh_delivery_lobby as lobby
cross join lateral public.invite_friend_to_current_place(
  pair.guest_friend_code,
  'party',
  '/app/games',
  lobby.session_id,
  null,
  null
) as invite_result;

select
  'direct_party_invite_targets_lobby_code' as check_name,
  bool_and(current_place_invite.target_url = '/app/games?join=' || lobby.invite_code) as passed,
  array_agg(current_place_invite.target_url) as observed
from hh_delivery_pair as pair
cross join hh_delivery_lobby as lobby
join public.current_place_invites as current_place_invite
  on current_place_invite.recipient_id = pair.guest_profile_id
 and current_place_invite.inviter_id = pair.host_profile_id
 and current_place_invite.invite_type = 'party'
 and current_place_invite.status = 'pending';

-- Guest sees the pending invite, accepts it, then can request to join by
-- the long lobby invite code.
select set_config('request.jwt.claim.sub', guest_profile_id::text, true) from hh_delivery_pair;

select
  'recipient_polling_rpc_sees_invite' as check_name,
  count(pending_invite.id) = 1 as passed,
  count(pending_invite.id) as observed
from public.get_my_pending_place_invites() as pending_invite
where pending_invite.invite_type = 'party';

select
  'accept_returns_join_target' as check_name,
  bool_and(response.ok and response.target_url = '/app/games?join=' || lobby.invite_code) as passed,
  array_agg(response.target_url) as observed
from hh_delivery_invite as invite
cross join hh_delivery_lobby as lobby
cross join lateral public.respond_to_place_invite(invite.invite_id, 'accepted') as response;

create temporary table hh_delivery_request on commit drop as
select public.request_join_party(lobby.invite_code) as request_id
from hh_delivery_lobby as lobby;

select
  'guest_request_inserted_by_lobby_code' as check_name,
  bool_and(request_id is not null) as passed,
  array_agg(request_id) as observed
from hh_delivery_request;

-- Host can read that exact pending request through the SECURITY DEFINER RPC.
select set_config('request.jwt.claim.sub', host_profile_id::text, true) from hh_delivery_pair;

select
  'host_pending_request_rpc_sees_guest' as check_name,
  count(join_request.id) = 1 as passed,
  count(join_request.id) as observed
from hh_delivery_lobby as lobby
cross join public.get_my_lobby_join_requests(lobby.session_id) as join_request
join hh_delivery_pair as pair
  on pair.guest_profile_id = join_request.requester_profile_id;

-- Chat persists through RPC and can be read by the accepted friend.
select
  'host_can_send_room_chat' as check_name,
  count(message.id) = 1 as passed,
  count(message.id) as observed
from public.send_place_chat_message('room', (select host_friend_code from hh_delivery_pair), 'moonlit-loft', 'hello from host') as message;

select set_config('request.jwt.claim.sub', guest_profile_id::text, true) from hh_delivery_pair;

select
  'guest_can_read_room_chat' as check_name,
  count(message.id) >= 1 as passed,
  count(message.id) as observed
from public.get_place_chat_messages('room', (select host_friend_code from hh_delivery_pair), 'moonlit-loft', 10) as message
where message.body = 'hello from host';

rollback;
