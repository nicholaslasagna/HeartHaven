"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { LANTERN_LEAP_LEVELS } from "@/lib/game/lantern-leap/levels";

const Canvas = dynamic(
  () => import("@/components/game/lantern-leap/lantern-leap-canvas").then((m) => m.LanternLeapCanvas),
  { ssr: false, loading: () => <div className="grid h-[540px] place-items-center text-sm font-bold text-white/70">Lighting the lanterns…</div> },
);

export function LanternLeapPreview() {
  const [levelId, setLevelId] = useState(LANTERN_LEAP_LEVELS[0].id);
  const [coins, setCoins] = useState(0);
  const [players, setPlayers] = useState(1);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-[#120d22] p-4 text-white sm:p-6">
      <div className="mx-auto grid max-w-6xl gap-3">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-white/50">Dev harness</p>
            <h1 className="text-2xl font-black">Lantern Leap</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {LANTERN_LEAP_LEVELS.map((level) => (
              <button
                className={`rounded-full px-3 py-1.5 text-sm font-extrabold transition ${
                  level.id === levelId ? "bg-white text-[#120d22]" : "bg-white/10 text-white/80 hover:bg-white/20"
                }`}
                key={level.id}
                onClick={() => { setLevelId(level.id); setCoins(0); }}
                type="button"
              >
                {level.name}
              </button>
            ))}
            <label className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-extrabold text-white/80">
              Players
              <select
                className="rounded bg-transparent font-black text-white outline-none"
                onChange={(event) => setPlayers(Number(event.target.value))}
                value={players}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
                  <option className="text-[#120d22]" key={count} value={count}>{count}</option>
                ))}
              </select>
            </label>
            <span className="rounded-full bg-amber-300/20 px-3 py-1.5 text-sm font-black text-amber-200">
              {coins} coins
            </span>
          </div>
        </header>

        {error && <p className="rounded-lg bg-rose-500/20 p-3 text-sm font-bold text-rose-200">{error}</p>}

        <Canvas
          devBots={players - 1}
          key={`${levelId}:${players}`}
          levelId={levelId}
          onError={setError}
          onEvent={(event) => {
            if (event.type === "coin") setCoins((c) => c + 1);
            if (event.type === "gem") setCoins((c) => c + 10);
          }}
          playerId="local"
          playerName="You"
          seatIndex={0}
        />

        <p className="text-sm font-semibold text-white/60">
          <span className="font-black text-white">←/→</span> or <span className="font-black text-white">A/D</span> move ·{" "}
          <span className="font-black text-white">Space</span>/<span className="font-black text-white">W</span> jump ·{" "}
          <span className="font-black text-white">Shift</span> run · <span className="font-black text-white">S</span> duck &amp; ground pound
        </p>
      </div>
    </main>
  );
}
