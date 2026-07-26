"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { MoonberryBowlingCanvas } from "@/components/game/moonberry-bowling-canvas";

/**
 * three.js must never reach the server bundle: the page that renders this is
 * server-rendered, and importing the canvas directly would drag the whole
 * engine through SSR and hang the route on its fallback.
 */
const Canvas = dynamic(
  () => import("@/components/game/moonberry-bowling-canvas").then((m) => m.MoonberryBowlingCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid aspect-[16/9] w-full place-items-center rounded-lg border border-cream-300 bg-ink-900 text-sm font-extrabold text-cream-100">
        Waxing the lane…
      </div>
    ),
  },
);

export function MoonberryBowlingLoader(props: ComponentProps<typeof MoonberryBowlingCanvas>) {
  return <Canvas {...props} />;
}
