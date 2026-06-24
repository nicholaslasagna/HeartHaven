"use client";

import { useCallback, useRef, useState } from "react";
import { CircleDot, Gift, Sparkles, Trophy } from "lucide-react";
import { GameHubButton } from "@/components/game/game-hub-button";
import { PoolCanvasLoader } from "@/components/game/pool-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { POOL_MAX_SHOTS } from "@/lib/game/pool-physics";

type PoolResult = {
  score: number;
  shotsTaken: number;
  cleared: boolean;
};

function fallbackPoolPayout(score: number) {
  return {
    coins: Math.min(90, Math.floor(Math.max(0, score) * 0.035)),
    hearts: score >= 1200 ? 1 : 0,
  };
}

export function PoolClient() {
  const game = useMiniGameSession("pool", { maxPlayers: 1 });
  const { handleReward, returnToLobby, rewardStatus, startPlay, status } = game;
  const [roundKey, setRoundKey] = useState(0);
  const [result, setResult] = useState<PoolResult | null>(null);
  const [rewardQueued, setRewardQueued] = useState(false);
  const seenInitialRoundRef = useRef(false);

  const handleRoundStart = useCallback(() => {
    setResult(null);
    setRewardQueued(false);
    if (seenInitialRoundRef.current) {
      void startPlay();
    } else {
      seenInitialRoundRef.current = true;
    }
  }, [startPlay]);

  const handleGameOver = useCallback((nextResult: PoolResult) => {
    setResult(nextResult);
  }, []);

  const claimReward = useCallback(() => {
    if (!result || rewardQueued) return;
    const payout = fallbackPoolPayout(result.score);
    setRewardQueued(true);
    handleReward({
      gameId: "pool",
      label: "Moonberry Pool",
      score: result.score,
      coins: payout.coins,
      hearts: payout.hearts,
    });
  }, [handleReward, result, rewardQueued]);

  const rackAgain = useCallback(() => {
    setRoundKey((current) => current + 1);
  }, []);

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">Cozy arcade table</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Moonberry Pool</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Pull back from the cue ball, choose your power, bank around the cushions, and pocket moonberry balls before
            your {POOL_MAX_SHOTS} shots run out.
          </p>
          <p className="mt-2 text-xs font-extrabold text-garden-700">{status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GameHubButton returnToLobby={returnToLobby} />
          <Button variant="warm">
            <CircleDot /> Local table
          </Button>
        </div>
      </section>

      <RewardWalletPanel />

      <PoolCanvasLoader roundKey={roundKey} onGameOver={handleGameOver} onRoundStart={handleRoundStart} />

      <section className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/60 p-4 text-sm font-bold leading-6 text-ink-700">
          <Sparkles className="mr-2 inline size-4 text-lavender-500" />
          Pool is local single-player in this phase. Party links can open the same route with{" "}
          <code className="rounded bg-white/80 px-1">?session=</code>, but shared ball physics will wait for a
          server-authoritative Pool move pass.
        </div>
        <Button onClick={rackAgain} variant="secondary">
          Rack again
        </Button>
      </section>

      {result && (
        <section className="flex flex-col justify-between gap-4 rounded-lg border border-honey-500/35 bg-honey-100/70 p-4 shadow-sm md:flex-row md:items-center">
          <div>
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-honey-700">
              <Trophy className="size-3.5" /> Final table score
            </p>
            <h2 className="mt-1 font-display text-3xl text-ink-900">{result.score} points</h2>
            <p className="mt-1 text-sm font-bold text-ink-700">
              {result.cleared ? "All balls cleared." : `Round ended after ${result.shotsTaken} shots.`}
            </p>
          </div>
          <Button disabled={rewardQueued || rewardStatus === "claimed"} onClick={claimReward} variant="warm">
            <Gift /> {rewardQueued || rewardStatus === "claimed" ? "Reward claimed" : "Claim reward"}
          </Button>
        </section>
      )}
    </div>
  );
}
