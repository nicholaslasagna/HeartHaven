"use client";

import type { RealtimeRoomPlayer } from "@/lib/game/types";

export type KeeperPaletteId = "blush" | "lavender" | "garden" | "honey" | "sky";
export type KeeperOutfitId = "cardigan" | "overalls" | "cape" | "sweater";
export type KeeperPose = "idle" | "walk1" | "walk2" | "sit" | "wave" | "heart";

export type PetSpeciesId = "fox" | "bunny" | "bear" | "duck" | "kitten";
export type PetToneId = "cream" | "blush" | "lavender" | "honey" | "sky" | "mint";
export type PetPose = "idle" | "walk1" | "walk2" | "sit" | "sleep" | "happy";

export type KeeperCustomization = {
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
};

export type PetCustomization = {
  speciesId: PetSpeciesId;
  toneId: PetToneId;
  accessory: string;
};

export const KEEPER_PALETTES: Array<{ id: KeeperPaletteId; label: string; color: string; frameRow: number }> = [
  { id: "blush", label: "Blush", color: "#D87E8C", frameRow: 0 },
  { id: "lavender", label: "Lavender", color: "#8E70BD", frameRow: 1 },
  { id: "garden", label: "Garden", color: "#6E9651", frameRow: 2 },
  { id: "honey", label: "Honey", color: "#D9A53E", frameRow: 3 },
  { id: "sky", label: "Sky", color: "#5E94B0", frameRow: 4 },
];

export const KEEPER_OUTFITS: Array<{ id: KeeperOutfitId; label: string }> = [
  { id: "cardigan", label: "Cozy cardigan" },
  { id: "overalls", label: "Garden overalls" },
  { id: "cape", label: "Moonlit cape" },
  { id: "sweater", label: "Party sweater" },
];

export const PET_SPECIES: Array<{ id: PetSpeciesId; label: string; frameRow: number }> = [
  { id: "fox", label: "Cloud Fox", frameRow: 0 },
  { id: "bunny", label: "Moonberry Fox", frameRow: 1 },
  { id: "bear", label: "Honey Fox", frameRow: 2 },
  { id: "duck", label: "Sky Fox", frameRow: 3 },
  { id: "kitten", label: "Garden Fox", frameRow: 4 },
];

export const PET_TONES: Array<{ id: PetToneId; label: string; color: string }> = [
  { id: "cream", label: "Cream", color: "#FFFCF3" },
  { id: "blush", label: "Blush", color: "#FBD9DC" },
  { id: "lavender", label: "Lavender", color: "#DECDEF" },
  { id: "honey", label: "Honey", color: "#FBE6B6" },
  { id: "sky", label: "Sky", color: "#C9E1ED" },
  { id: "mint", label: "Mint", color: "#D2E8C7" },
];

const keeperPoseColumns: Record<KeeperPose, number> = {
  idle: 0,
  walk1: 1,
  walk2: 2,
  sit: 3,
  wave: 4,
  heart: 5,
};

const petPoseColumns: Record<PetPose, number> = {
  idle: 0,
  walk1: 1,
  walk2: 2,
  sit: 3,
  sleep: 4,
  happy: 5,
};

export const KEEPER_CUSTOMIZATION_EVENT = "hearthaven:avatar-customization-changed";
export const PET_CUSTOMIZATION_EVENT = "hearthaven:pet-customization-changed";

export function keeperFrame(paletteId: KeeperPaletteId, pose: KeeperPose, outfitId: KeeperOutfitId = "cardigan") {
  const paletteRow = KEEPER_PALETTES.find((palette) => palette.id === paletteId)?.frameRow ?? 0;
  const outfitRow = Math.max(0, KEEPER_OUTFITS.findIndex((outfit) => outfit.id === outfitId));
  const row = paletteRow * KEEPER_OUTFITS.length + outfitRow;
  return row * 6 + keeperPoseColumns[pose];
}

export function petFrame(speciesId: PetSpeciesId, pose: PetPose) {
  const row = PET_SPECIES.find((species) => species.id === speciesId)?.frameRow ?? 0;
  return row * 6 + petPoseColumns[pose];
}

export function readKeeperCustomization(): KeeperCustomization {
  if (typeof window === "undefined") return { paletteId: "blush", outfitId: "cardigan" };
  const paletteId = normalizeKeeperPalette(window.localStorage.getItem("hearthaven:keeper-palette-id"));
  const outfitId = normalizeKeeperOutfit(window.localStorage.getItem("hearthaven:keeper-outfit-id"));
  return { paletteId, outfitId };
}

export function writeKeeperCustomization(customization: KeeperCustomization) {
  window.localStorage.setItem("hearthaven:keeper-palette-id", customization.paletteId);
  window.localStorage.setItem("hearthaven:keeper-palette", getKeeperPalette(customization.paletteId).color);
  window.localStorage.setItem("hearthaven:keeper-outfit-id", customization.outfitId);
  window.dispatchEvent(new CustomEvent(KEEPER_CUSTOMIZATION_EVENT, { detail: customization }));
}

export function readPetCustomization(): PetCustomization {
  if (typeof window === "undefined") return { speciesId: "fox", toneId: "cream", accessory: "Moonberry bow" };
  const speciesId = normalizePetSpecies(window.localStorage.getItem("hearthaven:pet-species-id") ?? window.localStorage.getItem("hearthaven:pet-type"));
  const toneId = normalizePetTone(window.localStorage.getItem("hearthaven:pet-tone-id") ?? window.localStorage.getItem("hearthaven:pet-tone"));
  const accessory = window.localStorage.getItem("hearthaven:pet-accessory") ?? "Moonberry bow";
  return { speciesId, toneId, accessory };
}

export function writePetCustomization(customization: PetCustomization) {
  window.localStorage.setItem("hearthaven:pet-species-id", customization.speciesId);
  window.localStorage.setItem("hearthaven:pet-type", customization.speciesId);
  window.localStorage.setItem("hearthaven:pet-tone-id", customization.toneId);
  window.localStorage.setItem("hearthaven:pet-tone", customization.toneId);
  window.localStorage.setItem("hearthaven:pet-accessory", customization.accessory);
  window.dispatchEvent(new CustomEvent(PET_CUSTOMIZATION_EVENT, { detail: customization }));
}

/**
 * The customization slice of a multiplayer presence payload, read live from
 * localStorage. Both the room and garden realtime hooks call this so a
 * visiting keeper always broadcasts their real palette + outfit and their
 * real pet species + fur tone + accessory. Pure read — safe to call anytime.
 */
export function readPresenceCustomization() {
  const keeper = readKeeperCustomization();
  const pet = readPetCustomization();
  const petName =
    typeof window === "undefined" ? "Casper" : window.localStorage.getItem("hearthaven:pet-name") ?? "Casper";
  return {
    color: getKeeperPalette(keeper.paletteId).color,
    paletteId: keeper.paletteId,
    outfitId: keeper.outfitId,
    petName,
    petSpeciesId: pet.speciesId,
    petToneId: pet.toneId,
    petAccessory: pet.accessory,
  };
}

export function getKeeperPalette(id: KeeperPaletteId) {
  return KEEPER_PALETTES.find((palette) => palette.id === id) ?? KEEPER_PALETTES[0];
}

export function keeperPaletteIdFromColor(color: string): KeeperPaletteId {
  const normalized = color.toLowerCase();
  return KEEPER_PALETTES.find((palette) => palette.color.toLowerCase() === normalized)?.id ?? "lavender";
}

/**
 * Coerce a remote player's presence payload (loosely-typed strings) into the
 * strict customization unions used to pick sprite frames. Old clients that
 * only sent `color` still resolve to a valid palette + sensible defaults, so
 * a visiting keeper never renders as a broken frame.
 */
export function normalizeRemoteCustomization(player: RealtimeRoomPlayer): {
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  petSpeciesId: PetSpeciesId;
  petToneId: PetToneId;
} {
  const paletteId: KeeperPaletteId = KEEPER_PALETTES.some((palette) => palette.id === player.paletteId)
    ? (player.paletteId as KeeperPaletteId)
    : keeperPaletteIdFromColor(player.color);
  const outfitId: KeeperOutfitId = KEEPER_OUTFITS.some((outfit) => outfit.id === player.outfitId)
    ? (player.outfitId as KeeperOutfitId)
    : "cardigan";
  const petSpeciesId: PetSpeciesId = PET_SPECIES.some((species) => species.id === player.petSpeciesId)
    ? (player.petSpeciesId as PetSpeciesId)
    : "fox";
  const petToneId: PetToneId = PET_TONES.some((tone) => tone.id === player.petToneId)
    ? (player.petToneId as PetToneId)
    : "cream";
  return { paletteId, outfitId, petSpeciesId, petToneId };
}

export function getKeeperOutfit(id: KeeperOutfitId) {
  return KEEPER_OUTFITS.find((outfit) => outfit.id === id) ?? KEEPER_OUTFITS[0];
}

export function getPetSpecies(id: PetSpeciesId) {
  return PET_SPECIES.find((species) => species.id === id) ?? PET_SPECIES[0];
}

export function getPetTone(id: PetToneId) {
  return PET_TONES.find((tone) => tone.id === id) ?? PET_TONES[0];
}

function normalizeKeeperPalette(value: string | null): KeeperPaletteId {
  return KEEPER_PALETTES.some((palette) => palette.id === value) ? (value as KeeperPaletteId) : "blush";
}

function normalizeKeeperOutfit(value: string | null): KeeperOutfitId {
  return KEEPER_OUTFITS.some((outfit) => outfit.id === value) ? (value as KeeperOutfitId) : "cardigan";
}

function normalizePetSpecies(value: string | null): PetSpeciesId {
  return PET_SPECIES.some((species) => species.id === value) ? (value as PetSpeciesId) : "fox";
}

function normalizePetTone(value: string | null): PetToneId {
  return PET_TONES.some((tone) => tone.id === value) ? (value as PetToneId) : "cream";
}
