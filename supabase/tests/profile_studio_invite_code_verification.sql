-- profile_studio_invite_code_verification.sql
--
-- Safe verification helpers for migrations 0043-0044. This file contains no
-- production secrets or real redemption/invite codes.

-- 1) profiles.display_name remains required.
select column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in ('display_name', 'keeper_customization');

-- 2) Keeper Studio has a server-persisted JSON slot.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.profiles'::regclass
  and conname = 'profiles_keeper_customization_object_chk';

-- 3) Party/game invite code generation is no longer the old one-shot default.
select extname, extnamespace::regnamespace as extension_schema
from pg_extension
where extname = 'pgcrypto';

select pg_get_expr(adbin, adrelid) as game_sessions_invite_code_default
from pg_attrdef
where adrelid = 'public.game_sessions'::regclass
  and adnum = (
    select attnum
    from pg_attribute
    where attrelid = 'public.game_sessions'::regclass
      and attname = 'invite_code'
  );

-- 4) Collision retry is implemented in the SECURITY DEFINER helper.
select proname, prosecdef
from pg_proc
where proname in (
  'generate_party_invite_code',
  'insert_game_session_with_unique_invite',
  'create_party_lobby',
  'ensure_play_game_session'
)
order by proname;

-- 5) Friend identity is backed by stable profile ids and duplicate
--    accepted friendship pairs are not present.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'friend_invites'
  and column_name in ('from_profile_id', 'to_profile_id');

select
  least(requester_id, friend_id) as profile_a,
  greatest(requester_id, friend_id) as profile_b,
  count(*) as row_count
from public.friendships
where status = 'accepted'
group by 1, 2
having count(*) > 1;

-- 6) Pending friend invite duplicates by stable profile pair should be gone.
select
  from_profile_id,
  to_profile_id,
  count(*) as pending_count
from public.friend_invites
where status = 'pending'
  and from_profile_id is not null
  and to_profile_id is not null
group by 1, 2
having count(*) > 1;

-- 7) Server-side friend reconciliation RPCs exist and are authenticated-only.
select proname, prosecdef
from pg_proc
where proname in (
  'sync_friendship_from_friend_invite',
  'upsert_friendship_pair',
  'get_my_friends',
  'remove_friend_by_code'
)
order by proname;

-- 8) Backfill/accept idempotency check. This must return zero rows. If it
--    returns rows, accepted invite history has not been materialized into
--    the stable friendships table.
with accepted_pairs as (
  select distinct
    least(coalesce(fi.from_profile_id, fi.sender_profile_id), coalesce(fi.to_profile_id, p_to.id)) as profile_a,
    greatest(coalesce(fi.from_profile_id, fi.sender_profile_id), coalesce(fi.to_profile_id, p_to.id)) as profile_b
  from public.friend_invites fi
  left join public.profiles p_to on upper(p_to.friend_code) = upper(fi.to_code)
  where fi.status = 'accepted'
    and coalesce(fi.from_profile_id, fi.sender_profile_id) is not null
    and coalesce(fi.to_profile_id, p_to.id) is not null
    and coalesce(fi.from_profile_id, fi.sender_profile_id) <> coalesce(fi.to_profile_id, p_to.id)
),
friend_pairs as (
  select
    least(requester_id, friend_id) as profile_a,
    greatest(requester_id, friend_id) as profile_b
  from public.friendships
  where status = 'accepted'
)
select ap.profile_a, ap.profile_b
from accepted_pairs ap
left join friend_pairs fp
  on fp.profile_a = ap.profile_a
 and fp.profile_b = ap.profile_b
where fp.profile_a is null;

-- 9) Reverse-direction accepted duplicates should still collapse to one
--    friend pair. This must return zero rows.
select
  least(requester_id, friend_id) as profile_a,
  greatest(requester_id, friend_id) as profile_b,
  count(*) as accepted_rows
from public.friendships
where status = 'accepted'
group by 1, 2
having count(*) > 1;

-- Optional admin-only transactional test. Replace the UUIDs with two
-- non-production test profile ids, run the block, and confirm it returns
-- pair_count = 1 without throwing even though the same pair is accepted twice.
--
-- begin;
-- select public.upsert_friendship_pair('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000002'::uuid);
-- select public.upsert_friendship_pair('00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000001'::uuid);
-- select count(*) as pair_count
-- from public.friendships
-- where least(requester_id, friend_id) = least('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000002'::uuid)
--   and greatest(requester_id, friend_id) = greatest('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000002'::uuid);
-- rollback;

-- Manual live checks:
--   A. Username: save @Casper on /app/account. It should succeed, and:
--        select id, username, display_name
--        from public.profiles
--        where lower(username) = 'casper';
--      should show a non-null display_name.
--
--   B. Studio: choose a different complete keeper in /app/pet, wait for
--      "Saved", refresh, then sign in from another browser. The same keeper
--      should hydrate from profiles.keeper_customization.
--
--   C. Invite-code collision retry: repeatedly create/close party lobbies
--      from /app/games. Creating a lobby should not surface
--      game_sessions_invite_code_key, and game_sessions.invite_code remains
--      unique:
--        select invite_code, count(*)
--        from public.game_sessions
--        group by invite_code
--        having count(*) > 1;
--      should return zero rows.
--
--   D. Friend identity: create a friend invite between two test accounts,
--      accept it, rename either account, then run:
--        select * from public.get_my_friends();
--      from each account. Each side should see exactly one row for the
--      other account with the current display name.
--
--   E. Remove friend: from one test account, call:
--        select public.remove_friend_by_code('HH-ABCDE-234');
--      using the other test account's code. Then public.get_my_friends()
--      should no longer return the removed account for either side.
