"use client";

import Link from "next/link";
import { ArrowLeft, Heart, Sparkles } from "lucide-react";
import { BowlingCanvasLoader } from "@/components/game/bowling-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";

export function BowlingClient() {
  const game = useMiniGameSession("bowling", { maxPlayers: 2 });

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-honey-500/30 bg-honey-100/65 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-honey-700">Mini-game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Moonberry Bowling</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Pass-and-play a two-lane bowling match, roll the moonberry ball, score strikes and spares, and let Casper
            cheer every frame.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
          <Button variant="warm"><Heart /> Party lane live</Button>
        </div>
      </section>
      <RewardWalletPanel />
      <BowlingCanvasLoader onReward={game.handleReward} />
      <div className="rounded-lg border border-blush-300/40 bg-blush-100/60 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-blush-500" />
        Bowling now alternates Blush and Lavender turns locally. Rewards update the same wallet as the arcade games.
      </div>
    </div>
  );
}
