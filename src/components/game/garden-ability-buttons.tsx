"use client";

import { PawPrint, Shovel } from "lucide-react";

function fireAbility(action: "squeeze" | "dig") {
  window.dispatchEvent(new CustomEvent("hearthaven:park-action", { detail: { action } }));
}

export function GardenAbilityButtons({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
      <button className="hh-btn hh-btn-soft justify-between" onClick={() => fireAbility("squeeze")} type="button">
        <span className="flex items-center gap-2"><PawPrint className="size-4" /> Squeeze gap</span>
        <kbd className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-black">E</kbd>
      </button>
      <button className="hh-btn justify-between border border-honey-500/35 bg-honey-100 text-ink-800" onClick={() => fireAbility("dig")} type="button">
        <span className="flex items-center gap-2"><Shovel className="size-4" /> Dig fresh dirt</span>
        <kbd className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-black">F</kbd>
      </button>
    </div>
  );
}
