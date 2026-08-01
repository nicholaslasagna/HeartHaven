"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, Flag, Layers, Play, Timer, Trophy, Users } from "lucide-react";
import { HeartRushCanvasLoader } from "@/components/game/heartrush-canvas-loader";
import { CompanionCameo } from "@/components/game/companion-cameo";
import { WorldZoneDock } from "@/components/game/world-zone-dock";
import {
  heartRushSeatCss,
  type HeartRushCompanion,
  type HeartRushRemote,
  type HeartRushState,
} from "@/lib/game/heartrush-shared";
import { HEARTRUSH_LEVELS } from "@/lib/game/heartrush-course";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  COMPANION_ROSTER_EVENT,
  getActiveCompanion,
  type CompanionRecord,
} from "@/lib/game/companion-roster";

const COUNTDOWN_MS = 3500;
/* Par for all three levels. Beat it and you score the full 1000; slower
   runs scale down from there. Kept in step with the reward spec's
   min_duration_seconds, which rejects anything impossibly fast. */
const PAR_MS = 150_000;
/** Drop a racer's ghost if we have not heard from them in this long. */
const STALE_MS = 4000;

function formatTime(ms: number) {
  const total = Math.max(0, ms);
  const seconds = Math.floor(total / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function HeartRushClient() {
  const game = useMiniGameSession("heartrush", { maxPlayers: 8 });
  const { sessionId, seats, mySeat, myProfileId, moves, submitMove, handleReward } = game;

  const [liveStartAt, setLiveStartAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState({ level: 0, levels: HEARTRUSH_LEVELS, checkpoint: 0, checkpoints: 0 });
  const [myFinishMs, setMyFinishMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCompanion, setActiveCompanion] = useState<CompanionRecord | null>(() => getActiveCompanion() ?? null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const remotesRef = useRef(new Map<string, HeartRushRemote & { at: number }>());
  const finishedRef = useRef(false);

  const isHost = (mySeat?.seat_index ?? 0) === 0;
  const seatIndex = mySeat?.seat_index ?? 0;
  const myName = mySeat?.display_name ?? "You";

  useEffect(() => {
    const syncCompanion = () => setActiveCompanion(getActiveCompanion() ?? null);
    window.addEventListener(COMPANION_ROSTER_EVENT, syncCompanion);
    return () => window.removeEventListener(COMPANION_ROSTER_EVENT, syncCompanion);
  }, []);

  const companionPayload = useMemo<HeartRushCompanion>(() => ({
    speciesId: activeCompanion?.speciesId ?? "kitten",
    toneId: activeCompanion?.toneId ?? "cream",
    accessory: activeCompanion?.accessory ?? "moonberry-bow",
  }), [activeCompanion]);

  /* -- authoritative finish order, straight off the ordered move log -- */
  const results = useMemo(() => {
    return moves
      .filter((move) => move.move_type === "finish")
      .map((move) => {
        const seat = seats.find((entry) => entry.profile_id === move.profile_id);
        return {
          profileId: move.profile_id,
          name: seat?.display_name ?? "Racer",
          seatIndex: seat?.seat_index ?? 0,
          ms: Math.max(0, Number((move.payload as { ms?: number })?.ms ?? 0)),
        };
      })
      .sort((a, b) => a.ms - b.ms);
  }, [moves, seats]);

  /* -- race start: broadcast is the fast path, the move log the truth --
     Derived, not synced: the log survives reloads and late joins, the
     broadcast lands instantly. Start stamps only move forward, so the
     later of the two is always the current race. */
  const raceStartAt = useMemo(() => {
    const logged = moves
      .filter((move) => move.move_type === "start")
      .map((move) => Number((move.payload as { startAt?: number })?.startAt ?? 0))
      .filter((value) => value > 0);
    const newestLogged = logged.length > 0 ? Math.max(...logged) : null;
    if (newestLogged === null) return liveStartAt;
    if (liveStartAt === null) return newestLogged;
    return Math.max(newestLogged, liveStartAt);
  }, [moves, liveStartAt]);

  /* -- realtime: 15Hz positions + instant start signal -- */
  useEffect(() => {
    if (!sessionId || !isSupabaseConfigured() || !myProfileId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`heartrush:${sessionId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        const entry = payload as HeartRushRemote;
        if (!entry?.id || entry.id === myProfileId) return;
        remotesRef.current.set(entry.id, { ...entry, at: Date.now() });
      })
      .on("broadcast", { event: "race_start" }, ({ payload }) => {
        const at = Number((payload as { startAt?: number })?.startAt ?? 0);
        if (at > 0) setLiveStartAt(at);
      })
      .subscribe();
    channelRef.current = channel;

    // Feed the canvas without re-rendering React 15x a second.
    const pump = window.setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      const players: HeartRushRemote[] = [];
      for (const [id, entry] of remotesRef.current) {
        if (entry.at < cutoff) {
          remotesRef.current.delete(id);
          continue;
        }
        players.push(entry);
      }
      window.dispatchEvent(new CustomEvent("hearthaven:heartrush-remote", { detail: { players } }));
    }, 66);

    return () => {
      window.clearInterval(pump);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [sessionId, myProfileId]);

  /* -- HUD clock -- */
  useEffect(() => {
    if (raceStartAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [raceStartAt]);

  const broadcastState = useCallback(
    (state: HeartRushState) => {
      const channel = channelRef.current;
      if (!channel || !myProfileId) return;
      void channel.send({
        type: "broadcast",
        event: "pos",
        payload: {
          ...state,
          id: myProfileId,
          name: myName,
          seat: seatIndex,
          companion: companionPayload,
        } satisfies HeartRushRemote,
      });
    },
    [companionPayload, myProfileId, myName, seatIndex],
  );

  const startRace = useCallback(async () => {
    const startAt = Date.now() + COUNTDOWN_MS;
    setLiveStartAt(startAt);
    finishedRef.current = false;
    setMyFinishMs(null);
    setProgress({ level: 0, levels: HEARTRUSH_LEVELS, checkpoint: 0, checkpoints: 0 });
    channelRef.current?.send({ type: "broadcast", event: "race_start", payload: { startAt } });
    // Durable copy so reloads and late joins still learn the start time.
    const result = await submitMove("start", { startAt });
    if (!result.ok) setError(result.reason ?? "Could not start the race.");
  }, [submitMove]);

  const handleFinish = useCallback(
    (elapsedMs: number) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      setMyFinishMs(elapsedMs);
      void submitMove("finish", { ms: elapsedMs });
      // Par-relative so the three-level run scores sensibly at any pace;
      // the server spec still caps the actual payout.
      const score = Math.max(0, Math.min(1000, Math.round((PAR_MS / Math.max(1, elapsedMs)) * 1000)));
      handleReward({
        gameId: "heartrush",
        label: "HeartRush",
        score,
        coins: 0,
        hearts: 0,
      });
    },
    [handleReward, submitMove],
  );

  const started = raceStartAt !== null && now >= raceStartAt;
  const countdown = raceStartAt === null ? null : Math.ceil((raceStartAt - now) / 1000);
  const elapsed = raceStartAt === null ? 0 : Math.max(0, now - raceStartAt);
  const racerCount = Math.max(seats.length, 1);

  return (
    <div className="grid gap-4">
      <section className="flex flex-col justify-between gap-3 rounded-lg border border-sky-300/50 bg-sky-100/65 p-4 shadow-sm sm:p-5 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-sky-700">Party obstacle race</p>
          <h1 className="mt-1 font-display text-3xl text-ink-900 sm:text-4xl">HeartRush</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Two to eight keepers race {HEARTRUSH_LEVELS} courses back to back, freshly generated for every race. Dodge the
            sweepers, ride the platforms, cross the bridge, and hit the last gate first.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CompanionCameo copy="is racing with you" />
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
        </div>
      </section>

      <WorldZoneDock active="games" />

      {error && (
        <p className="rounded-lg border border-blush-300/50 bg-blush-100/70 p-3 text-sm font-extrabold text-blush-700">
          {error}
        </p>
      )}

      <div className="relative">
        <HeartRushCanvasLoader
          companion={companionPayload}
          myName={myName}
          mySeatIndex={seatIndex}
          onProgress={setProgress}
          onError={setError}
          onFinish={handleFinish}
          onLocalState={broadcastState}
          raceStartAt={raceStartAt}
        />

        {/* HUD */}
        {started && myFinishMs === null && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 font-mono text-sm font-black text-ink-900 shadow">
              <Timer className="size-4 text-sky-700" /> {formatTime(elapsed)}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-sm font-black text-ink-900 shadow">
              <span className="inline-flex items-center gap-1.5 text-sky-700">
                <Layers className="size-4" /> Level {progress.level + 1}/{progress.levels}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Flag className="size-4 text-garden-700" /> {progress.checkpoint}/{Math.max(1, progress.checkpoints)}
              </span>
            </span>
          </div>
        )}

        {/* Pre-race + countdown */}
        {(raceStartAt === null || (countdown !== null && countdown > 0)) && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-ink-900/45 p-4 text-center">
            {raceStartAt === null ? (
              <div className="max-w-sm rounded-lg bg-cream-50 p-5 shadow-lg">
                <h2 className="font-display text-2xl text-ink-900">Ready to run?</h2>
                <p className="mt-2 text-sm font-bold leading-5 text-ink-700">
                  <span className="font-black">WASD</span> or arrows to move, <span className="font-black">Space</span> to
                  jump, <span className="font-black">Shift</span> to dive.
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-extrabold text-ink-600">
                  <Users className="size-3.5" /> {racerCount} racer{racerCount === 1 ? "" : "s"} on the line
                </p>
                {isHost ? (
                  <Button className="mt-4 w-full" onClick={() => void startRace()}>
                    <Play /> Start race
                  </Button>
                ) : (
                  <p className="mt-4 rounded-md bg-cream-100 px-3 py-2 text-xs font-extrabold text-ink-600">
                    Waiting for the host to start the race.
                  </p>
                )}
              </div>
            ) : (
              <p className="font-display text-7xl text-white drop-shadow-lg">
                {countdown === 0 ? "GO!" : countdown}
              </p>
            )}
          </div>
        )}

        {/* Finish */}
        {myFinishMs !== null && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-ink-900/55 p-4">
            <div className="w-full max-w-sm rounded-lg bg-cream-50 p-5 text-center shadow-lg">
              <Trophy className="mx-auto size-8 text-honey-700" />
              <h2 className="mt-2 font-display text-2xl text-ink-900">Finished!</h2>
              <p className="mt-1 font-mono text-3xl font-black text-ink-900">{formatTime(myFinishMs)}</p>
              <ol className="mt-4 grid gap-1.5 text-left">
                {results.map((entry, index) => (
                  <li
                    className="flex items-center justify-between gap-2 rounded-md bg-white/80 px-3 py-1.5 text-sm font-extrabold text-ink-800"
                    key={entry.profileId}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block size-3 rounded-full"
                        style={{ backgroundColor: heartRushSeatCss(entry.seatIndex) }}
                      />
                      {index + 1}. {entry.name}
                    </span>
                    <span className="font-mono">{formatTime(entry.ms)}</span>
                  </li>
                ))}
              </ol>
              {results.length < racerCount && (
                <p className="mt-3 text-xs font-extrabold text-ink-500">
                  Waiting on {racerCount - results.length} more racer{racerCount - results.length === 1 ? "" : "s"}…
                </p>
              )}
              {isHost && (
                <Button className="mt-4 w-full" onClick={() => void startRace()}>
                  <Play /> Race again
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <RewardWalletPanel />
    </div>
  );
}
