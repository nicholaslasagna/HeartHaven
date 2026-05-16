"use client";

import Link from "next/link";
import { ArrowLeft, Flame, Sparkles } from "lucide-react";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { CozyQuestCanvasLoader } from "@/components/game/cozy-quest-canvas-loader";
import { Button } from "@/components/ui/button";
import { useGameWallet } from "@/lib/game/use-game-wallet";

export function LanternRelayClient() {
  const { grantReward } = useGameWallet();

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-honey-500/30 bg-honey-100/70 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-honey-700">Party mini-game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Lantern Relay</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Light the garden lanterns in order before the timer ends. It is built for local play now and co-op turns later.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/app/games"><ArrowLeft /> Games hub</Link>
        </Button>
      </section>
      <RewardWalletPanel />
      <CozyQuestCanvasLoader onReward={grantReward} variant="lantern-relay" />
      <div className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 text-sm font-bold text-ink-700">
        <Flame className="mr-2 inline size-4 text-honey-700" />
        Online play can turn each lantern click into a party move event for shared relay nights.
        <Sparkles className="ml-2 inline size-4 text-blush-500" />
      </div>
    </div>
  );
}
