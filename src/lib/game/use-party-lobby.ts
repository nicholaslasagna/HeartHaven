"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PARTY_LOBBY_EVENT,
  buildPartyInviteLink,
  createPartyLobby,
  ensurePartyLobby,
  inviteFriendToParty,
  joinPartyFromInput,
  getPartyStartStatus,
  readPartyLobby,
  removePartySeat,
  selectPartyGame,
  setPartySize,
  startPartyGame,
  togglePartyReady,
  type PartyLobby,
} from "@/lib/game/party-lobby";
import type { Friend } from "@/lib/game/social";

export function usePartyLobby(initialSize: PartyLobby["size"] = 4) {
  const [lobby, setLobby] = useState<PartyLobby | null>(null);

  useEffect(() => {
    const sync = () => setLobby(readPartyLobby());
    const seeded = ensurePartyLobby(initialSize);
    queueMicrotask(() => setLobby(seeded));
    window.addEventListener(PARTY_LOBBY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PARTY_LOBBY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [initialSize]);

  const resetLobby = useCallback((size: PartyLobby["size"] = initialSize) => createPartyLobby(size), [initialSize]);
  const resize = useCallback((size: PartyLobby["size"]) => setPartySize(size), []);
  const inviteFriend = useCallback((friend: Friend) => inviteFriendToParty(friend), []);
  const removeSeat = useCallback((seatId: string) => removePartySeat(seatId), []);
  const toggleReady = useCallback(() => togglePartyReady(), []);
  const join = useCallback((input: string) => joinPartyFromInput(input), []);
  const selectGame = useCallback((game: { href: string; title: string }) => selectPartyGame(game), []);
  const startGame = useCallback(() => startPartyGame(), []);
  const buildLink = useCallback((friend?: Friend, game?: { href?: string; title?: string }) => {
    const current = readPartyLobby() ?? ensurePartyLobby(initialSize);
    const origin = typeof window !== "undefined" ? window.location.origin : "https://realfiction.store";
    return buildPartyInviteLink(current, origin, friend, game);
  }, [initialSize]);

  return useMemo(
    () => ({
      lobby,
      ready: lobby !== null,
      resetLobby,
      resize,
      inviteFriend,
      removeSeat,
      toggleReady,
      join,
      selectGame,
      startGame,
      startStatus: getPartyStartStatus(lobby),
      buildLink,
    }),
    [lobby, resetLobby, resize, inviteFriend, removeSeat, toggleReady, join, selectGame, startGame, buildLink],
  );
}
