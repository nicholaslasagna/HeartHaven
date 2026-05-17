"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Apple, Moon, Sparkles, Wind, type LucideIcon } from "lucide-react";
import { getActiveCompanion } from "@/lib/game/companion-roster";
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

const vitalRows: Array<{ key: keyof Pick<PetVitals, "happiness" | "fullness" | "energy" | "cleanliness">; label: string; color: string }> = [
  { key: "happiness", label: "Joy", color: "bg-blush-400" },
  { key: "fullness", label: "Fed", color: "bg-honey-500" },
  { key: "energy", label: "Rest", color: "bg-garden-600" },
  { key: "cleanliness", label: "Fresh", color: "bg-lavender-400" },
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
    companionName: getActiveCompanion()?.name ?? "Casper",
  };
}

function moodCopy(mood: PetMood) {
  const copy: Record<PetMood, string> = {
    blissful: "glowing",
    happy: "happy",
    content: "content",
    restless: "restless",
    lonely: "needs love",
  };
  return copy[mood];
}

export function CompanionCareDock({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState(readSnapshot);
  const [status, setStatus] = useState("Care right here without leaving the world.");

  const refresh = useCallback(() => {
    setSnapshot(readSnapshot());
  }, []);

  useEffect(() => {
    const onVitals = () => refresh();
    const onRoster = () => refresh();
    window.addEventListener(PET_VITALS_EVENT, onVitals);
    window.addEventListener("hearthaven:companion-roster-changed", onRoster);
    const timer = window.setInterval(refresh, 1000);
    return () => {
      window.removeEventListener(PET_VITALS_EVENT, onVitals);
      window.removeEventListener("hearthaven:companion-roster-changed", onRoster);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const lowestVital = useMemo(
    () => vitalRows.reduce((lowest, row) => (snapshot.vitals[row.key] < snapshot.vitals[lowest.key] ? row : lowest), vitalRows[0]),
    [snapshot.vitals],
  );

  function handleCare(action: PetCareAction) {
    const result = performPetAction(action);
    refresh();
    if (!result.ok) {
      setStatus(`${careActions.find((item) => item.id === action)?.label ?? "Care"} needs ${formatCooldown(result.cooldownRemainingMs)} more.`);
      return;
    }
    const label = careActions.find((item) => item.id === action)?.label ?? "Care";
    setStatus(`${label} helped ${snapshot.companionName}. +${result.heartsEarned} heart.`);
  }

  return (
    <section className={`rounded-lg border border-cream-300 bg-white/82 p-3 shadow-sm ${compact ? "" : "mt-3"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-black uppercase tracking-normal text-blush-500">Companion care</p>
          <p className="text-sm font-black text-ink-900">
            {snapshot.companionName} is {moodCopy(snapshot.mood)}
          </p>
        </div>
        <span className="rounded-full bg-cream-100 px-2.5 py-1 text-[11px] font-black text-ink-700">
          Needs {lowestVital.label.toLowerCase()}
        </span>
      </div>
      <div className="grid gap-1.5">
        {vitalRows.map((row) => (
          <div className="grid grid-cols-[52px_1fr_34px] items-center gap-2 text-[11px] font-black text-ink-700" key={row.key}>
            <span>{row.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-cream-200">
              <span className={`block h-full rounded-full ${row.color}`} style={{ width: `${Math.round(snapshot.vitals[row.key])}%` }} />
            </span>
            <span className="text-right">{Math.round(snapshot.vitals[row.key])}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
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
      <p className="mt-2 text-xs font-bold leading-5 text-ink-600">{status}</p>
    </section>
  );
}
