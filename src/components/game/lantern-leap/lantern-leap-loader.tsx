"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { LanternLeapCanvas } from "@/components/game/lantern-leap/lantern-leap-canvas";

/**
 * The only door into the Lantern Leap canvas.
 *
 * The canvas pulls in three.js, so it must load `ssr: false` — anything that
 * imports a *value* from it (or from `renderer.ts`) drags the whole engine
 * into the server bundle and the page hangs on its Suspense fallback. Types
 * are safe because `import type` is erased.
 */
const Canvas = dynamic(
  () => import("@/components/game/lantern-leap/lantern-leap-canvas").then((module) => module.LanternLeapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[360px] place-items-center rounded-lg bg-[#1b1430] text-sm font-extrabold text-cream-50">
        Lighting the lanterns...
      </div>
    ),
  },
);

export function LanternLeapLoader(props: ComponentProps<typeof LanternLeapCanvas>) {
  return <Canvas {...props} />;
}
