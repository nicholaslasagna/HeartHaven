"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SOCIAL_EVENT,
  acceptFriendInvite,
  acceptInviteFromCode,
  addFriendDirectly,
  applyKeeperNameRefresh,
  buildInviteLink,
  cancelOutgoingInvite,
  canLookupCode,
  declineFriendInvite,
  getSocialState,
  lookupFriendCode,
  markInviteBlocked,
  parseInviteToken,
  recordPlayedWith,
  removeFriend,
  replaceFriendsFromServer,
  sendFriendInvite,
  setSelfDisplayName,
  type FriendCode,
  type FriendInvite,
  type SocialState,
} from "@/lib/game/social";
import { getCachedPublicUsername } from "@/lib/game/public-identity";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  cancelSupabaseOutgoingInvite,
  ensureInviteRealtime,
  pushInviteToSupabase,
  setSupabaseInviteStatus,
  teardownInviteRealtime,
} from "@/lib/game/invite-bridge";

/**
 * useSocial — React view of the friend graph. Auto-syncs across tabs via
 * `hearthaven:social-changed` + the `storage` event.
 */
export function useSocial() {
  const [state, setState] = useState<SocialState | null>(null);

  useEffect(() => {
    const sync = () => setState(getSocialState());
    sync();
    window.addEventListener(SOCIAL_EVENT, sync);
    window.addEventListener("storage", sync);
    // Boot the Supabase realtime subscription so any invite addressed to us
    // — past or live — lands in the local inbox without the recipient
    // needing to click a shareable URL.
    void ensureInviteRealtime();

    // Refresh display names from the server for every friend + recently-
    // played-with keeper. Without this, a friend who changed their
    // username on their Account page would still show under the old
    // name here forever (the value was cached at friending time). The
    // RPC returns just `{friend_code, username}` per code — no PII
    // leakage beyond the friend graph the user already has access to.
    let cancelled = false;
    async function refreshNames() {
      if (cancelled) return;
      if (!isSupabaseConfigured()) return;
      const current = getSocialState();
      const codes = new Set<string>();
      for (const friend of current.friends) codes.add(friend.code);
      for (const played of current.playedWith) codes.add(played.code);
      // Strip self so we don't re-resolve ourselves through the RPC.
      codes.delete(current.selfCode);
      if (codes.size === 0) return;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("refresh_keeper_names", {
          p_friend_codes: Array.from(codes),
        });
        if (cancelled || error || !Array.isArray(data)) return;
        const updates = (data as Array<{ friend_code?: string; username?: string }>)
          .filter((row) => typeof row?.friend_code === "string" && typeof row?.username === "string")
          .map((row) => ({ code: row.friend_code as string, displayName: row.username as string }));
        if (updates.length > 0) applyKeeperNameRefresh(updates);
      } catch {
        /* best-effort — UI keeps the cached name until the next refresh */
      }
    }
    async function refreshServerFriends() {
      if (cancelled) return;
      if (!isSupabaseConfigured()) return;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("get_my_friends");
        if (cancelled || error || !Array.isArray(data)) return;
        replaceFriendsFromServer(
          (data as Array<{ friend_code?: string; display_name?: string }>)
            .filter((row) => typeof row.friend_code === "string")
            .map((row) => ({
              code: row.friend_code as string,
              displayName: typeof row.display_name === "string" ? row.display_name : "Keeper",
            })),
        );
      } catch {
        /* best-effort — local cache remains usable offline */
      }
    }
    // First refresh shortly after mount (let initial render settle).
    const initialTimer = window.setTimeout(() => {
      void refreshNames();
      void refreshServerFriends();
    }, 250);
    // Re-fetch whenever the tab regains focus — captures the case where
    // a friend renamed while this tab was in the background.
    const focusHandler = () => {
      void refreshNames();
      void refreshServerFriends();
    };
    window.addEventListener("focus", focusHandler);
    window.addEventListener("visibilitychange", focusHandler);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.removeEventListener("focus", focusHandler);
      window.removeEventListener("visibilitychange", focusHandler);
      window.removeEventListener(SOCIAL_EVENT, sync);
      window.removeEventListener("storage", sync);
      void teardownInviteRealtime();
    };
  }, []);

  const lookup = useCallback((code: FriendCode) => lookupFriendCode(code), []);
  const canLookup = useCallback((code: FriendCode) => canLookupCode(code), []);
  const sendInvite = useCallback((code: FriendCode, message?: string) => {
    const username = getCachedPublicUsername();
    setSelfDisplayName(username);
    const result = sendFriendInvite(code, message);
    // Fire-and-forget the Supabase push so the recipient gets the invite in
    // their inbox the moment their realtime subscription sees the INSERT —
    // no shareable URL hand-off needed when both keepers are signed in.
    if (result.ok) void pushInviteToSupabase(result.invite);
    return result;
  }, []);
  const acceptInvite = useCallback((inviteId: string) => {
    const state = getSocialState();
    const invite = state.inbox.find((entry) => entry.id === inviteId);
    const friend = acceptFriendInvite(inviteId);
    if (friend && invite) void setSupabaseInviteStatus(invite.fromCode, "accepted");
    return friend;
  }, []);
  const declineInvite = useCallback((inviteId: string) => {
    const state = getSocialState();
    const invite = state.inbox.find((entry) => entry.id === inviteId);
    declineFriendInvite(inviteId);
    if (invite) void setSupabaseInviteStatus(invite.fromCode, "declined");
  }, []);
  const cancelInvite = useCallback((inviteId: string) => {
    // Find the outgoing record so we can tell Supabase to mark the row
    // cancelled — that's what triggers the recipient's UPDATE channel
    // to remove the pending invite from their inbox.
    const state = getSocialState();
    const invite = state.outgoing.find((entry) => entry.id === inviteId);
    cancelOutgoingInvite(inviteId);
    if (invite) void cancelSupabaseOutgoingInvite(invite.toCode);
  }, []);
  const markInviteBlockedSynced = useCallback((inviteId: string) => {
    const state = getSocialState();
    const invite = state.inbox.find((entry) => entry.id === inviteId);
    markInviteBlocked(inviteId);
    if (invite) void setSupabaseInviteStatus(invite.fromCode, "blocked");
  }, []);
  const buildLink = useCallback((invite: FriendInvite) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://realfiction.store";
    return buildInviteLink(invite, origin);
  }, []);
  const redeemToken = useCallback((token: string) => {
    const payload = parseInviteToken(token);
    if (!payload) return { ok: false as const, reason: "invalid-code" as const };
    return acceptInviteFromCode(payload.fromCode, payload.fromDisplayName, payload.message);
  }, []);
  const removeFriendSynced = useCallback((code: FriendCode) => {
    removeFriend(code);
    if (!isSupabaseConfigured()) return;
    try {
      void getSupabaseBrowserClient().rpc("remove_friend_by_code", { p_friend_code: code });
    } catch {
      /* local removal already succeeded */
    }
  }, []);

  return useMemo(
    () => ({
      state,
      ready: state !== null,
      friends: state?.friends ?? [],
      inbox: state?.inbox ?? [],
      outgoing: state?.outgoing ?? [],
      playedWith: state?.playedWith ?? [],
      selfCode: state?.selfCode ?? "",
      selfDisplayName: getCachedPublicUsername(),
      lookup,
      canLookup,
      sendInvite,
      buildLink,
      redeemToken,
      // NOTE: we intentionally do NOT re-export `acceptInviteFromCode`
      // as a raw `redeemCode` here. That function fabricates an invite
      // FROM a friend code INTO the caller's own inbox — fine when
      // called from invite-bridge.ts (Supabase delivered a server-proven
      // row) or from `redeemToken` (the JWT is the proof), but
      // dangerous if a UI exposes it on a raw input, because anyone
      // could type any code and accept the forged invite to force a
      // friendship. The Friends page now routes raw-code input through
      // `sendInvite` (which goes into the OTHER keeper's inbox).
      cancelInvite,
      acceptInvite,
      declineInvite,
      markInviteBlocked: markInviteBlockedSynced,
      removeFriend: removeFriendSynced,
      recordPlayedWith,
      setSelfDisplayName,
    }),
    [state, lookup, canLookup, sendInvite, buildLink, redeemToken, acceptInvite, declineInvite, cancelInvite, markInviteBlockedSynced, removeFriendSynced],
  );
}
