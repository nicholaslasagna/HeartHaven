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
  type CoopGameDefinition,
  type CoopGameKey,
  type CoopGameStep,
  type CoopReducedState,
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
  if (actionId === "mix" || actionId === "chime" || actionId === "lantern") return "bg-honey-500";
  if (actionId === "sprinkle" || actionId === "hold" || actionId === "release") return "bg-lavender-500";
  if (actionId === "frost" || actionId === "tap") return "bg-blush-400";
  if (actionId === "breeze" || actionId === "rest") return "bg-garden-500";
  if (actionId === "net") return "bg-sky-400";
  return "bg-orange-400";
}

function actionSymbol(actionId: CoopActionId) {
  if (actionId === "mix") return "Whisk";
  if (actionId === "sprinkle") return "Sugar";
  if (actionId === "frost") return "Icing";
  if (actionId === "bake") return "Oven";
  if (actionId === "net") return "Net";
  if (actionId === "lantern") return "Lamp";
  if (actionId === "breeze") return "Wind";
  if (actionId === "release") return "Jar";
  if (actionId === "tap") return "Tap";
  if (actionId === "hold") return "Hold";
  if (actionId === "chime") return "Bell";
  return "Rest";
}

function stageCopy(theme: string) {
  if (theme === "bakeoff") {
    return {
      title: "Recipe stations",
    };
  }
  if (theme === "grove") {
    return {
      title: "Firefly route map",
    };
  }
  return {
    title: "Moonlight staff",
  };
}

type StageProps = {
  definition: CoopGameDefinition;
  state: CoopReducedState;
  currentStep?: CoopGameStep;
  expectedAction?: { shortLabel: string } | null;
  progressPct: number;
};

function MoonbeamBakeoffStage({ definition, state, currentStep, expectedAction, progressPct }: StageProps) {
  const completed = definition.steps.slice(0, state.currentStepIndex);
  const currentLane = currentStep?.lane ?? 0;
  const stationLabels = ["Mixing Bowl", "Topping Tray", "Moon Oven", "Frosting Bag"];

  return (
    <div className="relative min-h-[390px] overflow-hidden rounded-lg border border-honey-500/25 bg-gradient-to-br from-[#fff8e4] via-[#fffdf6] to-[#fde8ed] p-4">
      <div className="absolute inset-x-6 bottom-10 h-20 rounded-[48%] bg-honey-200/45 blur-xl" />
      <div className="relative z-10 grid h-full min-h-[360px] gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="grid gap-3">
          {stationLabels.map((label, index) => (
            <motion.div
              animate={currentLane === index && !state.gameOver ? { scale: [1, 1.03, 1] } : { scale: 1 }}
              className={cn(
                "rounded-lg border bg-white/78 p-3 shadow-sm",
                currentLane === index && !state.gameOver ? "border-blush-300 ring-2 ring-blush-100" : "border-cream-300",
              )}
              key={label}
              transition={{ duration: 1.1, repeat: currentLane === index && !state.gameOver ? Infinity : 0 }}
            >
              <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Station {index + 1}</p>
              <p className="font-display text-xl text-ink-900">{label}</p>
            </motion.div>
          ))}
        </div>

        <div className="relative flex items-center justify-center rounded-lg border border-cream-300 bg-white/65 p-4 shadow-inner">
          <motion.div
            animate={state.lastEntry?.correct ? { rotate: [0, -3, 3, 0], scale: [1, 1.06, 1] } : { y: [0, -5, 0] }}
            className="relative flex size-56 items-center justify-center rounded-full border-[10px] border-honey-200 bg-[#fff6df] shadow-[0_20px_40px_rgba(171,112,39,.18)]"
            transition={{ duration: state.lastEntry ? 0.55 : 2.4, repeat: state.lastEntry ? 0 : Infinity }}
          >
            <div className="absolute inset-8 rounded-full border-4 border-dashed border-blush-200" />
            <div className="absolute left-12 top-14 size-8 rounded-full bg-blush-300/80" />
            <div className="absolute right-14 top-20 size-7 rounded-full bg-lavender-300/80" />
            <div className="absolute bottom-16 left-20 size-6 rounded-full bg-garden-300/80" />
            <div className="relative z-10 text-center">
              <p className="font-display text-3xl text-ink-900">Mooncake</p>
              <p className="text-sm font-black text-honey-800">{progressPct}% baked</p>
            </div>
          </motion.div>
          <motion.div
            animate={{ height: `${Math.max(12, progressPct)}%` }}
            className="absolute right-6 bottom-6 w-4 rounded-full bg-gradient-to-t from-honey-500 to-blush-400"
            transition={{ type: "spring", stiffness: 140, damping: 20 }}
          />
          <div className="absolute right-3 bottom-6 h-32 w-10 rounded-full border border-honey-500/40 bg-white/80 p-1 text-center text-[10px] font-black uppercase text-honey-800">
            Heat
          </div>
        </div>
      </div>
      <div className="relative z-10 mt-4 rounded-lg border border-white/80 bg-white/80 p-3 text-sm font-extrabold text-ink-800">
        {state.gameOver
          ? state.resultCopy
          : currentStep
            ? `${currentStep.prompt} Use ${expectedAction?.shortLabel ?? "the matching station"}.`
            : "The mooncake is ready."}
        {completed.length > 0 && (
          <span className="mt-2 block text-xs text-ink-500">
            Finished: {completed.slice(-3).map((step) => step.label).join(" / ")}
          </span>
        )}
      </div>
    </div>
  );
}

function FireflyGroveStage({ definition, state, currentStep, expectedAction }: StageProps) {
  const nodes = [
    { x: 12, y: 58 },
    { x: 24, y: 28 },
    { x: 42, y: 42 },
    { x: 54, y: 18 },
    { x: 63, y: 56 },
    { x: 77, y: 34 },
    { x: 86, y: 62 },
    { x: 70, y: 78 },
  ];

  return (
    <div className="relative min-h-[390px] overflow-hidden rounded-lg border border-garden-300 bg-gradient-to-br from-[#edf6e7] via-[#fffaf0] to-[#e5f3f7] p-4">
      <div className="absolute inset-0 opacity-80">
        <div className="absolute left-8 top-8 size-40 rounded-full bg-garden-200 blur-3xl" />
        <div className="absolute right-10 bottom-10 size-48 rounded-full bg-sky-100 blur-3xl" />
      </div>
      <div className="relative h-[330px] rounded-lg border border-white/80 bg-white/42 shadow-inner">
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polyline
            fill="none"
            points={nodes.map((node) => `${node.x},${node.y}`).join(" ")}
            stroke="#E7C77D"
            strokeDasharray="2 2"
            strokeLinecap="round"
            strokeWidth="2.5"
          />
          <polyline
            fill="none"
            points={nodes.slice(0, Math.max(1, state.currentStepIndex + 1)).map((node) => `${node.x},${node.y}`).join(" ")}
            stroke="#6A9B4E"
            strokeLinecap="round"
            strokeWidth="3"
          />
        </svg>
        {nodes.map((node, index) => {
          const step = definition.steps[index];
          const complete = index < state.currentStepIndex;
          const active = index === state.currentStepIndex && !state.gameOver;
          return (
            <motion.div
              animate={active ? { scale: [1, 1.2, 1], boxShadow: ["0 0 0 rgba(250,235,194,0)", "0 0 36px rgba(250,235,194,.9)", "0 0 0 rgba(250,235,194,0)"] } : { scale: 1 }}
              className={cn(
                "absolute flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white text-center text-[10px] font-black leading-none shadow-lg",
                complete ? "bg-honey-300 text-ink-900" : active ? actionDotClass(step.actionId) : "bg-cream-100 text-ink-500",
              )}
              key={step.id}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              transition={{ duration: 1.3, repeat: active ? Infinity : 0 }}
            >
              {complete ? "Lit" : actionSymbol(step.actionId)}
            </motion.div>
          );
        })}
        <motion.div
          animate={{
            left: `${nodes[Math.min(state.currentStepIndex, nodes.length - 1)]?.x ?? 12}%`,
            top: `${nodes[Math.min(state.currentStepIndex, nodes.length - 1)]?.y ?? 58}%`,
          }}
          className="absolute size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-honey-200/75 blur-sm"
          transition={{ type: "spring", stiffness: 80, damping: 18 }}
        />
      </div>
      <div className="relative z-10 mt-4 rounded-lg border border-white/80 bg-white/80 p-3 text-sm font-extrabold text-ink-800">
        {state.gameOver
          ? state.resultCopy
          : currentStep
            ? `${currentStep.prompt} Choose ${expectedAction?.shortLabel ?? "the matching guide"}.`
            : "The grove is glowing."}
      </div>
    </div>
  );
}

function MoonlightMelodyStage({ definition, state, currentStep, expectedAction }: StageProps) {
  return (
    <div className="relative min-h-[390px] overflow-hidden rounded-lg border border-lavender-300 bg-gradient-to-br from-[#efe6f7] via-[#fffdf6] to-[#fde8ed] p-4">
      <div className="absolute inset-0 opacity-70">
        <div className="absolute left-16 top-8 size-40 rounded-full bg-lavender-200 blur-3xl" />
        <div className="absolute right-12 bottom-12 size-44 rounded-full bg-blush-100 blur-3xl" />
      </div>
      <div className="relative h-[330px] rounded-lg border border-white/80 bg-white/58 p-6 shadow-inner">
        <div className="absolute inset-x-6 top-1/2 grid -translate-y-1/2 gap-7">
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="h-1 rounded-full bg-ink-900/12" key={index} />
          ))}
        </div>
        <div className="absolute inset-x-8 top-8 flex justify-between text-xs font-black uppercase tracking-normal text-lavender-700">
          <span>Intro</span>
          <span>Harmony</span>
          <span>Finale</span>
        </div>
        {definition.steps.map((step, index) => {
          const complete = index < state.currentStepIndex;
          const active = index === state.currentStepIndex && !state.gameOver;
          const left = 10 + index * 11.5;
          const top = 70 - step.lane * 14;
          return (
            <motion.div
              animate={active ? { y: [0, -10, 0], scale: [1, 1.18, 1] } : complete ? { y: 0, scale: 0.9 } : { y: 0, scale: 1 }}
              className={cn(
                "absolute flex size-14 items-center justify-center rounded-full border-4 border-white font-display text-lg shadow-lg",
                complete ? "bg-garden-300 text-garden-900" : active ? actionDotClass(step.actionId) : "bg-cream-100 text-ink-500",
              )}
              key={step.id}
              style={{ left: `${left}%`, top: `${top}%` }}
              transition={{ duration: 1.1, repeat: active ? Infinity : 0 }}
            >
              {actionSymbol(step.actionId)}
            </motion.div>
          );
        })}
        <motion.div
          animate={{ width: `${Math.round(state.progress * 100)}%` }}
          className="absolute bottom-7 left-8 h-3 rounded-full bg-gradient-to-r from-lavender-400 via-blush-400 to-honey-400"
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
        <div className="absolute bottom-5 left-8 right-8 h-7 rounded-full border border-lavender-300/60 bg-white/65" />
      </div>
      <div className="relative z-10 mt-4 rounded-lg border border-white/80 bg-white/80 p-3 text-sm font-extrabold text-ink-800">
        {state.gameOver
          ? state.resultCopy
          : currentStep
            ? `${currentStep.prompt} Play ${expectedAction?.shortLabel ?? "the matching note"}.`
            : "The duet is complete."}
      </div>
    </div>
  );
}

function ThemedStage(props: StageProps) {
  if (props.definition.theme === "bakeoff") return <MoonbeamBakeoffStage {...props} />;
  if (props.definition.theme === "grove") return <FireflyGroveStage {...props} />;
  return <MoonlightMelodyStage {...props} />;
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

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <ThemedStage
              currentStep={currentStep}
              definition={definition}
              expectedAction={expectedAction}
              progressPct={progressPct}
              state={state}
            />

            <div className="grid content-start gap-3">
              <div className="rounded-lg border border-cream-300 bg-cream-50/80 p-4">
                <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Turn</p>
                <h3 className="mt-1 font-display text-2xl text-ink-900">
                  {state.gameOver ? "Round complete" : canAct ? "Your move" : waitingCopy}
                </h3>
                <p className="mt-1 text-sm font-bold leading-5 text-ink-600">
                  {state.gameOver
                    ? `${state.finalScore} final points.`
                    : definition.theme === "bakeoff"
                      ? "Choose the recipe station shown on the current prep card."
                      : definition.theme === "grove"
                        ? "Choose the tool needed for the glowing route node."
                        : "Choose the note action shown on the staff."}
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
