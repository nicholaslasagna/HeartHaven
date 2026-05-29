"use client";

import dynamic from "next/dynamic";
import type { GameReward } from "@/lib/game/rewards";

const GardenFourCanvas = dynamic(
  () => import("@/components/game/garden-four-canvas").then((module) => module.GardenFourCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[360px] place-items-center rounded-lg border border-garden-300/50 bg-garden-100/65 text-sm font-extrabold text-ink-700">
        Growing the Garden Four arbor...
      </div>
    ),
  },
);

type GardenFourCanvasLoaderProps = {
  onReward?: (reward: GameReward) => void;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
  mySeatIndex?: number | null;
  submitDrop?: (column: number) => Promise<{ ok: boolean; reason?: string }>;
};

export function GardenFourCanvasLoader({
  metadata,
  mySeatIndex,
  onReward,
  sessionId,
  submitDrop,
}: GardenFourCanvasLoaderProps) {
  return (
    <GardenFourCanvas
      metadata={metadata}
      mySeatIndex={mySeatIndex}
      onReward={onReward}
      sessionId={sessionId}
      submitDrop={submitDrop}
    />
  );
}
