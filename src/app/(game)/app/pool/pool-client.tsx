"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDot, Gift, Sparkles, Trophy, UsersRound } from "lucide-react";
import { GameHubButton } from "@/components/game/game-hub-button";
import { PoolCanvasLoader } from "@/components/game/pool-canvas-loader";
import type { PoolSubmittedShot } from "@/components/game/pool-canvas";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { useGameRewardRun } from "@/lib/game/use-game-reward-run";
import { useGameSession } from "@/lib/game/use-game-session";
import { POOL_MAX_SHOTS, parsePoolSessionMetadata, type PoolBall } from "@/lib/game/pool-physics";
import { cn } from "@/lib/utils";

type PoolResult = {
  score: number;
  shotsTaken: number;
  cleared: boolean;
};

type SubmitPoolShotRow = {
  ok?: boolean;
  move_index?: number;
  metadata?: Record<string, unknown>;
  error_message?: string | null;
};

function fallbackPoolPayout(score: number) {
  return {
    coins: Math.min(90, Math.floor(Math.max(0, score) * 0.035)),
    hearts: score >= 1200 ? 1 : 0,
  };
}

function serializeBall(ball: PoolBall) {
  return {
    id: ball.id,
    kind: ball.kind,
    number: ball.number,
    label: ball.label,
    color: ball.color,
    stripe: ball.stripe ?? null,
    x: Math.round(ball.x * 100) / 100,
    y: Math.round(ball.y * 100) / 100,
    vx: 0,
    vy: 0,
    radius: ball.radius,
    potted: ball.potted,
  };
}

export function PoolClient() {
  const session = useGameSession("pool", { maxPlayers: 2, autoCreate: false });
  const { claimRun, startRun, status: rewardStatus } = useGameRewardRun("pool");
  const [roundKey, setRoundKey] = useState(0);
  const [soloResult, setSoloResult] = useState<PoolResult | null>(null);
  const [rewardQueued, setRewardQueued] = useState(false);
  const [submittingShot, setSubmittingShot] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const seenInitialRoundRef = useRef(false);
  const isMultiplayer = Boolean(session.sessionId);
  const playerCount = Math.max(1, session.seats.length || 2);
  const poolState = useMemo(
    () => parsePoolSessionMetadata(session.metadata, playerCount),
    [playerCount, session.metadata],
  );
  const mySeatIndex = session.mySeat?.seat_index ?? null;
  const currentSeat = session.seats.find((seat) => seat.seat_index === poolState.currentSeat);
  const currentPlayerName = currentSeat?.display_name ?? "your partner";
  const mySharedScore = mySeatIndex === null
    ? Math.max(...poolState.scores, 0)
    : (poolState.scores[mySeatIndex] ?? 0);
  const sharedResult: PoolResult | null = isMultiplayer && poolState.gameOver
    ? {
        score: poolState.finalScore || Math.max(...poolState.scores, 0),
        shotsTaken: poolState.shotNumber,
        cleared: poolState.balls.every((ball) => ball.kind === "cue" || ball.potted),
      }
    : null;
  const result = sharedResult ?? soloResult;

  const handleRoundStart = useCallback(() => {
    setSoloResult(null);
    setRewardQueued(false);
    setNotice(null);
    if (seenInitialRoundRef.current) {
      void startRun();
    } else {
      seenInitialRoundRef.current = true;
      void startRun();
    }
  }, [startRun]);

  useEffect(() => {
    if (!isMultiplayer || !session.sessionId) return;
    queueMicrotask(() => {
      setSoloResult(null);
      setRewardQueued(false);
      setNotice(null);
    });
    void startRun();
  }, [isMultiplayer, session.sessionId, startRun]);

  const handleGameOver = useCallback((nextResult: PoolResult) => {
    setSoloResult(nextResult);
  }, []);

  const submitSharedShot = useCallback(
    async (shot: PoolSubmittedShot): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (!session.sessionId) return { ok: false, reason: "No shared Pool session is open." };
      if (!isSupabaseConfigured()) return { ok: false, reason: "Online Pool is not configured in this build." };

      setSubmittingShot(true);
      setNotice(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("submit_pool_shot", {
          p_session_id: session.sessionId,
          p_angle: shot.angle,
          p_power: shot.power,
          p_settled_balls: shot.settledBalls.map(serializeBall),
          p_score_delta: shot.summary.scoreDelta,
          p_potted_ids: shot.summary.pottedIds,
          p_scratched: shot.summary.scratched,
        });
        if (error) {
          const reason = error.message || "Shared Pool shot was rejected.";
          setNotice(reason);
          return { ok: false, reason };
        }
        const row = (Array.isArray(data) ? data[0] : data) as SubmitPoolShotRow | null;
        if (!row?.ok) {
          const reason = row?.error_message || "Shared Pool shot was rejected.";
          setNotice(reason);
          return { ok: false, reason };
        }
        await session.refresh(session.sessionId);
        setNotice("Shared table saved.");
        return { ok: true };
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Could not save shared Pool shot.";
        setNotice(reason);
        return { ok: false, reason };
      } finally {
        setSubmittingShot(false);
      }
    },
    [session],
  );

  const claimReward = useCallback(async () => {
    if (!result || rewardQueued) return;
    const payout = fallbackPoolPayout(result.score);
    setRewardQueued(true);
    const claim = await claimRun(result.score, {
      coins: payout.coins,
      hearts: payout.hearts,
      label: "Moonberry Pool",
      sessionId: isMultiplayer ? session.sessionId : null,
    });
    if (!claim.ok) {
      setRewardQueued(false);
      setNotice(claim.reason);
    }
  }, [claimRun, isMultiplayer, result, rewardQueued, session.sessionId]);

  const rackAgain = useCallback(() => {
    setRoundKey((current) => current + 1);
  }, []);

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">
            {isMultiplayer ? "Shared arcade table" : "Cozy arcade table"}
          </p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Moonberry Pool</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Pull back from the cue ball, choose your power, bank around the cushions, and pocket moonberry balls before
            your {POOL_MAX_SHOTS} shots run out.
          </p>
          <p className="mt-2 text-xs font-extrabold text-garden-700">
            {isMultiplayer
              ? session.loading
                ? "Connecting shared Pool table..."
                : session.status
              : "Solo Pool — open from a party lobby to play a shared table."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GameHubButton returnToLobby={session.returnToLobby} />
          <Button variant={isMultiplayer ? "default" : "warm"}>
            {isMultiplayer ? <UsersRound /> : <CircleDot />}
            {isMultiplayer ? "Multiplayer table" : "Solo table"}
          </Button>
        </div>
      </section>

      <RewardWalletPanel />

      {isMultiplayer && (
        <section className="grid gap-3 rounded-lg border border-lavender-300/40 bg-lavender-100/55 p-4 shadow-sm md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-600">Shared Pool state</p>
            <p className="mt-1 text-sm font-bold text-ink-700">
              {poolState.gameOver
                ? "The shared table is complete."
                : mySeatIndex === poolState.currentSeat
                  ? "Your turn. Aim and shoot."
                  : `Waiting for ${currentPlayerName}.`}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {session.seats.map((seat) => {
              const active = seat.seat_index === poolState.currentSeat && !poolState.gameOver;
              const score = poolState.scores[seat.seat_index] ?? 0;
              return (
                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm font-bold",
                    active ? "border-blush-300 bg-blush-100 text-blush-800" : "border-cream-300 bg-white/75 text-ink-700",
                  )}
                  key={seat.profile_id}
                >
                  <span className="block max-w-32 truncate">{seat.display_name}</span>
                  <span className="text-xs text-ink-500">{score} pts{active ? " · turn" : ""}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <PoolCanvasLoader
        currentPlayerName={currentPlayerName}
        mode={isMultiplayer ? "multiplayer" : "solo"}
        mySeatIndex={mySeatIndex}
        onGameOver={handleGameOver}
        onRoundStart={handleRoundStart}
        onSubmitShot={submitSharedShot}
        roundKey={roundKey}
        sessionState={isMultiplayer ? poolState : null}
        submittingShot={submittingShot}
      />

      <section className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/60 p-4 text-sm font-bold leading-6 text-ink-700">
          <Sparkles className="mr-2 inline size-4 text-lavender-500" />
          {isMultiplayer
            ? `Session score: you have ${mySharedScore} points. The server stores the settled table after every shot.`
            : "Solo Pool runs locally. Party lobbies open the same route with ?session= for synchronized turn play."}
          {notice && <span className="mt-2 block text-xs text-blush-700">{notice}</span>}
        </div>
        {!isMultiplayer && (
          <Button onClick={rackAgain} variant="secondary">
            Rack again
          </Button>
        )}
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
