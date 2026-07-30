"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, Flag, Play, Trophy, Users } from "lucide-react";
import { MoonberryRacingLoader } from "@/components/game/moonberry-racing-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { MOONBERRY_COURSES } from "@/lib/game/moonberry-racing/courses";
import { kartColor } from "@/lib/game/moonberry-racing/renderer";
import type { RacerReport } from "@/lib/game/moonberry-racing/race";
import type { ItemEvent } from "@/components/game/moonberry-racing-canvas";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

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
  const channelRef = useRef<RealtimeChannel | null>(null);
  const remoteHandlersRef = useRef(new Set<(report: RacerReport) => void>());
  const itemHandlersRef = useRef(new Set<(event: ItemEvent) => void>());

  const mySeatIndex = mySeat?.seat_index ?? null;
  const isHost = (mySeatIndex ?? 0) === 0;

  /* -- derived race state, straight off the ordered move log -- */
  const raceSetup = useMemo(() => {
    let courseId = MOONBERRY_COURSES[0].id;
    let startAt: number | null = null;
    for (const move of moves) {
      const payload = move.payload as { courseId?: string; startAt?: number };
      if (move.move_type === "course" && payload?.courseId) courseId = payload.courseId;
      if (move.move_type === "start" && Number(payload?.startAt) > 0) {
        // Later stamps win, so a rematch supersedes the previous race.
        startAt = Math.max(startAt ?? 0, Number(payload.startAt));
      }
    }
    return { courseId, startAt };
  }, [moves]);

  const course = useMemo(
    () => MOONBERRY_COURSES.find((c) => c.id === raceSetup.courseId) ?? MOONBERRY_COURSES[0],
    [raceSetup.courseId],
  );

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
      })),
    [seats, mySeat?.profile_id],
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

  return (
    <div className="grid gap-4">
      <section className="flex flex-col justify-between gap-3 rounded-lg border border-lavender-300/50 bg-lavender-100/60 p-4 shadow-sm sm:p-5 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-700">Party circuit</p>
          <h1 className="mt-1 font-display text-3xl text-ink-900 sm:text-4xl">Moonberry Racing</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Two to eight keepers, three laps, three courses. Hold <span className="font-black">Shift</span> to drift and
            hit <span className="font-black">Space</span> in the sweet spot for a boost.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/app/games"><ArrowLeft /> Games hub</Link>
        </Button>
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
        startAt={raceSetup.startAt}
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

        {isHost && !started && (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-1 text-sm font-extrabold text-ink-800">
              Course
              <select
                className="rounded-md border border-cream-300 bg-cream-50 px-3 py-2"
                onChange={(event) => void pickCourse(event.target.value)}
                value={course.id}
              >
                {MOONBERRY_COURSES.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
            </label>
            <Button onClick={() => void startRace()}>
              <Play /> Start race
            </Button>
          </div>
        )}
        {!isHost && !started && (
          <p className="rounded-md bg-cream-100 px-3 py-2 text-xs font-extrabold text-ink-600">
            Waiting for the host to pick a course and start the race.
          </p>
        )}
        {isHost && started && (
          <Button onClick={() => void startRace()} variant="secondary">
            <Flag /> Restart race
          </Button>
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
                  {finished ? `${(finished.ms / 1000).toFixed(2)}s` : started ? "racing" : "ready"}
                </span>
              </li>
            );
          })}
        </ol>

        {results.length > 0 && (
          <div className="grid gap-1.5 rounded-md border border-honey-500/30 bg-honey-100/50 p-3">
            <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase text-honey-800">
              <Trophy className="size-3.5" /> Results
            </p>
            {results.map((entry, index) => (
              <p className="text-sm font-extrabold text-ink-800" key={entry.profileId}>
                {index + 1}. {entry.name} — {(entry.ms / 1000).toFixed(2)}s
              </p>
            ))}
          </div>
        )}
      </section>

      <RewardWalletPanel />
    </div>
  );
}
