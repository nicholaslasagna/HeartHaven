"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { PawPrint, Plus, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ADOPTABLE_PET_SPECIES,
  PET_ACCESSORIES,
  PET_TONES,
  getPetSpecies,
  type PetAccessoryId,
  type PetSpeciesId,
  type PetToneId,
} from "@/lib/game/avatar-customization";
import {
  COMPANION_ROSTER_EVENT,
  adoptCompanion,
  getCompanionRoster,
  renameCompanion,
  selectCompanion,
  type CompanionRecord,
} from "@/lib/game/companion-roster";
import { usePlayerProgression } from "@/lib/game/use-player-progression";
import { playCozyCue } from "@/lib/game/cozy-audio";

function previewFor(companion: CompanionRecord) {
  return `/game-assets/generated/pet-art-preview-${companion.speciesId}.png`;
}

export function CompanionRosterPanel() {
  const progression = usePlayerProgression();
  const [state, setState] = useState(getCompanionRoster);
  const [newName, setNewName] = useState("Moonberry");
  const [speciesId, setSpeciesId] = useState<PetSpeciesId>("bunny");
  const [toneId, setToneId] = useState<PetToneId>("cream");
  const [accessory, setAccessory] = useState<PetAccessoryId>("moonberry-bow");
  const [notice, setNotice] = useState("Choose your active companion before entering a room or garden.");

  useEffect(() => {
    const sync = () => setState(getCompanionRoster());
    sync();
    window.addEventListener(COMPANION_ROSTER_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COMPANION_ROSTER_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const active = useMemo(
    () => state.companions.find((companion) => companion.id === state.activeId) ?? state.companions[0],
    [state],
  );
  const slotsLeft = Math.max(0, progression.companionCap - state.companions.length);

  function choose(id: string) {
    const selected = selectCompanion(id);
    if (!selected) return;
    setState(getCompanionRoster());
    setNotice(`${selected.name} is now walking with you.`);
    playCozyCue("petChirp");
  }

  function rename(id: string, name: string) {
    const renamed = renameCompanion(id, name);
    if (!renamed) return;
    setState(getCompanionRoster());
    setNotice(`${renamed.name}'s name is saved.`);
  }

  function adopt() {
    const result = adoptCompanion({ name: newName, speciesId, toneId, accessory });
    if (!result.ok) {
      setNotice(`Reach level ${(progression.companionCap + 1) * 10} to unlock another companion slot.`);
      return;
    }
    setState(result.state);
    setNewName("");
    setNotice(`${result.companion.name} joined your haven.`);
    playCozyCue("heart");
  }

  return (
    <CozyCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-500">
            <PawPrint className="size-3.5" /> Companion roster
          </p>
          <h2 className="mt-1 font-display text-3xl text-ink-900">{active?.name ?? "Companion"} is active</h2>
          <p className="mt-1 text-sm font-bold leading-6 text-ink-700">{notice}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="garden">Level {progression.level}</Badge>
          <Badge variant="outline">{state.companions.length}/{progression.companionCap} slots</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {state.companions.map((companion) => (
          <div
            className={`rounded-lg border p-3 shadow-sm ${
              companion.id === state.activeId ? "border-blush-300 bg-blush-100/60" : "border-cream-300 bg-white/70"
            }`}
            key={companion.id}
          >
            <div className="flex gap-3">
              <Image
                alt={`${companion.name} companion preview`}
                className="size-20 rounded-lg border border-white/80 bg-cream-50 object-contain"
                height={80}
                src={previewFor(companion)}
                width={80}
              />
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl text-ink-900">{companion.name}</p>
                <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">
                  {getPetSpecies(companion.speciesId).label}
                </p>
                <div className="mt-2 flex gap-2">
                  <CozyButton size="sm" variant={companion.id === state.activeId ? "warm" : "default"} onClick={() => choose(companion.id)}>
                    {companion.id === state.activeId ? "Active" : "Walk with"}
                  </CozyButton>
                </div>
              </div>
            </div>
            <Input
              aria-label={`Rename ${companion.name}`}
              className="mt-3"
              defaultValue={companion.name}
              maxLength={24}
              onBlur={(event) => rename(companion.id, event.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-garden-300/40 bg-garden-100/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-black text-ink-900">
              <Sparkles className="size-4 text-garden-700" /> Adopt another companion
            </p>
            <p className="mt-1 text-xs font-bold text-ink-600">
              One companion slot unlocks every 10 profile levels. Earn points from games, room visits, garden care, and friend time.
            </p>
          </div>
          <Badge variant={slotsLeft > 0 ? "garden" : "outline"}>{slotsLeft} open slot{slotsLeft === 1 ? "" : "s"}</Badge>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Input value={newName} maxLength={24} onChange={(event) => setNewName(event.target.value)} placeholder="Companion name" />
          <select className="rounded-md border border-cream-300 bg-white/80 px-3 py-2 text-sm font-bold text-ink-800" value={speciesId} onChange={(event) => setSpeciesId(event.target.value as PetSpeciesId)}>
            {ADOPTABLE_PET_SPECIES.map((species) => <option key={species.id} value={species.id}>{species.label}</option>)}
          </select>
          <select className="rounded-md border border-cream-300 bg-white/80 px-3 py-2 text-sm font-bold text-ink-800" value={toneId} onChange={(event) => setToneId(event.target.value as PetToneId)}>
            {PET_TONES.map((tone) => <option key={tone.id} value={tone.id}>{tone.label}</option>)}
          </select>
          <select className="rounded-md border border-cream-300 bg-white/80 px-3 py-2 text-sm font-bold text-ink-800" value={accessory} onChange={(event) => setAccessory(event.target.value as PetAccessoryId)}>
            {PET_ACCESSORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <CozyButton className="mt-3" disabled={slotsLeft <= 0} onClick={adopt}>
          <Plus /> Adopt companion
        </CozyButton>
      </div>
    </CozyCard>
  );
}
