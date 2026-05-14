"use client";

import type { RealtimeRoomPlayer } from "@/lib/game/types";

export type KeeperBodyId = "female" | "male";
export type KeeperSkinId = "fair" | "warm" | "tan" | "deep";
export type KeeperHairStyleId = "long-waves" | "soft-curls" | "braids" | "side-part";
export type KeeperHairColorId = "chestnut" | "black" | "auburn" | "blonde" | "lavender";
export type KeeperPaletteId = "blush" | "lavender" | "garden" | "honey" | "sky";
export type KeeperOutfitId = "cardigan" | "overalls" | "cape" | "sweater";
export type KeeperPose = "idle" | "walk1" | "walk2" | "sit" | "wave" | "heart";

export type PetSpeciesId = "fox" | "bunny" | "bear" | "duck" | "kitten";
export type PetToneId = "cream" | "blush" | "lavender" | "honey" | "sky" | "mint";
export type PetAccessoryId = "moonberry-bow" | "lantern-scarf" | "garden-crown" | "heart-vest";
export type PetPose = "idle" | "walk1" | "walk2" | "sit" | "sleep" | "happy";

export type KeeperCustomization = {
  bodyId: KeeperBodyId;
  skinId: KeeperSkinId;
  hairStyleId: KeeperHairStyleId;
  hairColorId: KeeperHairColorId;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
};

export type PetCustomization = {
  speciesId: PetSpeciesId;
  toneId: PetToneId;
  accessory: PetAccessoryId;
};

export const KEEPER_BODY_TYPES: Array<{ id: KeeperBodyId; label: string; frameBlock: number }> = [
  { id: "female", label: "Feminine", frameBlock: 0 },
  { id: "male", label: "Masculine", frameBlock: 1 },
];

export const KEEPER_SKIN_TONES: Array<{ id: KeeperSkinId; label: string; color: string }> = [
  { id: "fair", label: "Fair", color: "#F8CBAE" },
  { id: "warm", label: "Warm", color: "#DFA276" },
  { id: "tan", label: "Tan", color: "#B8734F" },
  { id: "deep", label: "Deep", color: "#7A4837" },
];

export const KEEPER_HAIR_STYLES: Array<{ id: KeeperHairStyleId; label: string }> = [
  { id: "long-waves", label: "Long waves" },
  { id: "soft-curls", label: "Soft curls" },
  { id: "braids", label: "Braids" },
  { id: "side-part", label: "Side part" },
];

export const KEEPER_HAIR_COLORS: Array<{ id: KeeperHairColorId; label: string; color: string }> = [
  { id: "chestnut", label: "Chestnut", color: "#8B4B2C" },
  { id: "black", label: "Black", color: "#2D211E" },
  { id: "auburn", label: "Auburn", color: "#A45132" },
  { id: "blonde", label: "Blonde", color: "#D9AE63" },
  { id: "lavender", label: "Lavender", color: "#9D84C8" },
];

export const KEEPER_PALETTES: Array<{ id: KeeperPaletteId; label: string; color: string }> = [
  { id: "blush", label: "Blush", color: "#D87E8C" },
  { id: "lavender", label: "Lavender", color: "#8E70BD" },
  { id: "garden", label: "Garden", color: "#6E9651" },
  { id: "honey", label: "Honey", color: "#D9A53E" },
  { id: "sky", label: "Sky", color: "#5E94B0" },
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

export const PET_ACCESSORIES: Array<{
  id: PetAccessoryId;
  label: string;
  frame: number;
  width: number;
  height: number;
  x: number;
  y: number;
}> = [
  { id: "moonberry-bow", label: "Moonberry bow", frame: 0, width: 48, height: 48, x: 0, y: -80 },
  { id: "lantern-scarf", label: "Lantern scarf", frame: 1, width: 50, height: 50, x: 1, y: -62 },
  { id: "garden-crown", label: "Garden crown", frame: 2, width: 58, height: 40, x: 0, y: -86 },
  { id: "heart-vest", label: "Heart vest", frame: 3, width: 64, height: 54, x: 0, y: -54 },
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

export function keeperFrame(
  _paletteId: KeeperPaletteId,
  pose: KeeperPose,
  outfitId: KeeperOutfitId = "cardigan",
  bodyId: KeeperBodyId = "female",
) {
  const bodyBlock = KEEPER_BODY_TYPES.find((body) => body.id === bodyId)?.frameBlock ?? 0;
  const outfitRow = Math.max(0, KEEPER_OUTFITS.findIndex((outfit) => outfit.id === outfitId));
  const row = bodyBlock * KEEPER_OUTFITS.length + outfitRow;
  return row * 6 + keeperPoseColumns[pose];
}

export function petFrame(speciesId: PetSpeciesId, pose: PetPose) {
  const row = PET_SPECIES.find((species) => species.id === speciesId)?.frameRow ?? 0;
  return row * 6 + petPoseColumns[pose];
}

export function petAccessoryFrame(accessory: PetAccessoryId) {
  return getPetAccessory(accessory).frame;
}

export function readKeeperCustomization(): KeeperCustomization {
  if (typeof window === "undefined") {
    return {
      bodyId: "female",
      skinId: "fair",
      hairStyleId: "long-waves",
      hairColorId: "chestnut",
      paletteId: "blush",
      outfitId: "cardigan",
    };
  }
  const bodyId = normalizeKeeperBody(window.localStorage.getItem("hearthaven:keeper-body-id"));
  const skinId = normalizeKeeperSkin(window.localStorage.getItem("hearthaven:keeper-skin-id"));
  const hairStyleId = normalizeKeeperHairStyle(window.localStorage.getItem("hearthaven:keeper-hair-style-id"));
  const hairColorId = normalizeKeeperHairColor(window.localStorage.getItem("hearthaven:keeper-hair-color-id"));
  const paletteId = normalizeKeeperPalette(window.localStorage.getItem("hearthaven:keeper-palette-id"));
  const outfitId = normalizeKeeperOutfit(window.localStorage.getItem("hearthaven:keeper-outfit-id"));
  return { bodyId, skinId, hairStyleId, hairColorId, paletteId, outfitId };
}

export function writeKeeperCustomization(customization: KeeperCustomization) {
  window.localStorage.setItem("hearthaven:keeper-body-id", customization.bodyId);
  window.localStorage.setItem("hearthaven:keeper-skin-id", customization.skinId);
  window.localStorage.setItem("hearthaven:keeper-hair-style-id", customization.hairStyleId);
  window.localStorage.setItem("hearthaven:keeper-hair-color-id", customization.hairColorId);
  window.localStorage.setItem("hearthaven:keeper-palette-id", customization.paletteId);
  window.localStorage.setItem("hearthaven:keeper-palette", getKeeperPalette(customization.paletteId).color);
  window.localStorage.setItem("hearthaven:keeper-outfit-id", customization.outfitId);
  window.dispatchEvent(new CustomEvent(KEEPER_CUSTOMIZATION_EVENT, { detail: customization }));
}

export function readPetCustomization(): PetCustomization {
  if (typeof window === "undefined") return { speciesId: "fox", toneId: "cream", accessory: "moonberry-bow" };
  const speciesId = normalizePetSpecies(window.localStorage.getItem("hearthaven:pet-species-id") ?? window.localStorage.getItem("hearthaven:pet-type"));
  const toneId = normalizePetTone(window.localStorage.getItem("hearthaven:pet-tone-id") ?? window.localStorage.getItem("hearthaven:pet-tone"));
  const accessory = normalizePetAccessory(window.localStorage.getItem("hearthaven:pet-accessory"));
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
    bodyId: keeper.bodyId,
    skinId: keeper.skinId,
    hairStyleId: keeper.hairStyleId,
    hairColorId: keeper.hairColorId,
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
  bodyId: KeeperBodyId;
  skinId: KeeperSkinId;
  hairStyleId: KeeperHairStyleId;
  hairColorId: KeeperHairColorId;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  petSpeciesId: PetSpeciesId;
  petToneId: PetToneId;
  petAccessoryId: PetAccessoryId;
} {
  const paletteId: KeeperPaletteId = KEEPER_PALETTES.some((palette) => palette.id === player.paletteId)
    ? (player.paletteId as KeeperPaletteId)
    : keeperPaletteIdFromColor(player.color);
  const outfitId: KeeperOutfitId = KEEPER_OUTFITS.some((outfit) => outfit.id === player.outfitId)
    ? (player.outfitId as KeeperOutfitId)
    : "cardigan";
  const bodyId = normalizeKeeperBody(player.bodyId);
  const skinId = normalizeKeeperSkin(player.skinId);
  const hairStyleId = normalizeKeeperHairStyle(player.hairStyleId);
  const hairColorId = normalizeKeeperHairColor(player.hairColorId);
  const petSpeciesId: PetSpeciesId = PET_SPECIES.some((species) => species.id === player.petSpeciesId)
    ? (player.petSpeciesId as PetSpeciesId)
    : "fox";
  const petToneId: PetToneId = PET_TONES.some((tone) => tone.id === player.petToneId)
    ? (player.petToneId as PetToneId)
    : "cream";
  const petAccessoryId = normalizePetAccessory(player.petAccessory);
  return { bodyId, skinId, hairStyleId, hairColorId, paletteId, outfitId, petSpeciesId, petToneId, petAccessoryId };
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

export function getPetAccessory(id: PetAccessoryId) {
  return PET_ACCESSORIES.find((accessory) => accessory.id === id) ?? PET_ACCESSORIES[0];
}

function normalizeKeeperPalette(value: string | null): KeeperPaletteId {
  return KEEPER_PALETTES.some((palette) => palette.id === value) ? (value as KeeperPaletteId) : "blush";
}

function normalizeKeeperBody(value: string | null | undefined): KeeperBodyId {
  return KEEPER_BODY_TYPES.some((body) => body.id === value) ? (value as KeeperBodyId) : "female";
}

function normalizeKeeperSkin(value: string | null | undefined): KeeperSkinId {
  return KEEPER_SKIN_TONES.some((skin) => skin.id === value) ? (value as KeeperSkinId) : "fair";
}

function normalizeKeeperHairStyle(value: string | null | undefined): KeeperHairStyleId {
  return KEEPER_HAIR_STYLES.some((hair) => hair.id === value) ? (value as KeeperHairStyleId) : "long-waves";
}

function normalizeKeeperHairColor(value: string | null | undefined): KeeperHairColorId {
  return KEEPER_HAIR_COLORS.some((hair) => hair.id === value) ? (value as KeeperHairColorId) : "chestnut";
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

function normalizePetAccessory(value: string | null | undefined): PetAccessoryId {
  if (PET_ACCESSORIES.some((accessory) => accessory.id === value)) return value as PetAccessoryId;
  const fromLabel = PET_ACCESSORIES.find((accessory) => accessory.label.toLowerCase() === value?.toLowerCase());
  return fromLabel?.id ?? "moonberry-bow";
}
