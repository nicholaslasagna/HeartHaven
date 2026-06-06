"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Palette, Scissors, Shirt, Sparkles, UserRound } from "lucide-react";
import { KeeperAvatarPreview } from "@/components/cozy/keeper-avatar-preview";
import { CozyCard } from "@/components/cozy/cozy-card";
import {
  KEEPER_BODY_TYPES,
  KEEPER_CHARACTER_PRESETS,
  KEEPER_HAIR_COLORS,
  KEEPER_HAIR_STYLES,
  getKeeperCharacterPreset,
  getKeeperOutfit,
  getKeeperPalette,
  KEEPER_OUTFITS,
  KEEPER_PALETTES,
  KEEPER_SKIN_TONES,
  loadKeeperCustomizationFromServer,
  readKeeperCustomization,
  saveKeeperCustomizationToServer,
  writeKeeperCustomization,
  type KeeperCustomization,
  type KeeperBodyId,
  type KeeperCharacterId,
  type KeeperHairColorId,
  type KeeperHairStyleId,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperSkinId,
} from "@/lib/game/avatar-customization";

export function KeeperCustomizerCard() {
  const keeperRef = useRef<KeeperCustomization>({
    characterId: "rose-waves",
    bodyId: "female",
    skinId: "fair",
    hairStyleId: "long-waves",
    hairColorId: "chestnut",
    paletteId: "blush",
    outfitId: "cardigan",
  });
  const [characterId, setCharacterId] = useState<KeeperCharacterId>("rose-waves");
  const [bodyId, setBodyId] = useState<KeeperBodyId>("female");
  const [skinId, setSkinId] = useState<KeeperSkinId>("fair");
  const [hairStyleId, setHairStyleId] = useState<KeeperHairStyleId>("long-waves");
  const [hairColorId, setHairColorId] = useState<KeeperHairColorId>("chestnut");
  const [paletteId, setPaletteId] = useState<KeeperPaletteId>("blush");
  const [outfitId, setOutfitId] = useState<KeeperOutfitId>("cardigan");
  const [notice, setNotice] = useState("Your keeper look is used in rooms, gardens, parties, and chat.");
  const saveSequenceRef = useRef(0);
  const palette = getKeeperPalette(paletteId);
  const outfit = getKeeperOutfit(outfitId);
  const hairColor = KEEPER_HAIR_COLORS.find((item) => item.id === hairColorId) ?? KEEPER_HAIR_COLORS[0];
  const hairStyle = KEEPER_HAIR_STYLES.find((item) => item.id === hairStyleId) ?? KEEPER_HAIR_STYLES[0];
  const character = getKeeperCharacterPreset(characterId);

  function applyKeeperCustomization(customization: KeeperCustomization) {
    keeperRef.current = customization;
    setCharacterId(customization.characterId);
    setBodyId(customization.bodyId);
    setSkinId(customization.skinId);
    setHairStyleId(customization.hairStyleId);
    setHairColorId(customization.hairColorId);
    setPaletteId(customization.paletteId);
    setOutfitId(customization.outfitId);
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = readKeeperCustomization();
      applyKeeperCustomization(saved);
    });
    const loadSequence = saveSequenceRef.current;
    void loadKeeperCustomizationFromServer().then((result) => {
      if (!active || !result.ok || saveSequenceRef.current !== loadSequence) return;
      applyKeeperCustomization(result.customization);
      setNotice("Loaded your saved keeper.");
    });
    return () => {
      active = false;
    };
  }, []);

  function persistKeeper(customization: KeeperCustomization) {
    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    setNotice("Saving...");
    void saveKeeperCustomizationToServer(customization).then((result) => {
      if (saveSequenceRef.current !== sequence) return;
      if (result.ok) {
        setNotice("Saved. Your keeper updates across rooms, gardens, and multiplayer visits.");
      } else {
        setNotice(`Could not save: ${result.reason}`);
      }
    });
  }

  function updateKeeper(next: Partial<{
    characterId: KeeperCharacterId;
    bodyId: KeeperBodyId;
    skinId: KeeperSkinId;
    hairStyleId: KeeperHairStyleId;
    hairColorId: KeeperHairColorId;
    paletteId: KeeperPaletteId;
    outfitId: KeeperOutfitId;
  }>) {
    const current = keeperRef.current;
    const customization = {
      characterId: next.characterId ?? current.characterId,
      bodyId: next.bodyId ?? current.bodyId,
      skinId: next.skinId ?? current.skinId,
      hairStyleId: next.hairStyleId ?? current.hairStyleId,
      hairColorId: next.hairColorId ?? current.hairColorId,
      paletteId: next.paletteId ?? current.paletteId,
      outfitId: next.outfitId ?? current.outfitId,
    };
    applyKeeperCustomization(customization);
    writeKeeperCustomization(customization);
    persistKeeper(customization);
  }

  function chooseCharacter(preset: (typeof KEEPER_CHARACTER_PRESETS)[number]) {
    updateKeeper({
      characterId: preset.id,
      bodyId: preset.bodyId,
      skinId: preset.skinId,
      hairStyleId: preset.hairStyleId,
      hairColorId: preset.hairColorId,
      paletteId: preset.paletteId,
      outfitId: preset.outfitId,
    });
  }

  return (
    <CozyCard className="overflow-hidden p-0">
      <div className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.94),transparent_28%),radial-gradient(circle_at_84%_8%,rgba(222,205,239,0.72),transparent_30%),linear-gradient(135deg,rgba(255,252,243,0.96),rgba(251,217,220,0.68)_48%,rgba(210,232,199,0.42))]" />
        <div className="relative grid gap-5 p-5 xl:grid-cols-[230px_1fr]">
          <div className="relative min-h-[260px] overflow-hidden rounded-[28px] border border-white/80 bg-white/52 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_22px_45px_-34px_rgba(91,63,63,0.75)]">
            <div className="absolute inset-x-8 bottom-9 h-7 rounded-full bg-ink-900/15 blur-[2px]" />
            <div className="absolute left-5 top-5 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-[11px] font-black uppercase tracking-normal text-ink-700 shadow-sm">
              {palette.label} style
            </div>
            <span
              className="absolute right-5 top-5 size-8 rounded-full border-[3px] border-white shadow-[0_10px_24px_-16px_rgba(91,63,63,0.8)]"
              style={{ backgroundColor: palette.color }}
            />
            <KeeperAvatarPreview
              bodyId={bodyId}
              characterId={characterId}
              className="relative mx-auto mt-10 h-56 w-auto object-contain drop-shadow-[0_18px_22px_rgba(91,63,63,0.24)]"
              hairColorId={hairColorId}
              hairStyleId={hairStyleId}
              outfitId={outfitId}
              paletteId={paletteId}
              skinId={skinId}
            />
          </div>

          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-600">
              <Palette className="size-4" /> Keeper studio
            </p>
            <h2 className="mt-1 font-display text-3xl text-ink-900">Design your playable keeper</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-ink-700">
              Choose the human avatar other players see walking through rooms, gardens, parties, and games. Your email
              and real name stay private.
            </p>

            <div className="mt-4 grid gap-2 rounded-2xl border border-white/70 bg-white/55 p-3 shadow-sm sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-ink-500">Body</p>
                <p className="mt-1 font-display text-lg text-ink-900">
                  {KEEPER_BODY_TYPES.find((item) => item.id === bodyId)?.label ?? character.label}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-ink-500">Outfit</p>
                <p className="mt-1 font-display text-lg text-ink-900">{outfit.label}</p>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-ink-500">Hair</p>
                <p className="mt-1 font-display text-lg text-ink-900">
                  {hairColor.label} {hairStyle.label.toLowerCase()}
                </p>
              </div>
            </div>

            <p className="mt-4 flex items-center gap-2 rounded-full border border-garden-200 bg-garden-100/70 px-3 py-2 text-xs font-black text-garden-800">
              <CheckCircle2 className="size-4" /> {notice}
            </p>
          </div>
        </div>

        <div className="relative grid gap-4 border-t border-white/70 bg-white/42 p-5">
          <section className="rounded-2xl border border-cream-300/80 bg-cream-50/70 p-3">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-ink-500">
              <Sparkles className="size-3.5" /> Starting looks
            </p>
            <p className="mt-1 text-xs font-bold leading-5 text-ink-600">
              Pick a finished look as a starting point, then change body, outfit, skin, hair, and colors independently.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KEEPER_CHARACTER_PRESETS.map((item) => (
                <button
                  aria-pressed={characterId === item.id}
                  className={`group rounded-2xl border p-2 text-left transition ${
                    characterId === item.id
                      ? "border-blush-300 bg-blush-100/80 shadow-sm"
                      : "border-cream-300 bg-white/75 hover:border-blush-200 hover:bg-white"
                  }`}
                  key={item.id}
                  onClick={() => chooseCharacter(item)}
                  type="button"
                >
                  <span className="block rounded-xl bg-white/70 p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      className="mx-auto h-24 w-auto object-contain drop-shadow-[0_10px_16px_rgba(91,63,63,0.18)]"
                      src={item.image}
                    />
                  </span>
                  <span className="mt-2 block text-xs font-black text-ink-900">{item.shortLabel}</span>
                  <span className="mt-0.5 block text-[10px] font-bold leading-4 text-ink-500">{item.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
            <section className="rounded-2xl border border-cream-300/80 bg-cream-50/70 p-3">
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-ink-500">
                <UserRound className="size-3.5" /> Body type
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {KEEPER_BODY_TYPES.map((item) => (
                  <button
                    aria-pressed={bodyId === item.id}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                      bodyId === item.id
                        ? "border-blush-300 bg-blush-100 text-ink-900 shadow-sm"
                        : "border-cream-300 bg-white/75 text-ink-700 hover:border-blush-200"
                    }`}
                    key={item.id}
                    onClick={() => updateKeeper({ bodyId: item.id })}
                    type="button"
                  >
                    <UserRound className="size-3" /> {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-cream-300/80 bg-cream-50/70 p-3">
              <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-ink-500">
                <Shirt className="size-3.5" /> Outfits
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {KEEPER_OUTFITS.map((item) => (
                  <button
                    aria-pressed={outfitId === item.id}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                      outfitId === item.id
                        ? "border-blush-300 bg-blush-100 text-ink-900 shadow-sm"
                        : "border-cream-300 bg-white/75 text-ink-700 hover:border-blush-200"
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
            </section>
          </div>

          <section className="grid gap-3 rounded-2xl border border-cream-300/80 bg-cream-50/70 p-3">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-ink-500">
              <Scissors className="size-3.5" /> Skin, hair, and style details
            </p>
            <div className="grid gap-4 xl:grid-cols-3">
              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-ink-500">Skin tone</p>
                <div className="flex flex-wrap gap-2">
                  {KEEPER_SKIN_TONES.map((item) => (
                    <button
                      aria-label={`Set skin tone to ${item.label}`}
                      aria-pressed={skinId === item.id}
                      className={`size-9 rounded-full border-[3px] transition ${
                        skinId === item.id ? "border-ink-900 shadow-sm" : "border-white hover:border-cream-300"
                      }`}
                      key={item.id}
                      onClick={() => updateKeeper({ skinId: item.id })}
                      style={{ backgroundColor: item.color }}
                      type="button"
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-ink-500">Hair style</p>
                <div className="flex flex-wrap gap-2">
                  {KEEPER_HAIR_STYLES.map((item) => (
                    <button
                      aria-pressed={hairStyleId === item.id}
                      className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                        hairStyleId === item.id
                          ? "border-garden-300 bg-garden-100 text-ink-900 shadow-sm"
                          : "border-cream-300 bg-white/75 text-ink-700 hover:border-garden-200"
                      }`}
                      key={item.id}
                      onClick={() => updateKeeper({ hairStyleId: item.id })}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-ink-500">Hair color</p>
                <div className="flex flex-wrap gap-2">
                  {KEEPER_HAIR_COLORS.map((item) => (
                    <button
                      aria-label={`Set hair color to ${item.label}`}
                      aria-pressed={hairColorId === item.id}
                      className={`size-9 rounded-full border-[3px] transition ${
                        hairColorId === item.id ? "border-ink-900 shadow-sm" : "border-white hover:border-cream-300"
                      }`}
                      key={item.id}
                      onClick={() => updateKeeper({ hairColorId: item.id })}
                      style={{ backgroundColor: item.color }}
                      type="button"
                    />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-ink-500">Signature palette</p>
              <div className="flex flex-wrap gap-2">
                {KEEPER_PALETTES.map((item) => (
                  <button
                    aria-label={`Set keeper palette to ${item.label}`}
                    aria-pressed={paletteId === item.id}
                    className={`size-9 rounded-full border-[3px] transition ${
                      paletteId === item.id ? "border-ink-900 shadow-sm" : "border-white hover:border-cream-300"
                    }`}
                    key={item.id}
                    onClick={() => updateKeeper({ paletteId: item.id })}
                    style={{ backgroundColor: item.color }}
                    type="button"
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </CozyCard>
  );
}
