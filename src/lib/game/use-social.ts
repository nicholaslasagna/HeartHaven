"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SOCIAL_EVENT,
  acceptFriendInvite,
  acceptInviteFromCode,
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
  sendFriendInvite,
  setSelfDisplayName,
  type FriendCode,
  type FriendInvite,
  type SocialState,
} from "@/lib/game/social";
import { getCachedPublicUsername } from "@/lib/game/public-identity";
import {
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
    return () => {
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
      redeemCode: acceptInviteFromCode,
      cancelInvite: cancelOutgoingInvite,
      acceptInvite,
      declineInvite,
      markInviteBlocked: markInviteBlockedSynced,
      removeFriend,
      recordPlayedWith,
      setSelfDisplayName,
    }),
    [state, lookup, canLookup, sendInvite, buildLink, redeemToken, acceptInvite, declineInvite, markInviteBlockedSynced],
  );
}
