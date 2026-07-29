"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { MoonberryRacingCanvas } from "@/components/game/moonberry-racing-canvas";

/**
 * three.js must never reach the server bundle: the page rendering this is
 * server-rendered, and importing the canvas directly would drag the engine
 * through SSR and hang the route on its fallback.
 */
const Canvas = dynamic(
  () => import("@/components/game/moonberry-racing-canvas").then((m) => m.MoonberryRacingCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid aspect-video w-full place-items-center rounded-lg border border-cream-300 bg-ink-900 text-sm font-extrabold text-cream-100">
        Warming up the grid…
      </div>
    ),
  },
);

export function MoonberryRacingLoader(props: ComponentProps<typeof MoonberryRacingCanvas>) {
  return <Canvas {...props} />;
}
