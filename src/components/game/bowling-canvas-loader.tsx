"use client";

import dynamic from "next/dynamic";
import type { GameReward } from "@/lib/game/rewards";

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
  onReward?: (reward: GameReward) => void;
};

export function BowlingCanvasLoader({ onReward }: BowlingCanvasLoaderProps) {
  return <BowlingCanvas onReward={onReward} />;
}
