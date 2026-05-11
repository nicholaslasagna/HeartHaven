"use client";

import Link from "next/link";
import { ArrowLeft, UsersRound } from "lucide-react";
import { useState } from "react";
import { MemoryMatchCanvasLoader } from "@/components/game/memory-match-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import type { MemoryMatchMode } from "@/components/game/memory-match-canvas";
import { Button } from "@/components/ui/button";
import { useGameWallet } from "@/lib/game/use-game-wallet";
import { cn } from "@/lib/utils";

const modeCopy: Record<MemoryMatchMode, { title: string; description: string }> = {
  couples: {
    title: "Couple-vs-couple",
    description: "Two couple teams pass turns locally now. Realtime rooms can replace the turn state later.",
  },
  party: {
    title: "Party table",
    description: "Six local seats rotate turns for room parties, birthday nights, or garden gatherings.",
  },
};

export function MemoryMatchClient() {
  const [mode, setMode] = useState<MemoryMatchMode>("couples");
  const { grantReward } = useGameWallet();

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-lavender-300/50 bg-lavender-100/60 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-500">Multiplayer mini-game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Memory Match</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            A playable keepsake card game for two couples or a larger pass-and-play party.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/app/games"><ArrowLeft /> Games hub</Link>
        </Button>
      </section>

      <section className="grid gap-3 rounded-lg border border-cream-300 bg-white/72 p-4 shadow-sm md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <UsersRound className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">{modeCopy[mode].title}</h2>
          </div>
          <p className="mt-1 text-sm font-bold text-ink-700">{modeCopy[mode].description}</p>
        </div>
        <div className="flex rounded-full border border-cream-300 bg-cream-50 p-1">
          {(["couples", "party"] as const).map((option) => (
            <button
              className={cn(
                "rounded-full px-4 py-2 text-sm font-extrabold transition-colors",
                mode === option ? "bg-blush-500 text-white shadow-sm" : "text-ink-700 hover:bg-blush-100",
              )}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {option === "couples" ? "Couples" : "Party"}
            </button>
          ))}
        </div>
      </section>

      <RewardWalletPanel />
      <MemoryMatchCanvasLoader mode={mode} onReward={grantReward} />
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        Pass-and-play rewards now update the wallet immediately. The scene is still structured for Supabase Realtime
        game sessions, player seats, turn events, and party room invites.
      </div>
    </div>
  );
}
