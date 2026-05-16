"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Cookie, HandHeart, Heart, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import {
  getPetAccessory,
  getPetSpecies,
  getPetTone,
  PET_ACCESSORIES,
  PET_SPECIES,
  PET_TONES,
  readPetCustomization,
  writePetCustomization,
  type PetAccessoryId,
  type PetSpeciesId,
  type PetToneId,
} from "@/lib/game/avatar-customization";
import { playCozyCue } from "@/lib/game/cozy-audio";

type PetCardProps = {
  name: string;
  species: string;
  trait: string;
  happiness: number;
  hunger: number;
};

export function PetCard({ name, species, trait, happiness, hunger }: PetCardProps) {
  const [currentHappiness, setCurrentHappiness] = useState(happiness);
  const [currentHunger, setCurrentHunger] = useState(hunger);
  const [mood, setMood] = useState("Calm");
  const [petType, setPetType] = useState<PetSpeciesId>("kitten");
  const [petTone, setPetTone] = useState<PetToneId>("cream");
  const [accessory, setAccessory] = useState<PetAccessoryId>("moonberry-bow");
  const selectedSpecies = getPetSpecies(petType);
  const selectedTone = getPetTone(petTone);
  const selectedAccessory = getPetAccessory(accessory);
  const previewSrc = `/game-assets/generated/pet-art-preview-${petType}.png`;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = readPetCustomization();
      setPetType(saved.speciesId);
      setPetTone(saved.toneId);
      setAccessory(saved.accessory);
    });
    return () => {
      active = false;
    };
  }, []);

  function updateCompanion(nextType: PetSpeciesId, nextTone: PetToneId, nextAccessory: PetAccessoryId) {
    setPetType(nextType);
    setPetTone(nextTone);
    setAccessory(nextAccessory);
    writePetCustomization({ speciesId: nextType, toneId: nextTone, accessory: nextAccessory });
  }

  function play() {
    setCurrentHappiness((value) => Math.min(100, value + 6));
    setMood("Playful");
    playCozyCue("petChirp");
  }

  function feed() {
    setCurrentHunger((value) => Math.max(0, value - 8));
    setCurrentHappiness((value) => Math.min(100, value + 2));
    setMood("Snack-happy");
    playCozyCue("petPurr");
  }

  function pet() {
    setCurrentHappiness((value) => Math.min(100, value + 4));
    setMood("Loved");
    playCozyCue("heart");
  }

  return (
    <CozyCard className="p-5">
      <div className="grid grid-cols-[112px_1fr] items-center gap-4">
        <motion.div
          animate={{ y: mood === "Playful" ? [0, -8, 0] : 0 }}
          className="relative grid h-28 place-items-center rounded-lg border border-cream-300 bg-cream-50"
          transition={{ duration: 0.45 }}
        >
          <div className="absolute bottom-3 h-4 w-16 rounded-full bg-ink-900/15 blur-[1px]" />
          <Image
            alt="Painted companion pet preview"
            className="relative h-28 w-auto object-contain drop-shadow-[0_10px_16px_rgba(91,63,63,0.2)]"
            height={288}
            src={previewSrc}
            width={256}
          />
          <span
            className="absolute right-3 top-3 size-4 rounded-full border-2 border-white shadow-sm"
            style={{ backgroundColor: selectedTone.color }}
          />
        </motion.div>
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
            <Sparkles className="size-3.5" />
            Active companion
          </div>
          <h2 className="mt-1 font-display text-3xl text-ink-900">{name}</h2>
          <p className="text-sm font-bold text-ink-700">{selectedSpecies.label || species}</p>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{trait}</p>
          <p className="mt-1 text-xs font-bold text-lavender-500">
            {selectedTone.label} coat | {selectedAccessory.label}
          </p>
          <p className="mt-2 w-fit rounded-full bg-honey-100 px-2.5 py-1 text-xs font-extrabold text-honey-700">{mood}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-sm font-bold text-ink-700">
        <div className="flex justify-between">
          <span className="inline-flex items-center gap-1"><Heart className="size-4 fill-current text-blush-500" /> Happiness</span>
          <span>{currentHappiness}%</span>
        </div>
        <div className="h-2 rounded-full bg-cream-200"><div className="h-full rounded-full bg-blush-300" style={{ width: `${currentHappiness}%` }} /></div>
        <div className="flex justify-between">
          <span>Hunger</span>
          <span>{currentHunger}%</span>
        </div>
        <div className="h-2 rounded-full bg-cream-200"><div className="h-full rounded-full bg-honey-500" style={{ width: `${currentHunger}%` }} /></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <CozyButton size="sm" variant="warm" onClick={pet}><HandHeart /> Pet</CozyButton>
        <CozyButton size="sm" variant="warm" onClick={feed}><Cookie /> Feed</CozyButton>
        <CozyButton size="sm" onClick={play}><Sparkles /> Play</CozyButton>
      </div>
      <div className="mt-5 rounded-lg border border-cream-300 bg-cream-50/70 p-3">
        <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Customize companion</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PET_SPECIES.map((look) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                petType === look.id ? "border-blush-300 bg-blush-100 text-ink-900" : "border-cream-300 bg-white/70 text-ink-700"
              }`}
              key={look.id}
              onClick={() => {
                updateCompanion(look.id, petTone, accessory);
                setMood("Styled");
                playCozyCue("petChirp");
              }}
              type="button"
            >
              {look.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PET_TONES.map((tone) => (
            <button
              aria-label={`Set pet tone to ${tone.label}`}
              className={`size-8 rounded-full border-2 transition ${petTone === tone.id ? "border-ink-900" : "border-white"}`}
              key={tone.id}
              onClick={() => {
                updateCompanion(petType, tone.id, accessory);
                setMood("Glowing");
                playCozyCue("ui");
              }}
              style={{ backgroundColor: tone.color }}
              type="button"
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PET_ACCESSORIES.map((item) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                accessory === item.id ? "border-lavender-300 bg-lavender-100 text-ink-900" : "border-cream-300 bg-white/70 text-ink-700"
              }`}
              key={item.id}
              onClick={() => {
                updateCompanion(petType, petTone, item.id);
                setMood("Loved");
                playCozyCue("heart");
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </CozyCard>
  );
}
