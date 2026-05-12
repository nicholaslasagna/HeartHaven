"use client";

import dynamic from "next/dynamic";
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
  variant: "personal" | "partner";
  plots: GardenPlotState[];
  onAvatarMove?: (position: { x: number; y: number }) => void;
};

export function GardenCanvasLoader({ onAvatarMove, remotePlayers, variant, plots }: GardenCanvasLoaderProps) {
  return <GardenCanvas onAvatarMove={onAvatarMove} plots={plots} remotePlayers={remotePlayers} variant={variant} />;
}
