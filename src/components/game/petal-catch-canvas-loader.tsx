"use client";

import dynamic from "next/dynamic";
import type { GameReward } from "@/lib/game/rewards";

const PetalCatchCanvas = dynamic(
  () => import("@/components/game/petal-catch-canvas").then((module) => module.PetalCatchCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[340px] place-items-center rounded-lg border border-blush-300/50 bg-blush-100/60 text-sm font-extrabold text-ink-700">
        Gathering petals...
      </div>
    ),
  },
);

type PetalCatchCanvasLoaderProps = {
  onReward?: (reward: GameReward) => void;
};

export function PetalCatchCanvasLoader({ onReward }: PetalCatchCanvasLoaderProps) {
  return <PetalCatchCanvas onReward={onReward} />;
}
