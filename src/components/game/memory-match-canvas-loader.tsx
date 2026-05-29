"use client";

import dynamic from "next/dynamic";
import type { MemoryMatchMode } from "@/lib/game/memory-match-state";
import type { GameReward } from "@/lib/game/rewards";
import type { GameSessionSeat } from "@/lib/game/use-game-session";

const MemoryMatchCanvas = dynamic(
  () => import("@/components/game/memory-match-canvas").then((module) => module.MemoryMatchCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[360px] place-items-center rounded-lg border border-lavender-300/50 bg-lavender-100/70 text-sm font-extrabold text-ink-700">
        Shuffling keepsake cards...
      </div>
    ),
  },
);

type MemoryMatchCanvasLoaderProps = {
  mode: MemoryMatchMode;
  onReward?: (reward: GameReward) => void;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
  seats?: GameSessionSeat[];
  mySeatIndex?: number | null;
  submitFlip?: (cardIndex: number) => Promise<{ ok: boolean; reason?: string }>;
};

export function MemoryMatchCanvasLoader({
  mode,
  metadata,
  mySeatIndex,
  onReward,
  seats,
  sessionId,
  submitFlip,
}: MemoryMatchCanvasLoaderProps) {
  return (
    <MemoryMatchCanvas
      key={`${mode}-${sessionId ?? "local"}`}
      metadata={metadata}
      mode={mode}
      mySeatIndex={mySeatIndex}
      onReward={onReward}
      seats={seats}
      sessionId={sessionId}
      submitFlip={submitFlip}
    />
  );
}
