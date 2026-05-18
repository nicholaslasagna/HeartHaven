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

/**
 * @deprecated Use `useServerPartyLobby` from `@/lib/game/use-server-party-lobby`.
 *
 * This is the original localStorage-backed lobby hook. It has a fatal
 * design flaw: each device has its own lobby state with no shared
 * rendezvous point, so cross-device multiplayer literally cannot work.
 * Migration 0029 + `useServerPartyLobby` replace it with a Supabase
 * Realtime-backed model. This shim stays in the tree only so the old
 * games-client UI keeps compiling while Codex rebuilds it.
 *
 * Do not consume this hook in new code.
 */
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
