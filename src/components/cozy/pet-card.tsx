"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Cookie, HandHeart, Heart, Sparkles } from "lucide-react";
import { PetIllustration } from "@/components/brand/illustrations";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";

type PetType = "bunny" | "kitten" | "fox" | "bear" | "duck";
type PetTone = "cream" | "blush" | "lavender" | "sky" | "honey" | "mint";

type PetCardProps = {
  name: string;
  species: string;
  trait: string;
  happiness: number;
  hunger: number;
};

const petLooks: Array<{ type: PetType; label: string }> = [
  { type: "fox", label: "Fox" },
  { type: "bunny", label: "Bunny" },
  { type: "bear", label: "Bear" },
  { type: "duck", label: "Duck" },
  { type: "kitten", label: "Kitten" },
];

const petTones: Array<{ tone: PetTone; label: string; swatch: string }> = [
  { tone: "cream", label: "Cream", swatch: "#FFFCF3" },
  { tone: "blush", label: "Blush", swatch: "#FBD9DC" },
  { tone: "lavender", label: "Lavender", swatch: "#DECDEF" },
  { tone: "mint", label: "Mint", swatch: "#D2E8C7" },
  { tone: "honey", label: "Honey", swatch: "#FBE6B6" },
  { tone: "sky", label: "Sky", swatch: "#C9E1ED" },
];

export function PetCard({ name, species, trait, happiness, hunger }: PetCardProps) {
  const [currentHappiness, setCurrentHappiness] = useState(happiness);
  const [currentHunger, setCurrentHunger] = useState(hunger);
  const [mood, setMood] = useState("Calm");
  const [petType, setPetType] = useState<PetType>("fox");
  const [petTone, setPetTone] = useState<PetTone>("cream");
  const [accessory, setAccessory] = useState("Moonberry bow");

  function play() {
    setCurrentHappiness((value) => Math.min(100, value + 6));
    setMood("Playful");
  }

  function feed() {
    setCurrentHunger((value) => Math.max(0, value - 8));
    setCurrentHappiness((value) => Math.min(100, value + 2));
    setMood("Snack-happy");
  }

  function pet() {
    setCurrentHappiness((value) => Math.min(100, value + 4));
    setMood("Loved");
  }

  return (
    <CozyCard className="p-5">
      <div className="grid grid-cols-[112px_1fr] items-center gap-4">
        <motion.div animate={{ y: mood === "Playful" ? [0, -8, 0] : 0 }} transition={{ duration: 0.45 }}>
          <PetIllustration type={petType} tone={petTone} />
        </motion.div>
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
            <Sparkles className="size-3.5" />
            Active companion
          </div>
          <h2 className="mt-1 font-display text-3xl text-ink-900">{name}</h2>
          <p className="text-sm font-bold text-ink-700">{species}</p>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{trait}</p>
          <p className="mt-1 text-xs font-bold text-lavender-500">{accessory}</p>
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
          {petLooks.map((look) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                petType === look.type ? "border-blush-300 bg-blush-100 text-ink-900" : "border-cream-300 bg-white/70 text-ink-700"
              }`}
              key={look.type}
              onClick={() => {
                setPetType(look.type);
                setMood("Styled");
              }}
              type="button"
            >
              {look.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {petTones.map((tone) => (
            <button
              aria-label={`Set pet tone to ${tone.label}`}
              className={`size-8 rounded-full border-2 transition ${petTone === tone.tone ? "border-ink-900" : "border-white"}`}
              key={tone.tone}
              onClick={() => {
                setPetTone(tone.tone);
                setMood("Glowing");
              }}
              style={{ backgroundColor: tone.swatch }}
              type="button"
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Moonberry bow", "Lantern scarf", "Garden crown"].map((item) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                accessory === item ? "border-lavender-300 bg-lavender-100 text-ink-900" : "border-cream-300 bg-white/70 text-ink-700"
              }`}
              key={item}
              onClick={() => {
                setAccessory(item);
                setMood("Loved");
              }}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    </CozyCard>
  );
}
