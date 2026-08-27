-- 0088_close_friendship_and_block_oracles.sql
--
-- Two more DEFINER predicates about other people, reachable without even
-- signing in.
--
-- THE ISSUE. Neither of these consults auth.uid(). Both subjects arrive as
-- parameters, and both functions are SECURITY DEFINER, so they answer
-- authoritatively past RLS:
--
--     are_friends(left_profile uuid, right_profile uuid)
--     is_recipient_blocking(recipient_code text, sender_code text)
--
-- Neither was ever revoked from PUBLIC. EXECUTE on a function is granted to
-- PUBLIC by default, so both were callable by `anon` — the key that ships in
-- the browser bundle. Confirmed against the live database: posting to
-- /rest/v1/rpc/are_friends and /rest/v1/rpc/is_recipient_blocking with only
-- the anon key returns 200 and a boolean.
--
-- What that gives away:
--
--   * are_friends: hand it two profile ids and learn whether those two
--     people are friends. A friendship-graph oracle, one pair at a time.
--   * is_recipient_blocking: hand it two friend codes and learn whether the
--     first has blocked the second. Blocks are meant to be silent — the
--     point is that the blocked person cannot tell. Being able to test it
--     turns a safety feature into a confirmation channel, which in a game
--     with younger players is the harassment case the block exists to
--     prevent.
--
-- Friend codes are 40 bits (gen_random_bytes(5)) so they cannot be
-- enumerated, but they are meant to be shared — the whole invite flow hands
-- them out. Anyone holding two of them could probe the block relationship.
--
-- THE FIX. Revoke PUBLIC and the client roles. Nothing depends on the
-- client grant:
--
--   * No client code calls either function.
--   * Neither appears in any RLS policy, so no policy evaluation needs
--     EXECUTE as the querying user. (This is why the same treatment cannot
--     be applied to can_profiles_interact, is_partner_member,
--     has_private_content or is_game_session_member — those ARE used in
--     policies, and are self-relative anyway: they answer about the caller,
--     not a third party.)
--   * Every internal caller is SECURITY DEFINER and so executes as owner:
--       are_friends           <- can_profiles_interact, send_inventory_gift
--       is_recipient_blocking <- can_insert_friend_invite
--     (can_insert_friend_invite is INVOKER in 0015 but redefined as DEFINER
--      in 0018, which is the definition that stands.)

revoke all on function public.are_friends(uuid, uuid) from public;
revoke all on function public.are_friends(uuid, uuid) from authenticated, anon;

revoke all on function public.is_recipient_blocking(text, text) from public;
revoke all on function public.is_recipient_blocking(text, text) from authenticated, anon;

comment on function public.are_friends(uuid, uuid) is
  'INTERNAL ONLY. SECURITY DEFINER and takes both subjects as parameters, so a client grant makes it a friendship-graph oracle. Called from can_profiles_interact and send_inventory_gift, both DEFINER. Keep revoked from public, authenticated and anon.';

comment on function public.is_recipient_blocking(text, text) is
  'INTERNAL ONLY. Reveals whether one keeper has blocked another. Blocks are silent by design; a callable predicate turns that into a confirmation channel. Called from can_insert_friend_invite (DEFINER as of 0018). Keep revoked from public, authenticated and anon.';
