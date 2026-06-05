"use client";

import { useCallback, useEffect, useRef } from "react";
import type { GameReward } from "@/lib/game/rewards";
import { useGameRewardRun } from "@/lib/game/use-game-reward-run";

export function useSoloGameRewards(gameKey: string) {
  const { claimRun, startRun, status } = useGameRewardRun(gameKey);
  const claimingRef = useRef(false);

  useEffect(() => {
    void startRun();
  }, [startRun]);

  const handleReward = useCallback(
    (reward: GameReward) => {
      if (claimingRef.current) return;
      claimingRef.current = true;
      void claimRun(reward.score, {
        coins: reward.coins,
        hearts: reward.hearts,
        label: reward.label,
      }).finally(() => {
        claimingRef.current = false;
        void startRun();
      });
    },
    [claimRun, startRun],
  );

  return {
    handleReward,
    rewardStatus: status,
    startPlay: startRun,
  };
}
