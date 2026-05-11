"use client";

import dynamic from "next/dynamic";
import type { RoomPlacement } from "@/lib/game/types";

const RoomCanvas = dynamic(() => import("@/components/game/room-canvas").then((module) => module.RoomCanvas), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[320px] place-items-center rounded-lg border border-cream-300 bg-cream-100 text-sm font-extrabold text-ink-700">
      Lighting the room lanterns...
    </div>
  ),
});

type RoomCanvasLoaderProps = {
  placements: RoomPlacement[];
  onPlacementsChange?: (placements: RoomPlacement[]) => void;
};

export function RoomCanvasLoader({ placements, onPlacementsChange }: RoomCanvasLoaderProps) {
  return <RoomCanvas onPlacementsChange={onPlacementsChange} placements={placements} />;
}
