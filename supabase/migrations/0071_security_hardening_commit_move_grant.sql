-- 0071_security_hardening_commit_move_grant.sql
--
-- Security hardening (least privilege). Outcome of a full review of the
-- SECURITY DEFINER / RLS / grant surface.
--
-- FINDING (the only actionable one): `commit_game_session_move` is
-- granted EXECUTE to the `authenticated` role, but:
--
--   • It is a SECURITY *INVOKER* function (no `security definer`), so a
--     direct RPC call runs with the caller's own privileges.
--   • Its parameters include `p_profile_id` and `p_seat_index` — i.e. it
--     takes the actor's identity + seat FROM THE CLIENT rather than from
--     auth.uid(). It then writes `game_sessions` (metadata/status) and
--     inserts into `game_moves`.
--   • It is only ever called INTERNALLY, via `perform`/`if not ...` from
--     the SECURITY DEFINER game functions (submit_game_move and the
--     per-game authoritative resolvers). No client code calls it.
--
-- It is NOT currently exploitable: `game_moves` denies direct INSERT
-- (`with check (false)`) and `game_sessions` denies direct writes (the
-- legacy permissive host policies were dropped in 0030), so a direct
-- call by an attacker fails at the RLS layer. But exposing an
-- identity-spoofable, write-capable invoker function to every signed-in
-- user means the ONLY thing standing between an attacker and forged game
-- moves / session tampering is those two RLS policies. That is exactly
-- the kind of single-barrier dependency a least-privilege grant should
-- remove.
--
-- FIX: revoke EXECUTE from `authenticated`. Internal callers are
-- unaffected — when a SECURITY DEFINER function (owned by the migration
-- role) invokes this function, the EXECUTE check runs against the
-- definer/owner, not the calling end-user. `service_role` retains it for
-- server-side/admin use.
--
-- Everything else in the review came back clean and is documented here
-- for the record (no code change needed):
--   • All SECURITY DEFINER functions pin `set search_path`.
--   • RLS is enabled on every public table; no write policy uses a
--     permissive `using (true)` / `with check (true)`.
--   • Identity-acting RPCs (kick_party_seat, set_room_decorator,
--     set_garden_decorator, request_partner_link,
--     invite_friend_to_current_place, redeem_*) all derive the actor
--     from auth.uid() and scope writes to the caller's own rows.
--   • Moderation columns on `profiles` are trigger-protected against
--     self-edit; `permanent_bans` has no authenticated write policy, so
--     users cannot un-ban themselves.
--   • Place-invite target URLs are pinned to same-origin `/app/%` and
--     friends-only — no open-redirect.
--   • `memory_match_sync_player_scores` (also a write-capable invoker) is
--     NOT granted to authenticated — internal-only. Safe as-is.

revoke execute on function
  public.commit_game_session_move(uuid, integer, uuid, integer, text, jsonb, jsonb, text)
  from authenticated;

comment on function
  public.commit_game_session_move(uuid, integer, uuid, integer, text, jsonb, jsonb, text) is
  'INTERNAL ONLY. Called via SECURITY DEFINER game resolvers (submit_game_move, per-game authoritative functions). Not granted to authenticated: it is a SECURITY INVOKER helper that takes actor identity + seat as parameters, so direct client access would allow move/seat spoofing if the game_moves / game_sessions RLS deny policies were ever loosened. Keep this revoked from authenticated.';
