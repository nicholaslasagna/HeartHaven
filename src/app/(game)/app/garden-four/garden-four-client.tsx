"use client";

import Link from "next/link";
import { ArrowLeft, HeartHandshake, Sparkles } from "lucide-react";
import { GardenFourCanvasLoader } from "@/components/game/garden-four-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";

export function GardenFourClient() {
  const game = useMiniGameSession("garden-four", { maxPlayers: 2, requireSessionComplete: true });

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">Party board game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Garden Four</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Drop keepsakes into the arbor and connect four. Moves sync through your party session when friends join from
            the games hub.
          </p>
          <p className="mt-2 text-xs font-extrabold text-garden-700">{game.status}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
          <Button variant="warm"><HeartHandshake /> Party table</Button>
        </div>
      </section>
      <RewardWalletPanel />
      <GardenFourCanvasLoader
        metadata={game.metadata}
        mySeatIndex={game.mySeat?.seat_index ?? null}
        onReward={game.handleReward}
        sessionId={game.sessionId}
        submitDrop={async (column) => {
          const result = await game.submitMove("drop", { column });
          return { ok: result.ok, reason: result.ok ? undefined : result.reason };
        }}
      />
      <div className="rounded-lg border border-honey-500/30 bg-honey-100/60 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-honey-700" />
        {game.sessionId
          ? `Live session ${game.sessionId.slice(0, 8)}… — seat ${game.mySeat?.seat_index ?? "?"} of ${game.seats.length}.`
          : "Connecting online session…"}
      </div>
    </div>
  );
}
