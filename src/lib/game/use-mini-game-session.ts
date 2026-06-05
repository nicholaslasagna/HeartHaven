"use client";

import { useCallback, useEffect, useRef } from "react";
import type { GameReward } from "@/lib/game/rewards";
import { useGameRewardRun } from "@/lib/game/use-game-reward-run";
import { useGameSession } from "@/lib/game/use-game-session";

/**
 * Combines server-validated rewards (0033) with live game-session sync
 * (0035 game_moves). Mini-game routes call `startPlay` when a round
 * begins and wire canvas `onReward` to `handleReward`.
 */
export function useMiniGameSession(
  gameKey: string,
  options?: {
    maxPlayers?: number;
    init?: Record<string, unknown>;
    /** When true, only claim after session metadata reports gameOver (Memory Match). */
    requireSessionComplete?: boolean;
  },
) {
  const rewards = useGameRewardRun(gameKey);
  const session = useGameSession(gameKey, options);
  const claimingRef = useRef(false);

  useEffect(() => {
    void rewards.startRun();
  }, [rewards.startRun]);

  const handleReward = useCallback(
    (reward: GameReward) => {
      if (claimingRef.current || rewards.status === "claimed") return;

      if (options?.requireSessionComplete) {
        const meta = session.metadata;
        if (!Boolean(meta.gameOver)) return;
        const finalScore = Math.max(0, Math.floor(Number(meta.finalScore ?? 0)));
        claimingRef.current = true;
        void rewards
          .claimRun(finalScore, {
            label: reward.label,
            sessionId: session.sessionId,
            coins: 0,
            hearts: 0,
          })
          .finally(() => {
            claimingRef.current = false;
          });
        return;
      }

      claimingRef.current = true;
      void rewards
        .claimRun(reward.score, {
          coins: reward.coins,
          hearts: reward.hearts,
          label: reward.label,
        })
        .finally(() => {
          claimingRef.current = false;
        });
    },
    [options?.requireSessionComplete, rewards, session.metadata, session.sessionId],
  );

  const submitMove = useCallback(
    (moveType: string, payload: Record<string, unknown> = {}) => session.submitMove(moveType, payload),
    [session.submitMove],
  );

  return {
    ...session,
    rewardStatus: rewards.status,
    handleReward,
    submitMove,
    startPlay: rewards.startRun,
  };
}
