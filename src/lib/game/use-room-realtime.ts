"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { FacingDirection, RealtimeRoomPlayer, RoomEmote } from "@/lib/game/types";
import {
  KEEPER_CUSTOMIZATION_EVENT,
  PET_CUSTOMIZATION_EVENT,
  readPresenceCustomization,
} from "@/lib/game/avatar-customization";
import { getSocialState, recordPlayedWith } from "@/lib/game/social";
import { isBlocked } from "@/lib/game/safety";

type UseRoomRealtimeOptions = {
  roomId: string;
  roomName: string;
};

type ConnectionState = "demo" | "connecting" | "connected" | "offline" | "error";

function createGuestId() {
  if (typeof window === "undefined") return "guest-server";
  const existing = window.localStorage.getItem("hearthaven:guest-player-id");
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem("hearthaven:guest-player-id", next);
  return next;
}

function createDisplayName(email?: string | null) {
  if (!email) return "Guest Keeper";
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeRoomId(roomId: string) {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "moonlit-loft";
}

export function useRoomRealtime({ roomId, roomName }: UseRoomRealtimeOptions) {
  const [players, setPlayers] = useState<RealtimeRoomPlayer[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("demo");
  const [status, setStatus] = useState("Realtime demo mode");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localPlayerRef = useRef<RealtimeRoomPlayer | null>(null);
  const normalizedRoomId = useMemo(() => normalizeRoomId(roomId), [roomId]);

  const inviteUrl = useMemo(() => {
    if (typeof window === "undefined") return `/app/room?room=${normalizedRoomId}`;
    const url = new URL("/app/room", window.location.origin);
    url.searchParams.set("room", normalizedRoomId);
    url.searchParams.set("visit", getSocialState().selfCode);
    return url.toString();
  }, [normalizedRoomId]);

  const roomCode = useMemo(() => normalizedRoomId.toUpperCase(), [normalizedRoomId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      queueMicrotask(() => {
        setConnectionState("demo");
        setStatus("Set Supabase env vars to enable live room presence.");
      });
      return;
    }

    let cancelled = false;
    let customizationCleanup: (() => void) | null = null;

    async function connect() {
      setConnectionState("connecting");
      setStatus(`Joining ${roomName} multiplayer`);

      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const localId = user?.id ?? createGuestId();
        const displayName = createDisplayName(user?.email);
        const social = getSocialState();

        // Full customization snapshot — keeper palette + outfit, pet species +
        // fur tone + accessory — so remote keepers see the real avatar/pet.
        const localPlayer: RealtimeRoomPlayer = {
          id: localId,
          displayName,
          friendCode: social.selfCode,
          ...readPresenceCustomization(),
          facing: "right",
          x: 390,
          y: 374,
          updatedAt: Date.now(),
        };

        localPlayerRef.current = localPlayer;

        const channel = supabase.channel(`room:${normalizedRoomId}`, {
          config: {
            broadcast: { self: false },
            presence: { key: localId },
          },
        });

        channelRef.current = channel;

        function syncPresence() {
          const state = channel.presenceState<RealtimeRoomPlayer>();
          const remotePlayers = Object.values(state)
            .flat()
            .filter((player) => player.id !== localId)
            .filter((player) => !player.friendCode || !isBlocked(player.friendCode))
            .sort((a, b) => a.displayName.localeCompare(b.displayName));

          remotePlayers.forEach((player) => {
            if (!player.friendCode) return;
            recordPlayedWith({ code: player.friendCode, displayName: player.displayName, context: roomName });
          });
          setPlayers(remotePlayers);
        }

        channel
          .on("presence", { event: "sync" }, syncPresence)
          .on("presence", { event: "join" }, syncPresence)
          .on("presence", { event: "leave" }, syncPresence)
          .on("broadcast", { event: "avatar_move" }, ({ payload }) => {
            const player = payload as RealtimeRoomPlayer;
            if (!player?.id || player.id === localId) return;
            if (player.friendCode && isBlocked(player.friendCode)) return;
            if (player.friendCode) {
              recordPlayedWith({ code: player.friendCode, displayName: player.displayName, context: roomName });
            }
            setPlayers((current) => upsertPlayer(current, player));
          })
          .on("broadcast", { event: "room_emote" }, ({ payload }) => {
            const player = payload as RealtimeRoomPlayer;
            if (!player?.id || player.id === localId) return;
            if (player.friendCode && isBlocked(player.friendCode)) return;
            if (player.friendCode) {
              recordPlayedWith({ code: player.friendCode, displayName: player.displayName, context: roomName });
            }
            setPlayers((current) => upsertPlayer(current, player));
            window.dispatchEvent(new CustomEvent("hearthaven:remote-emote", { detail: player }));
          })
          .subscribe(async (state) => {
            if (cancelled) return;
            if (state === "SUBSCRIBED") {
              await channel.track(localPlayer);
              setConnectionState("connected");
              setStatus(`Live in room ${roomCode}`);
            } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              setConnectionState("error");
              setStatus("Realtime could not connect. The room still works locally.");
            } else if (state === "CLOSED") {
              setConnectionState("offline");
              setStatus("Realtime room closed.");
            }
          });

        // Re-broadcast presence whenever the keeper or pet customization
        // changes (e.g. from the Account customizer) so anyone sharing the
        // room sees the new outfit / fur tone live, without a reload.
        const rebroadcastCustomization = () => {
          const current = localPlayerRef.current;
          if (!current) return;
          const payload: RealtimeRoomPlayer = {
            ...current,
            friendCode: getSocialState().selfCode,
            ...readPresenceCustomization(),
            updatedAt: Date.now(),
          };
          localPlayerRef.current = payload;
          void channel.track(payload);
          void channel.send({ type: "broadcast", event: "avatar_move", payload });
        };
        window.addEventListener(KEEPER_CUSTOMIZATION_EVENT, rebroadcastCustomization);
        window.addEventListener(PET_CUSTOMIZATION_EVENT, rebroadcastCustomization);
        customizationCleanup = () => {
          window.removeEventListener(KEEPER_CUSTOMIZATION_EVENT, rebroadcastCustomization);
          window.removeEventListener(PET_CUSTOMIZATION_EVENT, rebroadcastCustomization);
        };
      } catch (error) {
        setConnectionState("error");
        setStatus(error instanceof Error ? error.message : "Realtime could not start.");
      }
    }

    void connect();

    return () => {
      cancelled = true;
      customizationCleanup?.();
      customizationCleanup = null;
      const channel = channelRef.current;
      if (channel) {
        void getSupabaseBrowserClient().removeChannel(channel);
      }
      channelRef.current = null;
      localPlayerRef.current = null;
      setPlayers([]);
    };
  }, [normalizedRoomId, roomCode, roomName]);

  const sendMove = useCallback((position: { x: number; y: number; facing?: FacingDirection }) => {
    const channel = channelRef.current;
    const localPlayer = localPlayerRef.current;
    if (!channel || !localPlayer) return;

    const payload: RealtimeRoomPlayer = {
      ...localPlayer,
      x: Math.round(position.x),
      y: Math.round(position.y),
      facing: position.facing ?? localPlayer.facing,
      updatedAt: Date.now(),
    };

    localPlayerRef.current = payload;
    void channel.track(payload);
    void channel.send({ type: "broadcast", event: "avatar_move", payload });
  }, []);

  const sendEmote = useCallback((emote: RoomEmote) => {
    const channel = channelRef.current;
    const localPlayer = localPlayerRef.current;
    if (!channel || !localPlayer) return;

    const payload: RealtimeRoomPlayer = {
      ...localPlayer,
      emote,
      updatedAt: Date.now(),
    };

    localPlayerRef.current = payload;
    void channel.track(payload);
    void channel.send({ type: "broadcast", event: "room_emote", payload });
  }, []);

  return {
    connectionState,
    inviteUrl,
    players,
    roomCode,
    sendEmote,
    sendMove,
    status,
  };
}

function upsertPlayer(players: RealtimeRoomPlayer[], next: RealtimeRoomPlayer) {
  const withoutCurrent = players.filter((player) => player.id !== next.id);
  return [...withoutCurrent, next].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
