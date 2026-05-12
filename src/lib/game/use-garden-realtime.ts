"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { moderateChatMessage, type ChatModerationResult, type GardenChatMessage } from "@/lib/game/chat-moderation";
import type { RealtimeRoomPlayer } from "@/lib/game/types";

type UseGardenRealtimeOptions = {
  gardenId: string;
  gardenName: string;
  invitePath?: "/app/garden" | "/app/partner-garden";
};

type ConnectionState = "demo" | "connecting" | "connected" | "offline" | "error";

const colors = ["#D87E8C", "#8E70BD", "#6E9651", "#D9A53E", "#5E94B0"];

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

function normalizeGardenId(gardenId: string) {
  return gardenId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "caspers-moonberry-beds";
}

export function useGardenRealtime({ gardenId, gardenName, invitePath = "/app/garden" }: UseGardenRealtimeOptions) {
  const [players, setPlayers] = useState<RealtimeRoomPlayer[]>([]);
  const [messages, setMessages] = useState<GardenChatMessage[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("demo");
  const [status, setStatus] = useState("Garden chat demo mode");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localPlayerRef = useRef<RealtimeRoomPlayer | null>(null);
  const normalizedGardenId = useMemo(() => normalizeGardenId(gardenId), [gardenId]);

  const inviteUrl = useMemo(() => {
    if (typeof window === "undefined") return `${invitePath}?garden=${normalizedGardenId}`;
    const url = new URL(invitePath, window.location.origin);
    url.searchParams.set("garden", normalizedGardenId);
    return url.toString();
  }, [invitePath, normalizedGardenId]);

  const gardenCode = useMemo(() => normalizedGardenId.toUpperCase(), [normalizedGardenId]);

  const appendMessage = useCallback((message: GardenChatMessage) => {
    setMessages((current) => [message, ...current.filter((entry) => entry.id !== message.id)].slice(0, 20));
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      queueMicrotask(() => {
        const guestId = createGuestId();
        localPlayerRef.current = {
          id: guestId,
          displayName: "Guest Keeper",
          color: colors[Math.abs(hashCode(guestId)) % colors.length],
          x: 420,
          y: 430,
          petName: "Casper",
          updatedAt: Date.now(),
        };
        setConnectionState("demo");
        setStatus("Set Supabase env vars to enable live garden visits.");
      });
      return;
    }

    let cancelled = false;

    async function connect() {
      setConnectionState("connecting");
      setStatus(`Joining ${gardenName}`);

      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const localId = user?.id ?? createGuestId();
        const displayName = createDisplayName(user?.email);
        const savedColor = window.localStorage.getItem("hearthaven:keeper-palette");
        const color = savedColor ?? colors[Math.abs(hashCode(localId)) % colors.length];
        const localPlayer: RealtimeRoomPlayer = {
          id: localId,
          displayName,
          color,
          x: 420,
          y: 430,
          petName: "Casper",
          updatedAt: Date.now(),
        };

        localPlayerRef.current = localPlayer;

        const channel = supabase.channel(`garden:${normalizedGardenId}`, {
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
            .sort((a, b) => a.displayName.localeCompare(b.displayName));

          setPlayers(remotePlayers);
        }

        channel
          .on("presence", { event: "sync" }, syncPresence)
          .on("presence", { event: "join" }, syncPresence)
          .on("presence", { event: "leave" }, syncPresence)
          .on("broadcast", { event: "garden_move" }, ({ payload }) => {
            const player = payload as RealtimeRoomPlayer;
            if (!player?.id || player.id === localId) return;
            setPlayers((current) => upsertPlayer(current, player));
          })
          .on("broadcast", { event: "garden_chat" }, ({ payload }) => {
            const message = payload as GardenChatMessage;
            if (!message?.id || message.playerId === localId) return;
            appendMessage(message);
            window.dispatchEvent(new CustomEvent("hearthaven:garden-chat-bubble", { detail: message }));
          })
          .subscribe(async (state) => {
            if (cancelled) return;
            if (state === "SUBSCRIBED") {
              await channel.track(localPlayer);
              setConnectionState("connected");
              setStatus(`Live in garden ${gardenCode}`);
            } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              setConnectionState("error");
              setStatus("Realtime could not connect. The garden still works locally.");
            } else if (state === "CLOSED") {
              setConnectionState("offline");
              setStatus("Realtime garden closed.");
            }
          });
      } catch (error) {
        setConnectionState("error");
        setStatus(error instanceof Error ? error.message : "Garden Realtime could not start.");
      }
    }

    void connect();

    return () => {
      cancelled = true;
      const channel = channelRef.current;
      if (channel) {
        void getSupabaseBrowserClient().removeChannel(channel);
      }
      channelRef.current = null;
      localPlayerRef.current = null;
      setPlayers([]);
    };
  }, [appendMessage, gardenCode, gardenName, normalizedGardenId]);

  const sendMove = useCallback((position: { x: number; y: number }) => {
    const localPlayer = localPlayerRef.current;
    if (!localPlayer) return;

    const payload: RealtimeRoomPlayer = {
      ...localPlayer,
      x: Math.round(position.x),
      y: Math.round(position.y),
      updatedAt: Date.now(),
    };

    localPlayerRef.current = payload;
    const channel = channelRef.current;
    if (!channel) return;
    void channel.track(payload);
    void channel.send({ type: "broadcast", event: "garden_move", payload });
  }, []);

  const sendChat = useCallback((input: string): ChatModerationResult => {
    const moderation = moderateChatMessage(input);
    if (!moderation.ok) return moderation;

    const localPlayer = localPlayerRef.current;
    const message: GardenChatMessage = {
      id: crypto.randomUUID(),
      playerId: localPlayer?.id ?? createGuestId(),
      displayName: localPlayer?.displayName ?? "Guest Keeper",
      text: moderation.text,
      createdAt: Date.now(),
    };

    appendMessage(message);
    window.dispatchEvent(new CustomEvent("hearthaven:garden-chat-bubble", { detail: message }));

    const channel = channelRef.current;
    if (channel) void channel.send({ type: "broadcast", event: "garden_chat", payload: message });

    return moderation;
  }, [appendMessage]);

  return {
    connectionState,
    gardenCode,
    inviteUrl,
    messages,
    players,
    sendChat,
    sendMove,
    status,
  };
}

function upsertPlayer(players: RealtimeRoomPlayer[], next: RealtimeRoomPlayer) {
  const withoutCurrent = players.filter((player) => player.id !== next.id);
  return [...withoutCurrent, next].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function hashCode(value: string) {
  return value.split("").reduce((hash, char) => (hash << 5) - hash + char.charCodeAt(0), 0);
}
