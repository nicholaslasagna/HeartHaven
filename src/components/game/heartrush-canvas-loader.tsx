"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { HeartRushCanvas } from "@/components/game/heartrush-canvas";

const Canvas = dynamic(
  () => import("@/components/game/heartrush-canvas").then((module) => module.HeartRushCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[360px] place-items-center rounded-lg border border-sky-300/50 bg-sky-100/70 text-sm font-extrabold text-ink-700">
        Building the HeartRush course...
      </div>
    ),
  },
);

export function HeartRushCanvasLoader(props: ComponentProps<typeof HeartRushCanvas>) {
  return <Canvas {...props} />;
}
