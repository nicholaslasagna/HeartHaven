"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CircleDot, Gift, HeartHandshake, RefreshCcw, Sparkles, Trophy, UsersRound } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { GameHubButton } from "@/components/game/game-hub-button";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type CoopActionId,
  type CoopGameKey,
  getCoOpPartyGame,
  reduceCoopGameState,
} from "@/lib/game/co-op-party-games";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { cn } from "@/lib/utils";

type CoOpPartyGameClientProps = {
  gameKey: CoopGameKey;
};

function fallbackPayout(score: number) {
  return {
    coins: Math.min(95, Math.floor(Math.max(0, score) * 0.04)),
    hearts: score >= 1000 ? 1 : 0,
  };
}

function actionDotClass(actionId: CoopActionId) {
  if (actionId === "rose") return "bg-blush-400";
  if (actionId === "honey") return "bg-honey-500";
  if (actionId === "lavender") return "bg-lavender-500";
  return "bg-garden-500";
}

function stageCopy(theme: string) {
  if (theme === "bakeoff") {
    return {
      title: "Shared kitchen table",
      center: "Mooncake",
      left: "Mixing bowl",
      right: "Moon oven",
    };
  }
  if (theme === "grove") {
    return {
      title: "Lantern grove path",
      center: "Firefly chain",
      left: "Garden gate",
      right: "Moon ring",
    };
  }
  return {
    title: "Moonlight music stand",
    center: "Shared melody",
    left: "Soft intro",
    right: "Garden finale",
  };
}

export function CoOpPartyGameClient({ gameKey }: CoOpPartyGameClientProps) {
  const definition = getCoOpPartyGame(gameKey);
  const game = useMiniGameSession(definition.gameKey, { maxPlayers: definition.maxPlayers });
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<CoopActionId | null>(null);
  const [rewardQueued, setRewardQueued] = useState(false);
  const claimedForSessionRef = useRef<string | null>(null);

  const state = useMemo(
    () => reduceCoopGameState(definition, game.moves, game.seats),
    [definition, game.moves, game.seats],
  );

  const currentStep = definition.steps[state.currentStepIndex] ?? definition.steps.at(-1);
  const expectedAction = currentStep
    ? definition.actions.find((action) => action.id === currentStep.actionId)
    : null;
  const currentSeat = game.seats.find((seat) => seat.seat_index === state.currentSeat) ?? null;
  const mySeatIndex = game.mySeat?.seat_index ?? null;
  const canAct = Boolean(game.sessionId && mySeatIndex !== null && mySeatIndex === state.currentSeat && !state.gameOver);
  const waitingCopy = currentSeat?.display_name
    ? `Waiting for ${currentSeat.display_name}.`
    : "Waiting for a seated player.";
  const copy = stageCopy(definition.theme);
  const progressPct = Math.round(state.progress * 100);
  const sessionLabel = game.sessionId ? "Live shared session" : "Connecting shared session";

  async function chooseAction(actionId: CoopActionId) {
    if (!game.sessionId) {
      setMessage("Connecting the shared game session...");
      return;
    }
    if (!currentStep) return;
    if (!canAct) {
      setMessage(state.gameOver ? "This round is complete." : waitingCopy);
      return;
    }
    if (pendingAction) {
      setMessage("Saving your last move.");
      return;
    }

    setPendingAction(actionId);
    setMessage(null);
    playCozyCue(actionId === currentStep.actionId ? "combo" : "miss");
    const result = await game.submitMove("coop-action", {
      gameKey: definition.gameKey,
      actionId,
      stepId: currentStep.id,
      expectedActionId: currentStep.actionId,
    });
    if (!result.ok) {
      setMessage(result.reason);
    }
    window.setTimeout(() => setPendingAction(null), 650);
  }

  function claimReward() {
    if (!state.gameOver || rewardQueued) return;
    const sessionKey = `${game.sessionId ?? "solo"}:${state.finalScore}:${state.countedMoves}`;
    if (claimedForSessionRef.current === sessionKey) return;
    claimedForSessionRef.current = sessionKey;
    setRewardQueued(true);
    const payout = fallbackPayout(state.finalScore);
    game.handleReward({
      gameId: definition.gameKey,
      label: definition.rewardLabel,
      score: state.finalScore,
      coins: payout.coins,
      hearts: payout.hearts,
    });
    playCozyCue("reward");
  }

  return (
    <div className="grid gap-5">
      <section
        className={cn(
          "overflow-hidden rounded-lg border border-cream-300/80 bg-gradient-to-br p-5 shadow-sm",
          definition.backdropClassName,
        )}
      >
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <Badge variant="garden">
              <UsersRound className="size-3.5" />
              {definition.kicker}
            </Badge>
            <h1 className="mt-3 font-display text-4xl leading-none text-ink-900">{definition.title}</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-ink-700">{definition.longDescription}</p>
            <p className="mt-2 text-xs font-extrabold uppercase tracking-normal text-ink-500">
              {sessionLabel} · {game.status}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GameHubButton returnToLobby={game.returnToLobby} />
            <Button onClick={() => void game.returnToLobby()} variant="warm">
              <RefreshCcw /> Back to lobby
            </Button>
          </div>
        </div>
      </section>

      <RewardWalletPanel />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <CozyCard className="overflow-hidden p-0">
          <div className="border-b border-cream-300 bg-white/75 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">{copy.title}</p>
                <h2 className="font-display text-2xl text-ink-900">
                  {currentStep ? currentStep.label : "Round complete"}
                </h2>
              </div>
              <Badge variant={state.gameOver ? "garden" : "blush"}>
                {state.gameOver ? "Complete" : `${progressPct}%`}
              </Badge>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-cream-200">
              <motion.div
                animate={{ width: `${progressPct}%` }}
                className="h-full rounded-full bg-gradient-to-r from-blush-400 via-honey-500 to-garden-500"
                initial={false}
                transition={{ type: "spring", stiffness: 160, damping: 24 }}
              />
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_.9fr]">
            <div className="relative min-h-[360px] overflow-hidden rounded-lg border border-cream-300 bg-white/58 p-4">
              <div className="absolute inset-0 opacity-70">
                <div className="absolute left-8 top-10 size-28 rounded-full bg-blush-100 blur-2xl" />
                <div className="absolute right-8 top-20 size-32 rounded-full bg-lavender-100 blur-2xl" />
                <div className="absolute bottom-4 left-1/3 size-36 rounded-full bg-garden-100 blur-2xl" />
              </div>

              <div className="relative z-10 flex h-full min-h-[330px] flex-col justify-between">
                <div className="grid grid-cols-3 items-start gap-3 text-center text-xs font-extrabold uppercase tracking-normal text-ink-500">
                  <span>{copy.left}</span>
                  <span>{copy.center}</span>
                  <span>{copy.right}</span>
                </div>

                <div className="relative mx-auto flex size-56 items-center justify-center rounded-full border border-cream-300 bg-cream-50/85 shadow-inner">
                  <motion.div
                    animate={{
                      scale: state.lastEntry?.correct ? [1, 1.08, 1] : state.lastEntry ? [1, 0.95, 1] : [1, 1.02, 1],
                      rotate: definition.theme === "melody" ? [0, 2, -2, 0] : 0,
                    }}
                    className={cn(
                      "flex size-40 items-center justify-center rounded-full border-4 text-center font-display text-2xl leading-tight shadow-lg",
                      definition.accentClassName,
                    )}
                    transition={{ duration: state.lastEntry ? 0.55 : 2.4, repeat: state.lastEntry ? 0 : Infinity }}
                  >
                    {definition.theme === "bakeoff" ? "Moon Cake" : definition.theme === "grove" ? "Glow Path" : "Duet"}
                  </motion.div>

                  {definition.steps.map((step, index) => {
                    const angle = (Math.PI * 2 * index) / definition.steps.length - Math.PI / 2;
                    const complete = index < state.currentStepIndex;
                    const active = index === state.currentStepIndex && !state.gameOver;
                    return (
                      <motion.div
                        animate={active ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                        className={cn(
                          "absolute flex size-8 items-center justify-center rounded-full border-2 border-white text-[10px] font-extrabold shadow",
                          complete ? "bg-garden-400 text-white" : active ? actionDotClass(step.actionId) : "bg-cream-200 text-ink-500",
                        )}
                        key={step.id}
                        style={{
                          left: `calc(50% + ${Math.cos(angle) * 122}px - 1rem)`,
                          top: `calc(50% + ${Math.sin(angle) * 122}px - 1rem)`,
                        }}
                        transition={{ duration: 1.1, repeat: active ? Infinity : 0 }}
                      >
                        {index + 1}
                      </motion.div>
                    );
                  })}
                </div>

                <motion.div
                  animate={state.lastEntry ? { y: [6, 0], opacity: 1 } : { opacity: 0.85 }}
                  className="rounded-lg border border-white/80 bg-white/80 p-3 text-center text-sm font-extrabold text-ink-800 shadow-sm"
                >
                  {state.gameOver
                    ? state.resultCopy
                    : currentStep
                      ? `${currentStep.prompt} ${expectedAction ? `Choose ${expectedAction.shortLabel}.` : ""}`
                      : "Every step is complete."}
                </motion.div>
              </div>
            </div>

            <div className="grid content-start gap-3">
              <div className="rounded-lg border border-cream-300 bg-cream-50/80 p-4">
                <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Turn</p>
                <h3 className="mt-1 font-display text-2xl text-ink-900">
                  {state.gameOver ? "Round complete" : canAct ? "Your move" : waitingCopy}
                </h3>
                <p className="mt-1 text-sm font-bold leading-5 text-ink-600">
                  {state.gameOver
                    ? `${state.finalScore} final points.`
                    : "Tap the matching cue. Wrong cues break the combo but the team can recover."}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {definition.actions.map((action) => {
                  const expected = currentStep?.actionId === action.id && !state.gameOver;
                  return (
                    <motion.button
                      className={cn(
                        "rounded-lg border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55",
                        action.className,
                        expected && "ring-2 ring-white ring-offset-2",
                      )}
                      disabled={!canAct || Boolean(pendingAction)}
                      key={action.id}
                      onClick={() => void chooseAction(action.id)}
                      type="button"
                      whileTap={{ scale: 0.97 }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-display text-xl">{action.label}</span>
                        {pendingAction === action.id ? <CircleDot className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
                      </span>
                      <span className="mt-1 block text-xs font-bold leading-4 opacity-80">{action.description}</span>
                    </motion.button>
                  );
                })}
              </div>

              {message && (
                <p className="rounded-md border border-blush-300/50 bg-blush-100/70 px-3 py-2 text-xs font-extrabold text-blush-800">
                  {message}
                </p>
              )}
            </div>
          </div>
        </CozyCard>

        <div className="grid gap-4">
          <CozyCard className="p-4">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-600">
              <Trophy className="size-4" /> Team score
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
                <p className="font-display text-2xl text-ink-900">{state.misses}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {game.seats.map((seat) => (
                <div className="flex items-center justify-between rounded-md border border-cream-300 bg-white/70 px-3 py-2" key={seat.profile_id}>
                  <span className="truncate text-sm font-extrabold text-ink-800">{seat.display_name}</span>
                  <Badge variant={seat.seat_index === state.currentSeat && !state.gameOver ? "blush" : "outline"}>
                    {state.seatScores[seat.seat_index] ?? 0} pts
                  </Badge>
                </div>
              ))}
            </div>
          </CozyCard>

          <CozyCard className="p-4">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">
              <HeartHandshake className="size-4" /> Move log
            </p>
            {state.history.length === 0 ? (
              <p className="mt-3 rounded-md border border-cream-300 bg-cream-50 p-3 text-sm font-bold text-ink-600">
                No moves yet. The first player starts the chain.
              </p>
            ) : (
              <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1">
                {state.history.slice(0, 8).map((entry) => (
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm font-bold",
                      entry.correct ? "border-garden-300 bg-garden-100 text-garden-800" : "border-blush-300 bg-blush-100 text-blush-800",
                    )}
                    initial={{ opacity: 0, y: 8 }}
                    key={entry.moveIndex}
                  >
                    {entry.playerName}: {entry.actionLabel} {entry.correct ? "matched" : `missed ${entry.expectedLabel}`} · {entry.stepLabel}
                  </motion.div>
                ))}
              </div>
            )}
          </CozyCard>

          {state.gameOver && (
            <CozyCard className="border-honey-500/40 bg-honey-100/80 p-4">
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-honey-700">
                <Gift className="size-4" /> Reward
              </p>
              <h3 className="mt-1 font-display text-2xl text-ink-900">{state.resultTitle}</h3>
              <p className="mt-1 text-sm font-bold text-ink-700">{state.finalScore} final points</p>
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
