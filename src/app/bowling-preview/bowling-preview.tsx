"use client";

import { useState } from "react";
import { MoonberryBowlingLoader } from "@/components/game/moonberry-bowling-loader";
import type { LoggedThrow } from "@/lib/game/moonberry-bowling/match";

/**
 * Local harness: the canvas with a throw log kept in React state instead of
 * a Supabase session. Lets the alley be looked at, screenshotted and graded
 * without signing in. Development only — the page around this 404s in prod.
 */
export function BowlingPreview() {
  const [throws, setThrows] = useState<LoggedThrow[]>([]);
  const [seatCount, setSeatCount] = useState(4);

  const seatNames = Array.from({ length: 8 }, (_, i) => `Keeper ${i + 1}`);
  const currentSeat = throws.length === 0 ? 0 : seatOf(throws.length, seatCount);

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Moonberry Bowling — preview harness</h1>
        <div className="flex items-center gap-2 text-sm font-bold">
          <label htmlFor="seats">Players</label>
          <select
            className="rounded border px-2 py-1"
            id="seats"
            onChange={(event) => { setSeatCount(Number(event.target.value)); setThrows([]); }}
            value={seatCount}
          >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="rounded border px-3 py-1" onClick={() => setThrows([])} type="button">
            Reset rack
          </button>
        </div>
      </header>

      <MoonberryBowlingLoader
        currentSeat={currentSeat}
        gameOver={false}
        mySeatIndex={null}
        onThrow={async (details) => {
          setThrows((current) => [
            ...current,
            { moveIndex: current.length, seat: currentSeat, ...details },
          ]);
          return { ok: true };
        }}
        seatCount={seatCount}
        seatNames={seatNames}
        sessionId="preview"
        throws={throws}
      />

      <p className="text-sm text-neutral-500">
        {throws.length} throw{throws.length === 1 ? "" : "s"} logged. Swipe up over the lane to bowl; curve the flick to
        hook.
      </p>
    </main>
  );
}

/** Rough seat rotation, good enough for a harness. */
function seatOf(throwCount: number, seatCount: number) {
  return Math.floor(throwCount / 2) % seatCount;
}
