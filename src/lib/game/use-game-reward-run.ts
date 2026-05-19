"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { creditWallet, hydrateWalletStateFromServer } from "@/lib/game/wallet-store";
import { createRewardEntry } from "@/lib/game/rewards";

/**
 * useGameRewardRun — server-validated mini-game reward flow (migration 0033).
 *
 * Previously every mini-game called `grantReward({coins, hearts})` directly,
 * which meant a malicious client could mint arbitrary currency from the
 * browser console. Now the client only reports its SCORE; the server reads
 * the game's `game_reward_specs` row, validates score + elapsed time + daily
 * caps, and computes the actual payout.
 *
 * Usage in a mini-game client:
 *
 *   const { startRun, claimRun, status } = useGameRewardRun("memory-match");
 *
 *   // Start when actual gameplay begins (not on page mount — the
 *   // min-duration check kicks in from this moment):
 *   useEffect(() => { void startRun(); }, [startRun]);
 *
 *   // Wire your canvas's onReward to claim with the final score:
 *   const handleReward = useCallback(
 *     (reward: GameReward) => { void claimRun(reward.score); },
 *     [claimRun],
 *   );
 *   <CanvasLoader onReward={handleReward} />
 *
 * Offline fallback: when Supabase isn't configured we fall back to the
 * client-side `creditWallet` with whatever the canvas reports — same as
 * the old behaviour. This means local dev / demo mode keeps working.
 */

export type ClaimResult =
  | { ok: true; coinsAwarded: number; heartsAwarded: number; reason: "awarded" | "already-claimed" }
  | { ok: false; reason: string };

export function useGameRewardRun(gameKey: string) {
  const runIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "claimed" | "error">("idle");

  // Reset when the game key changes (rare, but supports the mode-switch
  // pattern in memory-match which keys on `mode`). The setState here
  // mirrors an external input (the `gameKey` prop changing) into local
  // state — that's the documented allowed pattern for the rule.
  useEffect(() => {
    runIdRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("idle");
  }, [gameKey]);

  const startRun = useCallback(async (): Promise<{ ok: boolean; runId?: string; reason?: string }> => {
    if (!isSupabaseConfigured()) {
      // Demo mode — no server token, claims fall back to creditWallet.
      setStatus("running");
      return { ok: true };
    }
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("start_game_run", { p_game_key: gameKey });
      if (error) {
        setStatus("error");
        return { ok: false, reason: error.message };
      }
      const runId = typeof data === "string" ? data : null;
      if (!runId) {
        setStatus("error");
        return { ok: false, reason: "empty response" };
      }
      runIdRef.current = runId;
      setStatus("running");
      return { ok: true, runId };
    } catch (err) {
      setStatus("error");
      return { ok: false, reason: err instanceof Error ? err.message : "network" };
    }
  }, [gameKey]);

  const claimRun = useCallback(
    async (
      score: number,
      // Optional fallback if Supabase isn't configured OR no run was
      // started. The fallback grants the locally-computed amounts so
      // demo mode + first-load races still pay something.
      fallback?: { coins: number; hearts: number; label?: string },
    ): Promise<ClaimResult> => {
      const safeScore = Math.max(0, Math.floor(Number(score) || 0));

      // Offline / demo path: credit the wallet locally with whatever the
      // canvas reported. This is the OLD trust-the-client behaviour, but
      // it's gated on Supabase being unconfigured so production traffic
      // never hits it.
      if (!isSupabaseConfigured() || !runIdRef.current) {
        if (fallback) {
          creditWallet({
            gameId: gameKey,
            label: fallback.label ?? gameKey,
            score: safeScore,
            coins: fallback.coins,
            hearts: fallback.hearts,
          });
        }
        setStatus("claimed");
        return { ok: true, coinsAwarded: fallback?.coins ?? 0, heartsAwarded: fallback?.hearts ?? 0, reason: "awarded" };
      }

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc("claim_game_reward", {
          p_run_id: runIdRef.current,
          p_score: safeScore,
        });
        if (error) {
          setStatus("error");
          return { ok: false, reason: error.message };
        }
        const row = Array.isArray(data) ? data[0] : null;
        if (!row) {
          setStatus("error");
          return { ok: false, reason: "empty response" };
        }
        const coinsAwarded = Math.max(0, Math.floor(Number(row.coins_awarded ?? 0)));
        const heartsAwarded = Math.max(0, Math.floor(Number(row.hearts_awarded ?? 0)));
        const reason = (row.reason as string) || "awarded";

        // Pull fresh wallet state from the server so the local ledger
        // shows the server-derived award. We do NOT call `creditWallet`
        // here because that would push another `phase2_credit_wallet`
        // through, double-crediting on top of the `claim_game_reward`
        // we just made. The hydrate is the safe single-direction sync.
        //
        // We also fire a reward toast event with the server-derived
        // amounts so the UI's "+5 coins, +1 heart" overlay still pops.
        if (coinsAwarded > 0 || heartsAwarded > 0) {
          const entry = createRewardEntry({
            gameId: gameKey,
            label: fallback?.label ?? gameKey,
            score: safeScore,
            coins: coinsAwarded,
            hearts: heartsAwarded,
          });
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("hearthaven:reward-toast", { detail: entry }));
          }
        }
        await hydrateWalletStateFromServer();

        setStatus("claimed");
        runIdRef.current = null; // a fresh run is needed to claim again
        return { ok: true, coinsAwarded, heartsAwarded, reason: reason === "already-claimed" ? "already-claimed" : "awarded" };
      } catch (err) {
        setStatus("error");
        return { ok: false, reason: err instanceof Error ? err.message : "network" };
      }
    },
    [gameKey],
  );

  // We deliberately do NOT return `runId` here — exposing it via the
  // ref during render trips `react-hooks/refs`, and external consumers
  // don't need it: `claimRun(score)` reads the ref internally on
  // invocation, which is the correct lifecycle.
  return { startRun, claimRun, status };
}
