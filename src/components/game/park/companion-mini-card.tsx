"use client";

import { Heart, PawPrint } from "lucide-react";
import { useEffect, useState } from "react";
import { getActiveCompanion, COMPANION_ROSTER_EVENT } from "@/lib/game/companion-roster";
import { getPetMood, getPetVitals, PET_VITALS_EVENT } from "@/lib/game/pet-state";

const moodCopy: Record<ReturnType<typeof getPetMood>, { label: string; tone: string }> = {
  blissful: { label: "Blissful", tone: "text-blush-500" },
  happy: { label: "Happy", tone: "text-garden-700" },
  content: { label: "Content", tone: "text-ink-700" },
  restless: { label: "Restless", tone: "text-honey-700" },
  lonely: { label: "Lonely", tone: "text-lavender-500" },
};

/**
 * Compact "your companion right now" card for the left column. Shows the
 * active companion's name, species, mood, and a vitals strip — so the
 * player has a glanceable status without leaving the park view.
 */
export function CompanionMiniCard() {
  const [companion, setCompanion] = useState(() => getActiveCompanion());
  const [vitals, setVitals] = useState(getPetVitals);
  const mood = getPetMood(vitals);
  const moodInfo = moodCopy[mood];

  useEffect(() => {
    const syncRoster = () => setCompanion(getActiveCompanion());
    const syncVitals = () => setVitals(getPetVitals());
    window.addEventListener(COMPANION_ROSTER_EVENT, syncRoster);
    window.addEventListener(PET_VITALS_EVENT, syncVitals);
    return () => {
      window.removeEventListener(COMPANION_ROSTER_EVENT, syncRoster);
      window.removeEventListener(PET_VITALS_EVENT, syncVitals);
    };
  }, []);

  const stats: Array<{ key: string; label: string; value: number; tint: string }> = [
    { key: "fullness", label: "Fed", value: vitals.fullness, tint: "bg-honey-500" },
    { key: "energy", label: "Rest", value: vitals.energy, tint: "bg-sky-500" },
    { key: "happiness", label: "Joy", value: vitals.happiness, tint: "bg-blush-500" },
    { key: "cleanliness", label: "Fresh", value: vitals.cleanliness, tint: "bg-garden-500" },
  ];

  return (
    <section className="hh-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="hh-eyebrow text-blush-500">Your companion</p>
        <span className={`text-xs font-extrabold uppercase tracking-normal ${moodInfo?.tone ?? "text-ink-700"}`}>
          {moodInfo?.label ?? mood}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <PawPrint className="size-5 text-lavender-500" />
        <h3 className="hh-display text-2xl text-ink-900">{companion?.name ?? "Casper"}</h3>
      </div>
      <p className="text-xs font-bold text-ink-500">
        {companion?.speciesId ? companion.speciesId.replace(/-/g, " ") : "Casper cat"}
      </p>
      <div className="mt-3 grid gap-2">
        {stats.map((stat) => (
          <div key={stat.key}>
            <div className="flex items-center justify-between text-xs font-extrabold text-ink-700">
              <span className="uppercase tracking-normal">{stat.label}</span>
              <span>{Math.round(stat.value)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cream-200">
              <div
                className={`h-full rounded-full ${stat.tint}`}
                style={{ width: `${Math.max(0, Math.min(100, stat.value))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-center gap-1 text-[11px] font-bold text-ink-600">
        <Heart className="size-3 text-blush-500" />
        Use the care dock beside the world to earn hearts and lift mood.
      </p>
    </section>
  );
}
