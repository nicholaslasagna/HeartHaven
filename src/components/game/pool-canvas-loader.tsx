"use client";

import dynamic from "next/dynamic";
import type { PoolSubmittedShot } from "@/components/game/pool-canvas";
import type { PoolSessionMetadata } from "@/lib/game/pool-physics";

const PoolCanvas = dynamic(() => import("@/components/game/pool-canvas").then((module) => module.PoolCanvas), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[360px] place-items-center rounded-lg border border-garden-300/45 bg-garden-100/65 text-sm font-extrabold text-ink-700">
      Brushing the moonberry felt...
    </div>
  ),
});

type PoolCanvasLoaderProps = {
  roundKey: number;
  mode?: "solo" | "multiplayer";
  sessionState?: PoolSessionMetadata | null;
  mySeatIndex?: number | null;
  currentPlayerName?: string;
  submittingShot?: boolean;
  onSubmitShot?: (shot: PoolSubmittedShot) => Promise<{ ok: true } | { ok: false; reason: string }>;
  onRoundStart?: () => void;
  onGameOver?: (result: { score: number; shotsTaken: number; cleared: boolean }) => void;
};

export function PoolCanvasLoader(props: PoolCanvasLoaderProps) {
  return <PoolCanvas {...props} />;
}
