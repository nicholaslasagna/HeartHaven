"use client";

import Link from "next/link";
import { ArrowLeft, Copy, HandHeart, RefreshCcw, Scissors, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { useGameWallet } from "@/lib/game/use-game-wallet";
import { cn } from "@/lib/utils";

type Choice = "rock" | "paper" | "scissors";
type PlayerId = "blush" | "lavender";

type RoundResult = {
  round: number;
  blush: Choice;
  lavender: Choice;
  winner: PlayerId | "tie";
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

export function RockPaperScissorsClient() {
  const { grantReward } = useGameWallet();
  const [turn, setTurn] = useState<PlayerId>("blush");
  const [starter, setStarter] = useState<PlayerId>("blush");
  const [picks, setPicks] = useState<Partial<Record<PlayerId, Choice>>>({});
  const [scores, setScores] = useState<Record<PlayerId, number>>({ blush: 0, lavender: 0 });
  const [history, setHistory] = useState<RoundResult[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [matchWinner, setMatchWinner] = useState<PlayerId | null>(null);
  const [copied, setCopied] = useState(false);

  const roundNumber = history.length + 1;
  const status = useMemo(() => {
    if (matchWinner) return `${players[matchWinner].team} won the match. Rewards are live.`;
    if (revealed) return "Round revealed. Start the next round when everyone is ready.";
    return `${players[turn].team}, choose in secret. Pass the device before revealing.`;
  }, [matchWinner, revealed, turn]);

  function choose(choice: Choice) {
    if (revealed || matchWinner) return;
    playCozyCue("cardFlip");

    if (turn === "blush") {
      setPicks({ blush: choice });
      setTurn("lavender");
      return;
    }

    const nextPicks = { ...picks, lavender: choice };
    if (!nextPicks.blush) return;

    const winner = getWinner(nextPicks.blush, nextPicks.lavender);
    const result: RoundResult = {
      round: roundNumber,
      blush: nextPicks.blush,
      lavender: nextPicks.lavender,
      winner,
    };
    const nextScores = { ...scores };
    if (winner !== "tie") {
      nextScores[winner] += 1;
      playCozyCue("score");
    } else {
      playCozyCue("heart");
    }

    setPicks(nextPicks);
    setScores(nextScores);
    setHistory((value) => [result, ...value].slice(0, 6));
    setRevealed(true);

    const wonMatch = winner !== "tie" && nextScores[winner] >= 3;
    if (wonMatch) {
      setMatchWinner(winner);
      grantReward({
        gameId: "rock-paper-scissors",
        label: "Moonstone RPS",
        score: 300 + nextScores[winner] * 80,
        coins: 160,
        hearts: 5,
      });
      playCozyCue("reward");
    }
  }

  function nextRound() {
    const nextStarter = starter === "blush" ? "lavender" : "blush";
    setStarter(nextStarter);
    setTurn(nextStarter);
    setPicks({});
    setRevealed(false);
    playCozyCue("ui");
  }

  function restartMatch() {
    setTurn("blush");
    setStarter("blush");
    setPicks({});
    setScores({ blush: 0, lavender: 0 });
    setHistory([]);
    setRevealed(false);
    setMatchWinner(null);
    playCozyCue("ui");
  }

  function copyInvite() {
    const link = `${window.location.origin}/app/rock-paper-scissors?party=HH-RPS-MOON`;
    navigator.clipboard?.writeText(link).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-lavender-300/50 bg-lavender-100/55 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-500">Party game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Moonstone Rock Paper Scissors</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            A cozy best-of-five secret-pick duel for couples, friends, and party seats. Turn switching is enforced locally
            now and ready for Realtime game moves later.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
          <Button onClick={copyInvite} variant="warm">
            <Copy /> {copied ? "Copied" : "Invite"}
          </Button>
        </div>
      </section>

      <RewardWalletPanel />

      <section className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <CozyCard className="overflow-hidden p-0">
          <div className="border-b border-cream-300 bg-white/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Badge variant="blush"><HandHeart className="size-3.5" /> Secret turns</Badge>
                <p className="mt-2 text-sm font-black text-ink-900">{status}</p>
              </div>
              <div className="flex gap-2 text-sm font-black text-ink-800">
                <span className="rounded-md bg-blush-100 px-3 py-1.5">Blush {scores.blush}</span>
                <span className="rounded-md bg-lavender-100 px-3 py-1.5">Lavender {scores.lavender}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-3">
            {choices.map((choice) => (
              <button
                className={cn(
                  "group rounded-lg border border-cream-300 bg-cream-50 p-4 text-left shadow-sm transition hover:-translate-y-1 hover:border-blush-300 hover:bg-white",
                  revealed || matchWinner ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                )}
                disabled={revealed || Boolean(matchWinner)}
                key={choice.id}
                onClick={() => choose(choice.id)}
                type="button"
              >
                <ChoiceIllustration choice={choice.id} active={picks[turn] === choice.id} color={players[turn].color} />
                <p className="mt-3 font-display text-2xl text-ink-900">{choice.label}</p>
                <p className="mt-1 text-xs font-bold text-ink-600">{choice.description}</p>
              </button>
            ))}
          </div>

          <div className="border-t border-cream-300 bg-white/72 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              {(["blush", "lavender"] as PlayerId[]).map((playerId) => (
                <div className={cn("rounded-lg border border-cream-300 p-3", players[playerId].bg)} key={playerId}>
                  <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">{players[playerId].team}</p>
                  <p className="mt-1 text-lg font-black text-ink-900">
                    {revealed || matchWinner ? labelChoice(picks[playerId]) : picks[playerId] ? "Locked in" : playerId === turn ? "Choosing now" : "Waiting"}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <CozyButton disabled={!revealed || Boolean(matchWinner)} onClick={nextRound} size="sm" variant="warm">
                <Sparkles /> Next round
              </CozyButton>
              <CozyButton onClick={restartMatch} size="sm" variant="secondary">
                <RefreshCcw /> Reset match
              </CozyButton>
            </div>
          </div>
        </CozyCard>

        <CozyCard className="p-5">
          <h2 className="font-display text-2xl text-ink-900">Round journal</h2>
          <div className="mt-4 grid gap-3">
            {history.length === 0 ? (
              <p className="rounded-lg border border-cream-300 bg-cream-50 p-4 text-sm font-bold text-ink-700">
                No rounds yet. First to 3 wins the match and earns wallet rewards.
              </p>
            ) : (
              history.map((round) => (
                <div className="rounded-lg border border-cream-300 bg-white/72 p-3 shadow-sm" key={round.round}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black text-ink-900">Round {round.round}</p>
                    <Badge variant={round.winner === "tie" ? "outline" : "garden"}>
                      {round.winner === "tie" ? "Tie" : `${players[round.winner].team} wins`}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs font-bold text-ink-600">
                    Blush {labelChoice(round.blush)} vs Lavender {labelChoice(round.lavender)}
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
