"use client";

import dynamic from "next/dynamic";

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
  onRoundStart?: () => void;
  onGameOver?: (result: { score: number; shotsTaken: number; cleared: boolean }) => void;
};

export function PoolCanvasLoader(props: PoolCanvasLoaderProps) {
  return <PoolCanvas {...props} />;
}
