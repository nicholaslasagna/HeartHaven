"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { loadKeeperCustomizationFromServer } from "@/lib/game/avatar-customization";
import type { RoomSurfaceSelection } from "@/lib/game/room-surfaces";
import type { RealtimeRoomPlayer, RoomBlueprint, RoomEmote, RoomPlacement } from "@/lib/game/types";

const RoomCanvas = dynamic(() => import("@/components/game/room-canvas").then((module) => module.RoomCanvas), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[320px] place-items-center rounded-lg border border-cream-300 bg-cream-100 text-sm font-extrabold text-ink-700">
      Lighting the room lanterns...
    </div>
  ),
});

type RoomCanvasLoaderProps = {
  remotePlayers?: RealtimeRoomPlayer[];
  roomName?: string;
  roomTheme?: RoomBlueprint["theme"];
  placements: RoomPlacement[];
  canEditRoom?: boolean;
  /** Optional bigger-than-viewport room world. Forwarded to the canvas. */
  worldWidth?: number;
  worldHeight?: number;
  roomPortals?: {
    left?: { name: string; href: string };
    right?: { name: string; href: string };
  };
  roomSurfaces?: RoomSurfaceSelection;
  pendingPlacementIds?: string[];
  onAvatarMove?: (position: {
    x: number;
    y: number;
    facing: "left" | "right";
    petX?: number;
    petY?: number;
    petFacing?: "left" | "right";
    controlMode?: "keeper" | "companion";
  }) => void;
  onRoomEmote?: (emote: RoomEmote) => void;
  onRoomNavigate?: (href: string) => void;
  onPlacementsChange?: (placements: RoomPlacement[]) => void;
};

export function RoomCanvasLoader({
  remotePlayers,
  roomName,
  roomTheme,
  placements,
  canEditRoom,
  worldWidth,
  worldHeight,
  roomPortals,
  roomSurfaces,
  pendingPlacementIds,
  onAvatarMove,
  onRoomEmote,
  onRoomNavigate,
  onPlacementsChange,
}: RoomCanvasLoaderProps) {
  const [keeperReady, setKeeperReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadKeeperCustomizationFromServer().finally(() => {
      if (active) setKeeperReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!keeperReady) {
    return (
      <div className="grid min-h-[320px] place-items-center rounded-lg border border-cream-300 bg-cream-100 text-sm font-extrabold text-ink-700">
        Loading your keeper...
      </div>
    );
  }

  return (
    <RoomCanvas
      canEditRoom={canEditRoom}
      onAvatarMove={onAvatarMove}
      onRoomNavigate={onRoomNavigate}
      onPlacementsChange={onPlacementsChange}
      onRoomEmote={onRoomEmote}
      pendingPlacementIds={pendingPlacementIds}
      placements={placements}
      remotePlayers={remotePlayers}
      roomName={roomName}
      roomPortals={roomPortals}
      roomSurfaces={roomSurfaces}
      roomTheme={roomTheme}
      worldWidth={worldWidth}
      worldHeight={worldHeight}
    />
  );
}
