"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trophy, Users } from "lucide-react";
import { MoonberryBowlingLoader } from "@/components/game/moonberry-bowling-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { resolveMatch, type LoggedThrow } from "@/lib/game/moonberry-bowling/match";
import { seatCss } from "@/lib/game/moonberry-bowling/types";

/**
 * Moonberry Bowling — session wiring for 2-8 keepers.
 *
 * The move log is the only source of truth. Each throw stores just what the
 * player did (aim, power, spin); every client replays those through the same
 * deterministic simulation to get identical pinfall and identical scores, so
 * nothing about the deck ever travels over the wire.
 */
export function MoonberryBowlingClient() {
  const game = useMiniGameSession("bowling", { maxPlayers: 8 });
  const { sessionId, seats, mySeat, moves, submitMove, handleReward } = game;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingCountRef = useRef<number | null>(null);

  const throws = useMemo<LoggedThrow[]>(
    () =>
      moves
        .filter((move) => move.move_type === "roll")
        .map((move) => {
          const payload = move.payload as { aim?: number; power?: number; spin?: number };
          return {
            seat: Number(move.seat_index ?? 0),
            aim: Number(payload?.aim ?? 0),
            power: Number(payload?.power ?? 0),
            spin: Number(payload?.spin ?? 0),
          };
        }),
    [moves],
  );

  // Seat the reducer off however many keepers are actually present, so a
  // solo game does not wait forever on a phantom seat.
  const seatCount = Math.max(1, seats.length);
  const mySeatIndex = mySeat?.seat_index ?? null;

  const match = useMemo(
    () => resolveMatch(throws, seatCount, sessionId),
    [throws, seatCount, sessionId],
  );

  const seatNames = useMemo(() => {
    const names = Array.from({ length: Math.max(seatCount, 8) }, (_, i) => `Player ${i + 1}`);
    for (const seat of seats) {
      if (typeof seat.seat_index === "number" && seat.display_name) {
        names[seat.seat_index] = seat.display_name;
      }
    }
    return names;
  }, [seats, seatCount]);

  // Clear the pending flag once our throw comes back through the log.
  useEffect(() => {
    const expected = pendingCountRef.current;
    if (expected === null || throws.length < expected) return;
    pendingCountRef.current = null;
    setSubmitting(false);
  }, [throws.length]);

  const claimedRef = useRef(false);
  useEffect(() => {
    if (!match.state.gameOver || claimedRef.current) return;
    claimedRef.current = true;
    handleReward({
      gameId: "bowling",
      label: "Moonberry Bowling",
      score: match.state.players[mySeatIndex ?? 0]?.total ?? 0,
      coins: 0,
      hearts: 0,
    });
  }, [match.state.gameOver, match.state.players, mySeatIndex, handleReward]);

  const onThrow = useCallback(
    async (details: { aim: number; power: number; spin: number }) => {
      if (submitting) return { ok: false, reason: "Waiting for your last throw to land." };
      if (match.state.gameOver) return { ok: false, reason: "This match is already over." };
      if (sessionId && mySeatIndex === null) return { ok: false, reason: "Waiting for your lane seat to sync." };
      if (mySeatIndex !== null && match.state.currentSeat !== mySeatIndex) {
        return { ok: false, reason: "Wait for your turn to bowl." };
      }

      pendingCountRef.current = throws.length + 1;
      setSubmitting(true);
      const result = await submitMove("roll", {
        aim: Number(details.aim.toFixed(4)),
        power: Number(details.power.toFixed(4)),
        spin: Number(details.spin.toFixed(4)),
        frame: match.state.currentFrame,
        ball: match.state.ballInFrame,
      });
      if (!result.ok) {
        pendingCountRef.current = null;
        setSubmitting(false);
        setError(result.reason ?? "That throw could not be saved.");
        return { ok: false, reason: result.reason ?? "That throw could not be saved." };
      }
      setError(null);
      return { ok: true };
    },
    [submitting, match.state, sessionId, mySeatIndex, throws.length, submitMove],
  );

  const players = match.state.players;

  return (
    <div className="grid gap-4">
      <section className="flex flex-col justify-between gap-3 rounded-lg border border-honey-500/40 bg-honey-100/60 p-4 shadow-sm sm:p-5 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-honey-700">Party lanes</p>
          <h1 className="mt-1 font-display text-3xl text-ink-900 sm:text-4xl">Moonberry Bowling</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Two to eight keepers, ten frames, one lane. Swipe up to roll and curve the flick to hook it into the pocket.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/app/games"><ArrowLeft /> Games hub</Link>
        </Button>
      </section>

      {error && (
        <p className="rounded-lg border border-blush-300/50 bg-blush-100/70 p-3 text-sm font-extrabold text-blush-700">
          {error}
        </p>
      )}

      <MoonberryBowlingLoader
        currentSeat={match.state.currentSeat}
        gameOver={match.state.gameOver}
        mySeatIndex={mySeatIndex}
        onThrow={onThrow}
        seatCount={seatCount}
        seatNames={seatNames}
        sessionId={sessionId}
        submitting={submitting}
        throws={throws}
      />

      <section className="overflow-x-auto rounded-lg border border-lavender-300/45 bg-white/88 p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2 pb-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-normal text-ink-600">
            <Users className="size-3.5" /> {seatCount} bowling
          </p>
          <p className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-normal text-ink-600">
            Frame {Math.min(10, match.state.currentFrame + 1)} of 10
          </p>
        </div>
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <tbody>
            {players.map((player, seat) => (
              <tr key={seat} className={seat === match.state.currentSeat ? "bg-honey-100/60" : undefined}>
                <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-extrabold text-ink-800">
                  <span
                    className="mr-2 inline-block size-2.5 rounded-full align-middle"
                    style={{ backgroundColor: seatCss(seat) }}
                  />
                  {seatNames[seat] ?? `Player ${seat + 1}`}
                  {seat === mySeatIndex && <span className="ml-1 text-xs text-ink-500">(you)</span>}
                </th>
                {player.frames.map((frame, index) => (
                  <td key={index} className="border-l border-cream-200 px-1.5 py-1.5 text-center font-mono text-xs text-ink-700">
                    <span className="block">{frame.rolls.map(scoreMark).join(" ") || "—"}</span>
                    <span className="block font-black text-ink-900">{frame.cumulative ?? ""}</span>
                  </td>
                ))}
                <td className="border-l border-cream-200 px-2 py-1.5 text-center font-black text-ink-900">
                  {player.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {match.state.gameOver && (
        <p className="inline-flex items-center gap-2 rounded-lg border border-honey-500/40 bg-honey-100/70 px-3 py-2 text-sm font-extrabold text-honey-900">
          <Trophy className="size-4" />
          {match.state.winnerSeats.length > 1
            ? "A friendly tie!"
            : `${seatNames[match.state.winnerSeats[0] ?? 0]} wins the lane.`}
        </p>
      )}

      <RewardWalletPanel />
    </div>
  );
}

/** Ten-pin shorthand: X for a strike, / for a spare, - for a miss. */
function scoreMark(pins: number, index: number, rolls: number[]) {
  if (pins === 10 && (index === 0 || rolls[index - 1] === 10)) return "X";
  if (index > 0 && rolls[index - 1] + pins === 10 && rolls[index - 1] !== 10) return "/";
  return pins === 0 ? "-" : String(pins);
}
