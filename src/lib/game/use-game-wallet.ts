"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { recordActivity } from "@/lib/game/activity";
import { REWARD_EVENT_NAME, type GameReward, type StoredRewardState } from "@/lib/game/rewards";
import {
  creditWallet,
  defaultWalletState,
  readWalletState,
  resetWalletState,
  spendFromWallet,
} from "@/lib/game/wallet-store";

/**
 * useGameWallet — React view over the shared wallet-store.
 *
 * The storage logic now lives in `wallet-store.ts` so non-React modules (the
 * daily gift, daily tasks, pet care) can credit the wallet too. This hook keeps
 * the exact same public surface it always had, and now also feeds the activity
 * bus so every mini-game payout advances daily tasks and achievements.
 */
export function useGameWallet() {
  const [state, setState] = useState<StoredRewardState>(defaultWalletState);

  useEffect(() => {
    const timeout = window.setTimeout(() => setState(readWalletState()), 0);

    function syncFromStorage() {
      setState(readWalletState());
    }
    function syncFromReward(event: Event) {
      const customEvent = event as CustomEvent<StoredRewardState>;
      setState(customEvent.detail ?? readWalletState());
    }

    window.addEventListener("storage", syncFromStorage);
    window.addEventListener(REWARD_EVENT_NAME, syncFromReward);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener(REWARD_EVENT_NAME, syncFromReward);
    };
  }, []);

  const grantReward = useCallback((reward: GameReward) => {
    const next = creditWallet(reward);
    setState(next);
    // Every mini-game payout is also an "activity": it advances the day's tasks
    // ("play a game", "earn coins") and milestone achievements.
    recordActivity("game-played", 1, { gameId: reward.gameId, label: reward.label });
    if (reward.coins > 0) recordActivity("coins-earned", reward.coins);
    if (reward.hearts > 0) recordActivity("hearts-earned", reward.hearts);
  }, []);

  const resetWallet = useCallback(() => {
    setState(resetWalletState());
  }, []);

  const spendCurrency = useCallback((coins: number, hearts: number) => {
    const ok = spendFromWallet(coins, hearts);
    if (ok) {
      setState(readWalletState());
      if (coins > 0) recordActivity("coins-spent", coins);
    }
    return ok;
  }, []);

  return useMemo(
    () => ({
      wallet: state.wallet,
      ledger: state.ledger,
      grantReward,
      resetWallet,
      spendCurrency,
    }),
    [grantReward, resetWallet, spendCurrency, state.ledger, state.wallet],
  );
}
