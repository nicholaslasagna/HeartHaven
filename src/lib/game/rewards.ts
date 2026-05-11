import type { Wallet } from "@/lib/game/types";

export type GameReward = {
  gameId: string;
  label: string;
  score: number;
  coins: number;
  hearts: number;
};

export type RewardLedgerEntry = GameReward & {
  id: string;
  awardedAt: string;
};

export type StoredRewardState = {
  wallet: Wallet;
  ledger: RewardLedgerEntry[];
};

export const REWARD_STORAGE_KEY = "hearthaven:reward-state";
export const REWARD_EVENT_NAME = "hearthaven:reward-granted";

export function createRewardEntry(reward: GameReward): RewardLedgerEntry {
  return {
    ...reward,
    id: `${reward.gameId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    awardedAt: new Date().toISOString(),
  };
}
