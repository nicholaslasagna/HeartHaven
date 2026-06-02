"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Heart, Sparkles } from "lucide-react";
import { BowlingCanvasLoader } from "@/components/game/bowling-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { computeBowlingState, type BowlingRoll } from "@/lib/game/bowling-scoring";
import { cn } from "@/lib/utils";

const DEFAULT_SEAT_NAMES = ["Blush Lane", "Lavender Lane"];

export function BowlingClient() {
  const game = useMiniGameSession("bowling", { maxPlayers: 2 });

  // Derive the ordered roll log from the shared move log. Every client
  // replays the same list through the pure reducer → identical state.
  const rolls = useMemo<BowlingRoll[]>(
    () =>
      game.moves
        .filter((move) => move.move_type === "roll")
        .map((move) => ({
          seat: Number(move.seat_index ?? 0),
          pins: Number((move.payload as { pins?: number })?.pins ?? 0),
        })),
    [game.moves],
  );

  // Solo play seats one player; party play seats two. Drive the reducer's
  // turn order off however many are actually seated so solo doesn't wait
  // forever on a phantom seat 1.
  const seatCount = Math.max(1, game.seats.length || 1);
  const state = useMemo(() => computeBowlingState(rolls, seatCount), [rolls, seatCount]);

  const mySeatIndex = game.mySeat?.seat_index ?? null;

  const seatNames = useMemo(() => {
    const names = [...DEFAULT_SEAT_NAMES];
    for (const seat of game.seats) {
      if (typeof seat.seat_index === "number" && seat.display_name) {
        names[seat.seat_index] = seat.display_name;
      }
    }
    return names;
  }, [game.seats]);

  // Claim the validated reward once when the match ends. Bowling's server
  // metadata doesn't carry gameOver (it uses the generic move-log path),
  // so the client reducer is the source of truth for completion. Each
  // player claims their own run with their own total (server caps it).
  const claimedRef = useRef(false);
  useEffect(() => {
    if (!state.gameOver || claimedRef.current) return;
    claimedRef.current = true;
    const seat = mySeatIndex ?? 0;
    const myTotal = state.players[seat]?.total ?? 0;
    game.handleReward({
      gameId: "bowling",
      label: "Moonberry Bowling",
      score: myTotal,
      coins: 0,
      hearts: 0,
    });
  }, [state.gameOver, state.players, mySeatIndex, game]);

  const onRoll = async (pins: number) => {
    const result = await game.submitMove("roll", { pins });
    return { ok: result.ok, reason: result.ok ? undefined : result.reason };
  };

  const turnLabel = state.gameOver
    ? state.winnerSeats.length > 1
      ? "Friendly tie!"
      : `${seatNames[state.winnerSeats[0]] ?? "Winner"} wins!`
    : mySeatIndex === null
      ? `${seatNames[state.currentSeat] ?? "Player"}'s turn`
      : state.currentSeat === mySeatIndex
        ? "Your turn to bowl"
        : `Waiting for ${seatNames[state.currentSeat] ?? "your friend"}…`;

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-honey-500/30 bg-honey-100/65 p-4 shadow-sm sm:p-5 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-honey-700">Party lane</p>
          <h1 className="mt-1 font-display text-3xl text-ink-900 sm:text-4xl">Moonberry Bowling</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Take turns rolling the moonberry ball. Every roll syncs to your friend&apos;s lane and the shared
            scoreboard, with proper strike and spare scoring.
          </p>
          <p className="mt-2 text-xs font-extrabold text-honey-700">{game.status}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
          <Button variant="warm"><Heart /> {turnLabel}</Button>
        </div>
      </section>

      <BowlingScoreboard state={state} seatNames={seatNames} mySeatIndex={mySeatIndex} />

      <BowlingCanvasLoader
        rolls={rolls}
        mySeatIndex={mySeatIndex}
        seatCount={seatCount}
        seatNames={seatNames}
        onRoll={onRoll}
        sessionId={game.sessionId}
      />

      <RewardWalletPanel />

      <div className="rounded-lg border border-blush-300/40 bg-blush-100/60 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-blush-500" />
        {game.sessionId
          ? `Live lane ${game.sessionId.slice(0, 8)}… — you are seat ${mySeatIndex ?? "?"} of ${game.seats.length || 1}.`
          : "Solo practice — invite a friend from the games hub for a two-player match."}
      </div>
    </div>
  );
}

function BowlingScoreboard({
  state,
  seatNames,
  mySeatIndex,
}: {
  state: ReturnType<typeof computeBowlingState>;
  seatNames: string[];
  mySeatIndex: number | null;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-cream-300 bg-white/80 p-3 shadow-sm">
      <table className="w-full min-w-[640px] border-collapse text-center text-xs font-bold text-ink-700">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left">Lane</th>
            {Array.from({ length: 10 }, (_, f) => (
              <th key={f} className="px-1 py-1">{f + 1}</th>
            ))}
            <th className="px-2 py-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {state.players.map((player) => {
            const isMe = mySeatIndex === player.seat;
            const isTurn = state.currentSeat === player.seat && !state.gameOver;
            return (
              <tr
                key={player.seat}
                className={cn(
                  "border-t border-cream-200",
                  isTurn && "bg-honey-100/70",
                )}
              >
                <td className="px-2 py-1 text-left font-extrabold text-ink-900">
                  {seatNames[player.seat] ?? `Player ${player.seat + 1}`}
                  {isMe && <span className="ml-1 text-[10px] text-blush-500">(you)</span>}
                </td>
                {Array.from({ length: 10 }, (_, f) => {
                  const frame = player.frames[f];
                  return (
                    <td key={f} className="px-1 py-1 align-top">
                      <div className="flex justify-center gap-0.5 text-[10px] text-ink-500">
                        {frame
                          ? frame.rolls.map((r, ri) => (
                              <span key={ri}>
                                {frame.isStrike && ri === 0 ? "X" : r === 0 ? "-" : r}
                              </span>
                            ))
                          : <span>&nbsp;</span>}
                      </div>
                      <div className="font-extrabold text-ink-900">
                        {frame?.cumulative ?? ""}
                      </div>
                    </td>
                  );
                })}
                <td className="px-2 py-1 font-display text-base text-ink-900">{player.total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
