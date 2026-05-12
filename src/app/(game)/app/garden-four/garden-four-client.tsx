"use client";

import Link from "next/link";
import { ArrowLeft, HeartHandshake, Sparkles } from "lucide-react";
import { GardenFourCanvasLoader } from "@/components/game/garden-four-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useGameWallet } from "@/lib/game/use-game-wallet";

export function GardenFourClient() {
  const { grantReward } = useGameWallet();

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">Party board game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Garden Four</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            A warm pass-and-play strategy board inspired by classic room-party games. Drop keepsakes into the arbor,
            connect four, and let Casper crown the cozy winner.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
          <Button variant="warm"><HeartHandshake /> Party table</Button>
        </div>
      </section>
      <RewardWalletPanel />
      <GardenFourCanvasLoader onReward={grantReward} />
      <div className="rounded-lg border border-honey-500/30 bg-honey-100/60 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-honey-700" />
        Garden Four is local pass-and-play now. The board shape is ready for Realtime turn sync, spectators, and hosted
        party tables.
      </div>
    </div>
  );
}
