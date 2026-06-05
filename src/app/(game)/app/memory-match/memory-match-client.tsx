"use client";

import { UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { GameHubButton } from "@/components/game/game-hub-button";
import { MemoryMatchCanvasLoader } from "@/components/game/memory-match-canvas-loader";
import { RewardWalletPanel } from "@/components/game/reward-wallet-panel";
import type { MemoryMatchMode } from "@/lib/game/memory-match-state";
import { Button } from "@/components/ui/button";
import { useMiniGameSession } from "@/lib/game/use-mini-game-session";
import { cn } from "@/lib/utils";

const modeCopy: Record<MemoryMatchMode, { title: string; description: string }> = {
  couples: {
    title: "Couple-vs-couple",
    description: "Two teams take turns on a server-shuffled board. Flips sync live for everyone in the session.",
  },
  party: {
    title: "Party table",
    description: "Up to six seats rotate turns with the same authoritative board and move log.",
  },
};

export function MemoryMatchClient() {
  const [mode, setMode] = useState<MemoryMatchMode>("couples");
  const game = useMiniGameSession("memory-match", {
    maxPlayers: mode === "party" ? 6 : 2,
    init: { mode },
    requireSessionComplete: true,
  });

  useEffect(() => {
    if (!game.sessionId || game.loading) return;
    void game.submitMove("init", { mode });
  }, [game.loading, game.sessionId, game.submitMove, mode]);

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-lavender-300/50 bg-lavender-100/60 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-500">Multiplayer mini-game</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Memory Match</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Server-authoritative pairs: the board, turns, and rewards are validated on Supabase. Friends join via the
            games hub party link with <code className="rounded bg-white/80 px-1">?session=</code>.
          </p>
        </div>
        <GameHubButton returnToLobby={game.returnToLobby} />
      </section>

      <section className="grid gap-3 rounded-lg border border-cream-300 bg-white/72 p-4 shadow-sm md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <UsersRound className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">{modeCopy[mode].title}</h2>
          </div>
          <p className="mt-1 text-sm font-bold text-ink-700">{modeCopy[mode].description}</p>
        </div>
        <div className="flex rounded-full border border-cream-300 bg-cream-50 p-1">
          {(["couples", "party"] as const).map((option) => (
            <button
              className={cn(
                "rounded-full px-4 py-2 text-sm font-extrabold transition-colors",
                mode === option ? "bg-blush-500 text-white shadow-sm" : "text-ink-700 hover:bg-blush-100",
              )}
              key={option}
              onClick={() => setMode(option)}
              type="button"
            >
              {option === "couples" ? "Couples" : "Party"}
            </button>
          ))}
        </div>
      </section>

      <RewardWalletPanel />
      <p className="text-xs font-extrabold text-lavender-600">{game.status}</p>
      <MemoryMatchCanvasLoader
        metadata={game.metadata}
        mode={mode}
        mySeatIndex={game.mySeat?.seat_index ?? null}
        onReward={game.handleReward}
        seats={game.seats}
        sessionId={game.sessionId}
        submitFlip={async (cardIndex) => {
          const result = await game.submitMove("flip", { cardIndex });
          return { ok: result.ok, reason: result.ok ? undefined : result.reason };
        }}
      />
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        {game.sessionId
          ? `Live session ${game.sessionId.slice(0, 8)}… — seat ${game.mySeat?.seat_index ?? "?"} of ${game.seats.length}. Moves sync through game_moves.`
          : "Connecting online session…"}
      </div>
    </div>
  );
}
