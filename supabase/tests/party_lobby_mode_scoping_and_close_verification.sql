-- party_lobby_mode_scoping_and_close_verification.sql
--
-- Safe verification for migration 0058. Runs inside a transaction and rolls
-- back all writes. Use against a non-production test project or throwaway
-- test profiles.

begin;

create temporary table hh_lobby_scope_pair on commit drop as
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
from hh_lobby_scope_pair;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', host_profile_id::text, true) from hh_lobby_scope_pair;

create temporary table hh_lobby_created on commit drop as
select created.*
from public.create_party_lobby(4) as created;

-- A direct play session for the same host must not be returned as the party
-- lobby, nor should it receive selected-game updates.
insert into public.game_sessions (
  host_id,
  game_key,
  mode,
  status,
  max_players,
  metadata
)
select
  host_profile_id,
  'memory-match',
  'play',
  'completed',
  2,
  '{}'::jsonb
from hh_lobby_scope_pair;

select public.select_party_game('garden-four', '/app/garden-four', 'Garden Four');

select
  'selected_game_written_to_party_lobby' as check_name,
  bool_and(lobby.selected_game_key = 'garden-four' and lobby.selected_game_href = '/app/garden-four') as passed,
  jsonb_agg(jsonb_build_object('session_id', lobby.session_id, 'selected_game_key', lobby.selected_game_key))
    as observed
from public.get_my_party_lobby() as lobby
join hh_lobby_created as created
  on created.session_id = lobby.session_id;

create temporary table hh_lobby_started on commit drop as
select public.start_party_lobby() as href;

select
  'start_does_not_require_full_lobby' as check_name,
  bool_and(started.href = '/app/garden-four?session=' || created.session_id::text) as passed,
  array_agg(started.href) as observed
from hh_lobby_started as started
cross join hh_lobby_created as created;

select public.close_party_lobby(created.session_id)
from hh_lobby_created as created;

select
  'closed_lobby_is_not_hydrated' as check_name,
  count(*) = 0 as passed,
  count(*) as observed
from public.get_my_party_lobby();

rollback;
