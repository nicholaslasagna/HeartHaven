"use client";

import { HandHeart, RefreshCcw, Scissors } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { GameHubButton } from "@/components/game/game-hub-button";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { cn } from "@/lib/utils";

type Choice = "rock" | "paper" | "scissors";
type PlayerId = "blush" | "lavender";

type RoundResult = {
  round: number;
  blush?: Choice;
  lavender?: Choice;
  winner?: PlayerId | "tie";
  complete: boolean;
};

const players: Record<PlayerId, { label: string; team: string; color: string; bg: string }> = {
  blush: { label: "Player 1", team: "Blush Team", color: "#D87E8C", bg: "bg-blush-100" },
  lavender: { label: "Player 2", team: "Lavender Team", color: "#8E70BD", bg: "bg-lavender-100" },
};

const choices: Array<{ id: Choice; label: string; description: string }> = [
  { id: "rock", label: "Moonstone", description: "Beats scissors" },
  { id: "paper", label: "Love Letter", description: "Beats moonstone" },
  { id: "scissors", label: "Ribbon Shears", description: "Beats love letter" },
];

const validChoices = new Set<Choice>(["rock", "paper", "scissors"]);

function seatToPlayer(seatIndex: number | null | undefined): PlayerId | null {
  if (seatIndex === 0) return "blush";
  if (seatIndex === 1) return "lavender";
  return null;
}

function choiceFromPayload(value: unknown): Choice | null {
  if (typeof value !== "string") return null;
  return validChoices.has(value as Choice) ? (value as Choice) : null;
}

function roundFromPayload(value: unknown) {
  const round = Number(value);
  return Number.isFinite(round) && round > 0 ? Math.floor(round) : 1;
}

function getWinner(blush: Choice, lavender: Choice): PlayerId | "tie" {
  if (blush === lavender) return "tie";
  if (
    (blush === "rock" && lavender === "scissors") ||
    (blush === "paper" && lavender === "rock") ||
    (blush === "scissors" && lavender === "paper")
  ) {
    return "blush";
  }
  return "lavender";
}

function labelChoice(choice?: Choice) {
  if (!choice) return "Waiting";
  return choices.find((item) => item.id === choice)?.label ?? choice;
}

export function RockPaperScissorsClient() {
  const game = useMiniGameSession("rock-paper-scissors", { maxPlayers: 2 });
  const [message, setMessage] = useState<string | null>(null);
  const rewardedMatchRef = useRef<string | null>(null);

  const myPlayerId = seatToPlayer(game.mySeat?.seat_index ?? null);
  const seatNames = useMemo(() => {
    const names: Record<PlayerId, string> = {
      blush: "Blush Team",
      lavender: "Lavender Team",
    };
    for (const seat of game.seats) {
      const player = seatToPlayer(seat.seat_index);
      if (player && seat.display_name) names[player] = seat.display_name;
    }
    return names;
  }, [game.seats]);

  const shared = useMemo(() => {
    const picksByRound = new Map<number, Partial<Record<PlayerId, Choice>>>();

    for (const move of game.moves) {
      if (move.move_type !== "pick") continue;
      const player = seatToPlayer(move.seat_index);
      const choice = choiceFromPayload(move.payload.choice);
      const round = roundFromPayload(move.payload.round);
      if (!player || !choice) continue;

      const picks = picksByRound.get(round) ?? {};
      // Ignore duplicate client retries for the same round/seat. The first
      // accepted pick is the round authority for every replaying client.
      if (!picks[player]) picks[player] = choice;
      picksByRound.set(round, picks);
    }

    const rounds: RoundResult[] = [];
    const scores: Record<PlayerId, number> = { blush: 0, lavender: 0 };
    let matchWinner: PlayerId | null = null;

    for (const round of [...picksByRound.keys()].sort((a, b) => a - b)) {
      const picks = picksByRound.get(round) ?? {};
      const result: RoundResult = {
        round,
        blush: picks.blush,
        lavender: picks.lavender,
        complete: Boolean(picks.blush && picks.lavender),
      };
      if (result.complete && result.blush && result.lavender && !matchWinner) {
        result.winner = getWinner(result.blush, result.lavender);
        if (result.winner !== "tie") {
          scores[result.winner] += 1;
          if (scores[result.winner] >= 3) matchWinner = result.winner;
        }
      }
      rounds.push(result);
      if (matchWinner) break;
    }

    const last = rounds.at(-1);
    const currentRound = !last || last.complete ? (last?.round ?? 0) + 1 : last.round;
    const currentPicks = picksByRound.get(currentRound) ?? {};

    return {
      currentRound,
      currentPicks,
      rounds: rounds.toReversed(),
      scores,
      matchWinner,
    };
  }, [game.moves]);

  useEffect(() => {
    if (!shared.matchWinner || !game.sessionId) return;
    const key = `${game.sessionId}:${shared.matchWinner}:${shared.scores[shared.matchWinner]}`;
    if (rewardedMatchRef.current === key) return;
    rewardedMatchRef.current = key;
    game.handleReward({
      gameId: "rock-paper-scissors",
      label: "Moonstone RPS",
      score: 300 + shared.scores[shared.matchWinner] * 80,
      coins: 160,
      hearts: 5,
    });
    playCozyCue("reward");
  }, [game, shared.matchWinner, shared.scores]);

  async function choose(choice: Choice) {
    if (!game.sessionId) {
      setMessage("Connecting online session...");
      return;
    }
    if (!myPlayerId) {
      setMessage("Join a two-player lobby to pick.");
      return;
    }
    if (shared.matchWinner) {
      setMessage("The match is complete. Start a fresh lobby for another duel.");
      return;
    }
    if (shared.currentPicks[myPlayerId]) {
      setMessage("Your pick is locked. Waiting for the other player.");
      return;
    }

    playCozyCue("cardFlip");
    const result = await game.submitMove("pick", {
      round: shared.currentRound,
      choice,
    });
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    setMessage("Pick locked. Waiting for the reveal.");
  }

  const opponent: PlayerId = myPlayerId === "lavender" ? "blush" : "lavender";
  const myPick = myPlayerId ? shared.currentPicks[myPlayerId] : undefined;
  const opponentPick = shared.currentPicks[opponent];
  const waitingForOpponent = Boolean(myPick && !opponentPick && !shared.matchWinner);
  const needsSecondSeat = game.seats.length < 2;

  const status = shared.matchWinner
    ? `${seatNames[shared.matchWinner]} won the match.`
    : needsSecondSeat
      ? "Waiting for one more player from the lobby."
      : waitingForOpponent
        ? "Your pick is locked. Waiting for the reveal."
        : myPlayerId
          ? "Choose once this round. Results reveal after both players pick."
          : "Join a lobby seat to play.";

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-lavender-300/50 bg-lavender-100/55 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-500">Party game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Moonstone Rock Paper Scissors</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Two lobby seats pick secretly. The shared move log reveals the round only after both players lock in.
          </p>
          <p className="mt-2 text-xs font-extrabold text-lavender-600">{game.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GameHubButton returnToLobby={game.returnToLobby} />
          <Button onClick={() => void game.returnToLobby()} variant="warm">
            <RefreshCcw /> New lobby
          </Button>
        </div>
      </section>

      <RewardWalletPanel />

      <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <CozyCard className="overflow-hidden p-0">
          <div className="border-b border-cream-300 bg-white/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Badge variant="blush"><HandHeart className="size-3.5" /> Synced round {shared.currentRound}</Badge>
                <p className="mt-2 text-sm font-black text-ink-900">{status}</p>
                {message && <p className="mt-1 text-xs font-extrabold text-lavender-600">{message}</p>}
              </div>
              <div className="flex gap-2 text-sm font-black text-ink-800">
                <span className="rounded-md bg-blush-100 px-3 py-1.5">
                  {seatNames.blush} {shared.scores.blush}
                </span>
                <span className="rounded-md bg-lavender-100 px-3 py-1.5">
                  {seatNames.lavender} {shared.scores.lavender}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-3">
            {choices.map((choice) => {
              const disabled = Boolean(shared.matchWinner || needsSecondSeat || !myPlayerId || myPick);
              return (
                <button
                  className={cn(
                    "group rounded-lg border border-cream-300 bg-cream-50 p-4 text-left shadow-sm transition hover:-translate-y-1 hover:border-blush-300 hover:bg-white",
                    disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                  )}
                  disabled={disabled}
                  key={choice.id}
                  onClick={() => void choose(choice.id)}
                  type="button"
                >
                  <ChoiceIllustration choice={choice.id} active={myPick === choice.id} color={myPlayerId ? players[myPlayerId].color : "#D87E8C"} />
                  <p className="mt-3 font-display text-2xl text-ink-900">{choice.label}</p>
                  <p className="mt-1 text-xs font-bold text-ink-600">{choice.description}</p>
                </button>
              );
            })}
          </div>

          <div className="border-t border-cream-300 bg-white/72 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              {(["blush", "lavender"] as PlayerId[]).map((playerId) => {
                const pick = shared.currentPicks[playerId];
                const revealCurrent = Boolean(shared.currentPicks.blush && shared.currentPicks.lavender);
                return (
                  <div className={cn("rounded-lg border border-cream-300 p-3", players[playerId].bg)} key={playerId}>
                    <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">
                      {seatNames[playerId]} {myPlayerId === playerId ? "(you)" : ""}
                    </p>
                    <p className="mt-1 text-lg font-black text-ink-900">
                      {revealCurrent ? labelChoice(pick) : pick ? "Locked in" : "Choosing"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </CozyCard>

        <CozyCard className="p-5">
          <h2 className="font-display text-2xl text-ink-900">Round journal</h2>
          <div className="mt-4 grid gap-3">
            {shared.rounds.length === 0 ? (
              <p className="rounded-lg border border-cream-300 bg-cream-50 p-4 text-sm font-bold text-ink-700">
                No shared rounds yet. First to 3 wins the match and earns wallet rewards.
              </p>
            ) : (
              shared.rounds.map((round) => (
                <div className="rounded-lg border border-cream-300 bg-white/72 p-3 shadow-sm" key={round.round}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black text-ink-900">Round {round.round}</p>
                    <Badge variant={!round.complete || round.winner === "tie" ? "outline" : "garden"}>
                      {!round.complete ? "Waiting" : round.winner === "tie" ? "Tie" : `${seatNames[round.winner ?? "blush"]} wins`}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs font-bold text-ink-600">
                    {round.complete
                      ? `Blush ${labelChoice(round.blush)} vs Lavender ${labelChoice(round.lavender)}`
                      : "One player has locked in. Waiting for the other pick."}
                  </p>
                </div>
              ))
            )}
          </div>
        </CozyCard>
      </section>
    </div>
  );
}

function ChoiceIllustration({ choice, active, color }: { choice: Choice; active: boolean; color: string }) {
  return (
    <motion.div
      animate={{ rotate: active ? [0, -4, 4, 0] : 0, y: active ? [0, -4, 0] : 0 }}
      className="relative grid h-32 place-items-center rounded-lg border border-white bg-gradient-to-br from-cream-50 via-blush-100/55 to-lavender-100/65 shadow-inner"
      transition={{ duration: 0.5 }}
    >
      <div className="absolute bottom-5 h-5 w-24 rounded-full bg-ink-900/10" />
      {choice === "rock" ? (
        <div className="relative size-20 rounded-[32px] border-4 border-white shadow-md" style={{ backgroundColor: color }}>
          <div className="absolute left-3 top-3 size-5 rounded-full bg-white/45" />
          <div className="absolute bottom-4 left-5 h-3 w-10 rounded-full bg-ink-900/20" />
        </div>
      ) : choice === "paper" ? (
        <div className="relative h-24 w-20 rotate-3 rounded-md border-4 border-white bg-cream-50 shadow-md">
          <div className="absolute left-3 right-3 top-5 h-1 rounded-full bg-blush-300" />
          <div className="absolute left-3 right-4 top-10 h-1 rounded-full bg-lavender-300" />
          <div className="absolute bottom-4 left-1/2 size-7 -translate-x-1/2 rounded-full bg-blush-200" />
        </div>
      ) : (
        <div className="relative h-24 w-24">
          <Scissors className="absolute left-3 top-4 size-20 rotate-45 text-lavender-500 drop-shadow-sm" strokeWidth={2.4} />
          <div className="absolute bottom-6 left-7 size-7 rounded-full border-4 border-white bg-blush-300" />
          <div className="absolute bottom-2 right-4 size-7 rounded-full border-4 border-white bg-honey-500" />
        </div>
      )}
    </motion.div>
  );
}
