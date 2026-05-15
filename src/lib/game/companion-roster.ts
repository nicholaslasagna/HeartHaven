"use client";

import {
  getPetAccessory,
  getPetSpecies,
  normalizePetAccessory,
  normalizePetSpecies,
  normalizePetTone,
  readPetCustomization,
  writePetCustomization,
  type PetAccessoryId,
  type PetSpeciesId,
  type PetToneId,
} from "@/lib/game/avatar-customization";
import { readPlayerProgression } from "@/lib/game/progression-store";

export const COMPANION_ROSTER_KEY = "hearthaven:companion-roster";
export const COMPANION_ROSTER_EVENT = "hearthaven:companion-roster-changed";

export type CompanionRecord = {
  id: string;
  name: string;
  speciesId: PetSpeciesId;
  toneId: PetToneId;
  accessory: PetAccessoryId;
  adoptedAt: string;
  active: boolean;
};

export type CompanionRosterState = {
  companions: CompanionRecord[];
  activeId: string;
};

function normalizeName(value: string | null | undefined, fallback = "Casper") {
  const cleaned = String(value ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
  return cleaned || fallback;
}

function starterCompanion(): CompanionRecord {
  const current = readPetCustomization();
  const name = typeof window === "undefined" ? "Casper" : window.localStorage.getItem("hearthaven:pet-name") ?? "Casper";
  return {
    id: "companion-casper",
    name: normalizeName(name),
    speciesId: current.speciesId,
    toneId: current.toneId,
    accessory: current.accessory,
    adoptedAt: new Date().toISOString(),
    active: true,
  };
}

function rawRead(): CompanionRosterState {
  if (typeof window === "undefined") {
    const starter = starterCompanion();
    return { companions: [starter], activeId: starter.id };
  }

  try {
    const raw = window.localStorage.getItem(COMPANION_ROSTER_KEY);
    if (!raw) {
      const starter = starterCompanion();
      const state = { companions: [starter], activeId: starter.id };
      rawWrite(state);
      return state;
    }
    const parsed = JSON.parse(raw) as Partial<CompanionRosterState>;
    const companions = Array.isArray(parsed.companions)
      ? parsed.companions.map((companion, index) => ({
        id: typeof companion.id === "string" ? companion.id : `companion-${index}`,
        name: normalizeName(companion.name, `Companion ${index + 1}`),
        speciesId: normalizePetSpecies(companion.speciesId),
        toneId: normalizePetTone(companion.toneId),
        accessory: normalizePetAccessory(companion.accessory),
        adoptedAt: typeof companion.adoptedAt === "string" ? companion.adoptedAt : new Date().toISOString(),
        active: Boolean(companion.active),
      }))
      : [];
    const fallback = starterCompanion();
    const safeCompanions = companions.length > 0 ? companions : [fallback];
    const activeId =
      typeof parsed.activeId === "string" && safeCompanions.some((companion) => companion.id === parsed.activeId)
        ? parsed.activeId
        : safeCompanions[0].id;
    return {
      companions: safeCompanions.map((companion) => ({ ...companion, active: companion.id === activeId })),
      activeId,
    };
  } catch {
    const starter = starterCompanion();
    return { companions: [starter], activeId: starter.id };
  }
}

function rawWrite(state: CompanionRosterState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COMPANION_ROSTER_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(COMPANION_ROSTER_EVENT, { detail: state }));
}

function activatePet(companion: CompanionRecord) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("hearthaven:pet-name", companion.name);
  writePetCustomization({
    speciesId: companion.speciesId,
    toneId: companion.toneId,
    accessory: companion.accessory,
  });
}

export function getCompanionRoster(): CompanionRosterState {
  return rawRead();
}

export function getActiveCompanion(state: CompanionRosterState = rawRead()) {
  return state.companions.find((companion) => companion.id === state.activeId) ?? state.companions[0];
}

export function adoptCompanion(input: {
  name: string;
  speciesId: PetSpeciesId;
  toneId: PetToneId;
  accessory: PetAccessoryId;
}): { ok: true; companion: CompanionRecord; state: CompanionRosterState } | { ok: false; reason: "cap" } {
  const state = rawRead();
  const cap = readPlayerProgression().companionCap;
  if (state.companions.length >= cap) return { ok: false, reason: "cap" };

  const species = getPetSpecies(input.speciesId);
  const accessory = getPetAccessory(input.accessory);
  const companion: CompanionRecord = {
    id: `companion-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: normalizeName(input.name, species.label),
    speciesId: species.id,
    toneId: normalizePetTone(input.toneId),
    accessory: accessory.id,
    adoptedAt: new Date().toISOString(),
    active: true,
  };
  const next: CompanionRosterState = {
    activeId: companion.id,
    companions: [...state.companions.map((pet) => ({ ...pet, active: false })), companion],
  };
  rawWrite(next);
  activatePet(companion);
  return { ok: true, companion, state: next };
}

export function selectCompanion(id: string) {
  const state = rawRead();
  const selected = state.companions.find((companion) => companion.id === id);
  if (!selected) return null;
  const next: CompanionRosterState = {
    activeId: selected.id,
    companions: state.companions.map((companion) => ({ ...companion, active: companion.id === selected.id })),
  };
  rawWrite(next);
  activatePet(selected);
  return selected;
}

export function renameCompanion(id: string, name: string) {
  const state = rawRead();
  const next: CompanionRosterState = {
    ...state,
    companions: state.companions.map((companion) =>
      companion.id === id ? { ...companion, name: normalizeName(name, companion.name) } : companion,
    ),
  };
  rawWrite(next);
  const active = getActiveCompanion(next);
  if (active?.id === id) activatePet(active);
  return next.companions.find((companion) => companion.id === id) ?? null;
}
