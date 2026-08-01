"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { HavenTrailsCanvas } from "@/components/game/haven-trails-canvas";
export type { HavenTrailsCompanion } from "@/components/game/haven-trails-canvas";

const Canvas = dynamic(
  () => import("@/components/game/haven-trails-canvas").then((module) => module.HavenTrailsCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[360px] place-items-center rounded-lg border border-garden-300/50 bg-garden-100/70 text-sm font-extrabold text-ink-700">
        Opening the lantern roads...
      </div>
    ),
  },
);

export function HavenTrailsLoader(props: ComponentProps<typeof HavenTrailsCanvas>) {
  return <Canvas {...props} />;
}
