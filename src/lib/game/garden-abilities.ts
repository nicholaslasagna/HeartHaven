"use client";

import { getDiscoveryDayKey } from "@/lib/game/discoveries-store";

export const GARDEN_ABILITIES_STATE_KEY = "hearthaven:garden-abilities-state";

export type GardenAbilityVariant = "personal" | "partner" | "park";
export type AbilityPoint = { x: number; y: number };
export type SqueezeGap = {
  id: string;
  label: string;
  a: AbilityPoint;
  b: AbilityPoint;
};
export type DigSpot = AbilityPoint & {
  id: string;
  label: string;
};

type GardenAbilitiesState = {
  dayKey: string;
  dugSpotIds: string[];
  gatheredSpotIds: string[];
};

const GARDEN_SQUEEZE_GAPS: SqueezeGap[] = [
  {
    id: "upper-vine-gap",
    label: "Upper vine tunnel",
    a: { x: 46, y: 43 },
    b: { x: 71, y: 43 },
  },
  {
    id: "lower-fern-gap",
    label: "Lower fern tunnel",
    a: { x: 38, y: 76 },
    b: { x: 62, y: 76 },
  },
];

const DIG_POSITION_POOL: AbilityPoint[] = [
  { x: 17, y: 54 },
  { x: 25, y: 72 },
  { x: 34, y: 38 },
  { x: 39, y: 65 },
  { x: 47, y: 54 },
  { x: 63, y: 62 },
  { x: 70, y: 80 },
  { x: 76, y: 48 },
  { x: 85, y: 70 },
  { x: 89, y: 36 },
];

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle<T>(values: readonly T[], seedText: string): T[] {
  let seed = hashSeed(seedText) || 1;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4_294_967_296;
  };
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function getGardenSqueezeGaps(variant: GardenAbilityVariant): SqueezeGap[] {
  return variant === "park" ? [] : GARDEN_SQUEEZE_GAPS;
}

export function getDailyDigSpots(
  variant: GardenAbilityVariant,
  dayKey = getDiscoveryDayKey(),
): DigSpot[] {
  if (variant === "park") return [];
  return seededShuffle(DIG_POSITION_POOL, `${dayKey}:${variant}:dig`)
    .slice(0, 4)
    .map((point, index) => ({ ...point, id: `${variant}-dig-${index + 1}`, label: `Fresh dirt ${index + 1}` }));
}

function freshState(): GardenAbilitiesState {
  return { dayKey: getDiscoveryDayKey(), dugSpotIds: [], gatheredSpotIds: [] };
}

function readIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export function readGardenAbilitiesState(): GardenAbilitiesState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(GARDEN_ABILITIES_STATE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<GardenAbilitiesState>;
    if (parsed.dayKey !== getDiscoveryDayKey()) {
      const next = freshState();
      window.localStorage.setItem(GARDEN_ABILITIES_STATE_KEY, JSON.stringify(next));
      return next;
    }
    return {
      dayKey: parsed.dayKey,
      dugSpotIds: readIds(parsed.dugSpotIds),
      // Absent on state written before foraging existed; treated as none.
      gatheredSpotIds: readIds(parsed.gatheredSpotIds),
    };
  } catch {
    return freshState();
  }
}

export function isDigSpotDug(spotId: string): boolean {
  return readGardenAbilitiesState().dugSpotIds.includes(spotId);
}

export function markDigSpotDug(spotId: string): { ok: boolean; coins: number } {
  if (typeof window === "undefined") return { ok: false, coins: 0 };
  const state = readGardenAbilitiesState();
  if (state.dugSpotIds.includes(spotId)) return { ok: false, coins: 0 };
  const coins = 4 + (hashSeed(`${state.dayKey}:${spotId}`) % 5);
  window.localStorage.setItem(
    GARDEN_ABILITIES_STATE_KEY,
    JSON.stringify({ ...state, dugSpotIds: [...state.dugSpotIds, spotId] }),
  );
  return { ok: true, coins };
}

/* ------------------------------------------------------------------ */
/* Unlockable abilities                                                */
/* ------------------------------------------------------------------ */

/** Bushes the forage ability harvests. Separate pool so berries and dirt
    never land on the same tile. */
const FORAGE_POSITION_POOL: AbilityPoint[] = [
  { x: 21, y: 41 },
  { x: 30, y: 58 },
  { x: 43, y: 30 },
  { x: 52, y: 71 },
  { x: 58, y: 45 },
  { x: 66, y: 33 },
  { x: 74, y: 63 },
  { x: 81, y: 44 },
  { x: 88, y: 57 },
  { x: 93, y: 74 },
];

/** Deeper caches. No marker is drawn for these until a lantern lights the
    ground, which is the entire point of the ability. */
const BURIED_POSITION_POOL: AbilityPoint[] = [
  { x: 14, y: 66 },
  { x: 28, y: 84 },
  { x: 45, y: 86 },
  { x: 57, y: 24 },
  { x: 69, y: 72 },
  { x: 79, y: 28 },
  { x: 91, y: 49 },
];

export function getDailyForageSpots(
  variant: GardenAbilityVariant,
  dayKey = getDiscoveryDayKey(),
): DigSpot[] {
  if (variant === "park") return [];
  return seededShuffle(FORAGE_POSITION_POOL, `${dayKey}:${variant}:forage`)
    .slice(0, 4)
    .map((point, index) => ({ ...point, id: `${variant}-forage-${index + 1}`, label: `Moonberry bush ${index + 1}` }));
}

export function getBuriedDigSpots(
  variant: GardenAbilityVariant,
  dayKey = getDiscoveryDayKey(),
): DigSpot[] {
  if (variant === "park") return [];
  return seededShuffle(BURIED_POSITION_POOL, `${dayKey}:${variant}:buried`)
    .slice(0, 2)
    .map((point, index) => ({ ...point, id: `${variant}-buried-${index + 1}`, label: `Buried cache ${index + 1}` }));
}

export function isForageSpotGathered(spotId: string): boolean {
  return readGardenAbilitiesState().gatheredSpotIds.includes(spotId);
}

export function markForageSpotGathered(spotId: string): { ok: boolean; coins: number } {
  if (typeof window === "undefined") return { ok: false, coins: 0 };
  const state = readGardenAbilitiesState();
  if (state.gatheredSpotIds.includes(spotId)) return { ok: false, coins: 0 };
  // A little less than digging: berries are easier to reach.
  const coins = 3 + (hashSeed(`${state.dayKey}:${spotId}:berry`) % 4);
  window.localStorage.setItem(
    GARDEN_ABILITIES_STATE_KEY,
    JSON.stringify({ ...state, gatheredSpotIds: [...state.gatheredSpotIds, spotId] }),
  );
  return { ok: true, coins };
}

/** Buried caches share the dug list, so a cache cannot be dug twice, but pay
    considerably more — otherwise the lantern is not worth carrying. */
export function markBuriedSpotDug(spotId: string): { ok: boolean; coins: number } {
  if (typeof window === "undefined") return { ok: false, coins: 0 };
  const state = readGardenAbilitiesState();
  if (state.dugSpotIds.includes(spotId)) return { ok: false, coins: 0 };
  const coins = 11 + (hashSeed(`${state.dayKey}:${spotId}:cache`) % 7);
  window.localStorage.setItem(
    GARDEN_ABILITIES_STATE_KEY,
    JSON.stringify({ ...state, dugSpotIds: [...state.dugSpotIds, spotId] }),
  );
  return { ok: true, coins };
}

