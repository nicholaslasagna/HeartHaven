"use client";

import Link from "next/link";
import { ArrowLeft, Heart, Sparkles } from "lucide-react";
import { CozyQuestCanvasLoader } from "@/components/game/cozy-quest-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useGameWallet } from "@/lib/game/use-game-wallet";

export function HeartHuntClient() {
  const { grantReward } = useGameWallet();

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-blush-300/50 bg-blush-100/60 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Party mini-game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Heart Hunt</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Search a cozy room for hidden keepsakes, build a warm score, and earn hearts for the shared memory loop.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/app/games"><ArrowLeft /> Games hub</Link>
        </Button>
      </section>
      <RewardWalletPanel />
      <CozyQuestCanvasLoader onReward={grantReward} variant="heart-hunt" />
      <div className="rounded-lg border border-blush-300/40 bg-blush-100/60 p-4 text-sm font-bold text-ink-700">
        <Heart className="mr-2 inline size-4 text-blush-500" />
        The hunt works locally now and can become a room-party scavenger hunt once realtime visitors are connected.
        <Sparkles className="ml-2 inline size-4 text-honey-700" />
      </div>
    </div>
  );
}
