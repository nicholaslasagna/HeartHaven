"use client";

import { useState } from "react";
import { Palette, Shirt, Sparkles } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";

const palettes = [
  { id: "blush", label: "Blush", color: "#D87E8C" },
  { id: "lavender", label: "Lavender", color: "#8E70BD" },
  { id: "garden", label: "Garden", color: "#6E9651" },
  { id: "honey", label: "Honey", color: "#D9A53E" },
  { id: "sky", label: "Sky", color: "#5E94B0" },
];

const outfits = ["Cozy cardigan", "Garden overalls", "Moonlit cape", "Party sweater"];

export function KeeperCustomizerCard() {
  const [palette, setPalette] = useState(palettes[0]);
  const [outfit, setOutfit] = useState(outfits[0]);

  return (
    <CozyCard className="p-5">
      <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-500">
        <Palette className="size-4" /> Keeper customization
      </p>
      <div className="mt-4 grid grid-cols-[110px_1fr] items-center gap-4">
        <div className="relative grid h-32 place-items-center rounded-lg border border-cream-300 bg-cream-50">
          <div className="absolute bottom-4 h-4 w-16 rounded-full bg-ink-900/15" />
          <div className="relative h-24 w-16 rounded-full border-4 border-white shadow-sm" style={{ backgroundColor: palette.color }}>
            <div className="absolute -top-5 left-1/2 h-12 w-12 -translate-x-1/2 rounded-full border-4 border-white bg-cream-50" />
            <div className="absolute left-4 top-7 h-2 w-2 rounded-full bg-ink-900" />
            <div className="absolute right-4 top-7 h-2 w-2 rounded-full bg-ink-900" />
            <div className="absolute left-1/2 top-11 h-2 w-5 -translate-x-1/2 rounded-b-full border-b-2 border-ink-900" />
          </div>
        </div>
        <div>
          <h2 className="font-display text-2xl text-ink-900">{outfit}</h2>
          <p className="mt-1 text-sm font-bold text-ink-700">Preview avatar colors for Realtime room visits.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {palettes.map((item) => (
              <button
                aria-label={`Set keeper palette to ${item.label}`}
                className={`size-8 rounded-full border-2 transition ${palette.id === item.id ? "border-ink-900" : "border-white"}`}
                key={item.id}
                onClick={() => {
                  setPalette(item);
                  window.localStorage.setItem("hearthaven:keeper-palette", item.color);
                }}
                style={{ backgroundColor: item.color }}
                type="button"
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {outfits.map((item) => (
          <button
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-black transition ${
              outfit === item ? "border-blush-300 bg-blush-100 text-ink-900" : "border-cream-300 bg-white/70 text-ink-700"
            }`}
            key={item}
            onClick={() => setOutfit(item)}
            type="button"
          >
            {outfit === item ? <Sparkles className="size-3" /> : <Shirt className="size-3" />}
            {item}
          </button>
        ))}
      </div>
    </CozyCard>
  );
}
