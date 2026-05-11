"use client";

import dynamic from "next/dynamic";
import type { CozyQuestVariant } from "@/components/game/cozy-quest-canvas";
import type { GameReward } from "@/lib/game/rewards";

const CozyQuestCanvas = dynamic(
  () => import("@/components/game/cozy-quest-canvas").then((module) => module.CozyQuestCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[340px] place-items-center rounded-lg border border-blush-300/50 bg-blush-100/65 text-sm font-extrabold text-ink-700">
        Preparing the party game...
      </div>
    ),
  },
);

type CozyQuestCanvasLoaderProps = {
  variant: CozyQuestVariant;
  onReward?: (reward: GameReward) => void;
};

export function CozyQuestCanvasLoader({ variant, onReward }: CozyQuestCanvasLoaderProps) {
  return <CozyQuestCanvas key={variant} variant={variant} onReward={onReward} />;
}
