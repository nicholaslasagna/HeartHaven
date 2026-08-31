"use client";

import { Lamp, PawPrint, Shovel, Sprout, Wind } from "lucide-react";
import { useAchievements } from "@/lib/game/use-achievements";
import { TOUCH_BUTTON_BASE } from "@/lib/game/touch-controls";
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

/**
 * Compact icon-only abilities, overlaid on the world itself.
 *
 * On a phone the panel version sits below the canvas, so using an ability
 * meant scrolling away from the companion standing on the spot — by the time
 * the button was on screen the thing you wanted to dig was not. Only unlocked
 * abilities appear here; the panel is where progress toward the rest is
 * shown, and screen space over the garden is worth more than a locked button.
 */
export function GardenAbilityOverlay() {
  const { progress } = useAchievements();
  const unlocked = KEEPER_ABILITIES.filter((ability) => isAbilityUnlocked(ability, progress));
  if (unlocked.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-2">
      {unlocked.map((ability) => {
        const Icon = ICONS[ability.icon];
        return (
          <button
            aria-label={ability.label}
            className={cn(
              TOUCH_BUTTON_BASE,
              "border border-garden-700/35 bg-white/85 px-0 text-ink-800 shadow-sm backdrop-blur active:bg-garden-100",
            )}
            key={ability.id}
            onClick={() => fireAbility(ability.id)}
            title={ability.description}
            type="button"
          >
            <Icon className="size-5" />
          </button>
        );
      })}
    </div>
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
