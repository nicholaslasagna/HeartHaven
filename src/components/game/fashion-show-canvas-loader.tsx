"use client";

import dynamic from "next/dynamic";
import type { GameReward } from "@/lib/game/rewards";

const FashionShowCanvas = dynamic(
  () => import("@/components/game/fashion-show-canvas").then((module) => module.FashionShowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[360px] place-items-center rounded-lg border border-blush-300/50 bg-blush-100/65 text-sm font-extrabold text-ink-700">
        Lighting the runway...
      </div>
    ),
  },
);

type FashionShowCanvasLoaderProps = {
  onReward?: (reward: GameReward) => void;
};

export function FashionShowCanvasLoader({ onReward }: FashionShowCanvasLoaderProps) {
  return <FashionShowCanvas onReward={onReward} />;
}
