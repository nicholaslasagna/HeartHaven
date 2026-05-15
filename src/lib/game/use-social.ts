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
    return () => {
      window.removeEventListener(SOCIAL_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const lookup = useCallback((code: FriendCode) => lookupFriendCode(code), []);
  const canLookup = useCallback((code: FriendCode) => canLookupCode(code), []);
  const sendInvite = useCallback((code: FriendCode, message?: string) => {
    const username = getCachedPublicUsername();
    setSelfDisplayName(username);
    return sendFriendInvite(code, message);
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
      acceptInvite: acceptFriendInvite,
      declineInvite: declineFriendInvite,
      markInviteBlocked,
      removeFriend,
      recordPlayedWith,
      setSelfDisplayName,
    }),
    [state, lookup, canLookup, sendInvite, buildLink, redeemToken],
  );
}
