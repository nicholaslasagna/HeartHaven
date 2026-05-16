"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Cookie,
  Footprints,
  Hand,
  PawPrint,
  PenTool,
  Search,
  Send,
  Shovel,
  Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ParkPlayMode } from "@/components/game/park/park-control-card";

type ActionDef = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hotkey: string;
  /** Color tint used for the chip-style action button. */
  tint: { bg: string; ring: string; text: string };
  /** What to do when the user clicks the button. */
  fire: () => void;
};

function tint(bg: string, ring: string, text: string) {
  return { bg, ring, text };
}

const CONFIRM = (action: string, detail?: Record<string, unknown>) =>
  window.dispatchEvent(new CustomEvent("hearthaven:park-action", { detail: { action, ...detail } }));

/**
 * Floating heads-up display layered over the park canvas. Two action bars
 * (keeper vs companion) plus the live "you are here" cards. The Phaser
 * scene listens to `hearthaven:park-action` so a button click triggers the
 * same handler a hotkey press would.
 */
export function ParkHud({ playerName, companionName }: { playerName: string; companionName: string }) {
  const [mode, setMode] = useState<ParkPlayMode>("keeper");
  const [keeperHint, setKeeperHint] = useState("Plot 4 · fountain");
  const [companionHint, setCompanionHint] = useState("Plot 9 · brook edge");
  const [upNext, setUpNext] = useState("Walk over to the lantern arch — your companion can squeeze through it.");

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ParkPlayMode }>).detail;
      if (detail?.mode === "keeper" || detail?.mode === "companion") setMode(detail.mode);
    };
    const onPos = (event: Event) => {
      const detail = (event as CustomEvent<{ keeperHint?: string; companionHint?: string }>).detail;
      if (detail?.keeperHint) setKeeperHint(detail.keeperHint);
      if (detail?.companionHint) setCompanionHint(detail.companionHint);
    };
    const onDiscovery = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (detail?.name) setUpNext(`Found ${detail.name}! Look around — there's more to sniff out.`);
    };
    window.addEventListener("hearthaven:play-mode-changed", sync);
    window.addEventListener("hearthaven:park-position", onPos);
    window.addEventListener("hearthaven:discovery-revealed", onDiscovery);
    return () => {
      window.removeEventListener("hearthaven:play-mode-changed", sync);
      window.removeEventListener("hearthaven:park-position", onPos);
      window.removeEventListener("hearthaven:discovery-revealed", onDiscovery);
    };
  }, []);

  const companionActions: ActionDef[] = [
    {
      id: "sniff",
      label: "Sniff",
      hotkey: "Q",
      icon: Search,
      tint: tint("bg-lavender-100", "border-lavender-300/70", "text-lavender-500"),
      fire: () => CONFIRM("sniff"),
    },
    {
      id: "squeeze",
      label: "Squeeze",
      hotkey: "E",
      icon: PawPrint,
      tint: tint("bg-lavender-100", "border-lavender-300/70", "text-lavender-500"),
      fire: () => CONFIRM("squeeze"),
    },
    {
      id: "dig",
      label: "Dig",
      hotkey: "F",
      icon: Shovel,
      tint: tint("bg-honey-100", "border-honey-500/40", "text-honey-700"),
      fire: () => CONFIRM("dig"),
    },
    {
      id: "fetch",
      label: "Fetch",
      hotkey: "G",
      icon: Footprints,
      tint: tint("bg-sky-100", "border-sky-300/70", "text-sky-500"),
      fire: () => CONFIRM("fetch"),
    },
    {
      id: "swap-back",
      label: `To ${playerName}`,
      hotkey: "R-click",
      icon: ArrowLeftRight,
      tint: tint("bg-blush-100", "border-blush-300/60", "text-blush-500"),
      fire: () => window.dispatchEvent(new CustomEvent("hearthaven:request-play-mode-swap")),
    },
  ];

  const keeperActions: ActionDef[] = [
    {
      id: "wave",
      label: "Wave",
      hotkey: "Q",
      icon: Hand,
      tint: tint("bg-blush-100", "border-blush-300/60", "text-blush-500"),
      fire: () => CONFIRM("wave"),
    },
    {
      id: "note",
      label: "Note",
      hotkey: "E",
      icon: PenTool,
      tint: tint("bg-blush-100", "border-blush-300/60", "text-blush-500"),
      fire: () => CONFIRM("note"),
    },
    {
      id: "treat",
      label: "Treat",
      hotkey: "F",
      icon: Cookie,
      tint: tint("bg-honey-100", "border-honey-500/40", "text-honey-700"),
      fire: () => CONFIRM("treat"),
    },
    {
      id: "whistle",
      label: "Whistle",
      hotkey: "G",
      icon: Send,
      tint: tint("bg-garden-100", "border-garden-300/60", "text-garden-700"),
      fire: () => CONFIRM("whistle"),
    },
    {
      id: "swap-to-companion",
      label: `To ${companionName}`,
      hotkey: "R-click",
      icon: ArrowLeftRight,
      tint: tint("bg-lavender-100", "border-lavender-300/70", "text-lavender-500"),
      fire: () => window.dispatchEvent(new CustomEvent("hearthaven:request-play-mode-swap")),
    },
  ];

  const actions = mode === "companion" ? companionActions : keeperActions;

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Up-next nudge in the top-right of the canvas */}
      <div className="absolute right-4 top-4 max-w-[240px] rounded-lg bg-white/92 px-3 py-2 text-xs font-bold text-ink-700 shadow-sm">
        <p className="hh-eyebrow text-garden-700 flex items-center gap-1">
          <Sparkles className="size-3" /> Up next
        </p>
        <p className="mt-0.5 leading-snug">{upNext}</p>
      </div>

      {/* Live cards in the bottom-left */}
      <div className="absolute bottom-4 left-4 grid gap-1.5">
        <LiveCard active={mode === "keeper"} who="keeper" hint={keeperHint} name={playerName} />
        <LiveCard active={mode === "companion"} who="companion" hint={companionHint} name={companionName} />
      </div>

      {/* Action bar centered along the bottom */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2">
        <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-cream-300/80 bg-white/95 px-2 py-1.5 shadow-md">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                aria-label={`${action.label} (${action.hotkey})`}
                className={`flex items-center gap-1.5 rounded-full border ${action.tint.ring} ${action.tint.bg} px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-normal ${action.tint.text} shadow-sm transition hover:-translate-y-0.5`}
                key={action.id}
                onClick={action.fire}
                type="button"
              >
                <Icon className="size-3.5" />
                <span>{action.label}</span>
                <span className="hidden rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-black tracking-normal text-ink-700 sm:inline">
                  {action.hotkey}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LiveCard({
  active,
  who,
  hint,
  name,
}: {
  active: boolean;
  who: ParkPlayMode;
  hint: string;
  name: string;
}) {
  const tone =
    who === "keeper"
      ? { dot: "bg-sky-500", text: active ? "text-sky-500" : "text-ink-600" }
      : { dot: "bg-lavender-500", text: active ? "text-lavender-500" : "text-ink-600" };
  return (
    <div
      className={`flex items-center gap-2 rounded-full bg-white/92 px-3 py-1.5 text-[11px] font-extrabold shadow-sm ${
        active ? "ring-2 ring-cream-300" : ""
      }`}
    >
      <span className={`size-2 rounded-full ${tone.dot}`} />
      <span className={tone.text}>
        {active ? "● " : ""}
        {name}
      </span>
      <span className="text-ink-500">· {hint}</span>
    </div>
  );
}
