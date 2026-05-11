"use client";

import dynamic from "next/dynamic";
import type { MemoryMatchMode } from "@/components/game/memory-match-canvas";

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
};

export function MemoryMatchCanvasLoader({ mode }: MemoryMatchCanvasLoaderProps) {
  return <MemoryMatchCanvas key={mode} mode={mode} />;
}
