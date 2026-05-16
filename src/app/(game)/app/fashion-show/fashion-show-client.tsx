"use client";

import Link from "next/link";
import { ArrowLeft, Shirt, Sparkles } from "lucide-react";
import { FashionShowCanvasLoader } from "@/components/game/fashion-show-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useGameWallet } from "@/lib/game/use-game-wallet";

export function FashionShowClient() {
  const { grantReward } = useGameWallet();

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-blush-300/50 bg-blush-100/60 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Park stage mini-game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Fashion Show</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Style your keeper and pet for themed runway rounds, match the judges&apos; prompts, animate the walk, and
            earn coins and hearts for the shop loop.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
          <Button asChild variant="warm">
            <Link href="/app/park"><Shirt /> Park stage</Link>
          </Button>
        </div>
      </section>
      <FashionShowCanvasLoader onReward={grantReward} />
      <RewardWalletPanel />
      <div className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-honey-700" />
        This stage uses the same painted keeper and pet sprite sheets as the room, so wardrobe choices can stay shared
        across the whole world when online play is available.
      </div>
    </div>
  );
}
