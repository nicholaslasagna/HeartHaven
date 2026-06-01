"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Apple, Heart, Moon, Sparkles, Wind } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { getPetSpecies, getPetTone, readPetCustomization } from "@/lib/game/avatar-customization";
import {
  PET_FOODS,
  formatPetFoodEffects,
  getPetFood,
  type PetFoodAnimation,
  type PetFoodId,
} from "@/lib/game/pet-foods";
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

const ACTION_ANIMATION: Record<PetCareAction, PetFoodAnimation | "play-sparkles" | "pamper-breeze" | "rest-moon"> = {
  feed: "sparkle-bite",
  play: "play-sparkles",
  pamper: "pamper-breeze",
  rest: "rest-moon",
};

type CareAnimationKind = PetFoodAnimation | "play-sparkles" | "pamper-breeze" | "rest-moon";

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

function CareAnimation({
  animation,
  foodId,
}: {
  animation: PetFoodAnimation | "play-sparkles" | "pamper-breeze" | "rest-moon";
  foodId?: PetFoodId;
}) {
  if (animation === "play-sparkles") {
    return (
      <>
        {[0, 1, 2, 3].map((index) => (
          <motion.span
            animate={{ opacity: [0, 1, 0], scale: [0.5, 1.25, 0.7], y: [-2, -34 - index * 5] }}
            className="absolute rounded-full bg-honey-300"
            initial={{ opacity: 0, scale: 0.5, x: -28 + index * 18, y: -8 }}
            key={`sparkle-${index}`}
            style={{ height: 7 + index, width: 7 + index }}
            transition={{ delay: index * 0.06, duration: 0.95, ease: "easeOut" }}
          />
        ))}
      </>
    );
  }

  if (animation === "pamper-breeze") {
    return (
      <>
        {[0, 1, 2].map((index) => (
          <motion.span
            animate={{ opacity: [0, 0.9, 0], x: [30, -42], y: [-22 - index * 14, -30 - index * 8] }}
            className="absolute h-2 rounded-full bg-sky-300/80"
            initial={{ opacity: 0, x: 38, y: -16 - index * 12 }}
            key={`breeze-${index}`}
            style={{ width: 44 - index * 6 }}
            transition={{ delay: index * 0.08, duration: 1.05, ease: "easeOut" }}
          />
        ))}
      </>
    );
  }

  if (animation === "rest-moon") {
    return (
      <motion.span
        animate={{ opacity: [0, 1, 0], scale: [0.7, 1, 1.1], y: [-2, -38] }}
        className="absolute right-5 top-5 rounded-full border border-lavender-200 bg-lavender-100 px-2 py-1 text-xs font-black text-lavender-600"
        initial={{ opacity: 0, scale: 0.7, y: 0 }}
        transition={{ duration: 1.3, ease: "easeOut" }}
      >
        Resting
      </motion.span>
    );
  }

  const food = getPetFood(foodId);
  const driftByAnimation: Record<PetFoodAnimation, { rotate: number; x: number; y: number }> = {
    "sparkle-bite": { rotate: -10, x: 18, y: -24 },
    "happy-crunch": { rotate: 8, x: 20, y: -16 },
    "fresh-leaves": { rotate: -18, x: 22, y: -28 },
    "sleepy-steam": { rotate: 4, x: 18, y: -34 },
    "purr-heart": { rotate: 12, x: 22, y: -20 },
  };
  const drift = driftByAnimation[animation];

  return (
    <>
      <motion.div
        animate={{ opacity: [0, 1, 1, 0], rotate: drift.rotate, scale: [0.72, 1, 0.86], x: drift.x, y: drift.y }}
        className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2"
        initial={{ opacity: 0, rotate: 0, scale: 0.72, x: -44, y: 8 }}
        transition={{ duration: 1.05, ease: "easeOut" }}
      >
        <Image alt="" height={96} src={food.imageSrc} width={96} />
      </motion.div>
      {[0, 1, 2].map((index) => (
        <motion.span
          animate={{ opacity: [0, 1, 0], scale: [0.6, 1, 0.8], y: [-6, -34 - index * 3] }}
          className="absolute rounded-full bg-blush-300"
          initial={{ opacity: 0, scale: 0.6, x: 22 + index * 8, y: -4 }}
          key={`crumb-${index}`}
          style={{ height: 5 + index, width: 5 + index }}
          transition={{ delay: 0.12 + index * 0.07, duration: 0.85, ease: "easeOut" }}
        />
      ))}
    </>
  );
}

export function PetCarePanel({ compact = false }: { compact?: boolean }) {
  const { vitals, mood, neediest, cooldowns, care, feedFood, careProfile, ready } = usePetCare();
  const [petName, setPetName] = useState("Casper");
  const [speciesId, setSpeciesId] = useState<ReturnType<typeof readPetCustomization>["speciesId"]>("kitten");
  const [toneId, setToneId] = useState<ReturnType<typeof readPetCustomization>["toneId"]>("cream");
  const [selectedFoodId, setSelectedFoodId] = useState<PetFoodId>("moonberry-biscuit");
  const actionBurstCounter = useRef(0);
  const [actionBurst, setActionBurst] = useState<{
    id: number;
    animation: CareAnimationKind;
    foodId?: PetFoodId;
  } | null>(null);
  const [actionNotice, setActionNotice] = useState("Choose a snack, then feed your companion for different boosts.");

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
  const selectedFood = getPetFood(selectedFoodId);
  const previewSrc = `/game-assets/generated/pet-art-preview-${speciesId}.png`;
  const moodCopy = MOOD_COPY[mood];

  const lowVital = useMemo(() => {
    if (!vitals) return null;
    return vitals[neediest] < 35 ? neediest : null;
  }, [vitals, neediest]);

  function pulse(animation: CareAnimationKind, foodId?: PetFoodId) {
    actionBurstCounter.current += 1;
    setActionBurst({ id: actionBurstCounter.current, animation, foodId });
  }

  function handleCare(action: PetCareAction, cue: CozyCue) {
    const result = action === "feed" ? feedFood(selectedFoodId) : care(action);
    if (result.ok) {
      playCozyCue(cue);
      pulse(action === "feed" ? selectedFood.animation : ACTION_ANIMATION[action], action === "feed" ? selectedFoodId : undefined);
      setActionNotice(
        action === "feed"
          ? `${petName} enjoyed ${selectedFood.name}: ${formatPetFoodEffects(selectedFood)}.`
          : `${petName} feels cared for. You earned a heart.`,
      );
      return;
    }
    setActionNotice(`${petName} needs a short pause. ${action === "feed" ? "Snack time" : action} is ready in ${formatCooldown(result.cooldownRemainingMs)}.`);
  }

  return (
    <CozyCard className={cn("p-5", compact ? "" : "p-6")}>
      <div className="grid grid-cols-[112px_1fr] items-center gap-4">
        <motion.div
          animate={{ y: mood === "blissful" || mood === "happy" ? [0, -2, 0] : 0 }}
          transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
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
          <AnimatePresence>
            {actionBurst && (
              <motion.div
                key={actionBurst.id}
                className="pointer-events-none absolute inset-0"
                exit={{ opacity: 0 }}
              >
                <CareAnimation animation={actionBurst.animation} foodId={actionBurst.foodId} />
                <motion.span
                  animate={{ opacity: [0, 1, 0], y: -42, scale: [0.65, 1, 0.9] }}
                  className="absolute left-1/2 top-2 -translate-x-1/2 text-blush-500"
                  initial={{ opacity: 0, y: 0, scale: 0.65 }}
                  transition={{ duration: 1.05 }}
                >
                  <Heart className="size-5 fill-current" />
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
            <Sparkles className="size-3.5" />
            Your companion
          </div>
          <h2 className="mt-1 font-display text-3xl text-ink-900">{petName}</h2>
          <p className="text-sm font-bold text-ink-700">{species.label}</p>
          {!compact && <p className="mt-1 text-xs font-bold leading-5 text-ink-500">{careProfile.careStyle}</p>}
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

      <div className="mt-5 rounded-2xl border border-honey-200 bg-honey-50/60 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase tracking-normal text-honey-700">Snack tray</p>
            <p className="mt-1 text-xs font-bold text-ink-600">
              Pick a food before pressing Feed. Each snack has its own benefit and animation.
            </p>
          </div>
          <Badge variant="outline">{formatPetFoodEffects(selectedFood)}</Badge>
        </div>
        <div className={cn("mt-3 grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-5")}>
          {PET_FOODS.map((food) => (
            <button
              aria-pressed={selectedFoodId === food.id}
              className={cn(
                "group rounded-xl border bg-white/75 p-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-honey-300 hover:shadow-md",
                selectedFoodId === food.id ? "border-honey-400 ring-2 ring-honey-200" : "border-cream-300",
              )}
              key={food.id}
              onClick={() => {
                setSelectedFoodId(food.id);
                setActionNotice(`${food.name}: ${formatPetFoodEffects(food)}.`);
                playCozyCue("ui");
              }}
              title={food.description}
              type="button"
            >
              <div className="grid place-items-center rounded-lg border border-cream-200 bg-cream-50/80 py-1">
                <Image
                  alt={food.name}
                  className="h-12 w-12 object-contain drop-shadow-[0_8px_12px_rgba(91,63,63,0.18)]"
                  height={96}
                  src={food.imageSrc}
                  width={96}
                />
              </div>
              <span className="mt-2 block text-xs font-black text-ink-800">{food.shortName}</span>
              {!compact && <span className="mt-0.5 block text-[10px] font-bold text-ink-500">{formatPetFoodEffects(food)}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-garden-200 bg-garden-100/60 px-3 py-2 text-sm font-bold text-garden-800">
        {actionNotice}
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
              disabled={!ready}
              onClick={() => handleCare(action.key, action.cue)}
              title={cd.ready ? `${action.label} your companion` : `Ready in ${formatCooldown(cd.remainingMs)}`}
            >
              <ActionIcon />
              {action.key === "feed" && cd.ready ? `Feed ${selectedFood.shortName}` : cd.ready ? action.label : formatCooldown(cd.remainingMs)}
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
