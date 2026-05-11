"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { playerWallet } from "@/lib/mock-data";
import {
  createRewardEntry,
  REWARD_EVENT_NAME,
  REWARD_STORAGE_KEY,
  type GameReward,
  type RewardLedgerEntry,
  type StoredRewardState,
} from "@/lib/game/rewards";

const defaultState: StoredRewardState = {
  wallet: playerWallet,
  ledger: [],
};

function readRewardState(): StoredRewardState {
  if (typeof window === "undefined") return defaultState;

  try {
    const raw = window.localStorage.getItem(REWARD_STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<StoredRewardState>;
    return {
      wallet: {
        coins: Number(parsed.wallet?.coins ?? defaultState.wallet.coins),
        hearts: Number(parsed.wallet?.hearts ?? defaultState.wallet.hearts),
      },
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger.slice(0, 12) as RewardLedgerEntry[] : [],
    };
  } catch {
    return defaultState;
  }
}

function writeRewardState(state: StoredRewardState) {
  window.localStorage.setItem(REWARD_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(REWARD_EVENT_NAME, { detail: state }));
}

export function useGameWallet() {
  const [state, setState] = useState<StoredRewardState>(defaultState);

  useEffect(() => {
    const timeout = window.setTimeout(() => setState(readRewardState()), 0);

    function syncFromStorage() {
      setState(readRewardState());
    }

    function syncFromReward(event: Event) {
      const customEvent = event as CustomEvent<StoredRewardState>;
      setState(customEvent.detail ?? readRewardState());
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
    const current = readRewardState();
    const entry = createRewardEntry(reward);
    const next: StoredRewardState = {
      wallet: {
        coins: current.wallet.coins + reward.coins,
        hearts: current.wallet.hearts + reward.hearts,
      },
      ledger: [entry, ...current.ledger].slice(0, 12),
    };
    writeRewardState(next);
    setState(next);
    // TODO: Replace local ledger with Supabase game_reward_events + wallets transaction RPC.
  }, []);

  const resetWallet = useCallback(() => {
    writeRewardState(defaultState);
    setState(defaultState);
  }, []);

  const spendCurrency = useCallback((coins: number, hearts: number) => {
    const current = readRewardState();
    if (current.wallet.coins < coins || current.wallet.hearts < hearts) return false;

    const next: StoredRewardState = {
      ...current,
      wallet: {
        coins: current.wallet.coins - coins,
        hearts: current.wallet.hearts - hearts,
      },
    };
    writeRewardState(next);
    setState(next);
    // TODO: Replace local spend with a Supabase wallet transaction RPC.
    return true;
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
