"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SOCIAL_EVENT,
  acceptFriendInvite,
  cancelOutgoingInvite,
  canLookupCode,
  declineFriendInvite,
  getSocialState,
  lookupFriendCode,
  markInviteBlocked,
  recordPlayedWith,
  removeFriend,
  sendFriendInvite,
  setSelfDisplayName,
  type FriendCode,
  type SocialState,
} from "@/lib/game/social";

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

  return useMemo(
    () => ({
      state,
      ready: state !== null,
      friends: state?.friends ?? [],
      inbox: state?.inbox ?? [],
      outgoing: state?.outgoing ?? [],
      playedWith: state?.playedWith ?? [],
      selfCode: state?.selfCode ?? "",
      selfDisplayName: state?.selfDisplayName ?? "Keeper",
      lookup,
      canLookup,
      sendInvite: sendFriendInvite,
      cancelInvite: cancelOutgoingInvite,
      acceptInvite: acceptFriendInvite,
      declineInvite: declineFriendInvite,
      markInviteBlocked,
      removeFriend,
      recordPlayedWith,
      setSelfDisplayName,
    }),
    [state, lookup, canLookup],
  );
}
