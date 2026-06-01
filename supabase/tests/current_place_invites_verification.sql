-- current_place_invites_verification.sql
--
-- Safe verification helpers for migration 0048. This file contains no
-- production secrets and no real invite codes.

-- 1) The direct place-invite RPC should be SECURITY DEFINER, authenticated
--    executable, and return invite_id instead of a bare id column.
select
  proc.proname,
  proc.prosecdef as security_definer,
  pg_get_function_result(proc.oid) as result_signature,
  pg_get_function_arguments(proc.oid) as arguments
from pg_proc proc
join pg_namespace ns on ns.oid = proc.pronamespace
where ns.nspname = 'public'
  and proc.proname = 'invite_friend_to_current_place';

select
  privilege_type,
  grantee
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name = 'invite_friend_to_current_place'
order by grantee, privilege_type;

-- 2) Direct table writes remain denied to normal authenticated clients. The
--    app path must use the RPC so Realtime/polling sees a canonical row.
select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'current_place_invites'
order by policyname;

-- 3) Pending target de-dupe is still in place, so clicking the same direct
--    Invite button twice refreshes the same card instead of creating dupes.
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'current_place_invites'
  and indexname = 'current_place_invites_one_pending_target';

-- 4) Transactional smoke test.
--
-- Requirements before running this block:
--   - At least two non-production test profiles exist.
--   - Those two profiles have one accepted public.friendships row.
--
-- The block picks one accepted friend pair, impersonates the host via the
-- request.jwt.claim.sub setting used by auth.uid(), calls the direct invite
-- RPC twice for ONE selected recipient, then verifies:
--   - no ambiguous id error was thrown
--   - the function returned invite_id
--   - repeat send reused/refreshed the same pending invite
--   - only the selected recipient has the pending invite
--   - the sender does not receive their own invite
--   - get_my_pending_place_invites() can see the invite for fallback polling
--
-- Everything rolls back.
begin;

create temporary table hh_place_invite_test on commit drop as
with selected_pair as (
  select
    friendship.requester_id as host_profile_id,
    friendship.friend_id as recipient_profile_id
  from public.friendships as friendship
  where friendship.status = 'accepted'
  order by friendship.updated_at desc, friendship.created_at desc
  limit 1
),
selected_target as (
  select
    selected_pair.host_profile_id,
    selected_pair.recipient_profile_id,
    recipient_profile.friend_code as recipient_friend_code,
    (
      select other_profile.id
      from public.profiles as other_profile
      where other_profile.id not in (selected_pair.host_profile_id, selected_pair.recipient_profile_id)
      order by other_profile.created_at desc
      limit 1
    ) as other_profile_id,
    (
      '/app/area?zone=garden&verification=' ||
      replace(extensions.gen_random_uuid()::text, '-', '')
    ) as target_url
  from selected_pair
  join public.profiles as recipient_profile
    on recipient_profile.id = selected_pair.recipient_profile_id
),
auth_context as (
  select
    set_config('request.jwt.claim.sub', selected_target.host_profile_id::text, true) as host_sub,
    set_config('request.jwt.claim.role', 'authenticated', true) as host_role
  from selected_target
),
first_invite as (
  select invite_result.*
  from selected_target
  cross join auth_context
  cross join lateral public.invite_friend_to_current_place(
    selected_target.recipient_friend_code,
    'garden',
    selected_target.target_url,
    null,
    'verification-garden',
    null
  ) as invite_result
),
second_invite as (
  select invite_result.*
  from selected_target
  cross join first_invite
  cross join lateral public.invite_friend_to_current_place(
    selected_target.recipient_friend_code,
    'garden',
    selected_target.target_url,
    null,
    'verification-garden',
    null
  ) as invite_result
)
select
  selected_target.host_profile_id,
  selected_target.recipient_profile_id,
  selected_target.other_profile_id,
  selected_target.target_url,
  first_invite.invite_id as first_invite_id,
  first_invite.status as first_status,
  second_invite.invite_id as second_invite_id,
  second_invite.status as second_status
from selected_target
cross join first_invite
cross join second_invite;

select
  'accepted_friend_pair_available' as check_name,
  count(*) = 1 as passed,
  count(*) as observed
from hh_place_invite_test;

select
  'returned_invite_id_without_ambiguous_id_error' as check_name,
  bool_and(first_invite_id is not null and first_status = 'pending') as passed,
  array_agg(first_invite_id) as observed_invite_ids
from hh_place_invite_test;

select
  'repeat_invite_reuses_one_pending_card' as check_name,
  bool_and(first_invite_id = second_invite_id and second_status = 'pending') as passed,
  array_agg(first_invite_id::text || ' / ' || second_invite_id::text) as observed
from hh_place_invite_test;

select
  'selected_recipient_has_exactly_one_pending_invite' as check_name,
  count(current_place_invite.id) = 1 as passed,
  count(current_place_invite.id) as observed
from hh_place_invite_test as test
left join public.current_place_invites as current_place_invite
  on current_place_invite.inviter_id = test.host_profile_id
 and current_place_invite.recipient_id = test.recipient_profile_id
 and current_place_invite.target_url = test.target_url
 and current_place_invite.status = 'pending';

select
  'sender_does_not_receive_own_invite' as check_name,
  count(current_place_invite.id) = 0 as passed,
  count(current_place_invite.id) as observed
from hh_place_invite_test as test
left join public.current_place_invites as current_place_invite
  on current_place_invite.recipient_id = test.host_profile_id
 and current_place_invite.target_url = test.target_url
 and current_place_invite.status = 'pending';

select
  'other_profiles_do_not_receive_selected_invite' as check_name,
  case
    when bool_or(test.other_profile_id is null) then null
    else count(current_place_invite.id) = 0
  end as passed,
  count(current_place_invite.id) as observed
from hh_place_invite_test as test
left join public.current_place_invites as current_place_invite
  on current_place_invite.recipient_id = test.other_profile_id
 and current_place_invite.target_url = test.target_url
 and current_place_invite.status = 'pending';

select set_config('request.jwt.claim.sub', test.recipient_profile_id::text, true)
from hh_place_invite_test as test;

select
  'fallback_polling_rpc_sees_recipient_invite' as check_name,
  count(pending_invite.id) = 1 as passed,
  count(pending_invite.id) as observed
from hh_place_invite_test as test
left join public.get_my_pending_place_invites() as pending_invite
  on pending_invite.id = test.first_invite_id;

rollback;
