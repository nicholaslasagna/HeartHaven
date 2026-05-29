"use client";

import dynamic from "next/dynamic";
import type { GardenDecorPlacement } from "@/components/game/garden-canvas";
import type { RealtimeRoomPlayer } from "@/lib/game/types";

type GardenPlotState = {
  id: string;
  name: string;
  stage: string;
  progress: number;
  accent: string;
  status: string;
};

const GardenCanvas = dynamic(() => import("@/components/game/garden-canvas").then((module) => module.GardenCanvas), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[380px] place-items-center rounded-lg border border-garden-300/50 bg-garden-100/70 text-sm font-extrabold text-ink-700">
      Waking the garden...
    </div>
  ),
});

type GardenCanvasLoaderProps = {
  remotePlayers?: RealtimeRoomPlayer[];
  variant: "personal" | "partner" | "park";
  plots: GardenPlotState[];
  decor?: GardenDecorPlacement[];
  pendingDecorIds?: string[];
  canEditGarden?: boolean;
  onAvatarMove?: (position: {
    x: number;
    y: number;
    facing: "left" | "right";
    petX?: number;
    petY?: number;
    petFacing?: "left" | "right";
    controlMode?: "keeper" | "companion";
  }) => void;
  onNavigate?: (href: string) => void;
  onDecorChange?: (decor: GardenDecorPlacement[]) => void;
  onPlotCare?: (plotId: string, action: "water" | "harvest") => void;
};

export function GardenCanvasLoader({
  canEditGarden,
  decor,
  onAvatarMove,
  onNavigate,
  onDecorChange,
  onPlotCare,
  pendingDecorIds,
  remotePlayers,
  variant,
  plots,
}: GardenCanvasLoaderProps) {
  return (
    <GardenCanvas
      canEditGarden={canEditGarden}
      decor={decor}
      onAvatarMove={onAvatarMove}
      onDecorChange={onDecorChange}
      onPlotCare={onPlotCare}
      onNavigate={onNavigate}
      pendingDecorIds={pendingDecorIds}
      plots={plots}
      remotePlayers={remotePlayers}
      variant={variant}
    />
  );
}
