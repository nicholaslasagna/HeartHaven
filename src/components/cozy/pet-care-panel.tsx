"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Apple, Heart, Moon, Sparkles, Wind } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { getPetSpecies, getPetTone, readPetCustomization } from "@/lib/game/avatar-customization";
import { playCozyCue, type CozyCue } from "@/lib/game/cozy-audio";
import { usePetCare } from "@/lib/game/use-pet-care";
import type { PetCareAction, PetMood, PetVitalKey } from "@/lib/game/pet-state";
import { cn } from "@/lib/utils";

/**
 * PetCarePanel — the living-companion care surface, the heart of the loop.
 *
 * Shows the companion, its four real-time-decaying vitals, and the four care
 * actions (feed / play / pamper / rest). Each action sits behind a short
 * cooldown and pays the keeper a heart. This is the Webkinz "pet room", modern.
 */

const VITALS: { key: PetVitalKey; label: string; bar: string; track: string }[] = [
  { key: "happiness",   label: "Happiness",   bar: "bg-blush-300",    track: "bg-blush-100" },
  { key: "fullness",    label: "Fullness",    bar: "bg-honey-500",    track: "bg-honey-100" },
  { key: "energy",      label: "Energy",      bar: "bg-garden-500",   track: "bg-garden-100" },
  { key: "cleanliness", label: "Freshness",   bar: "bg-lavender-300", track: "bg-lavender-100" },
];

const ACTIONS: { key: PetCareAction; label: string; icon: typeof Heart; cue: CozyCue }[] = [
  { key: "feed",   label: "Feed",   icon: Apple,    cue: "petPurr" },
  { key: "play",   label: "Play",   icon: Sparkles, cue: "petChirp" },
  { key: "pamper", label: "Pamper", icon: Wind,     cue: "ui" },
  { key: "rest",   label: "Rest",   icon: Moon,     cue: "petPurr" },
];

const MOOD_COPY: Record<PetMood, { label: string; tone: string }> = {
  blissful:  { label: "Blissful",  tone: "bg-blush-100 text-blush-700" },
  happy:     { label: "Happy",     tone: "bg-honey-100 text-honey-700" },
  content:   { label: "Content",   tone: "bg-garden-100 text-garden-700" },
  restless:  { label: "Restless",  tone: "bg-lavender-100 text-lavender-500" },
  lonely:    { label: "Needs you", tone: "bg-blush-100 text-blush-700" },
};

const NEED_COPY: Record<PetVitalKey, string> = {
  happiness: "could use some company",
  fullness: "is getting hungry",
  energy: "is running low on energy",
  cleanliness: "would love a little pampering",
};

function formatCooldown(ms: number): string {
  if (ms <= 0) return "Ready";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}

export function PetCarePanel({ compact = false }: { compact?: boolean }) {
  const { vitals, mood, neediest, cooldowns, care, ready } = usePetCare();
  const [petName, setPetName] = useState("Casper");
  const [speciesId, setSpeciesId] = useState<ReturnType<typeof readPetCustomization>["speciesId"]>("fox");
  const [toneId, setToneId] = useState<ReturnType<typeof readPetCustomization>["toneId"]>("cream");
  const [floatHeart, setFloatHeart] = useState(0);

  useEffect(() => {
    const sync = () => {
      const saved = readPetCustomization();
      setSpeciesId(saved.speciesId);
      setToneId(saved.toneId);
      if (typeof window !== "undefined") {
        setPetName(window.localStorage.getItem("hearthaven:pet-name") ?? "Casper");
      }
    };
    sync();
    window.addEventListener("hearthaven:pet-customization-changed", sync);
    return () => window.removeEventListener("hearthaven:pet-customization-changed", sync);
  }, []);

  const species = getPetSpecies(speciesId);
  const tone = getPetTone(toneId);
  const previewSrc = `/game-assets/generated/pet-art-preview-${speciesId}.png`;
  const moodCopy = MOOD_COPY[mood];

  const lowVital = useMemo(() => {
    if (!vitals) return null;
    return vitals[neediest] < 35 ? neediest : null;
  }, [vitals, neediest]);

  function handleCare(action: PetCareAction, cue: CozyCue) {
    const result = care(action);
    if (result.ok) {
      playCozyCue(cue);
      setFloatHeart((value) => value + 1);
    }
  }

  return (
    <CozyCard className={cn("p-5", compact ? "" : "p-6")}>
      <div className="grid grid-cols-[112px_1fr] items-center gap-4">
        <motion.div
          animate={{ y: mood === "blissful" || mood === "happy" ? [0, -6, 0] : 0 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          className="relative grid h-28 place-items-center rounded-lg border border-cream-300 bg-cream-50"
        >
          <div className="absolute bottom-3 h-4 w-16 rounded-full bg-ink-900/15 blur-[1px]" />
          <Image
            alt={`${petName} the ${species.label}`}
            className="relative h-28 w-auto object-contain drop-shadow-[0_10px_16px_rgba(91,63,63,0.2)]"
            height={288}
            src={previewSrc}
            width={256}
            priority={!compact}
          />
          <span
            className="absolute right-3 top-3 size-4 rounded-full border-2 border-white shadow-sm"
            style={{ backgroundColor: tone.color }}
          />
          {/* heart float feedback on a successful care action */}
          <AnimatePresence>
            <motion.span
              key={floatHeart}
              initial={{ opacity: 0, y: 0, scale: 0.6 }}
              animate={{ opacity: floatHeart > 0 ? [0, 1, 0] : 0, y: -38, scale: 1 }}
              transition={{ duration: 1 }}
              className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-blush-500"
            >
              <Heart className="size-5 fill-current" />
            </motion.span>
          </AnimatePresence>
        </motion.div>
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
            <Sparkles className="size-3.5" />
            Your companion
          </div>
          <h2 className="mt-1 font-display text-3xl text-ink-900">{petName}</h2>
          <p className="text-sm font-bold text-ink-700">{species.label}</p>
          <span className={cn("mt-2 inline-block w-fit rounded-full px-2.5 py-1 text-xs font-extrabold", moodCopy.tone)}>
            {moodCopy.label}
          </span>
        </div>
      </div>

      {lowVital && (
        <div className="mt-4 rounded-lg border border-blush-300/50 bg-blush-100/70 px-3 py-2 text-sm font-bold text-blush-700">
          {petName} {NEED_COPY[lowVital]}.
        </div>
      )}

      <div className="mt-4 grid gap-2.5">
        {VITALS.map((vital) => {
          const value = vitals ? Math.round(vitals[vital.key]) : 0;
          return (
            <div key={vital.key}>
              <div className="flex justify-between text-sm font-bold text-ink-700">
                <span>{vital.label}</span>
                <span className={cn(value < 30 && "text-blush-700")}>{value}%</span>
              </div>
              <div className={cn("mt-1 h-2.5 rounded-full", vital.track)}>
                <motion.div
                  className={cn("h-full rounded-full", vital.bar)}
                  animate={{ width: `${value}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIONS.map((action) => {
          const cd = cooldowns[action.key];
          const ActionIcon = action.icon;
          return (
            <CozyButton
              key={action.key}
              size="sm"
              variant={action.key === "play" ? "default" : "warm"}
              disabled={!ready || !cd.ready}
              onClick={() => handleCare(action.key, action.cue)}
              title={cd.ready ? `${action.label} your companion` : `Ready in ${formatCooldown(cd.remainingMs)}`}
            >
              <ActionIcon />
              {cd.ready ? action.label : formatCooldown(cd.remainingMs)}
            </CozyButton>
          );
        })}
      </div>

      {!compact && (
        <p className="mt-4 flex items-center gap-1.5 text-xs font-bold text-ink-500">
          <Heart className="size-3.5 fill-current text-blush-500" />
          Caring for {petName} earns you a heart each time — and keeps their vitals from drifting down.
        </p>
      )}
      {compact && <Badge variant="blush" className="mt-4">Tending earns hearts</Badge>}
    </CozyCard>
  );
}
