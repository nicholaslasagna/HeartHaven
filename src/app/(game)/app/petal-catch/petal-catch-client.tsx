"use client";

import Link from "next/link";
import { ArrowLeft, Gift, Sparkles } from "lucide-react";
import { PetalCatchCanvasLoader } from "@/components/game/petal-catch-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useGameWallet } from "@/lib/game/use-game-wallet";

export function PetalCatchClient() {
  const { grantReward } = useGameWallet();

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-blush-300/50 bg-blush-100/55 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Mini-game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Petal Catch</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Catch falling petals and hearts, avoid thorns, build combos, and earn coins and hearts for the garden loop.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/area?zone=garden"><ArrowLeft /> Garden</Link>
          </Button>
          <Button variant="warm"><Gift /> Rewards live</Button>
        </div>
      </section>
      <RewardWalletPanel />
      <PetalCatchCanvasLoader onReward={grantReward} />
      <div className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-honey-700" />
        Rewards update the wallet immediately and are shaped for trusted online payouts when live play is available.
      </div>
    </div>
  );
}
