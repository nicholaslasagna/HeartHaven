"use client";

import { useCallback, useEffect } from "react";
import type { GameReward } from "@/lib/game/rewards";
import { useGameRewardRun } from "@/lib/game/use-game-reward-run";
import { useGameSession } from "@/lib/game/use-game-session";

/**
 * Combines server-validated rewards (0033) with live game-session sync
 * (0035 game_moves). Mini-game routes call `startPlay` when a round
 * begins and wire canvas `onReward` to `handleReward`.
 */
export function useMiniGameSession(gameKey: string, options?: { maxPlayers?: number }) {
  const rewards = useGameRewardRun(gameKey);
  const session = useGameSession(gameKey, options);

  useEffect(() => {
    void rewards.startRun();
  }, [rewards.startRun]);

  const handleReward = useCallback(
    (reward: GameReward) => {
      void rewards.claimRun(reward.score, {
        coins: reward.coins,
        hearts: reward.hearts,
        label: reward.label,
      });
    },
    [rewards],
  );

  const submitMove = useCallback(
    (moveType: string, payload: Record<string, unknown> = {}) => session.submitMove(moveType, payload),
    [session],
  );

  return {
    ...session,
    rewardStatus: rewards.status,
    handleReward,
    submitMove,
    startPlay: rewards.startRun,
  };
}
