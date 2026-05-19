/**
 * wallet-store — the single low-level owner of the player's coins/hearts ledger.
 *
 * Previously the read/write logic lived inside `use-game-wallet.ts`, which meant
 * only React components could touch the wallet. The Webkinz-style engagement
 * loops (daily gift, daily tasks, pet care) all need to credit the wallet from
 * plain modules too — so the storage logic is extracted here and the hook now
 * delegates to it.
 *
 * Storage: `hearthaven:reward-state` in localStorage (unchanged key, so existing
 * balances carry over). Every mutation dispatches `hearthaven:reward-granted` so
 * any mounted `useGameWallet()` re-reads immediately.
 *
 * Phase 2: localStorage remains the instant/offline cache, while wallet
 * mutations write through to Supabase RPCs in the background when signed in.
 */

import { playerWallet } from "@/lib/mock-data";
import {
  createRewardEntry,
  REWARD_EVENT_NAME,
  REWARD_STORAGE_KEY,
  type GameReward,
  type RewardLedgerEntry,
  type StoredRewardState,
} from "@/lib/game/rewards";
import { loadServerWalletState, persistWalletCredit, persistWalletSpend } from "@/lib/game/phase2-server";

const LEDGER_LIMIT = 14;

const defaultState: StoredRewardState = {
  wallet: playerWallet,
  ledger: [],
};

export function readWalletState(): StoredRewardState {
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
      ledger: Array.isArray(parsed.ledger)
        ? (parsed.ledger.slice(0, LEDGER_LIMIT) as RewardLedgerEntry[])
        : [],
    };
  } catch {
    return defaultState;
  }
}

export function writeWalletState(state: StoredRewardState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REWARD_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(REWARD_EVENT_NAME, { detail: state }));
}

export async function hydrateWalletStateFromServer() {
  const serverState = await loadServerWalletState(readWalletState());
  if (!serverState) return null;
  writeWalletState(serverState);
  return serverState;
}

/**
 * Add coins/hearts to the wallet and push a ledger entry. Used by mini-game
 * payouts, the daily gift, daily-task completions, and pet-care love rewards —
 * anything that gives the player currency flows through here so the ledger is
 * one honest history.
 */
export function creditWallet(reward: GameReward): StoredRewardState {
  const current = readWalletState();
  const entry = createRewardEntry(reward);
  const next: StoredRewardState = {
    wallet: {
      coins: current.wallet.coins + reward.coins,
      hearts: current.wallet.hearts + reward.hearts,
    },
    ledger: [entry, ...current.ledger].slice(0, LEDGER_LIMIT),
  };
  writeWalletState(next);
  void persistWalletCredit(reward).then((serverState) => {
    if (serverState) writeWalletState(serverState);
  });
  return next;
}

/** Deduct currency if the player can afford it. Returns false (no-op) if not. */
export function spendFromWallet(coins: number, hearts: number): boolean {
  const current = readWalletState();
  if (current.wallet.coins < coins || current.wallet.hearts < hearts) return false;
  writeWalletState({
    ...current,
    wallet: {
      coins: current.wallet.coins - coins,
      hearts: current.wallet.hearts - hearts,
    },
  });
  void persistWalletSpend(coins, hearts).then((result) => {
    if (result.state) writeWalletState(result.state);
  });
  return true;
}

export function resetWalletState(): StoredRewardState {
  writeWalletState(defaultState);
  return defaultState;
}

export { defaultState as defaultWalletState };
