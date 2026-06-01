"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { moderateChatMessage, type ChatModerationResult, type GardenChatMessage } from "@/lib/game/chat-moderation";
import { hardenIncomingChat, hardenRealtimePlayer, hardenRoomPlacements } from "@/lib/game/realtime-hardening";
import {
  hardenServerRoomSurfaces,
  validateRoomSurfaceIdsForSave,
  type ServerRoomSurfaces,
} from "@/lib/game/room-surfaces";
import type { FacingDirection, RealtimeRoomPlayer, RoomEmote, RoomPlacement } from "@/lib/game/types";
import {
  KEEPER_CUSTOMIZATION_EVENT,
  PET_CUSTOMIZATION_EVENT,
  readPresenceCustomization,
} from "@/lib/game/avatar-customization";
import { recordRoomRealtimeDiagnostic } from "@/lib/game/room-realtime-diagnostics";
import { getSocialState, recordPlayedWith } from "@/lib/game/social";
import { isBlocked, isLocallyQuarantined, readSafetyState, submitReport } from "@/lib/game/safety";
import { getCachedPublicUsername, resolvePublicUsername } from "@/lib/game/public-identity";
import { recordActivity } from "@/lib/game/activity";
import { getPlaceChatMessages, sendPlaceChatMessage } from "@/lib/game/place-chat";

type UseRoomRealtimeOptions = {
  roomId: string;
  roomName: string;
  /** Host friend code owns the persistent room channel across room-to-room navigation. */
  hostFriendCode?: string | null;
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

function parsePlacementHydrationRow(row: unknown) {
  if (!row || typeof row !== "object") return null;
  const r = row as { placements?: unknown; version?: unknown; updated_at?: unknown };
  const versionNumber = Number(r.version);
  return {
    placements: hardenRoomPlacements(r.placements),
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : undefined,
    version: Number.isFinite(versionNumber) ? versionNumber : 1,
  };
}

export type SavePlacementsResult =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict" | "unauthorized" | "network" | "invalid"; serverVersion?: number; message?: string };

export type SaveSurfacesResult = SavePlacementsResult;

export function useRoomRealtime({ roomId, roomName, hostFriendCode }: UseRoomRealtimeOptions) {
  const [players, setPlayers] = useState<RealtimeRoomPlayer[]>([]);
  const [messages, setMessages] = useState<GardenChatMessage[]>([]);
  const [approvedDecoratorCodes, setApprovedDecoratorCodes] = useState<string[]>([]);
  // Server-canonical room layout for the host this channel represents.
  // `placements` is hydrated on connect via `get_room_placements` and kept
  // fresh by `room_placements_updated` broadcasts. `placementsVersion` is
  // the monotonic counter the save RPC enforces for optimistic concurrency.
  // `placementsLoading` is true until the first hydration round-trip
  // completes so UI can defer rendering localStorage fallback for a beat.
  const [placements, setPlacements] = useState<RoomPlacement[] | null>(null);
  const [placementsVersion, setPlacementsVersion] = useState<number>(0);
  const [placementsLoading, setPlacementsLoading] = useState<boolean>(true);
  const placementsVersionRef = useRef<number>(0);
  const [surfaces, setSurfaces] = useState<ServerRoomSurfaces | null>(null);
  const [surfacesVersion, setSurfacesVersion] = useState<number>(0);
  const [surfacesLoading, setSurfacesLoading] = useState<boolean>(true);
  const surfacesVersionRef = useRef<number>(0);
  const [localFriendCode, setLocalFriendCode] = useState(() =>
    typeof window === "undefined" ? "" : getSocialState().selfCode,
  );
  // Pick up friend-code regenerates so the invite URL + visitor-side
  // filters refresh without a reload. Also patch
  // `localPlayerRef.current.friendCode` so the next presence broadcast
  // carries the NEW code — otherwise remote viewers see the old code
  // for a frame, and any read-and-cache on their side captures stale
  // identity.
  useEffect(() => {
    const sync = () => {
      const next = getSocialState().selfCode;
      setLocalFriendCode(next);
      // sendMove + sendEmote merge `latestFriendCodeRef.current` into the
      // next payload, so updating this ref is enough — no need to mutate
      // the larger `localPlayerRef`.
      latestFriendCodeRef.current = next;
    };
    window.addEventListener("hearthaven:friend-code-regenerated", sync);
    return () => window.removeEventListener("hearthaven:friend-code-regenerated", sync);
  }, []);
  const [connectionState, setConnectionState] = useState<ConnectionState>("demo");
  const [status, setStatus] = useState("Solo room mode");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localPlayerRef = useRef<RealtimeRoomPlayer | null>(null);
  const realtimeReadyRef = useRef(false);
  // Latest friend code (refreshed on regen) — merged into broadcast
  // payloads so the next presence tick carries the new code without us
  // having to mutate the larger localPlayerRef.
  const latestFriendCodeRef = useRef<string>("");
  const lastFriendPointAtRef = useRef(0);
  const normalizedRoomId = useMemo(() => normalizeRoomId(roomId), [roomId]);
  const normalizedRoomIdRef = useRef(normalizedRoomId);
  useEffect(() => {
    normalizedRoomIdRef.current = normalizedRoomId;
  }, [normalizedRoomId]);
  const normalizedHostCode = useMemo(
    () => normalizeFriendCode(hostFriendCode || localFriendCode || getSocialState().selfCode),
    [hostFriendCode, localFriendCode],
  );
  const channelKey = useMemo(() => normalizedHostCode || normalizedRoomId, [normalizedHostCode, normalizedRoomId]);

  const inviteUrl = useMemo(() => {
    if (typeof window === "undefined") return `/app/area?zone=room&room=${normalizedRoomId}`;
    const url = new URL("/app/area", window.location.origin);
    url.searchParams.set("zone", "room");
    url.searchParams.set("room", normalizedRoomId);
    // Pull from the stateful friend-code state, not a fresh read, so the
    // URL refreshes when the keeper regenerates their friend code.
    url.searchParams.set("visit", localFriendCode || getSocialState().selfCode);
    return url.toString();
  }, [normalizedRoomId, localFriendCode]);

  const roomCode = useMemo(() => channelKey.toUpperCase(), [channelKey]);

  const appendMessage = useCallback((message: GardenChatMessage) => {
    setMessages((current) => [message, ...current.filter((entry) => entry.id !== message.id)].slice(0, 24));
  }, []);
  const mergeMessages = useCallback((incoming: GardenChatMessage[]) => {
    setMessages((current) => {
      const byId = new Map<string, GardenChatMessage>();
      for (const message of [...incoming, ...current]) {
        byId.set(message.id, message);
      }
      return Array.from(byId.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 24);
    });
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
          roomId: normalizedRoomId,
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
    let customizationPoll: number | null = null;
    let heartbeatTimer: number | null = null;
    let placementPollTimer: number | null = null;
    let chatPollTimer: number | null = null;

    async function connect() {
      setConnectionState("connecting");
      setStatus(`Joining ${roomName} multiplayer`);
      recordRoomRealtimeDiagnostic({
        resolvedRoomHostCode: channelKey,
        roomChannelName: `room:${channelKey}`,
        roomConnectionState: "connecting",
        roomId: normalizedRoomId,
        roomPlacementVersion: placementsVersionRef.current,
      });

      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const localId = user?.id ?? createGuestId();
        const displayName = await resolvePublicUsername(user);
        const social = getSocialState();
        setLocalFriendCode(social.selfCode);
        latestFriendCodeRef.current = social.selfCode;

        // Full customization snapshot — keeper palette + outfit, pet species +
        // fur tone + accessory — so remote keepers see the real avatar/pet.
        const localPlayer: RealtimeRoomPlayer = {
          id: localId,
          displayName,
          friendCode: social.selfCode,
          roomId: normalizedRoomId,
          ...readPresenceCustomization(),
          facing: "right",
          x: 390,
          y: 374,
          updatedAt: Date.now(),
        };

        localPlayerRef.current = localPlayer;

        const channel = supabase.channel(`room:${channelKey}`, {
          config: {
            broadcast: { self: false },
            presence: { key: localId },
          },
        });

        channelRef.current = channel;
        realtimeReadyRef.current = false;

        async function refreshRoomChat() {
          try {
            const recent = await getPlaceChatMessages({
              placeType: "room",
              hostFriendCode: channelKey,
              placeId: normalizedRoomId,
              limit: 30,
            });
            if (!cancelled && recent.length > 0) mergeMessages(recent);
          } catch {
            /* Chat history falls back to live broadcast until the migration is applied. */
          }
        }

        async function publishLocalPresence() {
          const current = localPlayerRef.current;
          if (!current) return;
          const next: RealtimeRoomPlayer = {
            ...current,
            displayName: getCachedPublicUsername(),
            friendCode: getSocialState().selfCode,
            roomId: normalizedRoomIdRef.current,
            ...readPresenceCustomization(),
            updatedAt: Date.now(),
          };
          localPlayerRef.current = next;
          latestFriendCodeRef.current = next.friendCode ?? "";
          await channel.track(next);
          void channel.send({ type: "broadcast", event: "avatar_move", payload: next });
        }

        async function refreshRoomPlacements(source: "hydrate" | "poll") {
          const { data, error } = await supabase.rpc("get_room_placements", {
            p_host_friend_code: channelKey,
            p_room_id: normalizedRoomId,
          });
          if (error) {
            recordRoomRealtimeDiagnostic({
              lastRealtimeError: error.message,
              resolvedRoomHostCode: channelKey,
              roomChannelName: `room:${channelKey}`,
              roomId: normalizedRoomId,
            });
            return null;
          }
          const row = Array.isArray(data) ? data[0] : null;
          const parsed = parsePlacementHydrationRow(row);
          if (!parsed) return null;
          if (!cancelled && (source === "hydrate" || parsed.version > placementsVersionRef.current)) {
            setPlacements(parsed.placements);
            setPlacementsVersion(parsed.version);
            placementsVersionRef.current = parsed.version;
          }
          if (!cancelled) {
            recordRoomRealtimeDiagnostic({
              lastPlacementPollAt: source === "poll" ? new Date().toISOString() : undefined,
              resolvedRoomHostCode: channelKey,
              roomChannelName: `room:${channelKey}`,
              roomId: normalizedRoomId,
              roomPlacementVersion: placementsVersionRef.current,
            });
          }
          return parsed;
        }

        function syncPresence() {
          const state = channel.presenceState<RealtimeRoomPlayer>();
          // Every realtime payload is untrusted — clamp coords, scrub
          // display names, drop ones missing required fields. Then filter
          // out self + blocked.
          const remotePlayers = Object.values(state)
            .flat()
            .map((player) => hardenRealtimePlayer(player))
            .filter((player): player is RealtimeRoomPlayer => Boolean(player))
            .filter((player) => player.id !== localId)
            .filter((player) => !player.roomId || player.roomId === normalizedRoomId)
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
          recordRoomRealtimeDiagnostic({
            presenceCount: remotePlayers.length + 1,
            remoteCompanionCount: remotePlayers.filter((player) => Boolean(player.petSpeciesId)).length,
            remotePlayerCount: remotePlayers.length,
            resolvedRoomHostCode: channelKey,
            roomChannelName: `room:${channelKey}`,
            roomConnectionState: "connected",
            roomId: normalizedRoomId,
            roomPlacementVersion: placementsVersionRef.current,
          });
        }

        // --- Hydrate server-canonical room state ----------------------
        // Pull the host's saved layout + the host's approved-decorator list
        // BEFORE we subscribe — that way the first paint we hand to the
        // canvas is the real state, not stale localStorage. The two RPCs
        // are independent so we fire them in parallel.
        setPlacementsLoading(true);
        setSurfacesLoading(true);
        const hydration = await Promise.all([
          refreshRoomPlacements("hydrate"),
          supabase.rpc("get_room_decorators", {
            p_host_friend_code: channelKey,
            p_room_id: normalizedRoomId,
          }),
          supabase.rpc("get_room_surfaces", {
            p_host_friend_code: channelKey,
            p_room_id: normalizedRoomId,
          }),
        ]);
        if (cancelled) return;

        if (!hydration[0]) {
          // No row yet — the host hasn't saved anything to the server. We
          // leave `placements` as null so the caller (room-client) knows
          // to fall back to its cozy default + localStorage. Version 0
          // means "this room has never been persisted" and a fresh save
          // will create it.
          setPlacements(null);
          setPlacementsVersion(0);
          placementsVersionRef.current = 0;
        }
        setPlacementsLoading(false);

        const surfacesRow = Array.isArray(hydration[2].data) ? hydration[2].data[0] : null;
        if (surfacesRow) {
          const safe = hardenServerRoomSurfaces(surfacesRow as { floor_id?: string; wall_id?: string });
          if (safe) {
            setSurfaces(safe);
            const versionNumber = Number((surfacesRow as { version?: number }).version);
            const safeVersion = Number.isFinite(versionNumber) ? versionNumber : 1;
            setSurfacesVersion(safeVersion);
            surfacesVersionRef.current = safeVersion;
          }
        } else {
          setSurfaces(null);
          setSurfacesVersion(0);
          surfacesVersionRef.current = 0;
        }
        setSurfacesLoading(false);

        const grantsData = Array.isArray(hydration[1].data) ? hydration[1].data : [];
        const hydratedGrants = grantsData
          .map((row) => normalizeFriendCode(String((row as { grantee_friend_code?: string })?.grantee_friend_code ?? "")))
          .filter((code) => code.length > 0);
        setApprovedDecoratorCodes(Array.from(new Set(hydratedGrants)));

        channel
          .on("presence", { event: "sync" }, syncPresence)
          .on("presence", { event: "join" }, syncPresence)
          .on("presence", { event: "leave" }, syncPresence)
          .on("broadcast", { event: "room_surfaces_updated" }, ({ payload }) => {
            const versionNumber = Number((payload as { version?: number })?.version);
            if (!Number.isFinite(versionNumber)) return;
            if (versionNumber <= surfacesVersionRef.current) return;
            const floorId = String((payload as { floorId?: string })?.floorId ?? "");
            const wallId = String((payload as { wallId?: string })?.wallId ?? "");
            const safe = hardenServerRoomSurfaces({ floor_id: floorId, wall_id: wallId });
            if (!safe) return;
            surfacesVersionRef.current = versionNumber;
            setSurfacesVersion(versionNumber);
            setSurfaces(safe);
          })
          .on("broadcast", { event: "room_placements_updated" }, ({ payload }) => {
            // Delta from another participant's save_room_placements. The
            // payload carries the new placements + version, so we apply
            // if the version is newer than what we know. Older or equal
            // versions are dropped (we already have at-least-as-fresh).
            const versionNumber = Number((payload as { version?: number })?.version);
            if (!Number.isFinite(versionNumber)) return;
            if (versionNumber <= placementsVersionRef.current) return;
            const safe = hardenRoomPlacements((payload as { placements?: unknown })?.placements);
            placementsVersionRef.current = versionNumber;
            setPlacementsVersion(versionNumber);
            setPlacements(safe);
            recordRoomRealtimeDiagnostic({
              lastPlacementBroadcastAt: new Date().toISOString(),
              resolvedRoomHostCode: channelKey,
              roomChannelName: `room:${channelKey}`,
              roomId: normalizedRoomId,
              roomPlacementVersion: versionNumber,
            });
          })
          .on("broadcast", { event: "avatar_move" }, ({ payload }) => {
            const player = hardenRealtimePlayer(payload);
            if (!player || player.id === localId) return;
            if (player.roomId && player.roomId !== normalizedRoomId) return;
            if (player.friendCode && isBlocked(player.friendCode)) return;
            if (player.friendCode) {
              recordPlayedWith({ code: player.friendCode, displayName: player.displayName, context: roomName });
            }
            setPlayers((current) => {
              const next = upsertPlayer(current, player);
              recordRoomRealtimeDiagnostic({
                remoteCompanionCount: next.filter((entry) => Boolean(entry.petSpeciesId)).length,
                remotePlayerCount: next.length,
                resolvedRoomHostCode: channelKey,
                roomChannelName: `room:${channelKey}`,
                roomConnectionState: "connected",
                roomId: normalizedRoomId,
                roomPlacementVersion: placementsVersionRef.current,
              });
              return next;
            });
          })
          .on("broadcast", { event: "room_emote" }, ({ payload }) => {
            const player = hardenRealtimePlayer(payload);
            if (!player || player.id === localId) return;
            if (player.roomId && player.roomId !== normalizedRoomId) return;
            if (player.friendCode && isBlocked(player.friendCode)) return;
            if (player.friendCode) {
              recordPlayedWith({ code: player.friendCode, displayName: player.displayName, context: roomName });
            }
            setPlayers((current) => {
              const next = upsertPlayer(current, player);
              recordRoomRealtimeDiagnostic({
                remoteCompanionCount: next.filter((entry) => Boolean(entry.petSpeciesId)).length,
                remotePlayerCount: next.length,
                resolvedRoomHostCode: channelKey,
                roomChannelName: `room:${channelKey}`,
                roomConnectionState: "connected",
                roomId: normalizedRoomId,
                roomPlacementVersion: placementsVersionRef.current,
              });
              return next;
            });
            window.dispatchEvent(new CustomEvent("hearthaven:remote-emote", { detail: player }));
          })
          .on("broadcast", { event: "room_chat" }, ({ payload }) => {
            const message = hardenIncomingChat(payload);
            if (!message || message.playerId === localId) return;
            if (message.roomId && message.roomId !== normalizedRoomId) return;
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
              realtimeReadyRef.current = true;
              await publishLocalPresence();
              void refreshRoomChat();
              if (heartbeatTimer) window.clearInterval(heartbeatTimer);
              heartbeatTimer = window.setInterval(() => void publishLocalPresence(), 2000);
              if (placementPollTimer) window.clearInterval(placementPollTimer);
              placementPollTimer = window.setInterval(() => void refreshRoomPlacements("poll"), 1200);
              if (chatPollTimer) window.clearInterval(chatPollTimer);
              chatPollTimer = window.setInterval(() => void refreshRoomChat(), 3000);
              setConnectionState("connected");
              setStatus(`Live in room ${roomCode}`);
              recordRoomRealtimeDiagnostic({
                resolvedRoomHostCode: channelKey,
                roomChannelName: `room:${channelKey}`,
                roomConnectionState: "connected",
                roomId: normalizedRoomId,
                roomPlacementVersion: placementsVersionRef.current,
              });
            } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              realtimeReadyRef.current = false;
              setConnectionState("error");
              setStatus("Online room visits could not connect. The room still works.");
              recordRoomRealtimeDiagnostic({
                lastRealtimeError: state,
                resolvedRoomHostCode: channelKey,
                roomChannelName: `room:${channelKey}`,
                roomConnectionState: "error",
                roomId: normalizedRoomId,
              });
            } else if (state === "CLOSED") {
              realtimeReadyRef.current = false;
              setConnectionState("offline");
              setStatus("Room visit connection closed.");
              recordRoomRealtimeDiagnostic({
                resolvedRoomHostCode: channelKey,
                roomChannelName: `room:${channelKey}`,
                roomConnectionState: "offline",
                roomId: normalizedRoomId,
              });
            }
          });

        // Re-broadcast presence whenever the keeper or pet customization
        // changes (e.g. from the Account customizer) so anyone sharing the
        // room sees the new outfit / fur tone live, without a reload.
        let lastCustomizationSignature = JSON.stringify(readPresenceCustomization());
        const rebroadcastCustomization = () => {
          const current = localPlayerRef.current;
          if (!current) return;
          lastCustomizationSignature = JSON.stringify(readPresenceCustomization());
          const payload: RealtimeRoomPlayer = {
            ...current,
            displayName: getCachedPublicUsername(),
            friendCode: getSocialState().selfCode,
            roomId: normalizedRoomIdRef.current,
            ...readPresenceCustomization(),
            updatedAt: Date.now(),
          };
          localPlayerRef.current = payload;
          void channel.track(payload);
          void channel.send({ type: "broadcast", event: "avatar_move", payload });
        };
        window.addEventListener(KEEPER_CUSTOMIZATION_EVENT, rebroadcastCustomization);
        window.addEventListener(PET_CUSTOMIZATION_EVENT, rebroadcastCustomization);
        // Username changes need the same treatment — otherwise other
        // visitors keep seeing the keeper's old display name above their
        // sprite until they reload.
        window.addEventListener("hearthaven:public-username-changed", rebroadcastCustomization);
        customizationPoll = window.setInterval(() => {
          const nextSignature = JSON.stringify(readPresenceCustomization());
          if (nextSignature === lastCustomizationSignature) return;
          rebroadcastCustomization();
        }, 1000);
        customizationCleanup = () => {
          window.removeEventListener(KEEPER_CUSTOMIZATION_EVENT, rebroadcastCustomization);
          window.removeEventListener(PET_CUSTOMIZATION_EVENT, rebroadcastCustomization);
          window.removeEventListener("hearthaven:public-username-changed", rebroadcastCustomization);
          if (customizationPoll) window.clearInterval(customizationPoll);
          customizationPoll = null;
        };
      } catch (error) {
        setConnectionState("error");
        setStatus(error instanceof Error ? error.message : "Online room visits could not start.");
        recordRoomRealtimeDiagnostic({
          lastRealtimeError: error instanceof Error ? error.message : "Online room visits could not start.",
          resolvedRoomHostCode: channelKey,
          roomChannelName: `room:${channelKey}`,
          roomConnectionState: "error",
          roomId: normalizedRoomId,
        });
      }
    }

    void connect();

    return () => {
      cancelled = true;
      customizationCleanup?.();
      customizationCleanup = null;
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (placementPollTimer) window.clearInterval(placementPollTimer);
      placementPollTimer = null;
      if (chatPollTimer) window.clearInterval(chatPollTimer);
      chatPollTimer = null;
      const channel = channelRef.current;
      if (channel) {
        void getSupabaseBrowserClient().removeChannel(channel);
      }
      channelRef.current = null;
      realtimeReadyRef.current = false;
      localPlayerRef.current = null;
      setPlayers([]);
    };
  }, [appendMessage, channelKey, mergeMessages, normalizedRoomId, roomCode, roomName]);

  const sendMove = useCallback((position: {
    x: number;
    y: number;
    facing?: FacingDirection;
    petX?: number;
    petY?: number;
    petFacing?: FacingDirection;
    controlMode?: "keeper" | "companion";
  }) => {
    const channel = channelRef.current;
    const localPlayer = localPlayerRef.current;
    if (!channel || !localPlayer) return;

    const payload: RealtimeRoomPlayer = {
      ...localPlayer,
      friendCode: latestFriendCodeRef.current || localPlayer.friendCode,
      roomId: normalizedRoomIdRef.current,
      x: Math.round(position.x),
      y: Math.round(position.y),
      facing: position.facing ?? localPlayer.facing,
      petX: position.petX === undefined ? localPlayer.petX : Math.round(position.petX),
      petY: position.petY === undefined ? localPlayer.petY : Math.round(position.petY),
      petFacing: position.petFacing ?? localPlayer.petFacing,
      controlMode: position.controlMode ?? localPlayer.controlMode ?? "keeper",
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
      roomId: normalizedRoomIdRef.current,
      emote,
      updatedAt: Date.now(),
    };

    localPlayerRef.current = payload;
    void channel.track(payload);
    void channel.send({ type: "broadcast", event: "room_emote", payload });
  }, []);

  const toggleDecoratorPermission = useCallback(async (friendCode: string) => {
    const normalized = normalizeFriendCode(friendCode);
    if (!normalized) return;

    // Optimistically flip locally so the host's UI feels snappy. If the
    // server rejects (e.g. the friend code isn't registered yet) we'll
    // revert via the next hydration on reconnect — the RPC errors out
    // before any audit row is written.
    let nextList: string[] = approvedDecoratorCodes;
    setApprovedDecoratorCodes((current) => {
      nextList = current.includes(normalized)
        ? current.filter((code) => code !== normalized)
        : [...current, normalized];
      return nextList;
    });
    const grant = nextList.includes(normalized);

    // Persist via RPC. Only the host's session has authority — the RPC
    // gates on auth.uid() so a guest invoking this is rejected.
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase.rpc("set_room_decorator", {
          p_room_id: normalizedRoomId,
          p_grantee_friend_code: normalized,
          p_grant: grant,
        });
      } catch {
        /* fall through — broadcast still keeps other clients in sync */
      }
    }

    // Broadcast a courtesy event so other clients on the same channel
    // update without waiting for a re-hydration. The server table is
    // authoritative; this is only a freshness booster.
    const channel = channelRef.current;
    if (channel) {
      void channel.send({
        type: "broadcast",
        event: "room_decorator_permissions",
        payload: {
          approvedCodes: nextList,
          hostCode: getSocialState().selfCode,
          updatedAt: Date.now(),
        },
      });
    }
  }, [approvedDecoratorCodes, normalizedRoomId]);

  /**
   * Persist a new placement list to the server + broadcast the delta to
   * every other participant on this channel. Returns a structured result
   * so the caller can surface conflict UI without throwing.
   *
   * Concurrency model — every save sends the version the caller thinks
   * they're editing. The RPC rejects if the server has moved on. The
   * caller is expected to re-hydrate from `placements` on conflict and
   * re-attempt with the new version.
   */
  const savePlacements = useCallback(
    async (nextPlacements: RoomPlacement[]): Promise<SavePlacementsResult> => {
      if (!isSupabaseConfigured()) {
        return { ok: false, reason: "network", message: "Online room sync is not configured." };
      }
      const safe = hardenRoomPlacements(nextPlacements);
      const expected = placementsVersionRef.current;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("save_room_placements", {
          p_host_friend_code: channelKey,
          p_room_id: normalizedRoomId,
          p_placements: safe,
          p_expected_version: expected,
        });
        if (error) {
          const message = error.message ?? "Could not save room layout.";
          // Server says the caller isn't allowed. Surface a clean reason.
          if (/not authorized/i.test(message)) {
            return { ok: false, reason: "unauthorized", message };
          }
          if (/too many|invalid|must be a json array/i.test(message)) {
            return { ok: false, reason: "invalid", message };
          }
          return { ok: false, reason: "network", message };
        }
        const row = Array.isArray(data) ? data[0] : null;
        if (!row) {
          return { ok: false, reason: "network", message: "Empty response from server." };
        }
        if (row.conflict) {
          const sv = Number(row.version);
          return { ok: false, reason: "conflict", serverVersion: Number.isFinite(sv) ? sv : undefined };
        }
        const newVersion = Number(row.version);
        const safeVersion = Number.isFinite(newVersion) ? newVersion : expected + 1;
        placementsVersionRef.current = safeVersion;
        setPlacementsVersion(safeVersion);
        setPlacements(safe);

        // Broadcast the delta so other participants on the same channel
        // pick up the new layout immediately instead of waiting for a
        // refresh-driven re-hydration.
        const channel = channelRef.current;
        if (channel) {
          void channel.send({
            type: "broadcast",
            event: "room_placements_updated",
            payload: { placements: safe, version: safeVersion, updatedAt: Date.now() },
          });
        }
        return { ok: true, version: safeVersion };
      } catch (error) {
        return {
          ok: false,
          reason: "network",
          message: error instanceof Error ? error.message : "Network error.",
        };
      }
    },
    [channelKey, normalizedRoomId],
  );

  const saveSurfaces = useCallback(
    async (floorId: string, wallId: string): Promise<SaveSurfacesResult> => {
      if (!isSupabaseConfigured()) {
        return { ok: false, reason: "network", message: "Online room sync is not configured." };
      }

      const validated = validateRoomSurfaceIdsForSave(floorId, wallId);
      if (!validated.ok) {
        return { ok: false, reason: "network", message: validated.message };
      }

      const expected = surfacesVersionRef.current;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("save_room_surfaces", {
          p_host_friend_code: channelKey,
          p_room_id: normalizedRoomId,
          p_floor_id: validated.floorId,
          p_wall_id: validated.wallId,
          p_expected_version: expected,
        });
        if (error) {
          const message = error.message ?? "Could not save room surfaces.";
          if (/not authorized/i.test(message)) return { ok: false, reason: "unauthorized", message };
          if (/surface id/i.test(message)) return { ok: false, reason: "network", message };
          return { ok: false, reason: "network", message };
        }
        const row = Array.isArray(data) ? data[0] : null;
        if (!row) return { ok: false, reason: "network", message: "Empty response from server." };
        if (row.conflict) {
          const sv = Number(row.version);
          return { ok: false, reason: "conflict", serverVersion: Number.isFinite(sv) ? sv : undefined };
        }
        const newVersion = Number(row.version);
        const safeVersion = Number.isFinite(newVersion) ? newVersion : expected + 1;
        const safe = { floorId: validated.floorId, wallId: validated.wallId };
        surfacesVersionRef.current = safeVersion;
        setSurfacesVersion(safeVersion);
        setSurfaces(safe);
        const channel = channelRef.current;
        if (channel) {
          void channel.send({
            type: "broadcast",
            event: "room_surfaces_updated",
            payload: {
              floorId: validated.floorId,
              wallId: validated.wallId,
              version: safeVersion,
              updatedAt: Date.now(),
            },
          });
        }
        return { ok: true, version: safeVersion };
      } catch (error) {
        return {
          ok: false,
          reason: "network",
          message: error instanceof Error ? error.message : "Network error.",
        };
      }
    },
    [channelKey, normalizedRoomId],
  );

  const sendChat = useCallback(async (input: string): Promise<ChatModerationResult> => {
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

    const channel = channelRef.current;
    if (isSupabaseConfigured() && (!channel || !realtimeReadyRef.current)) {
      return {
        ok: false,
        severity: "soft-block",
        reason: "Room chat is reconnecting. Try again in a moment.",
      };
    }

    const localPlayer = localPlayerRef.current;
    const social = getSocialState();
    let message: GardenChatMessage = {
      id: crypto.randomUUID(),
      playerId: localPlayer?.id ?? createGuestId(),
      displayName: localPlayer?.displayName ?? getCachedPublicUsername(),
      friendCode: social.selfCode,
      roomId: normalizedRoomIdRef.current,
      text: moderation.text,
      createdAt: Date.now(),
    };

    if (isSupabaseConfigured()) {
      try {
        const savedMessage = await sendPlaceChatMessage({
          placeType: "room",
          hostFriendCode: channelKey,
          placeId: normalizedRoomIdRef.current,
          body: moderation.text,
        });
        if (savedMessage) {
          message = savedMessage;
        }
      } catch (error) {
        return {
          ok: false,
          severity: "soft-block",
          reason: error instanceof Error ? error.message : "Room chat could not sync.",
        };
      }
    }

    appendMessage(message);
    window.dispatchEvent(new CustomEvent("hearthaven:room-chat-bubble", { detail: message }));

    if (channel) void channel.send({ type: "broadcast", event: "room_chat", payload: message });

    return moderation;
  }, [appendMessage, channelKey]);

  return {
    approvedDecoratorCodes,
    connectionState,
    inviteUrl,
    localFriendCode,
    messages,
    players,
    placements,
    placementsVersion,
    placementsLoading,
    roomCode,
    savePlacements,
    saveSurfaces,
    surfaces,
    surfacesLoading,
    surfacesVersion,
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
