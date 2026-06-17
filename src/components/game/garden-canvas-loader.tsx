"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { GardenDecorPlacement } from "@/components/game/garden-canvas";
import { loadKeeperCustomizationFromServer } from "@/lib/game/avatar-customization";
import type { RealtimeRoomPlayer } from "@/lib/game/types";

const KEEPER_LOAD_TIMEOUT_MS = 1800;

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
  const [keeperReady, setKeeperReady] = useState(false);

  useEffect(() => {
    let active = true;
    const timeout = new Promise<void>((resolve) => {
      window.setTimeout(resolve, KEEPER_LOAD_TIMEOUT_MS);
    });
    void Promise.race([loadKeeperCustomizationFromServer(), timeout]).finally(() => {
      if (active) setKeeperReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!keeperReady) {
    return (
      <div className="grid min-h-[380px] place-items-center rounded-lg border border-garden-300/50 bg-garden-100/70 text-sm font-extrabold text-ink-700">
        Loading your keeper...
      </div>
    );
  }

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
