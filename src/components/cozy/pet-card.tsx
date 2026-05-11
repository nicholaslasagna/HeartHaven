"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Cookie, HandHeart, Heart, Sparkles } from "lucide-react";
import { PetIllustration } from "@/components/brand/illustrations";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";

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
          <PetIllustration type="fox" tone="cream" />
        </motion.div>
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
            <Sparkles className="size-3.5" />
            Active companion
          </div>
          <h2 className="mt-1 font-display text-3xl text-ink-900">{name}</h2>
          <p className="text-sm font-bold text-ink-700">{species}</p>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{trait}</p>
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
    </CozyCard>
  );
}
