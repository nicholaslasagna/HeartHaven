"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, Sparkles, Trophy, UsersRound } from "lucide-react";
import { GameHubButton } from "@/components/game/game-hub-button";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import { StrikeNight3DCanvas } from "@/components/game/strike-night-3d-canvas";
import { Button } from "@/components/ui/button";
import { BowlingScoreboard } from "@/app/(game)/app/bowling/bowling-client";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { computeBowlingState, type BowlingRoll } from "@/lib/game/bowling-scoring";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const DEFAULT_SEAT_NAMES = [
  "Rose Lane", "Moon Lane", "Honey Lane", "Clover Lane",
  "Sakura Lane", "Lavender Lane", "Star Lane", "Sunbeam Lane",
];

export function StrikeNight3DClient() {
  const game = useMiniGameSession("bowling", { maxPlayers: 8 });
  const rolls = useMemo<BowlingRoll[]>(
    () => game.moves
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
  const seatCount = Math.max(1, game.seats.length);
  const state = useMemo(() => computeBowlingState(rolls, seatCount), [rolls, seatCount]);
  const mySeatIndex = game.mySeat?.seat_index ?? null;
  const [submitStatus, setSubmitStatus] = useState("Choose your lane, aim, and hold to charge.");
  const [pendingRoll, setPendingRoll] = useState(false);
  const pendingRollCountRef = useRef<number | null>(null);
  const claimedRef = useRef(false);

  useEffect(() => {
    const expected = pendingRollCountRef.current;
    if (expected === null || rolls.length < expected) return;
    pendingRollCountRef.current = null;
    setPendingRoll(false);
    setSubmitStatus("Official roll received. The scorecard is updated for everyone.");
  }, [rolls.length]);

  const seatNames = useMemo(() => {
    const names = [...DEFAULT_SEAT_NAMES];
    game.seats.forEach((seat) => {
      if (seat.seat_index >= 0 && seat.display_name) names[seat.seat_index] = seat.display_name;
    });
    return names;
  }, [game.seats]);

  useEffect(() => {
    if (!state.gameOver || claimedRef.current) return;
    claimedRef.current = true;
    const score = state.players[mySeatIndex ?? 0]?.total ?? 0;
    game.handleReward({ gameId: "bowling", label: "Strike Night 3D", score, coins: 0, hearts: 0 });
  }, [game, mySeatIndex, state.gameOver, state.players]);

  async function onRoll(details: { aim: number; power: number }) {
    if (pendingRoll) return { ok: false, reason: "Your last throw is still settling." };
    if (state.gameOver) return { ok: false, reason: "This match is complete." };
    if (game.sessionId && mySeatIndex === null) return { ok: false, reason: "Waiting for your lane seat to sync." };
    if (mySeatIndex !== null && state.currentSeat !== mySeatIndex) return { ok: false, reason: "Wait for your turn." };

    setPendingRoll(true);
    pendingRollCountRef.current = rolls.length + 1;
    setSubmitStatus("Sending the official throw to every lane...");

    if (!isSupabaseConfigured() || !game.sessionId) {
      pendingRollCountRef.current = null;
      setPendingRoll(false);
      const reason = "Strike Night needs an online session so every player sees the same pins and score.";
      setSubmitStatus(reason);
      return { ok: false, reason };
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc("submit_bowling_roll", {
      p_session_id: game.sessionId,
      p_pins: 0,
      p_aim: Number(details.aim.toFixed(3)),
      p_power: Number(details.power.toFixed(3)),
      p_frame: state.currentFrame,
      p_ball: state.ballInFrame,
    });
    if (error) {
      console.error("[strike-night-3d] submit_bowling_roll failed", error);
      pendingRollCountRef.current = null;
      setPendingRoll(false);
      const reason = /duplicate|move_index_conflict/i.test(error.message)
        ? "That throw arrived twice. The lane is refreshing its shared scorecard."
        : error.message || "The official lane could not accept that throw.";
      setSubmitStatus(reason);
      return { ok: false, reason };
    }
    const row = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; error_message?: string | null } | null;
    if (!row?.ok) {
      pendingRollCountRef.current = null;
      setPendingRoll(false);
      const reason = String(row?.error_message ?? "The official lane rejected that throw.");
      setSubmitStatus(reason);
      return { ok: false, reason };
    }
    await game.refresh(game.sessionId);
    return { ok: true };
  }

  const currentName = seatNames[state.currentSeat] ?? "the next bowler";
  const turnLabel = state.gameOver
    ? state.winnerSeats.length > 1 ? "Friendly tie" : `${seatNames[state.winnerSeats[0]] ?? "Winner"} wins`
    : mySeatIndex === state.currentSeat ? "Your turn to bowl" : `${currentName}'s turn`;

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-blush-300/55 bg-gradient-to-br from-blush-100 via-honey-100/70 to-lavender-100/70 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-blush-700"><Sparkles className="size-4" /> HeartHaven arcade</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900 sm:text-5xl">Strike Night 3D</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-ink-700">
            A bright, social bowling night with eight lanes, official ten-pin scoring, and server-confirmed throws.
            Choose your line, build your power, and let the pins tell the story.
          </p>
          <p className="mt-2 text-xs font-black text-blush-700">{game.loading ? "Connecting the bowling venue..." : game.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <GameHubButton returnToLobby={game.returnToLobby} />
          <Button variant="warm"><Heart /> {turnLabel}</Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-5">
          <StrikeNight3DCanvas
            mySeatIndex={mySeatIndex}
            onRoll={onRoll}
            rollLocked={pendingRoll}
            rolls={rolls}
            seatCount={seatCount}
            seatNames={seatNames}
          />
          <div className="rounded-2xl border border-lavender-300/45 bg-lavender-100/60 p-4 text-sm font-bold leading-6 text-ink-700">
            <UsersRound className="mr-2 inline size-4 text-lavender-600" />
            {submitStatus} {game.sessionId ? `Shared session ${game.sessionId.slice(0, 8)}…` : "Solo lane session"}
          </div>
          <RewardWalletPanel />
        </div>
        <aside className="grid content-start gap-5">
          <BowlingScoreboard mySeatIndex={mySeatIndex} seatNames={seatNames} state={state} />
          <section className="rounded-2xl border border-honey-500/35 bg-honey-100/70 p-4 shadow-sm">
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-honey-800"><Trophy className="size-4" /> Night rules</p>
            <ul className="mt-3 grid gap-2 text-sm font-bold leading-5 text-ink-700">
              <li>10 frames, with correct strike and spare bonuses.</li>
              <li>Every accepted throw is shared with the room.</li>
              <li>Inactive turns are protected by the server session.</li>
              <li>Up to 8 named lanes can spectate the same match.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
