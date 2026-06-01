"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { moderateChatMessage, type ChatModerationResult, type GardenChatMessage } from "@/lib/game/chat-moderation";
import {
  hardenGardenDecor,
  hardenIncomingChat,
  hardenRealtimePlayer,
  type HardenedGardenDecor,
} from "@/lib/game/realtime-hardening";
import type { FacingDirection, RealtimeRoomPlayer } from "@/lib/game/types";
import {
  KEEPER_CUSTOMIZATION_EVENT,
  PET_CUSTOMIZATION_EVENT,
  readPresenceCustomization,
} from "@/lib/game/avatar-customization";
import { getSocialState, recordPlayedWith } from "@/lib/game/social";
import { recordActivity } from "@/lib/game/activity";
import {
  isBlocked,
  isLocallyQuarantined,
  readSafetyState,
  submitReport,
} from "@/lib/game/safety";
import { getCachedPublicUsername, resolvePublicUsername } from "@/lib/game/public-identity";
import { hardenGardenPlots, type GardenPlotState } from "@/lib/game/garden-plots";
import { getPlaceChatMessages, sendPlaceChatMessage, type PlaceChatType } from "@/lib/game/place-chat";

type UseGardenRealtimeOptions = {
  gardenId: string;
  gardenName: string;
  invitePath?: "/app/garden" | "/app/partner-garden" | "/app/park" | "/app/area";
  inviteZone?: "garden" | "park";
  /** Host friend code that owns the canonical decor + grants for this
   *  garden. When unset (guest is browsing their own garden) we fall back
   *  to the local keeper's friend code. The channel key includes this so
   *  two users visiting the same host meet on the same channel, while two
   *  users in their *own* default-named gardens stay isolated. */
  hostFriendCode?: string | null;
};

export type SaveDecorResult =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict" | "unauthorized" | "network" | "invalid"; serverVersion?: number; message?: string };

export type SavePlotsResult = SaveDecorResult;

type ConnectionState = "demo" | "connecting" | "connected" | "offline" | "error";

function createGuestId() {
  if (typeof window === "undefined") return "guest-server";
  const existing = window.localStorage.getItem("hearthaven:guest-player-id");
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem("hearthaven:guest-player-id", next);
  return next;
}

function normalizeGardenId(gardenId: string) {
  return gardenId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "caspers-moonberry-beds";
}

function normalizeFriendCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

export function useGardenRealtime({
  gardenId,
  gardenName,
  invitePath = "/app/garden",
  inviteZone,
  hostFriendCode,
}: UseGardenRealtimeOptions) {
  const [players, setPlayers] = useState<RealtimeRoomPlayer[]>([]);
  const [messages, setMessages] = useState<GardenChatMessage[]>([]);
  const [approvedDecoratorCodes, setApprovedDecoratorCodes] = useState<string[]>([]);
  // Server-canonical decor for the host that owns this garden. Hydrated
  // via `get_garden_decor` on connect; refreshed via `garden_decor_updated`
  // broadcasts; written via `saveDecor` (which calls the save_garden_decor
  // RPC). See the room hook for the same pattern + comments.
  const [decor, setDecor] = useState<HardenedGardenDecor[] | null>(null);
  const [decorVersion, setDecorVersion] = useState<number>(0);
  const [decorLoading, setDecorLoading] = useState<boolean>(true);
  const decorVersionRef = useRef<number>(0);
  const [plots, setPlots] = useState<GardenPlotState[] | null>(null);
  const [plotsVersion, setPlotsVersion] = useState<number>(0);
  const [plotsLoading, setPlotsLoading] = useState<boolean>(true);
  const plotsVersionRef = useRef<number>(0);
  const [localFriendCode, setLocalFriendCode] = useState(() =>
    typeof window === "undefined" ? "" : getSocialState().selfCode,
  );
  // Refresh local friend code state on regenerate so the invite URL +
  // any local filters that depend on it update without a reload. Also
  // patch `localPlayerRef.current.friendCode` immediately — without
  // this, the next broadcast carries the OLD code for 1–2 frames and
  // remote visitors briefly see (and could even record) the stale
  // identity.
  useEffect(() => {
    const sync = () => {
      const next = getSocialState().selfCode;
      setLocalFriendCode(next);
      // The broadcast helpers below read `latestFriendCodeRef.current`
      // when assembling the payload, so updating this ref is sufficient —
      // we don't need to (and can't, under the immutability rule) write
      // back into the larger `localPlayerRef`.
      latestFriendCodeRef.current = next;
    };
    window.addEventListener("hearthaven:friend-code-regenerated", sync);
    return () => window.removeEventListener("hearthaven:friend-code-regenerated", sync);
  }, []);
  const [connectionState, setConnectionState] = useState<ConnectionState>("demo");
  const [status, setStatus] = useState("Solo garden mode");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localPlayerRef = useRef<RealtimeRoomPlayer | null>(null);
  const realtimeReadyRef = useRef(false);
  // Holds the freshest friend code so the broadcast tick picks it up
  // without us having to write back into `localPlayerRef.current` (which
  // tripped the react-hooks/immutability rule because of cascade).
  const latestFriendCodeRef = useRef<string>("");
  const lastFriendPointAtRef = useRef(0);
  const normalizedGardenId = useMemo(() => normalizeGardenId(gardenId), [gardenId]);
  // Resolve the host code up-front so the channel + RPC reads are
  // (host, garden)-scoped. When a guest follows a ?visit= link we honour
  // their target; otherwise we own this garden ourselves.
  const normalizedHostCode = useMemo(
    () => normalizeFriendCode(hostFriendCode ?? (localFriendCode || getSocialState().selfCode)),
    [hostFriendCode, localFriendCode],
  );
  // Channel topic = `garden:<hostCode>.<gardenId>`. We deliberately use `.`
  // as the inner separator, NOT `:`. Supabase Realtime parses multi-colon
  // topic names as postgres_changes subscriptions (the canonical form is
  // `realtime:<schema>:<table>:<filter>`), so a topic like
  // `garden:HH-XXXXX-NNN:caspers-moonberry-beds` gets misinterpreted and
  // the subscribe call closes immediately — which is what was producing
  // the "Garden visit connection closed" status on every load.
  //
  // Neither friend codes (regex `[^A-Z0-9-]` stripped) nor garden ids
  // (regex `[^a-zA-Z0-9_-]` stripped) can contain a dot, so the separator
  // is unambiguous.
  const channelKey = useMemo(
    () => `${normalizedHostCode || "anon"}.${normalizedGardenId}`,
    [normalizedHostCode, normalizedGardenId],
  );
  const placeChatType: PlaceChatType = useMemo(() => {
    if (inviteZone === "park" || invitePath === "/app/park") return "park";
    if (invitePath === "/app/partner-garden") return "partner-garden";
    return "garden";
  }, [invitePath, inviteZone]);

  const inviteUrl = useMemo(() => {
    if (typeof window === "undefined") {
      const zoneQuery = invitePath === "/app/area" && inviteZone ? `zone=${inviteZone}&` : "";
      return `${invitePath}?${zoneQuery}garden=${normalizedGardenId}`;
    }
    const url = new URL(invitePath, window.location.origin);
    if (invitePath === "/app/area" && inviteZone) url.searchParams.set("zone", inviteZone);
    url.searchParams.set("garden", normalizedGardenId);
    // Use the stateful `localFriendCode` (not a fresh `getSocialState()`
    // read) so the URL refreshes automatically when the keeper regenerates
    // their friend code on the Account page.
    url.searchParams.set("visit", localFriendCode || getSocialState().selfCode);
    return url.toString();
  }, [invitePath, inviteZone, normalizedGardenId, localFriendCode]);

  const gardenCode = useMemo(() => normalizedGardenId.toUpperCase(), [normalizedGardenId]);

  const appendMessage = useCallback((message: GardenChatMessage) => {
    setMessages((current) => [message, ...current.filter((entry) => entry.id !== message.id)].slice(0, 20));
  }, []);
  const mergeMessages = useCallback((incoming: GardenChatMessage[]) => {
    setMessages((current) => {
      const byId = new Map<string, GardenChatMessage>();
      for (const message of [...incoming, ...current]) {
        byId.set(message.id, message);
      }
      return Array.from(byId.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20);
    });
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      queueMicrotask(() => {
        const guestId = createGuestId();
        const social = getSocialState();
        const username = getCachedPublicUsername();
        setLocalFriendCode(social.selfCode);
        localPlayerRef.current = {
          id: guestId,
          displayName: username,
          friendCode: social.selfCode,
          ...readPresenceCustomization(),
          facing: "right",
          x: 420,
          y: 430,
          updatedAt: Date.now(),
        };
        setConnectionState("demo");
        setStatus("Online garden visits are not available in this build yet.");
      });
      return;
    }

    let cancelled = false;
    let customizationCleanup: (() => void) | null = null;
    let chatPollTimer: number | null = null;
    let decorPollTimer: number | null = null;
    let plotsPollTimer: number | null = null;

    async function connect() {
      setConnectionState("connecting");
      setStatus(`Joining ${gardenName}`);

      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const localId = user?.id ?? createGuestId();
        const displayName = await resolvePublicUsername(user);
        const social = getSocialState();
        setLocalFriendCode(social.selfCode);
        const localPlayer: RealtimeRoomPlayer = {
          id: localId,
          displayName,
          friendCode: social.selfCode,
          ...readPresenceCustomization(),
          facing: "right",
          x: 420,
          y: 430,
          updatedAt: Date.now(),
        };

        localPlayerRef.current = localPlayer;

        const channel = supabase.channel(`garden:${channelKey}`, {
          config: {
            broadcast: { self: false },
            presence: { key: localId },
          },
        });

        channelRef.current = channel;
        realtimeReadyRef.current = false;

        async function refreshGardenChat() {
          try {
            const recent = await getPlaceChatMessages({
              placeType: placeChatType,
              hostFriendCode: normalizedHostCode,
              placeId: normalizedGardenId,
              limit: 30,
            });
            if (!cancelled && recent.length > 0) mergeMessages(recent);
          } catch {
            /* Chat history falls back to live broadcast until the migration is applied. */
          }
        }

        async function refreshGardenDecor(source: "hydrate" | "poll") {
          const { data } = await supabase.rpc("get_garden_decor", {
            p_host_friend_code: normalizedHostCode,
            p_garden_id: normalizedGardenId,
          });
          const row = Array.isArray(data) ? data[0] : null;
          if (!row) return null;
          const safe = hardenGardenDecor((row as { decor?: unknown }).decor);
          const versionNumber = Number((row as { version?: number }).version);
          const safeVersion = Number.isFinite(versionNumber) ? versionNumber : 1;
          if (!cancelled && (source === "hydrate" || safeVersion > decorVersionRef.current)) {
            setDecor(safe);
            setDecorVersion(safeVersion);
            decorVersionRef.current = safeVersion;
          }
          return { decor: safe, version: safeVersion };
        }

        async function refreshGardenPlots(source: "hydrate" | "poll") {
          const { data } = await supabase.rpc("get_garden_plots", {
            p_host_friend_code: normalizedHostCode,
            p_garden_id: normalizedGardenId,
          });
          const row = Array.isArray(data) ? data[0] : null;
          if (!row) return null;
          const safe = hardenGardenPlots((row as { plots?: unknown }).plots);
          const versionNumber = Number((row as { version?: number }).version);
          const safeVersion = Number.isFinite(versionNumber) ? versionNumber : 1;
          if (!cancelled && (source === "hydrate" || safeVersion > plotsVersionRef.current)) {
            setPlots(safe);
            setPlotsVersion(safeVersion);
            plotsVersionRef.current = safeVersion;
          }
          return { plots: safe, version: safeVersion };
        }

        function startFallbackPollers() {
          if (!decorPollTimer) {
            decorPollTimer = window.setInterval(() => void refreshGardenDecor("poll"), 1200);
          }
          if (!plotsPollTimer) {
            plotsPollTimer = window.setInterval(() => void refreshGardenPlots("poll"), 1400);
          }
          if (!chatPollTimer) {
            chatPollTimer = window.setInterval(() => void refreshGardenChat(), 3000);
          }
        }

        // --- Hydrate server-canonical decor + grants -------------------
        // Before subscribing, pull the host's saved decor and approved-
        // decorator list so the first paint is the real shared state. We
        // fire both RPCs in parallel — they're independent.
        setDecorLoading(true);
        setPlotsLoading(true);
        const hydration = await Promise.all([
          refreshGardenDecor("hydrate"),
          supabase.rpc("get_garden_decorators", {
            p_host_friend_code: normalizedHostCode,
            p_garden_id: normalizedGardenId,
          }),
          refreshGardenPlots("hydrate"),
        ]);
        if (cancelled) return;

        if (!hydration[0]) {
          // No row yet — the host hasn't placed any decor. Caller falls
          // back to its starter default.
          setDecor(null);
          setDecorVersion(0);
          decorVersionRef.current = 0;
        }
        setDecorLoading(false);

        if (!hydration[2]) {
          setPlots(null);
          setPlotsVersion(0);
          plotsVersionRef.current = 0;
        }
        setPlotsLoading(false);

        // Broadcasts make shared gardens feel instant, but persisted state
        // still needs a reload-free fallback when Realtime reconnects late or
        // misses an event. Keep decor, plots, and chat polling regardless of
        // channel subscription status.
        startFallbackPollers();

        const grantsData = Array.isArray(hydration[1].data) ? hydration[1].data : [];
        const hydratedGrants = grantsData
          .map((row) => normalizeFriendCode(String((row as { grantee_friend_code?: string })?.grantee_friend_code ?? "")))
          .filter((code) => code.length > 0);
        setApprovedDecoratorCodes(Array.from(new Set(hydratedGrants)));

        function syncPresence() {
          const state = channel.presenceState<RealtimeRoomPlayer>();
          // Every payload is untrusted — sanitize before render.
          const remotePlayers = Object.values(state)
            .flat()
            .map((player) => hardenRealtimePlayer(player))
            .filter((player): player is RealtimeRoomPlayer => Boolean(player))
            .filter((player) => player.id !== localId)
            .filter((player) => !player.friendCode || !isBlocked(player.friendCode))
            .sort((a, b) => a.displayName.localeCompare(b.displayName));

          remotePlayers.forEach((player) => {
            if (!player.friendCode) return;
            recordPlayedWith({ code: player.friendCode, displayName: player.displayName, context: gardenName });
          });
          if (remotePlayers.length > 0 && Date.now() - lastFriendPointAtRef.current > 5 * 60_000) {
            lastFriendPointAtRef.current = Date.now();
            recordActivity("friend-time", 1, { context: gardenName });
          }
          setPlayers(remotePlayers);
        }

        channel
          .on("presence", { event: "sync" }, syncPresence)
          .on("presence", { event: "join" }, syncPresence)
          .on("presence", { event: "leave" }, syncPresence)
          .on("broadcast", { event: "garden_move" }, ({ payload }) => {
            const player = hardenRealtimePlayer(payload);
            if (!player || player.id === localId) return;
            if (player.friendCode && isBlocked(player.friendCode)) return;
            if (player.friendCode) {
              recordPlayedWith({ code: player.friendCode, displayName: player.displayName, context: gardenName });
            }
            setPlayers((current) => upsertPlayer(current, player));
          })
          .on("broadcast", { event: "garden_chat" }, ({ payload }) => {
            const message = hardenIncomingChat(payload);
            if (!message || message.playerId === localId) return;
            if (message.friendCode && isBlocked(message.friendCode)) return;
            appendMessage(message);
            window.dispatchEvent(new CustomEvent("hearthaven:garden-chat-bubble", { detail: message }));
          })
          .on("broadcast", { event: "garden_decorator_permissions" }, ({ payload }) => {
            const approvedCodes: string[] = Array.isArray(payload?.approvedCodes)
              ? (payload.approvedCodes as unknown[])
                .map((code: unknown) => normalizeFriendCode(String(code)))
                .filter((code): code is string => Boolean(code))
              : [];
            setApprovedDecoratorCodes([...new Set(approvedCodes)]);
          })
          .on("broadcast", { event: "garden_plots_updated" }, ({ payload }) => {
            const versionNumber = Number((payload as { version?: number })?.version);
            if (!Number.isFinite(versionNumber)) return;
            if (versionNumber <= plotsVersionRef.current) return;
            const safe = hardenGardenPlots((payload as { plots?: unknown })?.plots);
            plotsVersionRef.current = versionNumber;
            setPlotsVersion(versionNumber);
            setPlots(safe);
          })
          .on("broadcast", { event: "garden_decor_updated" }, ({ payload }) => {
            // Delta from a save_garden_decor call on another client. Apply
            // only if the broadcast version beats what we already have —
            // otherwise we'd clobber a more recent local write.
            const versionNumber = Number((payload as { version?: number })?.version);
            if (!Number.isFinite(versionNumber)) return;
            if (versionNumber <= decorVersionRef.current) return;
            const safe = hardenGardenDecor((payload as { decor?: unknown })?.decor);
            decorVersionRef.current = versionNumber;
            setDecorVersion(versionNumber);
            setDecor(safe);
          })
          .subscribe(async (state) => {
            if (cancelled) return;
            if (state === "SUBSCRIBED") {
              realtimeReadyRef.current = true;
              await channel.track(localPlayer);
              void refreshGardenChat();
              startFallbackPollers();
              setConnectionState("connected");
              setStatus(`Live in garden ${gardenCode}`);
            } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              realtimeReadyRef.current = false;
              setConnectionState("error");
              setStatus("Online garden visits could not connect. The garden still works.");
            } else if (state === "CLOSED") {
              realtimeReadyRef.current = false;
              setConnectionState("offline");
              setStatus("Garden visit connection closed.");
            }
          });

        // Live-update presence when the keeper/pet customization changes so
        // everyone in the garden sees the new look without a reload.
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
          void channel.send({ type: "broadcast", event: "garden_move", payload });
        };
        window.addEventListener(KEEPER_CUSTOMIZATION_EVENT, rebroadcastCustomization);
        window.addEventListener(PET_CUSTOMIZATION_EVENT, rebroadcastCustomization);
        // Username changes are presence-affecting too — without re-broadcasting
        // here, other visitors keep seeing the keeper's old display name.
        window.addEventListener("hearthaven:public-username-changed", rebroadcastCustomization);
        customizationCleanup = () => {
          window.removeEventListener(KEEPER_CUSTOMIZATION_EVENT, rebroadcastCustomization);
          window.removeEventListener(PET_CUSTOMIZATION_EVENT, rebroadcastCustomization);
          window.removeEventListener("hearthaven:public-username-changed", rebroadcastCustomization);
        };
      } catch (error) {
        setConnectionState("error");
        setStatus(error instanceof Error ? error.message : "Online garden visits could not start.");
      }
    }

    void connect();

    return () => {
      cancelled = true;
      customizationCleanup?.();
      customizationCleanup = null;
      if (chatPollTimer) window.clearInterval(chatPollTimer);
      chatPollTimer = null;
      if (decorPollTimer) window.clearInterval(decorPollTimer);
      decorPollTimer = null;
      if (plotsPollTimer) window.clearInterval(plotsPollTimer);
      plotsPollTimer = null;
      const channel = channelRef.current;
      if (channel) {
        void getSupabaseBrowserClient().removeChannel(channel);
      }
      channelRef.current = null;
      realtimeReadyRef.current = false;
      localPlayerRef.current = null;
      setPlayers([]);
    };
  }, [appendMessage, channelKey, gardenCode, gardenName, mergeMessages, normalizedGardenId, normalizedHostCode, placeChatType]);

  const sendMove = useCallback((position: {
    x: number;
    y: number;
    facing?: FacingDirection;
    petX?: number;
    petY?: number;
    petFacing?: FacingDirection;
    controlMode?: "keeper" | "companion";
  }) => {
    const localPlayer = localPlayerRef.current;
    if (!localPlayer) return;

    const payload: RealtimeRoomPlayer = {
      ...localPlayer,
      // Prefer the latest friend code if the keeper regenerated mid-session.
      friendCode: latestFriendCodeRef.current || localPlayer.friendCode,
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
    const channel = channelRef.current;
    if (!channel) return;
    void channel.track(payload);
    void channel.send({ type: "broadcast", event: "garden_move", payload });
  }, []);

  const sendChat = useCallback(async (input: string): Promise<ChatModerationResult> => {
    const safety = readSafetyState();
    if (isLocallyQuarantined(safety)) {
      return {
        ok: false,
        severity: "hard-block",
        reason: "Your garden chat is paused while recent activity is reviewed.",
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
          scene: invitePath,
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
        reason: "Garden chat is reconnecting. Try again in a moment.",
      };
    }

    const localPlayer = localPlayerRef.current;
    const social = getSocialState();
    let message: GardenChatMessage = {
      id: crypto.randomUUID(),
      playerId: localPlayer?.id ?? createGuestId(),
      displayName: localPlayer?.displayName ?? getCachedPublicUsername(),
      friendCode: social.selfCode,
      text: moderation.text,
      createdAt: Date.now(),
    };

    if (isSupabaseConfigured()) {
      try {
        const savedMessage = await sendPlaceChatMessage({
          placeType: placeChatType,
          hostFriendCode: normalizedHostCode,
          placeId: normalizedGardenId,
          body: moderation.text,
        });
        if (savedMessage) message = savedMessage;
      } catch (error) {
        return {
          ok: false,
          severity: "soft-block",
          reason: error instanceof Error ? error.message : "Garden chat could not sync.",
        };
      }
    }

    appendMessage(message);
    window.dispatchEvent(new CustomEvent("hearthaven:garden-chat-bubble", { detail: message }));

    if (channel) void channel.send({ type: "broadcast", event: "garden_chat", payload: message });

    return moderation;
  }, [appendMessage, invitePath, normalizedGardenId, normalizedHostCode, placeChatType]);

  const toggleDecoratorPermission = useCallback(async (friendCode: string) => {
    const normalized = normalizeFriendCode(friendCode);
    if (!normalized) return;

    let nextList: string[] = approvedDecoratorCodes;
    setApprovedDecoratorCodes((current) => {
      nextList = current.includes(normalized)
        ? current.filter((code) => code !== normalized)
        : [...current, normalized];
      return nextList;
    });
    const grant = nextList.includes(normalized);

    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase.rpc("set_garden_decorator", {
          p_garden_id: normalizedGardenId,
          p_grantee_friend_code: normalized,
          p_grant: grant,
        });
      } catch {
        /* fall through — broadcast still propagates the local change */
      }
    }

    const channel = channelRef.current;
    if (channel) {
      void channel.send({
        type: "broadcast",
        event: "garden_decorator_permissions",
        payload: {
          approvedCodes: nextList,
          hostCode: getSocialState().selfCode,
          updatedAt: Date.now(),
        },
      });
    }
  }, [approvedDecoratorCodes, normalizedGardenId]);

  const saveDecor = useCallback(
    async (nextDecor: HardenedGardenDecor[]): Promise<SaveDecorResult> => {
      if (!isSupabaseConfigured()) {
        return { ok: false, reason: "network", message: "Online garden sync is not configured." };
      }
      const safe = hardenGardenDecor(nextDecor);
      const expected = decorVersionRef.current;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("save_garden_decor", {
          p_host_friend_code: normalizedHostCode,
          p_garden_id: normalizedGardenId,
          p_decor: safe,
          p_expected_version: expected,
        });
        if (error) {
          const message = error.message ?? "Could not save garden decor.";
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
        decorVersionRef.current = safeVersion;
        setDecorVersion(safeVersion);
        setDecor(safe);

        const channel = channelRef.current;
        if (channel) {
          void channel.send({
            type: "broadcast",
            event: "garden_decor_updated",
            payload: { decor: safe, version: safeVersion, updatedAt: Date.now() },
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
    [normalizedGardenId, normalizedHostCode],
  );

  const savePlots = useCallback(
    async (nextPlots: GardenPlotState[]): Promise<SavePlotsResult> => {
      if (!isSupabaseConfigured()) {
        return { ok: false, reason: "network", message: "Online garden sync is not configured." };
      }
      const safe = hardenGardenPlots(nextPlots);
      const expected = plotsVersionRef.current;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("save_garden_plots", {
          p_host_friend_code: normalizedHostCode,
          p_garden_id: normalizedGardenId,
          p_plots: safe,
          p_expected_version: expected,
        });
        if (error) {
          const message = error.message ?? "Could not save garden plots.";
          if (/not authorized/i.test(message)) return { ok: false, reason: "unauthorized", message };
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
        plotsVersionRef.current = safeVersion;
        setPlotsVersion(safeVersion);
        setPlots(safe);
        const channel = channelRef.current;
        if (channel) {
          void channel.send({
            type: "broadcast",
            event: "garden_plots_updated",
            payload: { plots: safe, version: safeVersion, updatedAt: Date.now() },
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
    [normalizedGardenId, normalizedHostCode],
  );

  const applyPlotAction = useCallback(
    async (plotId: string, action: "water" | "harvest"): Promise<SavePlotsResult> => {
      if (!isSupabaseConfigured()) {
        return { ok: false, reason: "network", message: "Online garden sync is not configured." };
      }
      const expected = plotsVersionRef.current;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("apply_garden_plot_action", {
          p_host_friend_code: normalizedHostCode,
          p_garden_id: normalizedGardenId,
          p_plot_id: plotId,
          p_action: action,
          p_expected_version: expected,
        });
        if (error) {
          const message = error.message ?? "Could not update plot.";
          if (/not authorized/i.test(message)) return { ok: false, reason: "unauthorized", message };
          if (/plot not found/i.test(message)) return { ok: false, reason: "invalid", message };
          return { ok: false, reason: "network", message };
        }
        const row = Array.isArray(data) ? data[0] : null;
        if (!row) return { ok: false, reason: "network", message: "Empty response from server." };
        if (row.conflict) {
          const sv = Number(row.version);
          return { ok: false, reason: "conflict", serverVersion: Number.isFinite(sv) ? sv : undefined };
        }
        const safe = hardenGardenPlots(row.plots);
        const newVersion = Number(row.version);
        const safeVersion = Number.isFinite(newVersion) ? newVersion : expected + 1;
        plotsVersionRef.current = safeVersion;
        setPlotsVersion(safeVersion);
        setPlots(safe);
        const channel = channelRef.current;
        if (channel) {
          void channel.send({
            type: "broadcast",
            event: "garden_plots_updated",
            payload: { plots: safe, version: safeVersion, updatedAt: Date.now() },
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
    [normalizedGardenId, normalizedHostCode],
  );

  return {
    applyPlotAction,
    approvedDecoratorCodes,
    connectionState,
    decor,
    decorVersion,
    decorLoading,
    gardenCode,
    inviteUrl,
    localFriendCode,
    messages,
    players,
    plots,
    plotsLoading,
    plotsVersion,
    saveDecor,
    savePlots,
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
