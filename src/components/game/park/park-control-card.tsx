"use client";

import { ArrowLeftRight, MousePointer2 } from "lucide-react";
import { useEffect, useState } from "react";

export type ParkPlayMode = "keeper" | "companion";

/**
 * The "playing as" status card in the left column of the park layout.
 * Mirrors the play mode the Phaser canvas is in (driven by right-click)
 * and lets the player flip with a click. The canvas listens on the same
 * event channel, so either input source moves the same state.
 */
export function ParkControlCard({ playerName, companionName }: { playerName: string; companionName: string }) {
  const [mode, setMode] = useState<ParkPlayMode>("keeper");

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ParkPlayMode }>).detail;
      if (detail?.mode === "keeper" || detail?.mode === "companion") setMode(detail.mode);
    };
    window.addEventListener("hearthaven:play-mode-changed", sync);
    return () => window.removeEventListener("hearthaven:play-mode-changed", sync);
  }, []);

  function requestSwap() {
    window.dispatchEvent(new CustomEvent("hearthaven:request-play-mode-swap"));
  }

  const isCompanion = mode === "companion";

  return (
    <section
      className={`hh-card relative overflow-hidden p-4 transition-colors ${
        isCompanion ? "border-lavender-300/60" : "border-cream-300"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-0 opacity-50 transition-opacity ${
          isCompanion ? "hh-bg-paper" : "hh-bg-meadow"
        }`}
        aria-hidden
      />
      <div className="relative">
        <p className="hh-eyebrow text-lavender-500">Playing as</p>
        <p className="hh-display mt-1 text-2xl text-ink-900">
          {isCompanion ? `${companionName}` : playerName}
        </p>
        <p className="mt-1 text-xs font-extrabold uppercase tracking-normal text-ink-500">
          {isCompanion ? "Companion · faster · sniffs items" : "Keeper · slower · carries gear"}
        </p>
        <button
          className="hh-btn hh-btn-soft mt-3 w-full justify-center"
          onClick={requestSwap}
          type="button"
        >
          <ArrowLeftRight className="size-4" />
          Swap to {isCompanion ? playerName : companionName}
        </button>
        <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-ink-600">
          <MousePointer2 className="size-3" />
          Right-click anywhere in the world to swap. Hold to recall.
        </p>
      </div>
    </section>
  );
}
