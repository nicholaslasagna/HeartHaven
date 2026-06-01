"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { recordMultiplayerRpc } from "@/lib/game/multiplayer-diagnostics";
import { getSocialState } from "@/lib/game/social";

/**
 * Server-backed party lobby.
 *
 * Pre-0029 this hook was 100% localStorage — "Alice's lobby on her device"
 * had no link to "Bob's lobby on his device". That meant multiplayer
 * literally couldn't work no matter how pretty the UI got. Migration
 * 0029 fills in `game_sessions` + `game_session_players` +
 * `lobby_join_requests` + `lobby_events` as the shared rendezvous
 * point. This hook is the React-side mirror.
 *
 * Data flow on mount:
 *   1. Look up our current lobby (as host OR as seated guest) via the
 *      `find_my_party_lobby` server call (implemented inline below
 *      because it's a thin SELECT, not worth its own RPC).
 *   2. Subscribe via Supabase Realtime to:
 *        - `game_sessions`           (status / game-pick changes)
 *        - `game_session_players`    (seats fill / empty)
 *        - `lobby_join_requests`     (host sees incoming knocks)
 *        - `lobby_events`            (start / cancel / kick fan-out)
 *   3. Re-hydrate state on every event.
 *
 * Guest auto-navigation: when a `lobby_events.kind = 'started'` event
 * arrives, every subscribed seated guest auto-routes to the selected
 * game href. The host is in charge of their own navigation post-start.
 */

export type LobbySeat = {
  profile_id: string;
  display_name: string;
  seat_index: number;
  team_key: string;
  ready: boolean;
};

export type LobbyState = {
  session_id: string;
  host_profile_id: string;
  host_friend_code: string;
  invite_code: string;
  status: "waiting" | "active" | "complete" | "cancelled";
  max_players: number;
  selected_game_key: string | null;
  selected_game_href: string | null;
  selected_game_label: string | null;
  seats: LobbySeat[];
};

export type LobbyJoinRequest = {
  id: string;
  session_id: string;
  requester_profile_id: string;
  requester_friend_code: string;
  requester_display_name: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  created_at: string;
};

export type StartStatus =
  | { ok: true }
  | { ok: false; reason: "not-host" | "no-game" | "no-lobby" | "empty" | "not-ready" };

type Result<T = void> =
  | ({ ok: true } & (T extends void ? Record<string, never> : { value: T }))
  | { ok: false; reason: string };

function withSessionParam(href: string, sessionId: string) {
  if (!href || !sessionId || /(^|[?&])session=/.test(href)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}session=${encodeURIComponent(sessionId)}`;
}

export function useServerPartyLobby(initialSize = 4) {
  const router = useRouter();
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [joinRequests, setJoinRequests] = useState<LobbyJoinRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const navigatedToHrefRef = useRef<string | null>(null);
  const lobbyRef = useRef<LobbyState | null>(null);
  // userId lives in state, NOT a ref, because `isHost` + `selfSeated`
  // + `startStatus` all read it during render. Refs read during render
  // trip react-hooks/refs (and are genuinely a bug — they don't trigger
  // re-renders when the value changes).
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    lobbyRef.current = lobby;
  }, [lobby]);

  /** Pull current lobby + seats + pending requests for this keeper. */
  const hydrate = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLobby(null);
      setJoinRequests([]);
      setLoading(false);
      return;
    }
    try {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
      if (!user) {
        setLobby(null);
        setJoinRequests([]);
        setLoading(false);
        return;
      }

      // Find the newest active lobby this user is in (host or seated).
      // The old implementation grabbed the first historical seat row,
      // which could hydrate a cancelled/stale lobby and make ready/start
      // look broken even while a newer lobby existed.
      const { data: hostedSessions } = await supabase
        .from("game_sessions")
        .select(
          "id, host_id, host_friend_code, invite_code, status, max_players, selected_game_key, selected_game_href, selected_game_label, updated_at, created_at",
        )
        .eq("host_id", user.id)
        .in("status", ["waiting", "active"])
        .order("updated_at", { ascending: false })
        .limit(1);

      const { data: mySeatRows } = await supabase
        .from("game_session_players")
        .select("session_id, joined_at")
        .eq("profile_id", user.id)
        .order("joined_at", { ascending: false })
        .limit(10);

      const seatedSessionIds = Array.isArray(mySeatRows)
        ? mySeatRows.map((row) => row.session_id).filter(Boolean)
        : [];

      const { data: seatedSessions } = seatedSessionIds.length
        ? await supabase
            .from("game_sessions")
            .select(
              "id, host_id, host_friend_code, invite_code, status, max_players, selected_game_key, selected_game_href, selected_game_label, updated_at, created_at",
            )
            .in("id", seatedSessionIds)
            .in("status", ["waiting", "active"])
            .order("updated_at", { ascending: false })
        : { data: [] };

      const candidates = [...(hostedSessions ?? []), ...(seatedSessions ?? [])].sort((a, b) => {
        const left = Date.parse(String(a.updated_at ?? a.created_at ?? 0));
        const right = Date.parse(String(b.updated_at ?? b.created_at ?? 0));
        return right - left;
      });
      const session = candidates[0];

      if (!session?.id) {
        setLobby(null);
        setJoinRequests([]);
        setLoading(false);
        return;
      }

      if (session.status !== "waiting" && session.status !== "active") {
        setLobby(null);
        setJoinRequests([]);
        setLoading(false);
        return;
      }

      const { data: seats } = await supabase
        .from("game_session_players")
        .select("profile_id, display_name, seat_index, team_key, ready")
        .eq("session_id", session.id)
        .order("seat_index", { ascending: true });

      const lobbyState: LobbyState = {
        session_id: session.id,
        host_profile_id: session.host_id,
        host_friend_code: session.host_friend_code ?? "",
        invite_code: session.invite_code ?? session.host_friend_code ?? "",
        status: session.status as LobbyState["status"],
        max_players: session.max_players,
        selected_game_key: session.selected_game_key,
        selected_game_href: session.selected_game_href,
        selected_game_label: session.selected_game_label,
        seats: Array.isArray(seats) ? (seats as LobbySeat[]) : [],
      };
      setLobby(lobbyState);

      // Only the host sees pending join requests — RLS already gates
      // this, but we skip the query when we aren't the host to save
      // bandwidth.
      if (session.host_id === user.id) {
        const { data: rpcRequests, error: rpcRequestError } = await supabase.rpc("get_my_lobby_join_requests", {
          p_session_id: session.id,
        });
        const requests = rpcRequestError
          ? (await supabase
              .from("lobby_join_requests")
              .select(
                "id, session_id, requester_profile_id, requester_friend_code, requester_display_name, status, created_at",
              )
              .eq("session_id", session.id)
              .eq("status", "pending")
              .order("created_at", { ascending: true })).data
          : rpcRequests;
        setJoinRequests(Array.isArray(requests) ? (requests as LobbyJoinRequest[]) : []);
      } else {
        setJoinRequests([]);
      }
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load lobby");
      setLoading(false);
    }
  }, []);

  // Initial hydration + realtime subscription. setState calls inside
  // this effect are the documented "subscribe for updates from an
  // external system" pattern — Supabase Realtime IS the external
  // system. The rule's stated allowed shape applies; suppressing.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let myUserId: string | null = null;

    async function start() {
      await hydrate();
      if (cancelled) return;
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      myUserId = user.id;

      // One channel per user; postgres_changes events are filtered
      // server-side by RLS so we receive only relevant rows.
      const channel = supabase
        .channel(`party-lobby:${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "game_sessions" },
          () => {
            void hydrate();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "game_session_players" },
          () => {
            void hydrate();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "lobby_join_requests" },
          () => {
            void hydrate();
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "lobby_events" },
          (payload) => {
            const row = payload?.new as
              | { session_id?: string; kind?: string; payload?: { game_href?: string; profile_id?: string } }
              | undefined;
            if (!row) return;
            const currentLobby = lobbyRef.current;
            const eventSessionId = typeof row.session_id === "string" ? row.session_id : null;
            const isCurrentLobbyEvent = Boolean(currentLobby && eventSessionId === currentLobby.session_id);
            if (row.kind === "started") {
              const href = row.payload?.game_href;
              const isCurrentMember = Boolean(
                currentLobby
                  && (
                    currentLobby.host_profile_id === myUserId
                    || currentLobby.seats.some((seat) => seat.profile_id === myUserId)
                  ),
              );
              // Guests auto-navigate to the chosen game. Track the last
              // href we navigated to so a duplicate event (network
              // hiccup, hydration retry) doesn't double-fire.
              if (!isCurrentMember) {
                void hydrate();
                return;
              }
              const sessionHref = href && currentLobby ? withSessionParam(href, currentLobby.session_id) : href;
              if (sessionHref && navigatedToHrefRef.current !== sessionHref) {
                navigatedToHrefRef.current = sessionHref;
                router.push(sessionHref, { scroll: false });
              }
            } else if (row.kind === "cancelled" && isCurrentLobbyEvent) {
              setLobby(null);
              setJoinRequests([]);
            } else if (row.kind === "kicked" && isCurrentLobbyEvent && myUserId && row.payload?.profile_id === myUserId) {
              setLobby(null);
              setJoinRequests([]);
            } else {
              void hydrate();
            }
          },
        )
        .subscribe();

      channelRef.current = channel;
    }

    void start();

    const pollTimer = window.setInterval(() => {
      void hydrate();
    }, 2500);
    const refreshOnFocus = () => {
      void hydrate();
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") void hydrate();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void getSupabaseBrowserClient().removeChannel(channelRef.current);
        channelRef.current = null;
      }
      window.clearInterval(pollTimer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [hydrate, router]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Actions ─────────────────────────────────────────────────────────

  const createLobby = useCallback(async (maxPlayers = initialSize): Promise<Result<LobbyState>> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: rpcError } = await supabase.rpc("create_party_lobby", { p_max_players: maxPlayers });
      if (rpcError) {
        recordMultiplayerRpc("create_party_lobby", rpcError);
        return { ok: false, reason: rpcError.message };
      }
      recordMultiplayerRpc("create_party_lobby");
      await hydrate();
      return { ok: true } as Result<LobbyState>;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Could not create lobby" };
    }
  }, [hydrate, initialSize]);

  const requestJoin = useCallback(async (hostFriendCode: string): Promise<Result<{ requestId: string | null }>> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: rpcError } = await supabase.rpc("request_join_party", {
        p_host_friend_code: hostFriendCode,
      });
      if (rpcError) {
        recordMultiplayerRpc("request_join_party", rpcError);
        return { ok: false, reason: rpcError.message };
      }
      recordMultiplayerRpc("request_join_party");
      const requestId = typeof data === "string" ? data : null;
      // requestId === null means "already seated" — the post-hydrate
      // pull will put us into the lobby state automatically.
      await hydrate();
      return { ok: true, value: { requestId } } as Result<{ requestId: string | null }>;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Could not request to join" };
    }
  }, [hydrate]);

  const respondJoinRequest = useCallback(async (requestId: string, approve: boolean): Promise<Result> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: rpcError } = await supabase.rpc("respond_join_request", {
        p_request_id: requestId,
        p_approve: approve,
      });
      if (rpcError) {
        recordMultiplayerRpc("respond_join_request", rpcError);
        return { ok: false, reason: rpcError.message };
      }
      recordMultiplayerRpc("respond_join_request");
      await hydrate();
      return { ok: true } as Result;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Could not respond" };
    }
  }, [hydrate]);

  const approveRequest = useCallback((id: string) => respondJoinRequest(id, true), [respondJoinRequest]);
  const denyRequest = useCallback((id: string) => respondJoinRequest(id, false), [respondJoinRequest]);

  const selectGame = useCallback(
    async (game: { key: string; href: string; label?: string }): Promise<Result> => {
      if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
      try {
        const supabase = getSupabaseBrowserClient();
        const { error: rpcError } = await supabase.rpc("select_party_game", {
          p_game_key: game.key,
          p_game_href: game.href,
          p_game_label: game.label ?? "",
        });
        if (rpcError) {
          recordMultiplayerRpc("select_party_game", rpcError);
          return { ok: false, reason: rpcError.message };
        }
        recordMultiplayerRpc("select_party_game");
        await hydrate();
        return { ok: true } as Result;
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "Could not select game" };
      }
    },
    [hydrate],
  );

  const start = useCallback(async (): Promise<Result<{ href: string }>> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: rpcError } = await supabase.rpc("start_party_lobby");
      if (rpcError) {
        recordMultiplayerRpc("start_party_lobby", rpcError);
        return { ok: false, reason: rpcError.message };
      }
      recordMultiplayerRpc("start_party_lobby");
      const href = typeof data === "string" && lobbyRef.current
        ? withSessionParam(data, lobbyRef.current.session_id)
        : typeof data === "string"
          ? data
          : null;
      if (!href) return { ok: false, reason: "Pick a game before starting." };
      navigatedToHrefRef.current = href;
      router.push(href, { scroll: false });
      return { ok: true, value: { href } } as Result<{ href: string }>;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Could not start" };
    }
  }, [router]);

  const leave = useCallback(async (): Promise<Result> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: rpcError } = await supabase.rpc("leave_party_lobby");
      if (rpcError) {
        recordMultiplayerRpc("leave_party_lobby", rpcError);
        return { ok: false, reason: rpcError.message };
      }
      recordMultiplayerRpc("leave_party_lobby");
      setLobby(null);
      setJoinRequests([]);
      return { ok: true } as Result;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Could not leave" };
    }
  }, []);

  const kick = useCallback(async (profileId: string): Promise<Result> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: rpcError } = await supabase.rpc("kick_party_seat", { p_profile_id: profileId });
      if (rpcError) {
        recordMultiplayerRpc("kick_party_seat", rpcError);
        return { ok: false, reason: rpcError.message };
      }
      recordMultiplayerRpc("kick_party_seat");
      await hydrate();
      return { ok: true } as Result;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Could not kick" };
    }
  }, [hydrate]);

  const toggleReady = useCallback(async (): Promise<Result> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
    const current = lobby;
    const me = current?.seats.find((seat) => seat.profile_id === userId);
    if (!current || !me) return { ok: false, reason: "not seated" };
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: rpcError } = await supabase
        .from("game_session_players")
        .update({ ready: !me.ready })
        .eq("session_id", current.session_id)
        .eq("profile_id", me.profile_id);
      if (rpcError) {
        recordMultiplayerRpc("game_session_players.ready", rpcError);
        return { ok: false, reason: rpcError.message };
      }
      recordMultiplayerRpc("game_session_players.ready");
      await hydrate();
      return { ok: true } as Result;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Could not toggle ready" };
    }
  }, [lobby, hydrate, userId]);

  // ── Derived view-model ──────────────────────────────────────────────

  const startStatus: StartStatus = useMemo(() => {
    if (!lobby) return { ok: false, reason: "no-lobby" };
    if (lobby.host_profile_id !== userId) return { ok: false, reason: "not-host" };
    if (!lobby.selected_game_href) return { ok: false, reason: "no-game" };
    if (lobby.seats.length < 1) return { ok: false, reason: "empty" };
    const ready = lobby.seats.filter((seat) => seat.ready).length;
    if (ready < lobby.seats.length) return { ok: false, reason: "not-ready" };
    return { ok: true };
  }, [lobby, userId]);

  const isHost = useMemo(() => Boolean(lobby && lobby.host_profile_id === userId), [lobby, userId]);
  const selfSeated = useMemo(
    () => Boolean(lobby && lobby.seats.some((seat) => seat.profile_id === userId)),
    [lobby, userId],
  );
  const selfSeat = useMemo(
    () => lobby?.seats.find((seat) => seat.profile_id === userId) ?? null,
    [lobby, userId],
  );

  const localFriendCode = typeof window === "undefined" ? "" : getSocialState().selfCode;

  return useMemo(
    () => ({
      lobby,
      ready: !loading,
      loading,
      error,
      isHost,
      selfSeated,
      selfSeat,
      joinRequests,
      localFriendCode,
      // Actions
      createLobby,
      requestJoin,
      approveRequest,
      denyRequest,
      selectGame,
      start,
      leave,
      kick,
      toggleReady,
      // Derived
      startStatus,
      // Re-fetch on demand (useful after the Friends page invites someone).
      refresh: hydrate,
    }),
    [
      lobby,
      loading,
      error,
      isHost,
      selfSeated,
      selfSeat,
      joinRequests,
      localFriendCode,
      createLobby,
      requestJoin,
      approveRequest,
      denyRequest,
      selectGame,
      start,
      leave,
      kick,
      toggleReady,
      startStatus,
      hydrate,
    ],
  );
}
