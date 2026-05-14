"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Palette, Scissors, Shirt, Sparkles, UserRound } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import {
  KEEPER_BODY_TYPES,
  KEEPER_HAIR_COLORS,
  KEEPER_HAIR_STYLES,
  getKeeperOutfit,
  getKeeperPalette,
  KEEPER_OUTFITS,
  KEEPER_PALETTES,
  KEEPER_SKIN_TONES,
  readKeeperCustomization,
  writeKeeperCustomization,
  type KeeperBodyId,
  type KeeperHairColorId,
  type KeeperHairStyleId,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperSkinId,
} from "@/lib/game/avatar-customization";

export function KeeperCustomizerCard() {
  const [bodyId, setBodyId] = useState<KeeperBodyId>("female");
  const [skinId, setSkinId] = useState<KeeperSkinId>("fair");
  const [hairStyleId, setHairStyleId] = useState<KeeperHairStyleId>("long-waves");
  const [hairColorId, setHairColorId] = useState<KeeperHairColorId>("chestnut");
  const [paletteId, setPaletteId] = useState<KeeperPaletteId>("blush");
  const [outfitId, setOutfitId] = useState<KeeperOutfitId>("cardigan");
  const palette = getKeeperPalette(paletteId);
  const outfit = getKeeperOutfit(outfitId);
  const hairColor = KEEPER_HAIR_COLORS.find((item) => item.id === hairColorId) ?? KEEPER_HAIR_COLORS[0];
  const skinTone = KEEPER_SKIN_TONES.find((item) => item.id === skinId) ?? KEEPER_SKIN_TONES[0];
  const hairStyle = KEEPER_HAIR_STYLES.find((item) => item.id === hairStyleId) ?? KEEPER_HAIR_STYLES[0];
  const body = KEEPER_BODY_TYPES.find((item) => item.id === bodyId) ?? KEEPER_BODY_TYPES[0];
  const previewSrc = `/game-assets/generated/keeper-custom-preview-${bodyId}-${outfitId}.png`;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = readKeeperCustomization();
      setBodyId(saved.bodyId);
      setSkinId(saved.skinId);
      setHairStyleId(saved.hairStyleId);
      setHairColorId(saved.hairColorId);
      setPaletteId(saved.paletteId);
      setOutfitId(saved.outfitId);
    });
    return () => {
      active = false;
    };
  }, []);

  function updateKeeper(next: Partial<{
    bodyId: KeeperBodyId;
    skinId: KeeperSkinId;
    hairStyleId: KeeperHairStyleId;
    hairColorId: KeeperHairColorId;
    paletteId: KeeperPaletteId;
    outfitId: KeeperOutfitId;
  }>) {
    const customization = {
      bodyId: next.bodyId ?? bodyId,
      skinId: next.skinId ?? skinId,
      hairStyleId: next.hairStyleId ?? hairStyleId,
      hairColorId: next.hairColorId ?? hairColorId,
      paletteId: next.paletteId ?? paletteId,
      outfitId: next.outfitId ?? outfitId,
    };
    setBodyId(customization.bodyId);
    setSkinId(customization.skinId);
    setHairStyleId(customization.hairStyleId);
    setHairColorId(customization.hairColorId);
    setPaletteId(customization.paletteId);
    setOutfitId(customization.outfitId);
    writeKeeperCustomization(customization);
  }

  return (
    <CozyCard className="p-5">
      <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-500">
        <Palette className="size-4" /> Keeper customization
      </p>
      <div className="mt-4 grid grid-cols-[110px_1fr] items-center gap-4">
        <div className="relative grid h-32 place-items-center rounded-lg border border-cream-300 bg-cream-50">
          <div className="absolute bottom-4 h-5 w-20 rounded-full bg-ink-900/15 blur-[1px]" />
          <Image
            alt="Painted chibi keeper avatar preview"
            className="relative h-32 w-auto object-contain drop-shadow-[0_12px_18px_rgba(91,63,63,0.22)]"
            height={384}
            src={previewSrc}
            width={256}
          />
          <span
            className="absolute right-3 top-3 size-4 rounded-full border-2 border-white shadow-sm"
            style={{ backgroundColor: palette.color }}
          />
        </div>
        <div>
          <h2 className="font-display text-2xl text-ink-900">{outfit.label}</h2>
          <p className="mt-1 text-sm font-bold text-ink-700">
            {body.label} keeper | {skinTone.label} skin | {hairColor.label} {hairStyle.label.toLowerCase()}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {KEEPER_BODY_TYPES.map((item) => (
              <button
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                  bodyId === item.id ? "border-blush-300 bg-blush-100 text-ink-900" : "border-cream-300 bg-white/70 text-ink-700"
                }`}
                key={item.id}
                onClick={() => updateKeeper({ bodyId: item.id })}
                type="button"
              >
                <UserRound className="size-3" /> {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {KEEPER_PALETTES.map((item) => (
              <button
                aria-label={`Set keeper palette to ${item.label}`}
                className={`size-8 rounded-full border-2 transition ${paletteId === item.id ? "border-ink-900" : "border-white"}`}
                key={item.id}
                onClick={() => updateKeeper({ paletteId: item.id })}
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
            onClick={() => updateKeeper({ outfitId: item.id })}
            type="button"
          >
            {outfitId === item.id ? <Sparkles className="size-3" /> : <Shirt className="size-3" />}
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 rounded-lg border border-cream-300 bg-cream-50/70 p-3">
        <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-ink-500">
          <Scissors className="size-3.5" /> Skin, hair, and details
        </p>
        <div className="flex flex-wrap gap-2">
          {KEEPER_SKIN_TONES.map((item) => (
            <button
              aria-label={`Set skin tone to ${item.label}`}
              className={`size-8 rounded-full border-2 transition ${skinId === item.id ? "border-ink-900" : "border-white"}`}
              key={item.id}
              onClick={() => updateKeeper({ skinId: item.id })}
              style={{ backgroundColor: item.color }}
              type="button"
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {KEEPER_HAIR_STYLES.map((item) => (
            <button
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                hairStyleId === item.id ? "border-garden-300 bg-garden-100 text-ink-900" : "border-cream-300 bg-white/70 text-ink-700"
              }`}
              key={item.id}
              onClick={() => updateKeeper({ hairStyleId: item.id })}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {KEEPER_HAIR_COLORS.map((item) => (
            <button
              aria-label={`Set hair color to ${item.label}`}
              className={`size-8 rounded-full border-2 transition ${hairColorId === item.id ? "border-ink-900" : "border-white"}`}
              key={item.id}
              onClick={() => updateKeeper({ hairColorId: item.id })}
              style={{ backgroundColor: item.color }}
              type="button"
            />
          ))}
        </div>
      </div>
    </CozyCard>
  );
}
