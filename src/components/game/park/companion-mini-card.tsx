"use client";

import { Apple, Heart, Moon, PawPrint, Sparkles, Wind, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getActiveCompanion, COMPANION_ROSTER_EVENT } from "@/lib/game/companion-roster";
import {
  getCooldownRemaining,
  getPetMood,
  getPetVitals,
  performPetAction,
  PET_VITALS_EVENT,
  type PetCareAction,
  type PetMood,
  type PetVitals,
} from "@/lib/game/pet-state";

/**
 * The single companion surface for in-world pages — shows the active
 * companion's identity + mood + vitals, AND the four care actions
 * (Feed / Play / Pamper / Rest) so the keeper never has to leave the
 * scene to top up vitals. Previously this UI was split across a
 * left-sidebar mini card and a separate "Companion Care" dock below the
 * canvas; both surfaces showed the same numbers, which read as
 * duplicated noise. Merged here so the sidebar tells the whole story.
 */

const moodCopy: Record<PetMood, { label: string; tone: string; phrase: string }> = {
  blissful: { label: "Blissful", tone: "text-blush-500", phrase: "glowing" },
  happy: { label: "Happy", tone: "text-garden-700", phrase: "happy" },
  content: { label: "Content", tone: "text-ink-700", phrase: "content" },
  restless: { label: "Restless", tone: "text-honey-700", phrase: "restless" },
  lonely: { label: "Lonely", tone: "text-lavender-500", phrase: "needs love" },
};

const careActions: Array<{
  id: PetCareAction;
  label: string;
  hint: string;
  className: string;
  Icon: LucideIcon;
}> = [
  { id: "feed", label: "Feed", hint: "Adds fullness and a little joy.", className: "bg-honey-100 text-honey-800 border-honey-300", Icon: Apple },
  { id: "play", label: "Play", hint: "Boosts happiness, but uses energy.", className: "bg-blush-100 text-blush-700 border-blush-300", Icon: Sparkles },
  { id: "pamper", label: "Pamper", hint: "Restores freshness and comfort.", className: "bg-garden-100 text-garden-800 border-garden-300", Icon: Wind },
  { id: "rest", label: "Rest", hint: "Restores energy and settles your companion.", className: "bg-lavender-100 text-lavender-700 border-lavender-300", Icon: Moon },
];

const statsRows: Array<{
  key: keyof Pick<PetVitals, "happiness" | "fullness" | "energy" | "cleanliness">;
  label: string;
  tint: string;
}> = [
  { key: "fullness", label: "Fed", tint: "bg-honey-500" },
  { key: "energy", label: "Rest", tint: "bg-sky-500" },
  { key: "happiness", label: "Joy", tint: "bg-blush-500" },
  { key: "cleanliness", label: "Fresh", tint: "bg-garden-500" },
];

function formatCooldown(ms: number) {
  if (ms <= 0) return "Ready";
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.ceil((ms % 60_000) / 1000);
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function readSnapshot() {
  const vitals = getPetVitals();
  return {
    vitals,
    mood: getPetMood(vitals),
    cooldowns: Object.fromEntries(careActions.map((action) => [action.id, getCooldownRemaining(action.id)])) as Record<PetCareAction, number>,
    companion: getActiveCompanion(),
  };
}

type CompanionSnapshot = ReturnType<typeof readSnapshot>;

const INITIAL_VITALS: PetVitals = {
  happiness: 86,
  fullness: 74,
  energy: 80,
  cleanliness: 78,
  updatedAt: 0,
  lastActionAt: {
    feed: 0,
    play: 0,
    pamper: 0,
    rest: 0,
  },
};

const INITIAL_SNAPSHOT: CompanionSnapshot = {
  vitals: INITIAL_VITALS,
  mood: getPetMood(INITIAL_VITALS),
  cooldowns: {
    feed: 0,
    play: 0,
    pamper: 0,
    rest: 0,
  },
  companion: {
    id: "companion-casper",
    name: "Casper",
    speciesId: "kitten",
    toneId: "cream",
    accessory: "moonberry-bow",
    adoptedAt: "2026-01-01T00:00:00.000Z",
    active: true,
  },
};

export function CompanionMiniCard() {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>(INITIAL_SNAPSHOT);
  const [status, setStatus] = useState("Care right here without leaving the world.");

  const refresh = useCallback(() => {
    setSnapshot(readSnapshot());
  }, []);

  useEffect(() => {
    const onVitals = () => refresh();
    const onRoster = () => refresh();
    window.addEventListener(PET_VITALS_EVENT, onVitals);
    window.addEventListener(COMPANION_ROSTER_EVENT, onRoster);
    // 1s tick keeps cooldown labels counting down without us wiring up a
    // per-button timer per render.
    const timer = window.setInterval(refresh, 1000);
    return () => {
      window.removeEventListener(PET_VITALS_EVENT, onVitals);
      window.removeEventListener(COMPANION_ROSTER_EVENT, onRoster);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const lowestStat = useMemo(
    () =>
      statsRows.reduce(
        (lowest, row) => (snapshot.vitals[row.key] < snapshot.vitals[lowest.key] ? row : lowest),
        statsRows[0],
      ),
    [snapshot.vitals],
  );

  function handleCare(action: PetCareAction) {
    const result = performPetAction(action);
    refresh();
    const label = careActions.find((entry) => entry.id === action)?.label ?? "Care";
    if (!result.ok) {
      setStatus(`${label} needs ${formatCooldown(result.cooldownRemainingMs)} more.`);
      return;
    }
    const name = snapshot.companion?.name ?? "Casper";
    setStatus(`${label} helped ${name}. +${result.heartsEarned} heart.`);
  }

  const moodInfo = moodCopy[snapshot.mood];
  const speciesLabel = snapshot.companion?.speciesId
    ? snapshot.companion.speciesId.replace(/-/g, " ")
    : "Casper cat";

  return (
    <section className="hh-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="hh-eyebrow text-blush-500">Your companion</p>
        <span className={`text-xs font-extrabold uppercase tracking-normal ${moodInfo.tone}`}>
          {moodInfo.label}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <PawPrint className="size-5 text-lavender-500" />
        <h3 className="hh-display text-2xl text-ink-900">{snapshot.companion?.name ?? "Casper"}</h3>
      </div>
      <p className="text-xs font-bold text-ink-500">{speciesLabel}</p>

      <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-cream-100 px-2.5 py-0.5 text-[11px] font-black text-ink-700">
        Needs {lowestStat.label.toLowerCase()}
      </p>

      <div className="mt-3 grid gap-2">
        {statsRows.map((stat) => (
          <div key={stat.key}>
            <div className="flex items-center justify-between text-xs font-extrabold text-ink-700">
              <span className="uppercase tracking-normal">{stat.label}</span>
              <span>{Math.round(snapshot.vitals[stat.key])}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-200">
              <div
                className={`h-full rounded-full ${stat.tint}`}
                style={{ width: `${Math.max(0, Math.min(100, snapshot.vitals[stat.key]))}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {careActions.map(({ id, label, hint, className, Icon }) => {
          const cooldown = snapshot.cooldowns[id];
          const disabled = cooldown > 0;
          return (
            <button
              className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-2 text-xs font-black shadow-sm transition disabled:cursor-not-allowed disabled:border-cream-300 disabled:bg-cream-100 disabled:text-ink-400 ${className}`}
              disabled={disabled}
              key={id}
              onClick={() => handleCare(id)}
              title={disabled ? `${label} ready in ${formatCooldown(cooldown)}` : hint}
              type="button"
            >
              <Icon className="size-3.5" />
              {disabled ? formatCooldown(cooldown) : label}
            </button>
          );
        })}
      </div>

      <p className="mt-3 flex items-center gap-1 text-[11px] font-bold leading-5 text-ink-600">
        <Heart className="size-3 text-blush-500" />
        {status}
      </p>
    </section>
  );
}
