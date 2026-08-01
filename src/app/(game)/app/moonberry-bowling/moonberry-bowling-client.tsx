"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Trophy, Users } from "lucide-react";
import { CompanionCameo } from "@/components/game/companion-cameo";
import { MoonberryBowlingLoader } from "@/components/game/moonberry-bowling-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { Button } from "@/components/ui/button";
import { COMPANION_ROSTER_EVENT, getActiveCompanion, type CompanionRecord } from "@/lib/game/companion-roster";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { resolveMatch, type LoggedThrow } from "@/lib/game/moonberry-bowling/match";
import { seatCss } from "@/lib/game/moonberry-bowling/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Moonberry Bowling — session wiring for 2-8 keepers.
 *
 * The move log is the only source of truth. Each throw stores just what the
 * player did (aim, power, spin); every client replays those through the same
 * deterministic simulation for the presentation, then reconciles it to the
 * server-owned pin count. The lane therefore looks physical without allowing
 * clients to invent scores or advance turns.
 */
export function MoonberryBowlingClient() {
  const game = useMiniGameSession("bowling", { maxPlayers: 8 });
  const { sessionId, seats, mySeat, moves, handleReward, refresh, loading } = game;
  const [activeCompanion, setActiveCompanion] = useState<CompanionRecord | null>(() => getActiveCompanion() ?? null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingCountRef = useRef<number | null>(null);

  useEffect(() => {
    const syncCompanion = () => setActiveCompanion(getActiveCompanion() ?? null);
    window.addEventListener(COMPANION_ROSTER_EVENT, syncCompanion);
    return () => window.removeEventListener(COMPANION_ROSTER_EVENT, syncCompanion);
  }, []);

  const throws = useMemo<LoggedThrow[]>(
    () =>
      moves
        .filter((move) => move.move_type === "roll")
        .map((move) => {
          const payload = move.payload as {
            aim?: number;
            power?: number;
            spin?: number;
            pins?: number;
            rollSeed?: number;
            standingBefore?: number;
          };
          return {
            moveIndex: move.move_index,
            seat: Number(move.seat_index ?? 0),
            aim: Number(payload?.aim ?? 0),
            power: Number(payload?.power ?? 0),
            spin: Number(payload?.spin ?? 0),
            pins: Number.isFinite(payload?.pins) ? Number(payload.pins) : undefined,
            rollSeed: Number.isFinite(payload?.rollSeed) ? Number(payload.rollSeed) : undefined,
            standingBefore: Number.isFinite(payload?.standingBefore)
              ? Number(payload.standingBefore)
              : undefined,
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
    claimedRef.current = false;
  }, [sessionId]);

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
      if (!sessionId || !isSupabaseConfigured()) {
        pendingCountRef.current = null;
        setSubmitting(false);
        const reason = "Moonberry Bowling needs an online lane so every player receives the same result.";
        setError(reason);
        return { ok: false, reason };
      }

      const supabase = getSupabaseBrowserClient();
      const aim = Number(details.aim.toFixed(4));
      const power = Number(details.power.toFixed(4));
      const spin = Number(details.spin.toFixed(4));
      let rpc = await supabase.rpc("submit_bowling_roll", {
        p_session_id: sessionId,
        p_pins: 0,
        p_aim: aim,
        p_power: power,
        p_frame: match.state.currentFrame,
        p_ball: match.state.ballInFrame,
        p_spin: spin,
      });

      // Migration 0079 adds p_spin. Until a deployment has applied it, use
      // the established six-argument RPC and fold hook into the accepted
      // line instead of silently falling back to generic, unguarded moves.
      if (rpc.error && /p_spin|function.*submit_bowling_roll|schema cache|could not find/i.test(rpc.error.message)) {
        rpc = await supabase.rpc("submit_bowling_roll", {
          p_session_id: sessionId,
          p_pins: 0,
          p_aim: Math.max(-1, Math.min(1, aim + spin * 0.16)),
          p_power: power,
          p_frame: match.state.currentFrame,
          p_ball: match.state.ballInFrame,
        });
      }

      const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as {
        ok?: boolean;
        error_message?: string | null;
      } | null;
      if (rpc.error || !row?.ok) {
        const reason = rpc.error?.message || String(row?.error_message ?? "That throw could not be saved.");
        pendingCountRef.current = null;
        setSubmitting(false);
        setError(reason === "not your turn" ? "The lane already advanced to the next bowler." : reason);
        return { ok: false, reason };
      }

      await refresh(sessionId);
      setError(null);
      return { ok: true };
    },
    [submitting, match.state, sessionId, mySeatIndex, throws.length, refresh],
  );

  const players = match.state.players;

  return (
    <div className="grid gap-4">
      <section className="flex flex-col justify-between gap-3 rounded-lg border border-honey-500/40 bg-honey-100/60 p-4 shadow-sm sm:p-5 md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-honey-700">Party lanes</p>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Two to eight keepers, ten frames, one lane. Swipe up to roll and curve the flick to hook it into the pocket.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CompanionCameo />
          <Button asChild variant="secondary">
            <Link href="/app/games"><ArrowLeft /> Games hub</Link>
          </Button>
        </div>
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
        companionSpeciesId={activeCompanion?.speciesId ?? "kitten"}
        sessionId={sessionId}
        submitting={submitting}
        initialSyncComplete={!loading}
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
