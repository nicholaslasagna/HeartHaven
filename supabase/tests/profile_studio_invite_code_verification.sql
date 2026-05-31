-- profile_studio_invite_code_verification.sql
--
-- Safe verification helpers for migration 0043. This file contains no
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
