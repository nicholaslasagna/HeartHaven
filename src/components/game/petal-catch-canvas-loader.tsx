"use client";

import dynamic from "next/dynamic";
import type { GameReward } from "@/lib/game/rewards";
import type { PetalRelayResult, PetalRelayState } from "@/lib/game/petal-catch-relay";
import type { GameSessionSeat } from "@/lib/game/use-game-session";

const PetalCatchCanvas = dynamic(
  () => import("@/components/game/petal-catch-canvas").then((module) => module.PetalCatchCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[340px] place-items-center rounded-lg border border-blush-300/50 bg-blush-100/60 text-sm font-extrabold text-ink-700">
        Gathering petals...
      </div>
    ),
  },
);

type PetalCatchCanvasLoaderProps = {
  onReward?: (reward: GameReward) => void;
  mode?: "solo" | "relay";
  relayState?: PetalRelayState;
  seats?: GameSessionSeat[];
  mySeatIndex?: number | null;
  pendingRelayMove?: boolean;
  onRelayMove?: (result: PetalRelayResult) => void;
};

export function PetalCatchCanvasLoader(props: PetalCatchCanvasLoaderProps) {
  return <PetalCatchCanvas {...props} />;
}
