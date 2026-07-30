"use client";

import { useMemo, useState } from "react";
import { MoonberryRacingLoader } from "@/components/game/moonberry-racing-loader";
import { MOONBERRY_COURSES } from "@/lib/game/moonberry-racing/courses";

/**
 * Local harness: real courses, real handling, seats held in React state
 * instead of a Supabase session. Lets every stage be loaded, driven and
 * screenshotted without signing in.
 */
export function RacingPreview() {
  const [courseIndex, setCourseIndex] = useState(0);
  const [seatCount, setSeatCount] = useState(4);
  const [started, setStarted] = useState(false);
  const [startAt, setStartAt] = useState<number | null>(null);

  const course = MOONBERRY_COURSES[courseIndex];
  const seats = useMemo(
    () =>
      Array.from({ length: seatCount }, (_, i) => ({
        id: `p${i}`,
        name: `Keeper ${i + 1}`,
        seat: i,
        local: i === 0,
      })),
    [seatCount],
  );

  /* Stand-in for the transport: no network, so remote karts simply hold
     their grid slots. Real multiplayer lives on the app route. */
  const subscribeRemote = () => () => {};

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Moonberry Racing — preview harness</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <label htmlFor="course">Course</label>
          <select
            className="rounded border px-2 py-1"
            id="course"
            onChange={(e) => { setCourseIndex(Number(e.target.value)); setStarted(false); setStartAt(null); }}
            value={courseIndex}
          >
            {MOONBERRY_COURSES.map((c, i) => <option key={c.id} value={i}>{c.name}</option>)}
          </select>
          <label htmlFor="racers">Racers</label>
          <select
            className="rounded border px-2 py-1"
            id="racers"
            onChange={(e) => { setSeatCount(Number(e.target.value)); setStarted(false); setStartAt(null); }}
            value={seatCount}
          >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            className="rounded bg-ink-900 px-3 py-1 text-cream-50"
            onClick={() => { setStartAt(Date.now() + 3000); setStarted(true); }}
            type="button"
          >
            {started ? "Restart race" : "Start race"}
          </button>
        </div>
      </header>

      <MoonberryRacingLoader
        course={course}
        isHost
        localId="p0"
        seats={seats}
        startAt={startAt}
        subscribeRemote={subscribeRemote}
      />

      <p className="text-sm text-neutral-500">
        {course.name} · {course.points.length} control points · {course.checkpoints} checkpoints ·{" "}
        {course.laps} laps · {course.boostPads.length} boost pads · {course.ramps.length} ramps ·{" "}
        {course.hazards.length} hazards · {course.itemBoxes.length} item boxes
      </p>
    </main>
  );
}
