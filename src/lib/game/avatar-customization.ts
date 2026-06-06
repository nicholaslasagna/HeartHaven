"use client";

import type { RealtimeRoomPlayer } from "@/lib/game/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type KeeperBodyId = "female" | "male";
export type KeeperSkinId = "porcelain" | "fair" | "warm" | "olive" | "tan" | "brown" | "deep" | "ebony";
export type KeeperHairStyleId =
  | "long-waves"
  | "soft-curls"
  | "braids"
  | "side-part"
  | "short-curls"
  | "locs"
  | "curly-fade"
  | "straight-bangs";
export type KeeperHairColorId =
  | "chestnut"
  | "dark-brown"
  | "black"
  | "auburn"
  | "blonde"
  | "silver"
  | "rose"
  | "lavender";
export type KeeperPaletteId = "blush" | "lavender" | "garden" | "honey" | "sky";
export type KeeperOutfitId = "cardigan" | "overalls" | "cape" | "sweater";
export type KeeperPose = "idle" | "walk1" | "walk2" | "sit" | "wave" | "heart";
export type KeeperCharacterId =
  | "rose-waves"
  | "moonlit-overalls"
  | "sage-braids"
  | "honey-curls"
  | "blush-blonde"
  | "starlight-cape"
  | "garden-bangs"
  | "clover-curls";

export type PetSpeciesId =
  | "fox"
  | "bunny"
  | "bear"
  | "duck"
  | "kitten"
  | "puppy"
  | "calico"
  | "lamb"
  | "panda"
  | "dragon"
  | "super-snails";
export type PetToneId = "cream" | "blush" | "lavender" | "honey" | "sky" | "mint";
export type PetAccessoryId = "moonberry-bow" | "lantern-scarf" | "garden-crown" | "heart-vest";
export type PetPose = "idle" | "walk1" | "walk2" | "sit" | "sleep" | "happy";

export type KeeperCustomization = {
  characterId: KeeperCharacterId;
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
  { id: "porcelain", label: "Porcelain", color: "#FFDCC6" },
  { id: "fair", label: "Fair", color: "#F8CBAE" },
  { id: "warm", label: "Warm", color: "#DFA276" },
  { id: "olive", label: "Olive", color: "#C99367" },
  { id: "tan", label: "Tan", color: "#B8734F" },
  { id: "brown", label: "Brown", color: "#965C43" },
  { id: "deep", label: "Deep", color: "#7A4837" },
  { id: "ebony", label: "Ebony", color: "#4E2F29" },
];

export const KEEPER_HAIR_STYLES: Array<{ id: KeeperHairStyleId; label: string }> = [
  { id: "long-waves", label: "Long waves" },
  { id: "soft-curls", label: "Soft curls" },
  { id: "braids", label: "Braids" },
  { id: "side-part", label: "Side part" },
  { id: "short-curls", label: "Short curls" },
  { id: "locs", label: "Locs" },
  { id: "curly-fade", label: "Curly fade" },
  { id: "straight-bangs", label: "Straight bangs" },
];

export const KEEPER_HAIR_COLORS: Array<{ id: KeeperHairColorId; label: string; color: string }> = [
  { id: "chestnut", label: "Chestnut", color: "#8B4B2C" },
  { id: "dark-brown", label: "Dark brown", color: "#4A2D23" },
  { id: "black", label: "Black", color: "#2D211E" },
  { id: "auburn", label: "Auburn", color: "#A45132" },
  { id: "blonde", label: "Blonde", color: "#D9AE63" },
  { id: "silver", label: "Silver", color: "#BFC1C8" },
  { id: "rose", label: "Rose", color: "#C06E81" },
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

export const KEEPER_CHARACTER_PRESETS: Array<{
  id: KeeperCharacterId;
  label: string;
  shortLabel: string;
  image: string;
  bodyId: KeeperBodyId;
  skinId: KeeperSkinId;
  hairStyleId: KeeperHairStyleId;
  hairColorId: KeeperHairColorId;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  description: string;
}> = [
  {
    id: "rose-waves",
    label: "Rose Waves",
    shortLabel: "Rose",
    image: "/game-assets/generated/keepers/presets/rose-waves.png",
    bodyId: "female",
    skinId: "fair",
    hairStyleId: "long-waves",
    hairColorId: "chestnut",
    paletteId: "blush",
    outfitId: "cardigan",
    description: "Long waves, cream cardigan, lavender rose garden outfit.",
  },
  {
    id: "moonlit-overalls",
    label: "Moonlit Overalls",
    shortLabel: "Moonlit",
    image: "/game-assets/generated/keepers/presets/moonlit-overalls.png",
    bodyId: "male",
    skinId: "tan",
    hairStyleId: "side-part",
    hairColorId: "chestnut",
    paletteId: "sky",
    outfitId: "overalls",
    description: "Tousled side-part hair, denim garden overalls, lavender trim.",
  },
  {
    id: "sage-braids",
    label: "Sage Braids",
    shortLabel: "Sage",
    image: "/game-assets/generated/keepers/presets/sage-braids.png",
    bodyId: "female",
    skinId: "ebony",
    hairStyleId: "braids",
    hairColorId: "dark-brown",
    paletteId: "garden",
    outfitId: "cardigan",
    description: "Braided hair with flowers, deep skin tone, sage garden cardigan.",
  },
  {
    id: "honey-curls",
    label: "Honey Curls",
    shortLabel: "Honey",
    image: "/game-assets/generated/keepers/presets/honey-curls.png",
    bodyId: "male",
    skinId: "deep",
    hairStyleId: "curly-fade",
    hairColorId: "dark-brown",
    paletteId: "honey",
    outfitId: "overalls",
    description: "Curly fade, honey hoodie, soft green overalls.",
  },
  {
    id: "blush-blonde",
    label: "Blush Blonde",
    shortLabel: "Blush",
    image: "/game-assets/generated/keepers/presets/blush-blonde.png",
    bodyId: "female",
    skinId: "porcelain",
    hairStyleId: "soft-curls",
    hairColorId: "blonde",
    paletteId: "blush",
    outfitId: "sweater",
    description: "Soft blonde curls, blush skirt, cream cardigan.",
  },
  {
    id: "starlight-cape",
    label: "Starlight Cape",
    shortLabel: "Starlight",
    image: "/game-assets/generated/keepers/presets/starlight-cape.png",
    bodyId: "male",
    skinId: "olive",
    hairStyleId: "short-curls",
    hairColorId: "black",
    paletteId: "lavender",
    outfitId: "cape",
    description: "Short black curls, warm skin tone, lavender moon cape.",
  },
  {
    id: "garden-bangs",
    label: "Garden Bangs",
    shortLabel: "Garden",
    image: "/game-assets/generated/keepers/presets/garden-bangs.png",
    bodyId: "female",
    skinId: "warm",
    hairStyleId: "straight-bangs",
    hairColorId: "black",
    paletteId: "lavender",
    outfitId: "cardigan",
    description: "Straight bangs, flower clips, lavender garden dress.",
  },
  {
    id: "clover-curls",
    label: "Clover Curls",
    shortLabel: "Clover",
    image: "/game-assets/generated/keepers/presets/clover-curls.png",
    bodyId: "male",
    skinId: "brown",
    hairStyleId: "soft-curls",
    hairColorId: "auburn",
    paletteId: "garden",
    outfitId: "sweater",
    description: "Auburn curls, clover vest, cream celebration outfit.",
  },
];

export const PET_SPECIES: Array<{ id: PetSpeciesId; label: string; frameRow: number; secret?: boolean; flying?: boolean }> = [
  { id: "fox", label: "Cloud Fox", frameRow: 0 },
  { id: "bunny", label: "Moonberry Bunny", frameRow: 1 },
  { id: "bear", label: "Honey Bear", frameRow: 2 },
  { id: "duck", label: "Sky Duck", frameRow: 3 },
  { id: "kitten", label: "Casper Cat", frameRow: 4 },
  { id: "puppy", label: "Cocoa Puppy", frameRow: 5 },
  { id: "calico", label: "Garden Calico", frameRow: 6 },
  { id: "lamb", label: "Cloud Lamb", frameRow: 7 },
  { id: "panda", label: "Moon Panda", frameRow: 8 },
  { id: "dragon", label: "Lantern Dragon", frameRow: 9 },
  { id: "super-snails", label: "Super Snails", frameRow: 10, secret: true, flying: true },
];

export const ADOPTABLE_PET_SPECIES = PET_SPECIES.filter((species) => !species.secret);

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

const GAIT_FRAME_MS = 105;

export function gaitPhase(timeMs: number) {
  return (timeMs % (GAIT_FRAME_MS * 4)) / (GAIT_FRAME_MS * 4);
}

export function keeperGaitPose(timeMs: number): KeeperPose {
  // Four-beat gait cycle: walk1 (left foot fwd) → idle (mid-stance) →
  // walk2 (right foot fwd) → idle (mid-stance). Alternating walk1 and
  // walk2 is what makes the keeper read as STEPPING rather than
  // shuffling the same frame back and forth.
  const phase = Math.floor(timeMs / GAIT_FRAME_MS) % 4;
  if (phase === 0) return "walk1";
  if (phase === 2) return "walk2";
  return "idle";
}

export function petGaitPose(timeMs: number): PetPose {
  // Same four-beat alternation for the companion so it visually
  // trots (paw-fwd, neutral, paw-fwd-other, neutral) instead of
  // bobbing in place.
  const phase = Math.floor(timeMs / GAIT_FRAME_MS) % 4;
  if (phase === 0) return "walk1";
  if (phase === 2) return "walk2";
  return "idle";
}

export const KEEPER_CUSTOMIZATION_EVENT = "hearthaven:avatar-customization-changed";
export const PET_CUSTOMIZATION_EVENT = "hearthaven:pet-customization-changed";

export function keeperPlayableTextureKey(characterId: KeeperCharacterId) {
  return `keeper-preset-${characterId}`;
}

export function keeperPlayableTexturePath(characterId: KeeperCharacterId) {
  return getKeeperCharacterPreset(characterId).image;
}

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

export function keeperSkinFrame(pose: KeeperPose, outfitId: KeeperOutfitId = "cardigan", bodyId: KeeperBodyId = "female") {
  return keeperFrame("blush", pose, outfitId, bodyId);
}

export function keeperHairFrame(hairStyleId: KeeperHairStyleId, pose: KeeperPose, bodyId: KeeperBodyId = "female") {
  const bodyBlock = KEEPER_BODY_TYPES.find((body) => body.id === bodyId)?.frameBlock ?? 0;
  const hairRow = Math.max(0, KEEPER_HAIR_STYLES.findIndex((hair) => hair.id === hairStyleId));
  const row = bodyBlock * KEEPER_HAIR_STYLES.length + hairRow;
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
      characterId: "rose-waves",
      skinId: "fair",
      hairStyleId: "long-waves",
      hairColorId: "chestnut",
      paletteId: "blush",
      outfitId: "cardigan",
    };
  }
  const bodyId = normalizeKeeperBody(window.localStorage.getItem("hearthaven:keeper-body-id"));
  const characterId = normalizeKeeperCharacter(window.localStorage.getItem("hearthaven:keeper-character-id"));
  const skinId = normalizeKeeperSkin(window.localStorage.getItem("hearthaven:keeper-skin-id"));
  const hairStyleId = normalizeKeeperHairStyle(window.localStorage.getItem("hearthaven:keeper-hair-style-id"));
  const hairColorId = normalizeKeeperHairColor(window.localStorage.getItem("hearthaven:keeper-hair-color-id"));
  const paletteId = normalizeKeeperPalette(window.localStorage.getItem("hearthaven:keeper-palette-id"));
  const outfitId = normalizeKeeperOutfit(window.localStorage.getItem("hearthaven:keeper-outfit-id"));
  return { characterId, bodyId, skinId, hairStyleId, hairColorId, paletteId, outfitId };
}

export function writeKeeperCustomization(customization: KeeperCustomization) {
  window.localStorage.setItem("hearthaven:keeper-character-id", customization.characterId);
  window.localStorage.setItem("hearthaven:keeper-body-id", customization.bodyId);
  window.localStorage.setItem("hearthaven:keeper-skin-id", customization.skinId);
  window.localStorage.setItem("hearthaven:keeper-hair-style-id", customization.hairStyleId);
  window.localStorage.setItem("hearthaven:keeper-hair-color-id", customization.hairColorId);
  window.localStorage.setItem("hearthaven:keeper-palette-id", customization.paletteId);
  window.localStorage.setItem("hearthaven:keeper-palette", getKeeperPalette(customization.paletteId).color);
  window.localStorage.setItem("hearthaven:keeper-outfit-id", customization.outfitId);
  window.dispatchEvent(new CustomEvent(KEEPER_CUSTOMIZATION_EVENT, { detail: customization }));
}

function normalizeKeeperCustomization(value: Partial<KeeperCustomization> | null | undefined): KeeperCustomization {
  return {
    characterId: normalizeKeeperCharacter(value?.characterId),
    bodyId: normalizeKeeperBody(value?.bodyId),
    skinId: normalizeKeeperSkin(value?.skinId),
    hairStyleId: normalizeKeeperHairStyle(value?.hairStyleId),
    hairColorId: normalizeKeeperHairColor(value?.hairColorId),
    paletteId: normalizeKeeperPalette(value?.paletteId ?? null),
    outfitId: normalizeKeeperOutfit(value?.outfitId ?? null),
  };
}

function parseKeeperCustomizationPayload(value: unknown): KeeperCustomization | null {
  if (!value || typeof value !== "object") return null;
  return normalizeKeeperCustomization(value as Partial<KeeperCustomization>);
}

function parseLegacyAvatarKey(value: unknown): KeeperCustomization | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const preset = KEEPER_CHARACTER_PRESETS.find((character) => character.id === trimmed);
  if (preset) {
    return normalizeKeeperCustomization({
      characterId: preset.id,
      bodyId: preset.bodyId,
      skinId: preset.skinId,
      hairStyleId: preset.hairStyleId,
      hairColorId: preset.hairColorId,
      paletteId: preset.paletteId,
      outfitId: preset.outfitId,
    });
  }
  return null;
}

function isMissingCustomizationColumn(message: string) {
  return /keeper_customization|column .* does not exist|Could not find .*keeper_customization/i.test(message);
}

export async function loadKeeperCustomizationFromServer(): Promise<
  | { ok: true; customization: KeeperCustomization }
  | { ok: false; reason: string }
> {
  if (!isSupabaseConfigured()) return { ok: false, reason: "Online profile services are not configured." };

  try {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Sign in to sync your keeper." };

    const { data, error } = await supabase
      .from("profiles")
      .select("keeper_customization, avatar_key")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      if (!isMissingCustomizationColumn(error.message)) return { ok: false, reason: error.message };
      const { data: legacy, error: legacyError } = await supabase
        .from("profiles")
        .select("avatar_key")
        .eq("id", user.id)
        .maybeSingle();
      if (legacyError) return { ok: false, reason: legacyError.message };
      const legacyCustomization = parseLegacyAvatarKey(legacy?.avatar_key);
      if (!legacyCustomization) return { ok: false, reason: "No saved keeper yet." };
      writeKeeperCustomization(legacyCustomization);
      return { ok: true, customization: legacyCustomization };
    }

    const customization =
      parseKeeperCustomizationPayload(data?.keeper_customization) ?? parseLegacyAvatarKey(data?.avatar_key);
    if (!customization) return { ok: false, reason: "No saved keeper yet." };
    writeKeeperCustomization(customization);
    return { ok: true, customization };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Could not load keeper." };
  }
}

export async function saveKeeperCustomizationToServer(customization: KeeperCustomization): Promise<
  | { ok: true }
  | { ok: false; reason: string }
> {
  if (!isSupabaseConfigured()) return { ok: true };

  try {
    const normalized = normalizeKeeperCustomization(customization);
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Sign in to sync your keeper." };

    const { error } = await supabase
      .from("profiles")
      .update({
        keeper_customization: normalized,
        avatar_key: normalized.characterId,
      })
      .eq("id", user.id);

    if (!error) return { ok: true };

    if (isMissingCustomizationColumn(error.message)) {
      const { error: legacyError } = await supabase
        .from("profiles")
        .update({ avatar_key: normalized.characterId })
        .eq("id", user.id);
      return legacyError ? { ok: false, reason: legacyError.message } : { ok: true };
    }

    return { ok: false, reason: error.message };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Could not save keeper." };
  }
}

export function readPetCustomization(): PetCustomization {
  if (typeof window === "undefined") return { speciesId: "kitten", toneId: "cream", accessory: "moonberry-bow" };
  const speciesId = normalizePetSpecies(window.localStorage.getItem("hearthaven:pet-species-id") ?? window.localStorage.getItem("hearthaven:pet-type") ?? "kitten");
  const toneId = normalizePetTone(window.localStorage.getItem("hearthaven:pet-tone-id") ?? window.localStorage.getItem("hearthaven:pet-tone") ?? "cream");
  const accessory = normalizePetAccessory(window.localStorage.getItem("hearthaven:pet-accessory") ?? "moonberry-bow");
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
    characterId: keeper.characterId,
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

export function getKeeperCharacterPreset(id: KeeperCharacterId) {
  return KEEPER_CHARACTER_PRESETS.find((preset) => preset.id === id) ?? KEEPER_CHARACTER_PRESETS[0];
}

export function isKeeperPresetExactMatch(customization: Pick<KeeperCustomization, "bodyId" | "characterId" | "hairColorId" | "hairStyleId" | "outfitId" | "paletteId" | "skinId">) {
  const preset = getKeeperCharacterPreset(customization.characterId);
  return (
    preset.bodyId === customization.bodyId &&
    preset.skinId === customization.skinId &&
    preset.hairStyleId === customization.hairStyleId &&
    preset.hairColorId === customization.hairColorId &&
    preset.paletteId === customization.paletteId &&
    preset.outfitId === customization.outfitId
  );
}

export function getKeeperSkinTone(id: KeeperSkinId) {
  return KEEPER_SKIN_TONES.find((skin) => skin.id === id) ?? KEEPER_SKIN_TONES[0];
}

export function getKeeperHairColor(id: KeeperHairColorId) {
  return KEEPER_HAIR_COLORS.find((hair) => hair.id === id) ?? KEEPER_HAIR_COLORS[0];
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
  characterId: KeeperCharacterId;
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
  const characterId = normalizeKeeperCharacter(player.characterId);
  const bodyId = normalizeKeeperBody(player.bodyId);
  const skinId = normalizeKeeperSkin(player.skinId);
  const hairStyleId = normalizeKeeperHairStyle(player.hairStyleId);
  const hairColorId = normalizeKeeperHairColor(player.hairColorId);
  const petSpeciesId = normalizePetSpecies(player.petSpeciesId);
  const petToneId: PetToneId = PET_TONES.some((tone) => tone.id === player.petToneId)
    ? (player.petToneId as PetToneId)
    : "cream";
  const petAccessoryId = normalizePetAccessory(player.petAccessory);
  return { characterId, bodyId, skinId, hairStyleId, hairColorId, paletteId, outfitId, petSpeciesId, petToneId, petAccessoryId };
}

export function getKeeperOutfit(id: KeeperOutfitId) {
  return KEEPER_OUTFITS.find((outfit) => outfit.id === id) ?? KEEPER_OUTFITS[0];
}

export function getPetSpecies(id: PetSpeciesId) {
  return PET_SPECIES.find((species) => species.id === id) ?? PET_SPECIES[0];
}

export function isFlyingPetSpecies(id: PetSpeciesId) {
  return Boolean(getPetSpecies(id).flying);
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

function normalizeKeeperCharacter(value: string | null | undefined): KeeperCharacterId {
  return KEEPER_CHARACTER_PRESETS.some((character) => character.id === value)
    ? (value as KeeperCharacterId)
    : "rose-waves";
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

export function normalizePetSpecies(value: string | null | undefined): PetSpeciesId {
  const legacyMap: Record<string, PetSpeciesId> = {
    "cloud-fox": "fox",
    "moonberry-fox": "bunny",
    "honey-fox": "bear",
    "garden-fox": "duck",
  };
  if (value && legacyMap[value]) return legacyMap[value];
  return PET_SPECIES.some((species) => species.id === value) ? (value as PetSpeciesId) : "kitten";
}

export function normalizePetTone(value: string | null | undefined): PetToneId {
  return PET_TONES.some((tone) => tone.id === value) ? (value as PetToneId) : "cream";
}

export function normalizePetAccessory(value: string | null | undefined): PetAccessoryId {
  if (PET_ACCESSORIES.some((accessory) => accessory.id === value)) return value as PetAccessoryId;
  const fromLabel = PET_ACCESSORIES.find((accessory) => accessory.label.toLowerCase() === value?.toLowerCase());
  return fromLabel?.id ?? "moonberry-bow";
}
