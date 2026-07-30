"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, Coins, Flag, Play, Timer, Trophy, Users } from "lucide-react";
import { LanternLeapLoader } from "@/components/game/lantern-leap/lantern-leap-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import type { GameEvent } from "@/lib/game/lantern-leap/game";
import { LANTERN_LEAP_LEVELS } from "@/lib/game/lantern-leap/levels";
// Same eight seat colours the canvas paints the avatars with, and the only
// copy of them that is safe to import here — `renderer.ts` owns the 3D copy
// but pulls three.js in with it.
import { heartRushSeatCss } from "@/lib/game/heartrush-shared";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Drop a teammate's ghost if we have not heard from them in this long. */
const STALE_MS = 4000;
/** HUD refresh. Deliberately far slower than the 20Hz position feed. */
const HUD_MS = 250;
/** Every level's par added up; a run at par scores the full time bonus. */
const PAR_MS = LANTERN_LEAP_LEVELS.reduce((total, level) => total + level.parTime, 0) * 1000;
const COIN_POINTS = 12;
const MAX_COIN_SCORE = 600;
const MAX_TIME_SCORE = 400;

type LocalState = { x: number; y: number; facing: 1 | -1; motion: string; bubbled: boolean };
type RemoteEntry = LocalState & { id: string; name: string; seat: number; coins: number; at: number };

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function payloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function LanternLeapClient() {
  const game = useMiniGameSession("lantern-leap", { maxPlayers: 8 });
  const { sessionId, seats, mySeat, myProfileId, moves, submitMove, handleReward, loading } = game;

  const [error, setError] = useState<string | null>(null);
  /* Optimistic copy of the host's own level change, and the whole story when
     Supabase is not configured. The move log always wins once it lands. */
  const [localLevel, setLocalLevel] = useState<{ index: number; startAt: number } | null>(null);
  /* Everything the HUD needs, snapshotted off the live refs 4x a second. The
     position feed itself never touches React. */
  const [hud, setHud] = useState<{
    now: number;
    coins: number;
    bubbled: boolean;
    finished: boolean;
    remotes: Array<{ id: string; coins: number; bubbled: boolean }>;
  }>(() => ({ now: Date.now(), coins: 0, bubbled: false, finished: false, remotes: [] }));
  const now = hud.now;

  /* The canvas keeps its own ref to this list, so replacing the array here
     updates remote bodies without restarting the Three.js scene. */
  const [remoteSnapshot, setRemoteSnapshot] = useState<{ level: number; entries: RemoteEntry[] }>(() => ({
    level: 0,
    entries: [],
  }));

  const channelRef = useRef<RealtimeChannel | null>(null);
  const remotesRef = useRef(new Map<string, RemoteEntry>());
  const coinsRef = useRef(0);
  const myStateRef = useRef<LocalState | null>(null);
  const finishedRef = useRef(false);
  const advancingRef = useRef(false);
  const claimedRef = useRef(false);
  const levelIndexRef = useRef(0);
  const playerIdRef = useRef("local-keeper");

  const seatIndex = mySeat?.seat_index ?? 0;
  const isHost = seatIndex === 0;
  const myName = mySeat?.display_name ?? "You";
  const playerId = myProfileId ?? "local-keeper";

  /* ---- everything about "where are we" is derived from the move log ---- */

  const loggedStarts = useMemo(() => {
    const starts = new Map<number, number>();
    for (const move of moves) {
      if (move.move_type !== "start") continue;
      const index = payloadNumber(move.payload, "levelIndex");
      const startAt = payloadNumber(move.payload, "startAt");
      if (index !== null && startAt !== null) starts.set(index, startAt);
    }
    return starts;
  }, [moves]);

  /* One "complete" move per cleared level, so the count IS the level we are
     on. A reload or a late join replays the log and lands in the same place. */
  const loggedIndex = useMemo(() => {
    const cleared = new Set<number>();
    for (const move of moves) {
      if (move.move_type !== "complete") continue;
      const index = payloadNumber(move.payload, "levelIndex");
      if (index !== null) cleared.add(index);
    }
    return cleared.size;
  }, [moves]);

  const levelIndex = Math.max(loggedIndex, localLevel?.index ?? 0);
  const runOver = levelIndex >= LANTERN_LEAP_LEVELS.length;
  const level = LANTERN_LEAP_LEVELS[Math.min(levelIndex, LANTERN_LEAP_LEVELS.length - 1)];
  const levelStartAt =
    loggedStarts.get(levelIndex) ?? (localLevel?.index === levelIndex ? localLevel.startAt : null);
  const started = levelStartAt !== null && !runOver;

  /** profile id -> their time on the level we are playing right now. */
  const finishedThisLevel = useMemo(() => {
    const times = new Map<string, number>();
    for (const move of moves) {
      if (move.move_type !== "finish") continue;
      if (payloadNumber(move.payload, "levelIndex") !== levelIndex) continue;
      times.set(move.profile_id, payloadNumber(move.payload, "ms") ?? 0);
    }
    return times;
  }, [moves, levelIndex]);

  const myTotalMs = useMemo(
    () =>
      moves.reduce(
        (total, move) =>
          move.move_type === "finish" && move.profile_id === myProfileId
            ? total + (payloadNumber(move.payload, "ms") ?? 0)
            : total,
        0,
      ),
    [moves, myProfileId],
  );

  useEffect(() => {
    levelIndexRef.current = levelIndex;
  }, [levelIndex]);
  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  const refillList = useCallback(() => {
    setRemoteSnapshot({ level: levelIndexRef.current, entries: [...remotesRef.current.values()] });
  }, []);

  /* New level: fresh world, fresh finish flag, drop stale ghosts. Coins keep
     accumulating — they are the run's score, not the level's. */
  useEffect(() => {
    finishedRef.current = false;
    advancingRef.current = false;
    myStateRef.current = null;
    remotesRef.current.clear();
  }, [levelIndex]);

  /* ---- HUD pump: prune dead ghosts, snapshot the refs for render ---- */
  useEffect(() => {
    const pump = window.setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      let dropped = false;
      for (const [id, entry] of remotesRef.current) {
        if (entry.at >= cutoff) continue;
        remotesRef.current.delete(id);
        dropped = true;
      }
      if (dropped) refillList();
      setHud({
        now: Date.now(),
        coins: coinsRef.current,
        bubbled: Boolean(myStateRef.current?.bubbled),
        finished: finishedRef.current,
        remotes: [...remotesRef.current.values()].map((entry) => ({
          id: entry.id,
          coins: entry.coins,
          bubbled: entry.bubbled,
        })),
      });
    }, HUD_MS);
    return () => window.clearInterval(pump);
  }, [refillList]);

  /* ---- realtime: 20Hz positions, plus an instant level-change nudge ---- */
  useEffect(() => {
    if (!sessionId || !isSupabaseConfigured() || !myProfileId) return;
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`lanternleap:${sessionId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        const entry = payload as RemoteEntry;
        if (!entry?.id || entry.id === myProfileId) return;
        const known = remotesRef.current.get(entry.id);
        if (known) {
          // Mutate in place so the array the canvas holds stays current.
          Object.assign(known, entry, { at: Date.now() });
          return;
        }
        remotesRef.current.set(entry.id, { ...entry, at: Date.now() });
        refillList();
      })
      .on("broadcast", { event: "level" }, ({ payload }) => {
        const index = payloadNumber(payload as Record<string, unknown>, "index");
        const startAt = payloadNumber(payload as Record<string, unknown>, "startAt");
        if (index === null || startAt === null) return;
        setLocalLevel((current) => (current && current.index >= index ? current : { index, startAt }));
      })
      .subscribe();
    channelRef.current = channel;

    const pump = window.setInterval(() => {
      const cutoff = Date.now() - STALE_MS;
      let dropped = false;
      for (const [id, entry] of remotesRef.current) {
        if (entry.at >= cutoff) continue;
        remotesRef.current.delete(id);
        dropped = true;
      }
      if (dropped) refillList();
      setHud((current) => ({ ...current, now: Date.now() }));
    }, HUD_MS);

    return () => {
      window.clearInterval(pump);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
    // refillList is a useCallback with no deps of its own, so declaring it
    // here is honest without re-subscribing the channel on every render.
  }, [sessionId, myProfileId, refillList]);

  /* Offline / solo still needs a clock and a HUD tick. */
  useEffect(() => {
    if (sessionId && isSupabaseConfigured()) return;
    const timer = window.setInterval(() => {
      setHud((current) => ({ ...current, now: Date.now() }));
    }, HUD_MS);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  const handleLocalState = useCallback(
    (state: LocalState) => {
      myStateRef.current = state;
      const channel = channelRef.current;
      if (!channel || !myProfileId) return;
      void channel.send({
        type: "broadcast",
        event: "pos",
        payload: { ...state, id: myProfileId, name: myName, seat: seatIndex, coins: coinsRef.current },
      });
    },
    [myProfileId, myName, seatIndex],
  );

  const handleEvent = useCallback(
    (event: GameEvent) => {
      // Remote players are simulated locally too, so their events land here.
      if (event.playerId !== playerIdRef.current) return;
      if (event.type === "coin") coinsRef.current += 1;
      else if (event.type === "gem") coinsRef.current += 10;
      else if (event.type === "finish") {
        if (finishedRef.current) return;
        finishedRef.current = true;
        void submitMove("finish", { levelIndex: levelIndexRef.current, ms: event.ms });
      }
    },
    [submitMove],
  );

  const startLevel = useCallback(
    async (index: number) => {
      const startAt = Date.now();
      setLocalLevel({ index, startAt });
      channelRef.current?.send({ type: "broadcast", event: "level", payload: { index, startAt } });
      const result = await submitMove("start", {
        levelIndex: index,
        levelId: LANTERN_LEAP_LEVELS[index]?.id ?? "",
        startAt,
      });
      // Offline play is still allowed; the optimistic copy carries it.
      if (!result.ok && isSupabaseConfigured() && sessionId) {
        setError(result.reason ?? "Could not start the level.");
      }
    },
    [sessionId, submitMove],
  );

  /* ---- host drives progression; everyone else follows the log ---- */
  const roster = useMemo(
    () =>
      seats.length > 0
        ? seats.map((seat) => ({ id: seat.profile_id, name: seat.display_name, seat: seat.seat_index }))
        : [{ id: playerId, name: myName, seat: seatIndex }],
    [seats, playerId, myName, seatIndex],
  );

  /* A seat stops holding the level up once it has finished, is stuck in a
     bubble nobody can reach any more, or has simply gone quiet. */
  const seatBlocking = useCallback(
    (id: string) => {
      if (finishedThisLevel.has(id)) return false;
      if (id === playerId) return !(finishedRef.current || myStateRef.current?.bubbled);
      const remote = remotesRef.current.get(id);
      if (!remote) return false;
      return !remote.bubbled;
    },
    [finishedThisLevel, playerId],
  );

  useEffect(() => {
    if (!isHost || !started || runOver || advancingRef.current) return;
    // Give every client a beat to appear before "nobody is blocking" can be
    // true, otherwise the first tick of a level could advance it.
    if (levelStartAt === null || now - levelStartAt < 1500) return;
    if (roster.some((entry) => seatBlocking(entry.id))) return;
    advancingRef.current = true;
    void (async () => {
      const cleared = levelIndex;
      const result = await submitMove("complete", {
        levelIndex: cleared,
        levelId: LANTERN_LEAP_LEVELS[cleared]?.id ?? "",
      });
      if (!result.ok && isSupabaseConfigured() && sessionId) {
        setError(result.reason ?? "Could not record the level.");
      }
      const next = cleared + 1;
      if (next < LANTERN_LEAP_LEVELS.length) await startLevel(next);
      else setLocalLevel({ index: next, startAt: Date.now() });
    })();
    // `now` is the 4Hz HUD tick: it is what re-checks the live bubble state.
  }, [now, levelStartAt, isHost, started, runOver, roster, seatBlocking, levelIndex, sessionId, startLevel, submitMove]);

  /* ---- reward, once, when the last level is done ---- */
  useEffect(() => {
    if (!runOver || claimedRef.current) return;
    claimedRef.current = true;
    const coinScore = Math.min(MAX_COIN_SCORE, coinsRef.current * COIN_POINTS);
    const timeScore =
      myTotalMs > 0 ? Math.min(MAX_TIME_SCORE, Math.round((PAR_MS / myTotalMs) * MAX_TIME_SCORE)) : 0;
    handleReward({
      gameId: "lantern-leap",
      label: "Lantern Leap",
      score: Math.min(1000, coinScore + timeScore),
      coins: 0,
      hearts: 0,
    });
  }, [runOver, myTotalMs, handleReward]);

  /* ---- HUD ----
     ponytail: the chips read live refs during a render the 4Hz tick just
     caused. Mirroring positions and coins into state would re-render the page
     20 times a second for no visible gain. */
  const remoteHud = new Map(hud.remotes.map((entry) => [entry.id, entry]));
  const remoteList = remoteSnapshot.level === levelIndex ? remoteSnapshot.entries : [];
  const chips = roster.map((entry) => {
    const mine = entry.id === playerId;
    const remote = remoteHud.get(entry.id);
    const finishMs = finishedThisLevel.get(entry.id) ?? null;
    const bubbled = mine ? hud.bubbled : Boolean(remote?.bubbled);
    let status: "done" | "bubble" | "away" | "playing" = "playing";
    if (finishMs !== null) status = "done";
    else if (bubbled) status = "bubble";
    else if (!mine && !remote) status = "away";
    return {
      ...entry,
      mine,
      coins: mine ? hud.coins : (remote?.coins ?? 0),
      status,
      finishMs,
    };
  });

  const elapsed = levelStartAt === null ? 0 : Math.max(0, now - levelStartAt);
  const waitingOn = chips.filter((chip) => chip.status === "playing" || chip.status === "bubble").length;
  const iFinished = finishedThisLevel.has(playerId) || hud.finished;

  return (
    <div className="grid gap-4">
      <section className="flex flex-col justify-between gap-3 rounded-lg border border-lavender-300/50 bg-lavender-100/65 p-4 shadow-sm sm:p-5 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-ink-700">Co-op platformer</p>
          <h1 className="mt-1 font-display text-3xl text-ink-900 sm:text-4xl">Lantern Leap</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Two to eight keepers run {LANTERN_LEAP_LEVELS.length} lantern-lit levels together. Grab coins and gems,
            stomp the critters, and pop a friend&apos;s bubble to free them. Everybody has to reach the goal before the
            next level opens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/games">
              <ArrowLeft /> Games hub
            </Link>
          </Button>
        </div>
      </section>

      {error && (
        <p className="rounded-lg border border-blush-300/50 bg-blush-100/70 p-3 text-sm font-extrabold text-ink-900">
          {error}
        </p>
      )}

      {/* HUD */}
      <section className="grid gap-3 rounded-lg border border-cream-300 bg-cream-50/90 p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-black text-ink-900">
            <span className="rounded-full bg-lavender-100 px-2 py-0.5 text-xs font-extrabold text-ink-700">
              Level {Math.min(levelIndex + 1, LANTERN_LEAP_LEVELS.length)} of {LANTERN_LEAP_LEVELS.length}
            </span>{" "}
            {level.name}
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-mono text-sm font-black text-ink-900 shadow-sm">
            <Timer className="size-4 text-ink-500" /> {formatTime(elapsed)}
          </span>
        </div>
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li
              className="inline-flex items-center gap-2 rounded-full border border-cream-300 bg-white px-3 py-1.5 text-sm font-extrabold text-ink-900 shadow-sm"
              key={chip.id}
            >
              <span
                aria-hidden
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: heartRushSeatCss(chip.seat) }}
              />
              <span>{chip.mine ? `${chip.name} (you)` : chip.name}</span>
              <span className="inline-flex items-center gap-1 text-honey-700">
                <Coins className="size-3.5" /> {chip.coins}
              </span>
              {chip.status === "done" && (
                <span className="inline-flex items-center gap-1 text-garden-700">
                  <Flag className="size-3.5" /> {formatTime(chip.finishMs ?? 0)}
                </span>
              )}
              {chip.status === "bubble" && <span className="text-ink-500">in a bubble</span>}
              {chip.status === "away" && <span className="text-ink-500">away</span>}
            </li>
          ))}
        </ul>
      </section>

      <div className="relative">
        {loading ? (
          <div className="grid min-h-[360px] place-items-center rounded-lg bg-[#1b1430] text-sm font-extrabold text-cream-50">
            Lighting the lanterns...
          </div>
        ) : (
          <LanternLeapLoader
            levelId={level.id}
            onError={setError}
            onEvent={handleEvent}
            onLocalState={handleLocalState}
            paused={!started}
            playerId={playerId}
            playerName={myName}
            remotes={remoteList}
            seatIndex={seatIndex}
          />
        )}

        {/* Not running yet */}
        {!loading && !started && !runOver && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-ink-900/55 p-4 text-center">
            <div className="max-w-sm rounded-lg bg-cream-50 p-5 shadow-lg">
              <h2 className="font-display text-2xl text-ink-900">Ready to leap?</h2>
              <p className="mt-2 text-sm font-bold leading-5 text-ink-700">
                <span className="font-black">A</span> and <span className="font-black">D</span> to run,{" "}
                <span className="font-black">Space</span> to jump, <span className="font-black">Shift</span> to sprint,{" "}
                <span className="font-black">S</span> to ground pound. Touch a bubbled friend to pop them free.
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-extrabold text-ink-500">
                <Users className="size-3.5" /> {roster.length} keeper{roster.length === 1 ? "" : "s"} ready
              </p>
              {isHost ? (
                <Button className="mt-4 w-full" onClick={() => void startLevel(levelIndex)}>
                  <Play /> Start level {levelIndex + 1}
                </Button>
              ) : (
                <p className="mt-4 rounded-md bg-cream-100 px-3 py-2 text-xs font-extrabold text-ink-700">
                  Waiting for the host to start.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Finished the level, teammates still out there */}
        {started && iFinished && waitingOn > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
            <p className="mx-auto w-fit rounded-full bg-ink-900/80 px-4 py-2 text-sm font-black text-cream-50 shadow-lg">
              Goal reached! Waiting for {waitingOn} teammate{waitingOn === 1 ? "" : "s"}...
            </p>
          </div>
        )}

        {/* Whole run done */}
        {runOver && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-ink-900/60 p-4">
            <div className="w-full max-w-sm rounded-lg bg-cream-50 p-5 text-center shadow-lg">
              <Trophy className="mx-auto size-8 text-honey-700" />
              <h2 className="mt-2 font-display text-2xl text-ink-900">All lanterns lit!</h2>
              <p className="mt-1 text-sm font-bold text-ink-700">
                {hud.coins} coins collected in {formatTime(myTotalMs)}.
              </p>
              {/* ponytail: no "play again" — a replay means a fresh session,
                  and the games hub already starts one. */}
              <Button asChild className="mt-4 w-full" variant="secondary">
                <Link href="/app/games">
                  <ArrowLeft /> Games hub
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>

      <RewardWalletPanel />
    </div>
  );
}
