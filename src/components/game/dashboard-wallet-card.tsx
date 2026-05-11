"use client";

import { Heart } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { CurrencyPill } from "@/components/cozy/currency-pill";
import { useGameWallet } from "@/lib/game/use-game-wallet";

export function DashboardWalletCard() {
  const { wallet, ledger } = useGameWallet();

  return (
    <CozyCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-2xl">Wallet</h2>
        <Heart className="size-5 fill-current text-blush-500" />
      </div>
      <div className="flex flex-wrap gap-2">
        <CurrencyPill type="coins" value={wallet.coins} />
        <CurrencyPill type="hearts" value={wallet.hearts} />
      </div>
      {ledger[0] && (
        <p className="mt-3 text-xs font-extrabold text-ink-600">
          Last reward: {ledger[0].label} gave +{ledger[0].coins} coins and +{ledger[0].hearts} hearts.
        </p>
      )}
    </CozyCard>
  );
}
