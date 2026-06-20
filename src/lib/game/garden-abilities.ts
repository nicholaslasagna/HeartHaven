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
  return { dayKey: getDiscoveryDayKey(), dugSpotIds: [] };
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
      dugSpotIds: Array.isArray(parsed.dugSpotIds) ? parsed.dugSpotIds.filter((id): id is string => typeof id === "string") : [],
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

