"use client";

import dynamic from "next/dynamic";
import type { BowlingRoll } from "@/lib/game/bowling-scoring";

const BowlingCanvas = dynamic(
  () => import("@/components/game/bowling-canvas").then((module) => module.BowlingCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[360px] place-items-center rounded-lg border border-honey-500/30 bg-honey-100/65 text-sm font-extrabold text-ink-700">
        Polishing the moonberry lane...
      </div>
    ),
  },
);

type BowlingCanvasLoaderProps = {
  rolls: BowlingRoll[];
  mySeatIndex: number | null;
  seatCount: number;
  seatNames: string[];
  onRoll: (details: { aim: number; power: number }) => Promise<{ ok: boolean; reason?: string }>;
  rollLocked?: boolean;
  sessionId?: string | null;
};

export function BowlingCanvasLoader(props: BowlingCanvasLoaderProps) {
  return <BowlingCanvas {...props} />;
}
