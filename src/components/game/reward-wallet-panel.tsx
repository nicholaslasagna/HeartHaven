"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import { CurrencyPill } from "@/components/cozy/currency-pill";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Button } from "@/components/ui/button";
import { useGameWallet } from "@/lib/game/use-game-wallet";

type RewardWalletPanelProps = {
  compact?: boolean;
};

export function RewardWalletPanel({ compact = false }: RewardWalletPanelProps) {
  const { wallet, ledger, resetWallet } = useGameWallet();
  const latest = ledger[0];

  if (compact) {
    return (
      <div className="hidden items-center gap-2 xl:flex">
        <CurrencyPill type="coins" value={wallet.coins} />
        <CurrencyPill type="hearts" value={wallet.hearts} />
      </div>
    );
  }

  return (
    <CozyCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-honey-500" />
            <h2 className="font-display text-2xl text-ink-900">Game rewards</h2>
          </div>
          <p className="mt-1 text-sm font-bold text-ink-700">
            {latest ? `${latest.label}: +${latest.coins} coins, +${latest.hearts} hearts` : "Play a mini-game to earn coins and hearts."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CurrencyPill type="coins" value={wallet.coins} />
          <CurrencyPill type="hearts" value={wallet.hearts} />
          <Button onClick={resetWallet} size="sm" variant="secondary">
            <RotateCcw /> Reset
          </Button>
        </div>
      </div>
      {ledger.length > 0 && (
        <div className="mt-3 grid gap-2 text-xs font-extrabold text-ink-700 sm:grid-cols-2">
          {ledger.slice(0, 4).map((entry) => (
            <div className="rounded-md border border-cream-300 bg-cream-50/80 px-3 py-2" key={entry.id}>
              {entry.label}: {entry.score} pts
            </div>
          ))}
        </div>
      )}
    </CozyCard>
  );
}
