"use client";

import { useEffect, useState } from "react";
import { Palette, Shirt, Sparkles } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import {
  getKeeperOutfit,
  getKeeperPalette,
  KEEPER_OUTFITS,
  KEEPER_PALETTES,
  readKeeperCustomization,
  writeKeeperCustomization,
  type KeeperOutfitId,
  type KeeperPaletteId,
} from "@/lib/game/avatar-customization";

export function KeeperCustomizerCard() {
  const [paletteId, setPaletteId] = useState<KeeperPaletteId>("blush");
  const [outfitId, setOutfitId] = useState<KeeperOutfitId>("cardigan");
  const palette = getKeeperPalette(paletteId);
  const outfit = getKeeperOutfit(outfitId);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = readKeeperCustomization();
      setPaletteId(saved.paletteId);
      setOutfitId(saved.outfitId);
    });
    return () => {
      active = false;
    };
  }, []);

  function updateKeeper(nextPaletteId: KeeperPaletteId, nextOutfitId: KeeperOutfitId) {
    setPaletteId(nextPaletteId);
    setOutfitId(nextOutfitId);
    writeKeeperCustomization({ paletteId: nextPaletteId, outfitId: nextOutfitId });
  }

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
          <h2 className="font-display text-2xl text-ink-900">{outfit.label}</h2>
          <p className="mt-1 text-sm font-bold text-ink-700">Animated room and garden avatar style.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {KEEPER_PALETTES.map((item) => (
              <button
                aria-label={`Set keeper palette to ${item.label}`}
                className={`size-8 rounded-full border-2 transition ${paletteId === item.id ? "border-ink-900" : "border-white"}`}
                key={item.id}
                onClick={() => updateKeeper(item.id, outfitId)}
                style={{ backgroundColor: item.color }}
                type="button"
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {KEEPER_OUTFITS.map((item) => (
          <button
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-black transition ${
              outfitId === item.id ? "border-blush-300 bg-blush-100 text-ink-900" : "border-cream-300 bg-white/70 text-ink-700"
            }`}
            key={item.id}
            onClick={() => updateKeeper(paletteId, item.id)}
            type="button"
          >
            {outfitId === item.id ? <Sparkles className="size-3" /> : <Shirt className="size-3" />}
            {item.label}
          </button>
        ))}
      </div>
    </CozyCard>
  );
}
