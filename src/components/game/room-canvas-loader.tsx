"use client";

import dynamic from "next/dynamic";
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
  onAvatarMove?: (position: { x: number; y: number; facing: "left" | "right" }) => void;
  onRoomEmote?: (emote: RoomEmote) => void;
  onPlacementsChange?: (placements: RoomPlacement[]) => void;
};

export function RoomCanvasLoader({
  remotePlayers,
  roomName,
  roomTheme,
  placements,
  onAvatarMove,
  onRoomEmote,
  onPlacementsChange,
}: RoomCanvasLoaderProps) {
  return (
    <RoomCanvas
      onAvatarMove={onAvatarMove}
      onPlacementsChange={onPlacementsChange}
      onRoomEmote={onRoomEmote}
      placements={placements}
      remotePlayers={remotePlayers}
      roomName={roomName}
      roomTheme={roomTheme}
    />
  );
}
