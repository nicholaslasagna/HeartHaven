"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { moderateChatMessage, type ChatModerationResult, type GardenChatMessage } from "@/lib/game/chat-moderation";
import type { FacingDirection, RealtimeRoomPlayer, RoomEmote } from "@/lib/game/types";
import {
  KEEPER_CUSTOMIZATION_EVENT,
  PET_CUSTOMIZATION_EVENT,
  readPresenceCustomization,
} from "@/lib/game/avatar-customization";
import { getSocialState, recordPlayedWith } from "@/lib/game/social";
import { isBlocked, isLocallyQuarantined, readSafetyState, submitReport } from "@/lib/game/safety";
import { getCachedPublicUsername, resolvePublicUsername } from "@/lib/game/public-identity";
import { recordActivity } from "@/lib/game/activity";

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

function normalizeRoomId(roomId: string) {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "moonlit-loft";
}

function normalizeFriendCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

export function useRoomRealtime({ roomId, roomName }: UseRoomRealtimeOptions) {
  const [players, setPlayers] = useState<RealtimeRoomPlayer[]>([]);
  const [messages, setMessages] = useState<GardenChatMessage[]>([]);
  const [approvedDecoratorCodes, setApprovedDecoratorCodes] = useState<string[]>([]);
  const [localFriendCode, setLocalFriendCode] = useState(() =>
    typeof window === "undefined" ? "" : getSocialState().selfCode,
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>("demo");
  const [status, setStatus] = useState("Solo room mode");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localPlayerRef = useRef<RealtimeRoomPlayer | null>(null);
  const lastFriendPointAtRef = useRef(0);
  const normalizedRoomId = useMemo(() => normalizeRoomId(roomId), [roomId]);

  const inviteUrl = useMemo(() => {
    if (typeof window === "undefined") return `/app/area?zone=room&room=${normalizedRoomId}`;
    const url = new URL("/app/area", window.location.origin);
    url.searchParams.set("zone", "room");
    url.searchParams.set("room", normalizedRoomId);
    url.searchParams.set("visit", getSocialState().selfCode);
    return url.toString();
  }, [normalizedRoomId]);

  const roomCode = useMemo(() => normalizedRoomId.toUpperCase(), [normalizedRoomId]);

  const appendMessage = useCallback((message: GardenChatMessage) => {
    setMessages((current) => [message, ...current.filter((entry) => entry.id !== message.id)].slice(0, 24));
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      queueMicrotask(() => {
        const username = getCachedPublicUsername();
        const social = getSocialState();
        setLocalFriendCode(social.selfCode);
        localPlayerRef.current = {
          id: createGuestId(),
          displayName: username,
          friendCode: social.selfCode,
          ...readPresenceCustomization(),
          facing: "right",
          x: 390,
          y: 374,
          updatedAt: Date.now(),
        };
        setConnectionState("demo");
        setStatus("Online room visits are not available in this build yet.");
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
        const displayName = await resolvePublicUsername(user);
        const social = getSocialState();
        setLocalFriendCode(social.selfCode);

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
          if (remotePlayers.length > 0 && Date.now() - lastFriendPointAtRef.current > 5 * 60_000) {
            lastFriendPointAtRef.current = Date.now();
            recordActivity("friend-time", 1, { context: roomName });
          }
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
          .on("broadcast", { event: "room_chat" }, ({ payload }) => {
            const message = payload as GardenChatMessage;
            if (!message?.id || message.playerId === localId) return;
            if (message.friendCode && isBlocked(message.friendCode)) return;
            appendMessage(message);
            window.dispatchEvent(new CustomEvent("hearthaven:room-chat-bubble", { detail: message }));
          })
          .on("broadcast", { event: "room_decorator_permissions" }, ({ payload }) => {
            const approvedCodes: string[] = Array.isArray(payload?.approvedCodes)
              ? (payload.approvedCodes as unknown[])
                .map((code: unknown) => normalizeFriendCode(String(code)))
                .filter((code): code is string => Boolean(code))
              : [];
            setApprovedDecoratorCodes([...new Set(approvedCodes)]);
          })
          .subscribe(async (state) => {
            if (cancelled) return;
            if (state === "SUBSCRIBED") {
              await channel.track(localPlayer);
              setConnectionState("connected");
              setStatus(`Live in room ${roomCode}`);
            } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              setConnectionState("error");
              setStatus("Online room visits could not connect. The room still works.");
            } else if (state === "CLOSED") {
              setConnectionState("offline");
              setStatus("Room visit connection closed.");
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
            displayName: getCachedPublicUsername(),
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
        setStatus(error instanceof Error ? error.message : "Online room visits could not start.");
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
  }, [appendMessage, normalizedRoomId, roomCode, roomName]);

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

  const toggleDecoratorPermission = useCallback((friendCode: string) => {
    const normalized = normalizeFriendCode(friendCode);
    if (!normalized) return;

    setApprovedDecoratorCodes((current) => {
      const next = current.includes(normalized)
        ? current.filter((code) => code !== normalized)
        : [...current, normalized];

      const channel = channelRef.current;
      if (channel) {
        void channel.send({
          type: "broadcast",
          event: "room_decorator_permissions",
          payload: {
            approvedCodes: next,
            hostCode: getSocialState().selfCode,
            updatedAt: Date.now(),
          },
        });
      }

      return next;
    });
  }, []);

  const sendChat = useCallback((input: string): ChatModerationResult => {
    const safety = readSafetyState();
    if (isLocallyQuarantined(safety)) {
      return {
        ok: false,
        severity: "hard-block",
        reason: "Your room chat is paused while recent activity is reviewed.",
      };
    }

    const moderation = moderateChatMessage(input);
    if (!moderation.ok) {
      if (moderation.severity === "hard-block") {
        const social = getSocialState();
        submitReport({
          reporterCode: social.selfCode,
          offenderCode: social.selfCode,
          offenderDisplayName: getCachedPublicUsername(),
          reason: "explicit-content",
          details: moderation.reason,
          chatExcerpt: input.slice(0, 240),
          scene: "/app/room",
          autoFlagged: true,
        });
      }
      return moderation;
    }

    const localPlayer = localPlayerRef.current;
    const social = getSocialState();
    const message: GardenChatMessage = {
      id: crypto.randomUUID(),
      playerId: localPlayer?.id ?? createGuestId(),
      displayName: localPlayer?.displayName ?? getCachedPublicUsername(),
      friendCode: social.selfCode,
      text: moderation.text,
      createdAt: Date.now(),
    };

    appendMessage(message);
    window.dispatchEvent(new CustomEvent("hearthaven:room-chat-bubble", { detail: message }));

    const channel = channelRef.current;
    if (channel) void channel.send({ type: "broadcast", event: "room_chat", payload: message });

    return moderation;
  }, [appendMessage]);

  return {
    approvedDecoratorCodes,
    connectionState,
    inviteUrl,
    localFriendCode,
    messages,
    players,
    roomCode,
    sendEmote,
    sendChat,
    sendMove,
    status,
    toggleDecoratorPermission,
  };
}

function upsertPlayer(players: RealtimeRoomPlayer[], next: RealtimeRoomPlayer) {
  const withoutCurrent = players.filter((player) => player.id !== next.id);
  return [...withoutCurrent, next].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
