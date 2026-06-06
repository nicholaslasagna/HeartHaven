"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Palette, Sparkles } from "lucide-react";
import { KeeperAvatarPreview } from "@/components/cozy/keeper-avatar-preview";
import { CozyCard } from "@/components/cozy/cozy-card";
import {
  KEEPER_CHARACTER_PRESETS,
  getKeeperCharacterPreset,
  getKeeperPalette,
  keeperCustomizationFromPreset,
  loadKeeperCustomizationFromServer,
  readKeeperCustomization,
  saveKeeperCustomizationToServer,
  writeKeeperCustomization,
  type KeeperCharacterId,
  type KeeperCustomization,
} from "@/lib/game/avatar-customization";

export function KeeperCustomizerCard() {
  const keeperRef = useRef<KeeperCustomization>(keeperCustomizationFromPreset("rose-waves"));
  const [characterId, setCharacterId] = useState<KeeperCharacterId>("rose-waves");
  const [notice, setNotice] = useState("Choose one finished keeper. This is what friends see in rooms, gardens, and games.");
  const saveSequenceRef = useRef(0);
  const character = getKeeperCharacterPreset(characterId);
  const palette = getKeeperPalette(character.paletteId);

  function applyKeeperCustomization(customization: KeeperCustomization) {
    const presetCustomization = keeperCustomizationFromPreset(customization.characterId);
    keeperRef.current = presetCustomization;
    setCharacterId(presetCustomization.characterId);
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      applyKeeperCustomization(readKeeperCustomization());
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
      setNotice(
        result.ok
          ? "Saved. Your keeper updates across rooms, gardens, and multiplayer visits."
          : `Could not save: ${result.reason}`,
      );
    });
  }

  function chooseCharacter(nextCharacterId: KeeperCharacterId) {
    const customization = keeperCustomizationFromPreset(nextCharacterId);
    applyKeeperCustomization(customization);
    writeKeeperCustomization(customization);
    persistKeeper(customization);
  }

  return (
    <CozyCard className="overflow-hidden p-0">
      <div className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.94),transparent_28%),radial-gradient(circle_at_84%_8%,rgba(222,205,239,0.72),transparent_30%),linear-gradient(135deg,rgba(255,252,243,0.96),rgba(251,217,220,0.68)_48%,rgba(210,232,199,0.42))]" />
        <div className="relative grid gap-5 p-5 xl:grid-cols-[240px_1fr]">
          <div className="relative min-h-[284px] overflow-hidden rounded-[28px] border border-white/80 bg-white/52 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_22px_45px_-34px_rgba(91,63,63,0.75)]">
            <div className="absolute inset-x-8 bottom-9 h-7 rounded-full bg-ink-900/15 blur-[2px]" />
            <div className="absolute left-5 top-5 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-[11px] font-black uppercase tracking-normal text-ink-700 shadow-sm">
              {character.shortLabel} keeper
            </div>
            <span
              className="absolute right-5 top-5 size-8 rounded-full border-[3px] border-white shadow-[0_10px_24px_-16px_rgba(91,63,63,0.8)]"
              style={{ backgroundColor: palette.color }}
            />
            <KeeperAvatarPreview
              bodyId={character.bodyId}
              characterId={character.id}
              className="relative mx-auto mt-11 h-60 w-auto object-contain drop-shadow-[0_18px_22px_rgba(91,63,63,0.24)]"
              hairColorId={character.hairColorId}
              hairStyleId={character.hairStyleId}
              outfitId={character.outfitId}
              paletteId={character.paletteId}
              skinId={character.skinId}
            />
          </div>

          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-600">
              <Palette className="size-4" /> Keeper studio
            </p>
            <h2 className="mt-1 font-display text-3xl text-ink-900">Choose your playable keeper</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-ink-700">
              Pick one finished avatar with complete art direction, outfit, hair, and skin tone already authored. Your
              email and real name stay private.
            </p>

            <div className="mt-4 grid gap-2 rounded-2xl border border-white/70 bg-white/55 p-3 shadow-sm sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-ink-500">Keeper</p>
                <p className="mt-1 font-display text-lg text-ink-900">{character.label}</p>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-ink-500">Style</p>
                <p className="mt-1 font-display text-lg text-ink-900">{palette.label}</p>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-normal text-ink-500">Shown to friends</p>
                <p className="mt-1 font-display text-lg text-ink-900">Rooms + games</p>
              </div>
            </div>

            <p className="mt-4 flex items-center gap-2 rounded-full border border-garden-200 bg-garden-100/70 px-3 py-2 text-xs font-black text-garden-800">
              <CheckCircle2 className="size-4" /> {notice}
            </p>
          </div>
        </div>

        <section className="relative border-t border-white/70 bg-white/42 p-5">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-ink-500">
            <Sparkles className="size-3.5" /> Finished keeper lineup
          </p>
          <p className="mt-1 text-xs font-bold leading-5 text-ink-600">
            These are no longer mix-and-match placeholders. Each keeper uses a dedicated animated preset sheet for idle,
            walking, sitting, waving, and heart poses.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {KEEPER_CHARACTER_PRESETS.map((item) => (
              <button
                aria-pressed={characterId === item.id}
                className={`group rounded-[22px] border p-3 text-left transition ${
                  characterId === item.id
                    ? "border-blush-300 bg-blush-100/80 shadow-sm"
                    : "border-cream-300 bg-white/75 hover:border-blush-200 hover:bg-white"
                }`}
                key={item.id}
                onClick={() => chooseCharacter(item.id)}
                type="button"
              >
                <span className="block rounded-2xl bg-white/70 p-1">
                  <KeeperAvatarPreview
                    bodyId={item.bodyId}
                    characterId={item.id}
                    className="mx-auto h-28 w-auto object-contain drop-shadow-[0_10px_16px_rgba(91,63,63,0.18)]"
                    hairColorId={item.hairColorId}
                    hairStyleId={item.hairStyleId}
                    outfitId={item.outfitId}
                    paletteId={item.paletteId}
                    pose={characterId === item.id ? "wave" : "idle"}
                    skinId={item.skinId}
                  />
                </span>
                <span className="mt-2 block text-xs font-black text-ink-900">{item.label}</span>
                <span className="mt-0.5 block text-[10px] font-bold leading-4 text-ink-500">{item.description}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </CozyCard>
  );
}
