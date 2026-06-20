"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleDot, Heart, Sparkles, Trophy } from "lucide-react";
import { GameHubButton } from "@/components/game/game-hub-button";
import { BowlingCanvasLoader } from "@/components/game/bowling-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { computeBowlingState, type BowlingRoll } from "@/lib/game/bowling-scoring";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
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
          aim: Number((move.payload as { aim?: number })?.aim ?? 0),
          power: Number((move.payload as { power?: number })?.power ?? 0),
          rollSeed: Number((move.payload as { rollSeed?: number })?.rollSeed ?? 0),
        })),
    [game.moves],
  );

  // Solo play seats one player; party play seats two. Drive the reducer's
  // turn order off however many are actually seated so solo doesn't wait
  // forever on a phantom seat 1.
  const seatCount = Math.max(1, game.seats.length);
  const state = useMemo(() => computeBowlingState(rolls, seatCount), [rolls, seatCount]);

  const mySeatIndex = game.mySeat?.seat_index ?? null;
  const [submitStatus, setSubmitStatus] = useState("Choose your direction, then power.");
  const [pendingRoll, setPendingRoll] = useState(false);
  const pendingRollCountRef = useRef<number | null>(null);

  useEffect(() => {
    const expectedRollCount = pendingRollCountRef.current;
    if (expectedRollCount === null || rolls.length < expectedRollCount) return;
    pendingRollCountRef.current = null;
    setPendingRoll(false);
    setSubmitStatus("Roll confirmed on the shared lane.");
  }, [rolls.length]);

  const seatNames = useMemo(() => {
    const names = [...DEFAULT_SEAT_NAMES];
    for (const seat of game.seats) {
      if (typeof seat.seat_index === "number" && seat.display_name) {
        names[seat.seat_index] = seat.display_name;
      }
    }
    return names;
  }, [game.seats]);

  // The score is derived only from server-accepted move payloads. Reward
  // claiming remains protected by the once-per-run server claim path.
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

  const onRoll = async (details: { aim: number; power: number }) => {
    if (pendingRoll) return { ok: false, reason: "Waiting for the shared lane to confirm your last roll." };
    if (state.gameOver) return { ok: false, reason: "This match is already over." };
    if (game.sessionId && mySeatIndex === null) {
      return { ok: false, reason: "Waiting for your lane seat to sync." };
    }
    if (mySeatIndex !== null && state.currentSeat !== mySeatIndex) {
      return { ok: false, reason: "Wait for your turn before bowling." };
    }
    setSubmitStatus("Sending aim and power to the shared lane...");
    const expectedRollCount = rolls.length + 1;
    pendingRollCountRef.current = expectedRollCount;
    setPendingRoll(true);
    const payload = {
      aim: Number(details.aim.toFixed(3)),
      power: Number(details.power.toFixed(3)),
      frame: state.currentFrame,
      ball: state.ballInFrame,
    };
    let result: { ok: true } | { ok: false; reason: string };
    if (isSupabaseConfigured() && game.sessionId) {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("submit_bowling_roll", {
        p_session_id: game.sessionId,
        // Compatibility argument retained by the RPC signature. Migration
        // 0067 deliberately ignores this value and computes pins server-side.
        p_pins: 0,
        p_aim: payload.aim,
        p_power: payload.power,
        p_frame: payload.frame,
        p_ball: payload.ball,
      });
      if (error) {
        console.error("[bowling] submit_bowling_roll failed", error);
        result = {
          ok: false,
          reason: /submit_bowling_roll|schema cache/i.test(error.message)
            ? "The shared bowling lane needs its latest server update before play can continue."
            : error.message,
        };
      } else {
        const row = Array.isArray(data) ? data[0] : null;
        result = row?.ok ? { ok: true } : { ok: false, reason: String(row?.error_message ?? "Move rejected.") };
      }
    } else {
      result = { ok: false, reason: "Bowling needs an online game session so every roll stays authoritative." };
    }
    if (!result.ok) {
      setPendingRoll(false);
      pendingRollCountRef.current = null;
      setSubmitStatus(result.reason);
      return { ok: false, reason: result.reason };
    }
    if (game.sessionId) await game.refresh(game.sessionId);
    setSubmitStatus("Roll accepted. Playing the server-confirmed result.");
    return { ok: true };
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
          <GameHubButton returnToLobby={game.returnToLobby} />
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
        rollLocked={pendingRoll}
        sessionId={game.sessionId}
      />

      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/60 p-4 text-sm font-bold text-ink-700">
        <CircleDot className="mr-2 inline size-4 text-lavender-500" />
        {submitStatus}
      </div>

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

function rollSymbols(frame: ReturnType<typeof computeBowlingState>["players"][number]["frames"][number], frameIndex: number) {
  const rolls = frame?.rolls ?? [];
  if (!frame) return ["", "", frameIndex === 9 ? "" : undefined].filter((value): value is string => value !== undefined);
  if (frameIndex < 9) {
    if (frame.isStrike) return ["", "X"];
    const first = rolls[0] ?? 0;
    const second = rolls[1];
    return [
      first === 0 ? "-" : String(first),
      frame.isSpare ? "/" : second === undefined ? "" : second === 0 ? "-" : String(second),
    ];
  }
  return [0, 1, 2].map((index) => {
    const value = rolls[index];
    if (value === undefined) return "";
    if (value === 10) return "X";
    if (index === 1 && (rolls[0] ?? 0) < 10 && (rolls[0] ?? 0) + value === 10) return "/";
    if (index === 2 && (rolls[1] ?? 0) < 10 && (rolls[1] ?? 0) + value === 10) return "/";
    return value === 0 ? "-" : String(value);
  });
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
    <div className="overflow-x-auto rounded-2xl border border-cream-300 bg-white/86 p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-honey-700">
            <Trophy className="size-3.5" /> Official lane scoreboard
          </p>
          <p className="text-xs font-bold text-ink-600">X = strike, / = spare, - = gutter.</p>
        </div>
        {!state.gameOver && (
          <span className="rounded-full border border-honey-500/30 bg-honey-100 px-3 py-1 text-xs font-black text-honey-800">
            Frame {state.currentFrame + 1}, ball {state.ballInFrame + 1}
          </span>
        )}
      </div>
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-center text-xs font-bold text-ink-700">
        <thead>
          <tr>
            <th className="rounded-l-lg border-y border-l border-cream-300 bg-cream-100 px-2 py-2 text-left">Bowler</th>
            {Array.from({ length: 10 }, (_, f) => (
              <th key={f} className="border-y border-cream-300 bg-cream-100 px-1 py-2">{f + 1}</th>
            ))}
            <th className="rounded-r-lg border-y border-r border-cream-300 bg-cream-100 px-2 py-2">Total</th>
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
                <td className="border-b border-cream-200 px-2 py-3 text-left font-extrabold text-ink-900">
                  {seatNames[player.seat] ?? `Player ${player.seat + 1}`}
                  {isMe && <span className="ml-1 text-[10px] text-blush-500">(you)</span>}
                  {isTurn && <span className="ml-2 rounded-full bg-honey-500/15 px-2 py-0.5 text-[10px] text-honey-800">up</span>}
                </td>
                {Array.from({ length: 10 }, (_, f) => {
                  const frame = player.frames[f];
                  const symbols = frame ? rollSymbols(frame, f) : f === 9 ? ["", "", ""] : ["", ""];
                  return (
                    <td key={f} className="border-b border-cream-200 px-1 py-2 align-top">
                      <div className="mx-auto grid max-w-[72px] grid-cols-2 overflow-hidden rounded border border-cream-300 bg-white text-[11px] text-ink-700 shadow-sm">
                        {symbols.map((symbol, index) => (
                          <span
                            className={cn(
                              "grid min-h-6 place-items-center border-cream-200 px-1 font-black",
                              index > 0 && "border-l",
                              f === 9 && "min-h-5",
                            )}
                            key={`${f}-${index}`}
                          >
                            {symbol || "\u00a0"}
                          </span>
                        ))}
                      </div>
                      <div className="mt-1 font-extrabold text-ink-900">
                        {frame?.cumulative ?? ""}
                      </div>
                    </td>
                  );
                })}
                <td className="border-b border-cream-200 px-2 py-2 font-display text-lg text-ink-900">{player.total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
