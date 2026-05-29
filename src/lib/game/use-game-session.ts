"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function useGameSession(gameKey: string, options?: { maxPlayers?: number }) {
  const [sessionFromUrl] = useState(readSessionIdFromUrl);
  const [sessionId, setSessionId] = useState<string | null>(readSessionIdFromUrl);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [seats, setSeats] = useState<GameSessionSeat[]>([]);
  const [moves, setMoves] = useState<GameMoveRecord[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Connecting game session...");
  const lastMoveIndexRef = useRef(-1);
  const sessionIdRef = useRef<string | null>(sessionFromUrl);

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
      setStatus(stateResult.error.message);
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
  }, [gameKey]);

  useEffect(() => {
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

      if (!target) {
        const { data, error } = await supabase.rpc("ensure_play_game_session", {
          p_game_key: gameKey,
          p_max_players: options?.maxPlayers ?? 2,
        });
        if (error) {
          setStatus(error.message);
          setLoading(false);
          return;
        }
        target = typeof data === "string" ? data : null;
      }

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
  }, [gameKey, hydrate, options?.maxPlayers, sessionFromUrl, sessionId]);

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
          const meta = row?.metadata;
          if (meta && typeof meta === "object" && !Array.isArray(meta)) {
            setMetadata(meta as Record<string, unknown>);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

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
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("submit_game_move", {
          p_session_id: target,
          p_move_type: moveType,
          p_payload: payload,
        });
        if (error) return { ok: false, reason: error.message };
        const row = Array.isArray(data) ? data[0] : null;
        if (!row || !row.ok) {
          return { ok: false, reason: String(row?.error_message ?? "Move rejected.") };
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
    },
    [],
  );

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
    refresh: hydrate,
  };
}
