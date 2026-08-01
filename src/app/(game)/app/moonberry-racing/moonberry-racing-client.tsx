"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, Check, Flag, Play, Trophy, Users } from "lucide-react";
import { CompanionCameo } from "@/components/game/companion-cameo";
import { MoonberryRacingLoader } from "@/components/game/moonberry-racing-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { MOONBERRY_COURSES } from "@/lib/game/moonberry-racing/courses";
import { canStartRace, deriveRaceSetup, MAX_LAPS, MIN_LAPS } from "@/lib/game/moonberry-racing/session";
import { kartColor } from "@/lib/game/moonberry-racing/renderer";
import type { RacerReport } from "@/lib/game/moonberry-racing/race";
import type { ItemEvent } from "@/components/game/moonberry-racing-canvas";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { COMPANION_ROSTER_EVENT, getActiveCompanion, type CompanionRecord } from "@/lib/game/companion-roster";

/**
 * Moonberry Racing — session wiring for 2-8 racers.
 *
 * TRANSPORT MODEL, and why it is split in two:
 *
 *   • Kart POSES go over a realtime broadcast channel at 20Hz. They are
 *     high-frequency, worthless a second later, and losing one should look
 *     like smoothing rather than a rollback — so they are deliberately NOT
 *     persisted. Nothing about the result depends on them.
 *
 *   • Anything that DECIDES the race — the course, the shared start stamp,
 *     and each finish — goes through the ordered `game_moves` log. That log
 *     survives a reload, a late join and a disconnect, so every client
 *     reconstructs the same race from it.
 *
 * The countdown is derived from the logged start stamp rather than counted
 * locally, which is what keeps eight machines in step without a tick message.
 */
export function MoonberryRacingClient() {
  const game = useMiniGameSession("moonberry-racing", { maxPlayers: 8 });
  const { sessionId, seats, mySeat, moves, submitMove, handleReward } = game;

  const [error, setError] = useState<string | null>(null);
  const [activeCompanion, setActiveCompanion] = useState<CompanionRecord | null>(() => getActiveCompanion() ?? null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const remoteHandlersRef = useRef(new Set<(report: RacerReport) => void>());
  const itemHandlersRef = useRef(new Set<(event: ItemEvent) => void>());

  const mySeatIndex = mySeat?.seat_index ?? null;
  const isHost = (mySeatIndex ?? 0) === 0;

  useEffect(() => {
    const syncCompanion = () => setActiveCompanion(getActiveCompanion() ?? null);
    window.addEventListener(COMPANION_ROSTER_EVENT, syncCompanion);
    return () => window.removeEventListener(COMPANION_ROSTER_EVENT, syncCompanion);
  }, []);

  const companionPayload = useMemo(
    () => activeCompanion
      ? {
          speciesId: activeCompanion.speciesId,
          toneId: activeCompanion.toneId,
          accessory: activeCompanion.accessory,
        }
      : undefined,
    [activeCompanion],
  );

  /* -- derived race state, straight off the ordered move log -- */
  const raceSetup = useMemo(
    () => deriveRaceSetup(moves, MOONBERRY_COURSES[0].id),
    [moves],
  );

  const course = useMemo(() => {
    const base = MOONBERRY_COURSES.find((c) => c.id === raceSetup.courseId) ?? MOONBERRY_COURSES[0];
    // A course ships a default lap count; the lobby's choice overrides it.
    return base.laps === raceSetup.laps ? base : { ...base, laps: raceSetup.laps };
  }, [raceSetup.courseId, raceSetup.laps]);

  const results = useMemo(
    () =>
      moves
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
        .sort((a, b) => a.ms - b.ms),
    [moves, seats],
  );

  const racingSeats = useMemo(
    () =>
      seats.map((seat) => ({
        id: seat.profile_id,
        name: seat.display_name ?? `Player ${(seat.seat_index ?? 0) + 1}`,
        seat: seat.seat_index ?? 0,
        local: seat.profile_id === mySeat?.profile_id,
        companion: seat.profile_id === mySeat?.profile_id ? companionPayload : undefined,
      })),
    [companionPayload, seats, mySeat?.profile_id],
  );

  /* -- realtime: 20Hz kart poses, never persisted -- */
  useEffect(() => {
    if (!sessionId || !isSupabaseConfigured()) return;
    const supabase = getSupabaseBrowserClient();
    // A single colon in the topic: Supabase parses extra colons as a
    // postgres_changes filter and the channel silently never connects.
    const channel = supabase
      .channel(`moonberry-racing.${sessionId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "pose" }, ({ payload }) => {
        const report = payload as RacerReport;
        if (!report?.racerId) return;
        for (const handler of remoteHandlersRef.current) handler(report);
      })
      /* Item traffic rides the same channel but is a different event, because
         it is rare and every client must act on it — unlike a pose, dropping
         one leaves a crate up on one screen and gone on another. */
      .on("broadcast", { event: "item" }, ({ payload }) => {
        const event = payload as ItemEvent;
        if (!event?.racerId) return;
        for (const handler of itemHandlersRef.current) handler(event);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const onReport = useCallback((report: RacerReport) => {
    channelRef.current?.send({ type: "broadcast", event: "pose", payload: report });
  }, []);

  const subscribeRemote = useCallback((handler: (report: RacerReport) => void) => {
    remoteHandlersRef.current.add(handler);
    return () => { remoteHandlersRef.current.delete(handler); };
  }, []);

  const onItemEvent = useCallback((event: ItemEvent) => {
    channelRef.current?.send({ type: "broadcast", event: "item", payload: event });
  }, []);

  const subscribeItems = useCallback((handler: (event: ItemEvent) => void) => {
    itemHandlersRef.current.add(handler);
    return () => { itemHandlersRef.current.delete(handler); };
  }, []);

  /* -- host controls -- */
  const startRace = useCallback(async () => {
    const startAt = Date.now() + 3200;
    const result = await submitMove("start", { startAt, courseId: course.id });
    if (!result.ok) setError(result.reason ?? "Could not start the race.");
  }, [submitMove, course.id]);

  const pickCourse = useCallback(async (courseId: string) => {
    const result = await submitMove("course", { courseId });
    if (!result.ok) setError(result.reason ?? "Could not change the course.");
  }, [submitMove]);

  const setSettings = useCallback(async (next: { laps?: number; items?: boolean }) => {
    const result = await submitMove("settings", next);
    if (!result.ok) setError(result.reason ?? "Could not change the race settings.");
  }, [submitMove]);

  const toggleReady = useCallback(async (ready: boolean) => {
    const result = await submitMove("ready", { ready });
    if (!result.ok) setError(result.reason ?? "Could not update your ready state.");
  }, [submitMove]);

  const claimedRef = useRef(false);
  const onFinish = useCallback(
    (ms: number, position: number) => {
      void submitMove("finish", { ms, position, courseId: course.id });
      if (claimedRef.current) return;
      claimedRef.current = true;
      // Par-relative so a slow lap still pays; the server spec caps it.
      const score = Math.max(0, Math.min(1000, Math.round((180_000 / Math.max(1, ms)) * 1000)));
      handleReward({ gameId: "moonberry-racing", label: "Moonberry Racing", score, coins: 0, hearts: 0 });
    },
    [submitMove, handleReward, course.id],
  );
  useEffect(() => { claimedRef.current = false; }, [raceSetup.startAt]);

  const started = raceSetup.startAt !== null;
  const myProfileId = mySeat?.profile_id ?? null;
  const iAmReady = myProfileId !== null && raceSetup.readyIds.has(myProfileId);
  const readyCount = racingSeats.filter((seat) => raceSetup.readyIds.has(seat.id)).length;
  const everyoneReady = canStartRace(racingSeats.map((seat) => seat.id), raceSetup.readyIds);
  const didNotFinish = racingSeats.filter(
    (seat) => !results.some((entry) => entry.profileId === seat.id),
  );

  return (
    <div className="grid gap-4">
      <section className="flex flex-col justify-between gap-3 rounded-lg border border-lavender-300/50 bg-lavender-100/60 p-4 shadow-sm sm:p-5 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-700">Party circuit</p>
          <h1 className="mt-1 font-display text-3xl text-ink-900 sm:text-4xl">Moonberry Racing</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Two to eight keepers, three original circuits. Hold <span className="font-black">Shift</span> to drift and
            hit <span className="font-black">Space</span> in the sweet spot for a boost.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CompanionCameo />
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
        </div>
      </section>

      {error && (
        <p className="rounded-lg border border-blush-300/50 bg-blush-100/70 p-3 text-sm font-extrabold text-blush-700">
          {error}
        </p>
      )}

      <MoonberryRacingLoader
        course={course}
        isHost={isHost}
        localId={mySeat?.profile_id ?? "local"}
        onError={setError}
        onFinish={onFinish}
        onItemEvent={onItemEvent}
        onReport={onReport}
        seats={racingSeats.length > 0 ? racingSeats : [{ id: "local", name: "You", seat: 0, local: true }]}
        companion={companionPayload}
        startAt={raceSetup.startAt}
        itemsEnabled={raceSetup.items}
        subscribeItems={subscribeItems}
        subscribeRemote={subscribeRemote}
      />

      <section className="grid gap-3 rounded-lg border border-cream-300 bg-white/88 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-normal text-ink-600">
            <Users className="size-3.5" /> {Math.max(1, seats.length)} on the grid
          </p>
          <p className="text-xs font-black uppercase tracking-normal text-ink-600">{course.name}</p>
        </div>

        {isHost && (
          <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
            <label className="grid gap-1 text-sm font-extrabold text-ink-800">
              Course
              <select
                className="rounded-md border border-cream-300 bg-cream-50 px-3 py-2"
                onChange={(event) => void pickCourse(event.target.value)}
                value={raceSetup.courseId}
              >
                {MOONBERRY_COURSES.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-extrabold text-ink-800">
              Laps
              <select
                className="rounded-md border border-cream-300 bg-cream-50 px-3 py-2"
                onChange={(event) => void setSettings({ laps: Number(event.target.value) })}
                value={raceSetup.laps}
              >
                {Array.from({ length: MAX_LAPS - MIN_LAPS + 1 }, (_, i) => MIN_LAPS + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-md border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-extrabold text-ink-800">
              <input
                checked={raceSetup.items}
                onChange={(event) => void setSettings({ items: event.target.checked })}
                type="checkbox"
              />
              Power-ups
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {racingSeats.length > 1 && (
            <Button
              onClick={() => void toggleReady(!iAmReady)}
              variant={iAmReady ? "secondary" : "default"}
            >
              <Check /> {iAmReady ? "Ready — tap to cancel" : "I'm ready"}
            </Button>
          )}
          {isHost && (
            <Button disabled={!everyoneReady} onClick={() => void startRace()}>
              {started ? <><Flag /> Rematch</> : <><Play /> Start race</>}
            </Button>
          )}
          {racingSeats.length > 1 && (
            <span className="text-xs font-black uppercase tracking-normal text-ink-500">
              {readyCount}/{racingSeats.length} ready
            </span>
          )}
        </div>

        {!isHost && !started && (
          <p className="rounded-md bg-cream-100 px-3 py-2 text-xs font-extrabold text-ink-600">
            {course.name} · {raceSetup.laps} lap{raceSetup.laps === 1 ? "" : "s"} ·{" "}
            {raceSetup.items ? "power-ups on" : "power-ups off"} — waiting for the host to start.
          </p>
        )}
        {isHost && !everyoneReady && racingSeats.length > 1 && (
          <p className="rounded-md bg-cream-100 px-3 py-2 text-xs font-extrabold text-ink-600">
            Waiting for every racer to confirm before the lights go out.
          </p>
        )}

        <ol className="grid gap-1.5">
          {racingSeats.map((seat) => {
            const finished = results.find((r) => r.profileId === seat.id);
            return (
              <li
                className="flex items-center justify-between gap-2 rounded-md bg-cream-50 px-3 py-1.5 text-sm font-extrabold text-ink-800"
                key={seat.id}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: `#${kartColor(seat.seat).toString(16).padStart(6, "0")}` }}
                  />
                  {seat.name}
                  {seat.local && <span className="text-xs text-ink-500">(you)</span>}
                </span>
                <span className="font-mono text-xs">
                  {finished
                    ? `${(finished.ms / 1000).toFixed(2)}s`
                    : started
                      ? "racing"
                      : raceSetup.readyIds.has(seat.id)
                        ? "ready"
                        : "waiting"}
                </span>
              </li>
            );
          })}
        </ol>

        {results.length > 0 && (
          <div className="grid gap-1.5 rounded-md border border-honey-500/30 bg-honey-100/50 p-3">
            <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase text-honey-800">
              <Trophy className="size-3.5" /> Results · {course.name}
            </p>
            {results.map((entry, index) => (
              <p
                className="flex items-center justify-between gap-2 text-sm font-extrabold text-ink-800"
                key={entry.profileId}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: `#${kartColor(entry.seatIndex).toString(16).padStart(6, "0")}` }}
                  />
                  {index + 1}. {entry.name}
                </span>
                <span className="font-mono text-xs">
                  {(entry.ms / 1000).toFixed(2)}s
                  {/* Gap to the winner reads faster than four absolute times. */}
                  {index > 0 && (
                    <span className="ml-2 text-ink-500">
                      +{((entry.ms - results[0].ms) / 1000).toFixed(2)}
                    </span>
                  )}
                </span>
              </p>
            ))}
            {didNotFinish.map((seat) => (
              <p
                className="flex items-center justify-between gap-2 text-sm font-extrabold text-ink-500"
                key={seat.id}
              >
                <span>{seat.name}</span>
                <span className="font-mono text-xs">DNF</span>
              </p>
            ))}
          </div>
        )}
      </section>

      <RewardWalletPanel />
    </div>
  );
}
