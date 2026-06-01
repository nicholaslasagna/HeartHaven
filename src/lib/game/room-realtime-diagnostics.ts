"use client";

import { isMultiplayerDiagnosticsEnabled } from "@/lib/game/multiplayer-diagnostics";

export const ROOM_REALTIME_DIAGNOSTIC_EVENT = "hearthaven:room-realtime-diagnostic";

export type RoomRealtimeDiagnostic = {
  lastPlacementAppliedAt?: string;
  lastPlacementBroadcastAt?: string;
  lastPlacementPollAt?: string;
  lastRealtimeError?: string | null;
  presenceCount?: number;
  remoteCompanionCount?: number;
  remotePlayerCount?: number;
  resolvedRoomHostCode?: string;
  roomChannelName?: string;
  roomConnectionState?: string;
  roomId?: string;
  roomPlacementVersion?: number;
  visitFriendCode?: string | null;
};

export function recordRoomRealtimeDiagnostic(detail: RoomRealtimeDiagnostic) {
  if (!isMultiplayerDiagnosticsEnabled() || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ROOM_REALTIME_DIAGNOSTIC_EVENT, { detail }));
}
