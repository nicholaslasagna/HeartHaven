"use client";

import { Lamp, PawPrint, Shovel, Sprout, Wind } from "lucide-react";
import { useAchievements } from "@/lib/game/use-achievements";
import {
  abilityProgress,
  isAbilityUnlocked,
  KEEPER_ABILITIES,
  type KeeperAbility,
  type KeeperAbilityId,
} from "@/lib/game/keeper-abilities";
import { cn } from "@/lib/utils";

function fireAbility(action: KeeperAbilityId) {
  window.dispatchEvent(new CustomEvent("hearthaven:park-action", { detail: { action } }));
}

const ICONS = {
  PawPrint,
  Shovel,
  Wind,
  Sprout,
  // lucide has no "Lantern"; Lamp is the same idea and ships in the bundle.
  Lantern: Lamp,
} as const;

function AbilityButton({
  ability,
  unlocked,
  progress,
}: {
  ability: KeeperAbility;
  unlocked: boolean;
  progress: number;
}) {
  const Icon = ICONS[ability.icon];

  if (!unlocked) {
    /* Locked abilities stay visible with their requirement and a progress
       bar. A greyed button that does not say why is just a dead end. */
    return (
      <div
        className="rounded-2xl border border-ink-300/35 bg-ink-100/45 px-3 py-2 text-left opacity-90"
        title={ability.lockedHint}
      >
        <span className="flex items-center gap-2 text-[13px] font-black text-ink-600">
          <Icon className="size-4 shrink-0" />
          {ability.label}
          <span className="ml-auto rounded-full bg-ink-200/70 px-2 py-0.5 text-[10px] font-black text-ink-600">
            Locked
          </span>
        </span>
        <span className="mt-1 block text-[11px] font-bold leading-snug text-ink-500">
          {ability.lockedHint}
        </span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-ink-200/70">
          <span
            className="block h-full rounded-full bg-honey-400/80"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      </div>
    );
  }

  return (
    <button
      className={cn(
        "hh-btn justify-between",
        ability.id === "dig"
          ? "border border-honey-500/35 bg-honey-100 text-ink-800"
          : "hh-btn-soft",
      )}
      onClick={() => fireAbility(ability.id)}
      title={ability.description}
      type="button"
    >
      <span className="flex items-center gap-2"><Icon className="size-4" /> {ability.label}</span>
      <kbd className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-black">{ability.key}</kbd>
    </button>
  );
}

export function GardenAbilityButtons({ compact = false }: { compact?: boolean }) {
  const { progress } = useAchievements();

  return (
    <div className={compact ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
      {KEEPER_ABILITIES.map((ability) => (
        <AbilityButton
          ability={ability}
          key={ability.id}
          progress={abilityProgress(ability, progress)}
          unlocked={isAbilityUnlocked(ability, progress)}
        />
      ))}
    </div>
  );
}
