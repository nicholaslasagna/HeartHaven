"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type GameSessionSeat = {
  profile_id: string;
  display_name: string;
  seat_index: number;
  team_key: string;
  ready: boolean;
  score: number;
};

export type GameMoveRecord = {
  move_index: number;
  profile_id: string;
  seat_index: number;
  move_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type SubmitMoveResult =
  | { ok: true; moveIndex: number; metadata: Record<string, unknown> }
  | { ok: false; reason: string };

function normalizeSessionGameKey(key: string) {
  const trimmed = key.trim();
  if (trimmed.endsWith("-party")) return trimmed.slice(0, -6);
  return trimmed;
}

function readSessionIdFromUrl() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("session");
}

function stableInitKey(init?: Record<string, unknown>) {
  try {
    return JSON.stringify(init ?? {});
  } catch {
    return "{}";
  }
}

function parseInitKey(key: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(key) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sessionErrorCopy(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("game_sessions_status_check")) {
    return "This game needs the latest HeartHaven game-status update before it can finish. Ask the host to refresh after the update is applied.";
  }
  if (lower.includes("game_sessions_one_active_per_host") || lower.includes("duplicate key value")) {
    return "HeartHaven found another live game for you. Refresh this page, or leave the active party lobby before starting a different game.";
  }
  if (lower.includes("active party session")) {
    return "You already have an active party session. Finish or leave it before starting another game.";
  }
  if (lower.includes("different game")) {
    return "This invite belongs to a different game. Ask the host for a fresh invite.";
  }
  return message;
}

export function useGameSession(
  gameKey: string,
  options?: { maxPlayers?: number; init?: Record<string, unknown> },
) {
  const router = useRouter();
  const [sessionFromUrl, setSessionFromUrl] = useState<string | null>(null);
  const [sessionUrlReady, setSessionUrlReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [seats, setSeats] = useState<GameSessionSeat[]>([]);
  const [moves, setMoves] = useState<GameMoveRecord[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Connecting game session...");
  const lastMoveIndexRef = useRef(-1);
  const sessionIdRef = useRef<string | null>(null);
  const maxPlayers = options?.maxPlayers ?? 2;
  const initKey = stableInitKey(options?.init);

  useEffect(() => {
    const urlSessionId = readSessionIdFromUrl();
    sessionIdRef.current = urlSessionId;
    queueMicrotask(() => {
      setSessionFromUrl(urlSessionId);
      setSessionId(urlSessionId);
      setSessionUrlReady(true);
    });
  }, []);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const hydrate = useCallback(async (targetSessionId: string) => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      setStatus("Offline — local play only.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setMyProfileId(user?.id ?? null);

    const [stateResult, movesResult] = await Promise.all([
      supabase.rpc("get_game_session_state", { p_session_id: targetSessionId }),
      supabase.rpc("get_game_moves", { p_session_id: targetSessionId, p_since_index: 0 }),
    ]);

    const stateRow = Array.isArray(stateResult.data) ? stateResult.data[0] : null;
    if (stateResult.error) {
      setLoading(false);
      setStatus(sessionErrorCopy(stateResult.error.message));
      return;
    }
    if (stateRow) {
      const sessionKey = normalizeSessionGameKey(String(stateRow.game_key ?? ""));
      const expectedKey = normalizeSessionGameKey(gameKey);
      if (sessionKey !== expectedKey && sessionKey !== "lobby") {
        setLoading(false);
        setStatus("This session belongs to a different game.");
        return;
      }
      const meta = stateRow.metadata;
      const rowStatus = String(stateRow.status ?? "");
      if (sessionFromUrl && rowStatus === "waiting") {
        setMetadata(meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {});
        setLoading(false);
        setStatus("The host brought everyone back to the lobby.");
        router.push("/app/games", { scroll: false });
        return;
      }
      if (sessionFromUrl && rowStatus === "cancelled") {
        setLoading(false);
        setStatus("This party lobby was closed.");
        router.push("/app/games", { scroll: false });
        return;
      }
      setMetadata(meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {});
      const seatRows = Array.isArray(stateRow.seats) ? stateRow.seats : [];
      const parsedSeats: GameSessionSeat[] = seatRows
        .map((seat: unknown) => {
          const s = seat as Record<string, unknown>;
          return {
            profile_id: String(s.profile_id ?? ""),
            display_name: String(s.display_name ?? "Keeper"),
            seat_index: Number(s.seat_index ?? 0),
            team_key: String(s.team_key ?? "solo"),
            ready: Boolean(s.ready),
            score: Number(s.score ?? 0),
          };
        })
        .filter((seat: GameSessionSeat) => seat.profile_id.length > 0)
        .sort((a: GameSessionSeat, b: GameSessionSeat) => a.seat_index - b.seat_index);
      setSeats(parsedSeats);
    }

    const moveRows = Array.isArray(movesResult.data) ? movesResult.data : [];
    const parsedMoves: GameMoveRecord[] = moveRows.map((row) => {
      const r = row as Record<string, unknown>;
      const payload = r.payload;
      return {
        move_index: Number(r.move_index ?? 0),
        profile_id: String(r.profile_id ?? ""),
        seat_index: Number(r.seat_index ?? 0),
        move_type: String(r.move_type ?? ""),
        payload: payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {},
        created_at: String(r.created_at ?? ""),
      };
    });
    setMoves(parsedMoves);
    lastMoveIndexRef.current = parsedMoves.length > 0 ? parsedMoves[parsedMoves.length - 1].move_index : -1;
    setLoading(false);
    setStatus(`Live game session · ${parsedMoves.length} moves`);
  }, [gameKey, router, sessionFromUrl]);

  useEffect(() => {
    if (!sessionUrlReady) return;

    if (!isSupabaseConfigured()) {
      queueMicrotask(() => {
        setLoading(false);
        setStatus("Offline — local play only.");
      });
      return;
    }

    let cancelled = false;

    async function boot() {
      setLoading(true);
      const supabase = getSupabaseBrowserClient();
      let target = sessionFromUrl;

      const { data, error } = await supabase.rpc("ensure_play_game_session", {
        p_game_key: gameKey,
        p_max_players: maxPlayers,
        p_init: parseInitKey(initKey),
        p_session_id: target,
      });
      if (error) {
        setStatus(sessionErrorCopy(error.message));
        setLoading(false);
        return;
      }
      target = typeof data === "string" ? data : target;

      if (!target || cancelled) {
        setLoading(false);
        return;
      }

      setSessionId(target);
      sessionIdRef.current = target;
      await hydrate(target);
    }

    void boot();

    return () => {
      cancelled = true;
    };
  }, [gameKey, hydrate, initKey, maxPlayers, sessionFromUrl, sessionUrlReady]);

  useEffect(() => {
    const target = sessionIdRef.current;
    if (!target || !isSupabaseConfigured()) return;

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`game-session:${target}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_moves", filter: `session_id=eq.${target}` },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          const moveIndex = Number(row.move_index ?? -1);
          if (moveIndex <= lastMoveIndexRef.current) return;
          lastMoveIndexRef.current = moveIndex;
          const movePayload = row.payload;
          setMoves((current) => [
            ...current,
            {
              move_index: moveIndex,
              profile_id: String(row.profile_id ?? ""),
              seat_index: Number(row.seat_index ?? 0),
              move_type: String(row.move_type ?? ""),
              payload: movePayload && typeof movePayload === "object" && !Array.isArray(movePayload)
                ? (movePayload as Record<string, unknown>)
                : {},
              created_at: String(row.created_at ?? ""),
            },
          ]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${target}` },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          const rowStatus = String(row?.status ?? "");
          if (sessionFromUrl && rowStatus === "waiting") {
            setStatus("The host brought everyone back to the lobby.");
            router.push("/app/games", { scroll: false });
            return;
          }
          if (sessionFromUrl && rowStatus === "cancelled") {
            setStatus("This party lobby was closed.");
            router.push("/app/games", { scroll: false });
            return;
          }
          const meta = row?.metadata;
          if (meta && typeof meta === "object" && !Array.isArray(meta)) {
            setMetadata(meta as Record<string, unknown>);
          }
        },
      )
      .subscribe();

    // Polling fallback. Realtime postgres_changes on game_sessions /
    // game_moves are RLS-gated and occasionally dropped (browser sleep,
    // socket churn, replica lag) — and when the opponent's move event is
    // the one that's dropped, the board never advances and the match
    // softlocks. Re-hydrating the full session state every 1s guarantees
    // both players' boards converge quickly regardless of
    // realtime health. The two RPCs are cheap for a 2-player turn game.
    const pollTimer = window.setInterval(() => {
      const active = sessionIdRef.current;
      if (active) void hydrate(active);
    }, 1000);

    return () => {
      window.clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
  }, [sessionId, hydrate, router, sessionFromUrl]);

  const mySeat = useMemo(
    () => seats.find((seat) => seat.profile_id === myProfileId) ?? null,
    [myProfileId, seats],
  );

  const submitMove = useCallback(
    async (moveType: string, payload: Record<string, unknown> = {}): Promise<SubmitMoveResult> => {
      const target = sessionIdRef.current;
      if (!target || !isSupabaseConfigured()) {
        return { ok: false, reason: "No online game session." };
      }

      const attempt = async (allowRetry: boolean): Promise<SubmitMoveResult> => {
        try {
          const supabase = getSupabaseBrowserClient();
          const { data, error } = await supabase.rpc("submit_game_move", {
            p_session_id: target,
            p_move_type: moveType,
            p_payload: payload,
          });
          if (error) return { ok: false, reason: sessionErrorCopy(error.message) };
          const row = Array.isArray(data) ? data[0] : null;
          if (!row || !row.ok) {
            const reason = String(row?.error_message ?? "Move rejected.");
            if (allowRetry && reason === "move_index_conflict") {
              return attempt(false);
            }
            return { ok: false, reason };
          }
          const meta = row.metadata;
          if (meta && typeof meta === "object" && !Array.isArray(meta)) {
            setMetadata(meta as Record<string, unknown>);
          }
          return {
            ok: true,
            moveIndex: Number(row.move_index ?? 0),
            metadata: meta && typeof meta === "object" && !Array.isArray(meta)
              ? (meta as Record<string, unknown>)
              : {},
          };
        } catch (err) {
          return { ok: false, reason: err instanceof Error ? err.message : "Network error." };
        }
      };

      return attempt(true);
    },
    [],
  );

  const returnToLobby = useCallback(async (): Promise<SubmitMoveResult> => {
    const target = sessionIdRef.current;
    if (!target || !isSupabaseConfigured()) {
      router.push("/app/games", { scroll: false });
      return { ok: true, moveIndex: -1, metadata: {} };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("return_party_lobby_to_waiting", {
        p_session_id: target,
      });

      // Guests and older databases can still use the button as ordinary
      // navigation. The server RPC is only required for the host fan-out.
      if (error && !/not-host|function public\.return_party_lobby_to_waiting|schema cache/i.test(error.message)) {
        return { ok: false, reason: sessionErrorCopy(error.message) };
      }
      router.push("/app/games", { scroll: false });
      return { ok: true, moveIndex: -1, metadata: {} };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Could not return to lobby." };
    }
  }, [router]);

  return {
    sessionId,
    metadata,
    seats,
    moves,
    mySeat,
    myProfileId,
    loading,
    status,
    submitMove,
    returnToLobby,
    refresh: hydrate,
  };
}
