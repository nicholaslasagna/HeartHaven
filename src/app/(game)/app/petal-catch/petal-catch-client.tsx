"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Gift, HeartHandshake, Sparkles, Trophy, UsersRound } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { GameHubButton } from "@/components/game/game-hub-button";
import { PetalCatchCanvasLoader } from "@/components/game/petal-catch-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PETAL_RELAY_MISS_LIMIT,
  PETAL_RELAY_MOVE_TYPE,
  petalRelayKindLabel,
  type PetalRelayResult,
  petalRelayItems,
  reducePetalRelayState,
} from "@/lib/game/petal-catch-relay";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { useSoloGameRewards } from "@/lib/game/use-solo-game-rewards";
import { cn } from "@/lib/utils";

type PetalCatchClientProps = {
  sessionId?: string | null;
};

function fallbackPayout(score: number) {
  return {
    coins: Math.min(100, Math.floor(Math.max(0, Math.min(score, 2000)) * 0.04)),
    hearts: score >= 500 ? 1 : 0,
  };
}

function PetalCatchSoloClient() {
  const game = useSoloGameRewards("petal-catch");

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-blush-300/50 bg-blush-100/55 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Mini-game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Petal Catch</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Catch falling petals and hearts, avoid thorns, build combos, and earn coins and hearts for the garden loop.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/games">
              <ArrowLeft /> Games hub
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/app/area?zone=garden">
              <ArrowLeft /> Garden
            </Link>
          </Button>
          <Button variant="warm">
            <Gift /> Rewards live
          </Button>
        </div>
      </section>
      <RewardWalletPanel />
      <PetalCatchCanvasLoader onReward={game.handleReward} />
      <div className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-honey-700" />
        Solo rewards update the wallet immediately. Start Petal Catch Relay from a lobby to play the shared co-op version.
      </div>
    </div>
  );
}

function PetalCatchRelayClient() {
  const game = useMiniGameSession("petal-catch", { maxPlayers: 6 });
  const [message, setMessage] = useState<string | null>(null);
  const [pendingRelayMove, setPendingRelayMove] = useState(false);
  const [rewardQueued, setRewardQueued] = useState(false);
  const claimedForSessionRef = useRef<string | null>(null);

  const state = useMemo(() => reducePetalRelayState(game.moves, game.seats), [game.moves, game.seats]);
  const mySeatIndex = game.mySeat?.seat_index ?? null;
  const activeSeat = game.seats.find((seat) => seat.seat_index === state.currentSeat) ?? null;
  const canAct = Boolean(game.sessionId && mySeatIndex !== null && mySeatIndex === state.currentSeat && !state.gameOver);
  const rewardScore = Math.min(2000, Math.max(0, state.finalScore));

  async function submitRelayMove(result: PetalRelayResult) {
    if (!game.sessionId || !state.currentItem) {
      setMessage("Connecting the shared relay session...");
      return;
    }
    if (!canAct) {
      setMessage(state.gameOver ? "The relay is complete." : `Waiting for ${activeSeat?.display_name ?? "the active player"}.`);
      return;
    }
    if (pendingRelayMove) return;

    setPendingRelayMove(true);
    setMessage(null);
    const moveResult = await game.submitMove(PETAL_RELAY_MOVE_TYPE, {
      gameKey: "petal-catch",
      itemIndex: state.itemIndex,
      kind: state.currentItem.kind,
      result,
    });
    if (!moveResult.ok) {
      setMessage(moveResult.reason);
    }
    window.setTimeout(() => setPendingRelayMove(false), 520);
  }

  function claimReward() {
    if (!state.gameOver || rewardQueued) return;
    const sessionKey = `${game.sessionId ?? "solo"}:${rewardScore}:${state.itemIndex}`;
    if (claimedForSessionRef.current === sessionKey) return;
    claimedForSessionRef.current = sessionKey;
    setRewardQueued(true);
    const payout = fallbackPayout(rewardScore);
    game.handleReward({
      gameId: "petal-catch",
      label: "Petal Catch Relay",
      score: rewardScore,
      coins: payout.coins,
      hearts: payout.hearts,
    });
    playCozyCue("reward");
  }

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-lg border border-blush-300/50 bg-gradient-to-br from-blush-100/70 via-cream-100 to-lavender-100/70 p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <Badge variant="blush">
              <UsersRound className="size-3.5" />
              Co-op relay
            </Badge>
            <h1 className="mt-3 font-display text-4xl leading-none text-ink-900">Petal Catch Relay</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-ink-700">
              Pass the basket around the party. Each seated player handles the next falling item: catch petals and hearts,
              dodge thorns, and keep one shared combo alive.
            </p>
            <p className="mt-2 text-xs font-extrabold uppercase tracking-normal text-ink-500">
              {game.sessionId ? "Live shared session" : "Connecting shared session"} · {game.status}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GameHubButton returnToLobby={game.returnToLobby} />
            <Button onClick={() => void game.returnToLobby()} variant="warm">
              <ArrowLeft /> Back to lobby
            </Button>
          </div>
        </div>
      </section>

      <RewardWalletPanel />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PetalCatchCanvasLoader
          mode="relay"
          relayState={state}
          seats={game.seats}
          mySeatIndex={mySeatIndex}
          pendingRelayMove={pendingRelayMove}
          onRelayMove={(result) => void submitRelayMove(result)}
        />

        <div className="grid gap-4">
          <CozyCard className="p-4">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-600">
              <Trophy className="size-4" /> Team relay
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-cream-300 bg-cream-50 p-3">
                <p className="text-xs font-extrabold text-ink-500">Score</p>
                <p className="font-display text-2xl text-ink-900">{state.score}</p>
              </div>
              <div className="rounded-md border border-cream-300 bg-cream-50 p-3">
                <p className="text-xs font-extrabold text-ink-500">Combo</p>
                <p className="font-display text-2xl text-ink-900">{state.combo}</p>
              </div>
              <div className="rounded-md border border-cream-300 bg-cream-50 p-3">
                <p className="text-xs font-extrabold text-ink-500">Misses</p>
                <p className="font-display text-2xl text-ink-900">
                  {state.misses}/{PETAL_RELAY_MISS_LIMIT}
                </p>
              </div>
            </div>

            <div className="mt-3 h-3 overflow-hidden rounded-full bg-cream-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blush-400 via-honey-500 to-garden-500 transition-all"
                style={{ width: `${Math.round(state.progress * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-sm font-bold leading-5 text-ink-700">
              {state.gameOver
                ? `${state.success ? "Every drop handled." : "The relay ended early."} Final score ${state.finalScore}.`
                : canAct
                  ? state.currentItem?.kind === "thorn"
                    ? "Your turn: dodge the thorn."
                    : `Your turn: catch the ${state.currentItem ? petalRelayKindLabel(state.currentItem.kind).toLowerCase() : "next drop"}.`
                  : `Waiting for ${activeSeat?.display_name ?? "the next player"}.`}
            </p>
            {message && (
              <p className="mt-3 rounded-md border border-blush-300/50 bg-blush-100/70 px-3 py-2 text-xs font-extrabold text-blush-800">
                {message}
              </p>
            )}
          </CozyCard>

          <CozyCard className="p-4">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">
              <HeartHandshake className="size-4" /> Seats
            </p>
            <div className="mt-3 grid gap-2">
              {game.seats.map((seat) => (
                <div
                  className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-2",
                    seat.seat_index === state.currentSeat && !state.gameOver
                      ? "border-blush-300 bg-blush-100/70"
                      : "border-cream-300 bg-white/70",
                  )}
                  key={seat.profile_id}
                >
                  <span className="truncate text-sm font-extrabold text-ink-800">{seat.display_name}</span>
                  <Badge variant={seat.seat_index === state.currentSeat && !state.gameOver ? "blush" : "outline"}>
                    {state.seatScores[seat.seat_index] ?? 0} pts
                  </Badge>
                </div>
              ))}
            </div>
          </CozyCard>

          <CozyCard className="p-4">
            <p className="text-xs font-extrabold uppercase tracking-normal text-blush-600">
              Drop log · {state.itemIndex}/{petalRelayItems.length}
            </p>
            {state.history.length === 0 ? (
              <p className="mt-3 rounded-md border border-cream-300 bg-cream-50 p-3 text-sm font-bold text-ink-600">
                No drops handled yet. The first seated player starts.
              </p>
            ) : (
              <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
                {state.history.slice(0, 8).map((entry) => (
                  <div
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm font-bold",
                      entry.points > 0 ? "border-garden-300 bg-garden-100 text-garden-800" : "border-blush-300 bg-blush-100 text-blush-800",
                    )}
                    key={entry.moveIndex}
                  >
                    {entry.playerName} {entry.copy} · {entry.points > 0 ? "+" : ""}
                    {entry.points}
                  </div>
                ))}
              </div>
            )}
          </CozyCard>

          {state.gameOver && (
            <CozyCard className="border-honey-500/40 bg-honey-100/80 p-4">
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-honey-700">
                <Gift className="size-4" /> Reward
              </p>
              <h3 className="mt-1 font-display text-2xl text-ink-900">
                {state.success ? "Relay complete" : "Relay finished"}
              </h3>
              <p className="mt-1 text-sm font-bold text-ink-700">{state.finalScore} team points</p>
              <Button
                className="mt-3 w-full"
                disabled={rewardQueued || game.rewardStatus === "claimed"}
                onClick={claimReward}
                variant="warm"
              >
                <Gift /> {rewardQueued || game.rewardStatus === "claimed" ? "Reward queued" : "Claim reward"}
              </Button>
            </CozyCard>
          )}
        </div>
      </section>
    </div>
  );
}

export function PetalCatchClient({ sessionId }: PetalCatchClientProps) {
  return sessionId ? <PetalCatchRelayClient /> : <PetalCatchSoloClient />;
}
