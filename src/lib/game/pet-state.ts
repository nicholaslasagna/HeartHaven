/**
 * pet-state — the living companion: the soul of the Webkinz loop.
 *
 * Your companion has four vitals (0–100, higher is better):
 *   • happiness   — the headline mood; sags when the others are neglected
 *   • fullness    — drains over time; topped up by feeding
 *   • energy      — drains as the pet plays; restored by resting
 *   • cleanliness — drifts down slowly; restored by pampering
 *
 * Vitals decay in REAL time. We never run a background timer to "tick" them —
 * instead each vital carries a single `updatedAt` timestamp and decay is
 * recomputed from elapsed wall-clock whenever the state is read. That means it
 * works even while the tab is closed, and it's trivially Supabase-portable.
 *
 * Care actions (feed / play / pamper / rest) each boost vitals, sit behind a
 * short cooldown so they can't be spam-farmed, and pay the keeper a heart —
 * because in HeartHaven, tending to someone you love is how you earn love.
 *
 * Storage: `hearthaven:pet-vitals`. Mutations dispatch `hearthaven:pet-vitals-changed`.
 * TODO: the `pets` table already has happiness/hunger columns — map this state
 * onto it (fullness = 100 - hunger) once migrations are applied.
 */

import { creditWallet } from "@/lib/game/wallet-store";
import { recordActivity, type ActivityType } from "@/lib/game/activity";
import { getPetFood, type PetFoodId } from "@/lib/game/pet-foods";
import { getActiveCompanion, getCompanionRoster, type CompanionRecord } from "@/lib/game/companion-roster";
import type { PetSpeciesId } from "@/lib/game/avatar-customization";

export const PET_VITALS_KEY = "hearthaven:pet-vitals";
export const PET_VITALS_EVENT = "hearthaven:pet-vitals-changed";

export type PetVitalKey = "happiness" | "fullness" | "energy" | "cleanliness";
export type PetCareAction = "feed" | "play" | "pamper" | "rest";

export type PetVitals = {
  happiness: number;
  fullness: number;
  energy: number;
  cleanliness: number;
  /** Wall-clock ms at which the stored values were last "realized". */
  updatedAt: number;
  /** Wall-clock ms of the last time each care action was performed. */
  lastActionAt: Record<PetCareAction, number>;
  /** When the companion is napping (because energy hit 0), this is the
   *  wall-clock ms the nap ends. The next `getPetVitals()` read after
   *  that time auto-credits +25% energy and clears the field. While
   *  set + in the future, canvases hide the pet (it's "off screen
   *  asleep"). */
  napUntil?: number;
};

/** Derived behaviour modifiers that the canvas reads each frame. Keeps
 *  the magic numbers in one place so room + garden + park behave
 *  identically. */
export type PetBehavior = {
  /** Multiplier applied to every pet movement speed (follow + companion
   *  + flee). 1.0 = full joy, 0.5 = miserable. Smooth across the range
   *  so the player feels the change before joy bottoms out. */
  speedMultiplier: number;
  /** True when cleanliness is critically low — the canvas tints the
   *  pet with a muddy overlay so the keeper can SEE the neglect. */
  dirty: boolean;
  /** True when the companion is too hungry to obey commands — sniff
   *  refuses, companion-mode inputs are ignored. */
  disobeys: boolean;
  /** True when energy has bottomed out. The canvas transitions into
   *  the "wander off-screen + nap" state on the next frame, and a
   *  napUntil timestamp is recorded so the pet stays asleep for 5
   *  minutes even across navigation. */
  exhausted: boolean;
  /** Whether a nap is currently in progress (napUntil > now). The
   *  canvas hides the pet sprite while true. */
  napping: boolean;
};

export type PetMood = "blissful" | "happy" | "content" | "restless" | "lonely";

export type PetCareResult =
  | { ok: true; action: PetCareAction; vitals: PetVitals; mood: PetMood; heartsEarned: number; foodId?: PetFoodId; label?: string }
  | { ok: false; action: PetCareAction; reason: "cooldown"; cooldownRemainingMs: number };

export type CompanionCareProfile = {
  speciesId: PetSpeciesId | "default";
  label: string;
  careStyle: string;
  baseline: Record<PetVitalKey, number>;
  decayPerHour: Record<PetVitalKey, number>;
  actionScale?: Partial<Record<PetCareAction, number>>;
  cooldownScale?: Partial<Record<PetCareAction, number>>;
  thresholds: {
    dirty: number;
    hungry: number;
    exhausted: number;
  };
  napDurationMs: number;
  napEnergyRestore: number;
};

/** Default points lost per hour for each vital, with the tab open or closed. */
const DEFAULT_DECAY_PER_HOUR: Record<PetVitalKey, number> = {
  fullness: 7,
  energy: 5,
  cleanliness: 4,
  happiness: 3,
};

const DEFAULT_BASELINE: Record<PetVitalKey, number> = {
  happiness: 86,
  fullness: 74,
  energy: 80,
  cleanliness: 78,
};

/** Per-action vital deltas + cooldown + the activity it logs. */
const CARE_ACTIONS: Record<
  PetCareAction,
  { deltas: Partial<Record<PetVitalKey, number>>; cooldownMs: number; activity: ActivityType; hearts: number }
> = {
  feed:   { deltas: { fullness: 36, happiness: 8 },                cooldownMs: 8 * 60_000,  activity: "pet-fed",      hearts: 1 },
  play:   { deltas: { happiness: 26, energy: -12, fullness: -6 },  cooldownMs: 6 * 60_000,  activity: "pet-played",   hearts: 1 },
  pamper: { deltas: { cleanliness: 34, happiness: 7 },             cooldownMs: 12 * 60_000, activity: "pet-pampered", hearts: 1 },
  rest:   { deltas: { energy: 40, happiness: 4 },                  cooldownMs: 15 * 60_000, activity: "pet-rested",   hearts: 1 },
};

const VITAL_KEYS: PetVitalKey[] = ["happiness", "fullness", "energy", "cleanliness"];

/** How long a pet stays asleep when energy bottoms out. 5 minutes. */
export const PET_NAP_DURATION_MS = 5 * 60_000;
/** How much energy a completed nap restores (as a percent of the 0-100 bar). */
export const PET_NAP_ENERGY_RESTORE = 25;

const DEFAULT_CARE_PROFILE: CompanionCareProfile = {
  speciesId: "default",
  label: "Balanced companion",
  careStyle: "Balanced needs. Snack, play, pamper, and rest all matter evenly.",
  baseline: DEFAULT_BASELINE,
  decayPerHour: DEFAULT_DECAY_PER_HOUR,
  thresholds: { dirty: 10, hungry: 5, exhausted: 5 },
  napDurationMs: PET_NAP_DURATION_MS,
  napEnergyRestore: PET_NAP_ENERGY_RESTORE,
};

const CARE_PROFILES: Partial<Record<PetSpeciesId, CompanionCareProfile>> = {
  kitten: {
    speciesId: "kitten",
    label: "Casper care",
    careStyle: "Casper is affectionate and steady, but gets hungry if treats are skipped.",
    baseline: { happiness: 88, fullness: 76, energy: 78, cleanliness: 82 },
    decayPerHour: { fullness: 6.5, energy: 4.5, cleanliness: 3.5, happiness: 2.6 },
    actionScale: { feed: 1.08, pamper: 1.05 },
    thresholds: { dirty: 11, hungry: 7, exhausted: 5 },
    napDurationMs: 4.5 * 60_000,
    napEnergyRestore: 27,
  },
  "super-snails": {
    speciesId: "super-snails",
    label: "Super Snails care",
    careStyle: "Flying burns energy faster, but heroic play gives a bigger mood lift.",
    baseline: { happiness: 92, fullness: 72, energy: 90, cleanliness: 82 },
    decayPerHour: { fullness: 7.5, energy: 7.2, cleanliness: 3.3, happiness: 2.4 },
    actionScale: { play: 1.2, rest: 1.18 },
    cooldownScale: { play: 0.82, rest: 0.9 },
    thresholds: { dirty: 10, hungry: 6, exhausted: 8 },
    napDurationMs: 3.5 * 60_000,
    napEnergyRestore: 34,
  },
  fox: {
    speciesId: "fox",
    label: "Cloud fox care",
    careStyle: "Foxes are playful and quick. They need more snacks after exploring.",
    baseline: { happiness: 86, fullness: 68, energy: 88, cleanliness: 76 },
    decayPerHour: { fullness: 8.5, energy: 5.8, cleanliness: 4.2, happiness: 3.2 },
    actionScale: { feed: 1.15, play: 1.1 },
    cooldownScale: { play: 0.9 },
    thresholds: { dirty: 12, hungry: 9, exhausted: 6 },
    napDurationMs: 4 * 60_000,
    napEnergyRestore: 30,
  },
  bunny: {
    speciesId: "bunny",
    label: "Moonberry bunny care",
    careStyle: "Bunnies stay cheerful with play, but tire sooner than sturdier pets.",
    baseline: { happiness: 90, fullness: 78, energy: 72, cleanliness: 84 },
    decayPerHour: { fullness: 6.2, energy: 6.6, cleanliness: 3.2, happiness: 3.8 },
    actionScale: { play: 1.18, rest: 1.12 },
    thresholds: { dirty: 10, hungry: 6, exhausted: 9 },
    napDurationMs: 4.75 * 60_000,
    napEnergyRestore: 32,
  },
  bear: {
    speciesId: "bear",
    label: "Honey bear care",
    careStyle: "Bears are cozy and resilient, but need hearty meals and long rests.",
    baseline: { happiness: 84, fullness: 64, energy: 82, cleanliness: 74 },
    decayPerHour: { fullness: 9, energy: 3.8, cleanliness: 4.8, happiness: 2.8 },
    actionScale: { feed: 1.24, rest: 0.95 },
    cooldownScale: { feed: 1.08, rest: 1.12 },
    thresholds: { dirty: 12, hungry: 12, exhausted: 4 },
    napDurationMs: 6 * 60_000,
    napEnergyRestore: 30,
  },
  duck: {
    speciesId: "duck",
    label: "Sky duck care",
    careStyle: "Ducks love clean water. Pampering keeps them happiest.",
    baseline: { happiness: 84, fullness: 76, energy: 80, cleanliness: 68 },
    decayPerHour: { fullness: 6.3, energy: 4.8, cleanliness: 6.8, happiness: 3 },
    actionScale: { pamper: 1.28, play: 1.03 },
    cooldownScale: { pamper: 0.88 },
    thresholds: { dirty: 16, hungry: 6, exhausted: 5 },
    napDurationMs: 4.5 * 60_000,
    napEnergyRestore: 26,
  },
  puppy: {
    speciesId: "puppy",
    label: "Cocoa puppy care",
    careStyle: "Puppies need play often, then rest after big zoomies.",
    baseline: { happiness: 88, fullness: 74, energy: 84, cleanliness: 72 },
    decayPerHour: { fullness: 7.2, energy: 6.8, cleanliness: 5.4, happiness: 4.2 },
    actionScale: { play: 1.25, rest: 1.08 },
    cooldownScale: { play: 0.82 },
    thresholds: { dirty: 14, hungry: 7, exhausted: 8 },
    napDurationMs: 4 * 60_000,
    napEnergyRestore: 31,
  },
  calico: {
    speciesId: "calico",
    label: "Garden calico care",
    careStyle: "Calicos are independent. They like pampering and steady meals.",
    baseline: { happiness: 86, fullness: 78, energy: 80, cleanliness: 86 },
    decayPerHour: { fullness: 6.8, energy: 4.4, cleanliness: 3.6, happiness: 2.2 },
    actionScale: { pamper: 1.15, feed: 1.05 },
    thresholds: { dirty: 10, hungry: 7, exhausted: 5 },
    napDurationMs: 4.5 * 60_000,
    napEnergyRestore: 26,
  },
  lamb: {
    speciesId: "lamb",
    label: "Cloud lamb care",
    careStyle: "Lambs are gentle and sleepy. Rest matters more than speed.",
    baseline: { happiness: 87, fullness: 78, energy: 68, cleanliness: 88 },
    decayPerHour: { fullness: 5.8, energy: 5.4, cleanliness: 3.2, happiness: 2.5 },
    actionScale: { rest: 1.25, pamper: 1.08 },
    cooldownScale: { rest: 0.92 },
    thresholds: { dirty: 9, hungry: 5, exhausted: 10 },
    napDurationMs: 5.5 * 60_000,
    napEnergyRestore: 36,
  },
  panda: {
    speciesId: "panda",
    label: "Moon panda care",
    careStyle: "Pandas are calm and snack-loving. They lose energy slowly.",
    baseline: { happiness: 84, fullness: 70, energy: 86, cleanliness: 78 },
    decayPerHour: { fullness: 8.2, energy: 3.4, cleanliness: 4.4, happiness: 2.4 },
    actionScale: { feed: 1.18, rest: 1.05 },
    thresholds: { dirty: 11, hungry: 10, exhausted: 4 },
    napDurationMs: 5.75 * 60_000,
    napEnergyRestore: 29,
  },
  dragon: {
    speciesId: "dragon",
    label: "Lantern dragon care",
    careStyle: "Dragons are energetic. Play makes them glow, but rest keeps sparks steady.",
    baseline: { happiness: 90, fullness: 72, energy: 92, cleanliness: 76 },
    decayPerHour: { fullness: 7.8, energy: 6.2, cleanliness: 4.5, happiness: 3.4 },
    actionScale: { play: 1.16, rest: 1.16, feed: 1.05 },
    cooldownScale: { rest: 0.92 },
    thresholds: { dirty: 13, hungry: 8, exhausted: 7 },
    napDurationMs: 4.25 * 60_000,
    napEnergyRestore: 33,
  },
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function companionContext(companionId?: string): { companionId: string; companion?: CompanionRecord; active: boolean } {
  if (typeof window === "undefined") {
    return { companionId: companionId ?? "companion-casper", active: true };
  }
  const roster = getCompanionRoster();
  const activeCompanion = getActiveCompanion(roster);
  const companion = companionId
    ? roster.companions.find((candidate) => candidate.id === companionId)
    : activeCompanion;
  return {
    companionId: companion?.id ?? activeCompanion?.id ?? companionId ?? "companion-casper",
    companion,
    active: !companionId || companion?.id === activeCompanion?.id,
  };
}

function vitalsKey(companionId?: string) {
  const context = companionContext(companionId);
  return `${PET_VITALS_KEY}:${context.companionId}`;
}

export function getPetCareProfile(companionId?: string): CompanionCareProfile {
  const { companion } = companionContext(companionId);
  return (companion?.speciesId && CARE_PROFILES[companion.speciesId]) || DEFAULT_CARE_PROFILE;
}

function scaledAction(action: PetCareAction, profile = getPetCareProfile()) {
  const base = CARE_ACTIONS[action];
  const deltaScale = profile.actionScale?.[action] ?? 1;
  const cooldownScale = profile.cooldownScale?.[action] ?? 1;
  const deltas = Object.fromEntries(
    Object.entries(base.deltas).map(([key, value]) => [key, Math.round(Number(value) * deltaScale)]),
  ) as Partial<Record<PetVitalKey, number>>;
  return {
    ...base,
    deltas,
    cooldownMs: Math.max(1_000, Math.round(base.cooldownMs * cooldownScale)),
  };
}

function freshVitals(companionId?: string): PetVitals {
  const now = Date.now();
  const profile = getPetCareProfile(companionId);
  return {
    happiness: profile.baseline.happiness,
    fullness: profile.baseline.fullness,
    energy: profile.baseline.energy,
    cleanliness: profile.baseline.cleanliness,
    updatedAt: now,
    lastActionAt: { feed: 0, play: 0, pamper: 0, rest: 0 },
  };
}

function coerceVitals(parsed: Partial<PetVitals>, companionId?: string): PetVitals {
  const base = freshVitals(companionId);
  const napUntilRaw = Number(parsed.napUntil ?? 0);
  return {
    happiness: clamp(Number(parsed.happiness ?? base.happiness)),
    fullness: clamp(Number(parsed.fullness ?? base.fullness)),
    energy: clamp(Number(parsed.energy ?? base.energy)),
    cleanliness: clamp(Number(parsed.cleanliness ?? base.cleanliness)),
    updatedAt: Number(parsed.updatedAt ?? base.updatedAt),
    lastActionAt: { ...base.lastActionAt, ...(parsed.lastActionAt ?? {}) },
    napUntil: Number.isFinite(napUntilRaw) && napUntilRaw > 0 ? napUntilRaw : undefined,
  };
}

function rawRead(companionId?: string): PetVitals {
  if (typeof window === "undefined") return freshVitals(companionId);
  try {
    const key = vitalsKey(companionId);
    const { active } = companionContext(companionId);
    const raw = window.localStorage.getItem(key) ?? (active ? window.localStorage.getItem(PET_VITALS_KEY) : null);
    if (!raw) return freshVitals(companionId);
    const parsed = JSON.parse(raw) as Partial<PetVitals>;
    return coerceVitals(parsed, companionId);
  } catch {
    return freshVitals(companionId);
  }
}

function rawWrite(vitals: PetVitals, companionId?: string) {
  if (typeof window === "undefined") return;
  const context = companionContext(companionId);
  window.localStorage.setItem(`${PET_VITALS_KEY}:${context.companionId}`, JSON.stringify(vitals));
  if (context.active) {
    window.localStorage.setItem(PET_VITALS_KEY, JSON.stringify(vitals));
    window.dispatchEvent(new CustomEvent(PET_VITALS_EVENT, { detail: { companionId: context.companionId, vitals } }));
  }
}

export function replacePetVitalsState(vitals: PetVitals, companionId?: string) {
  rawWrite({
    ...vitals,
    happiness: clamp(vitals.happiness),
    fullness: clamp(vitals.fullness),
    energy: clamp(vitals.energy),
    cleanliness: clamp(vitals.cleanliness),
    updatedAt: Number(vitals.updatedAt || Date.now()),
    lastActionAt: {
      feed: Number(vitals.lastActionAt?.feed ?? 0),
      play: Number(vitals.lastActionAt?.play ?? 0),
      pamper: Number(vitals.lastActionAt?.pamper ?? 0),
      rest: Number(vitals.lastActionAt?.rest ?? 0),
    },
    napUntil: vitals.napUntil,
  }, companionId);
}

/**
 * Apply real-time decay to a stored snapshot WITHOUT persisting. Happiness takes
 * an extra hit when the practical needs (fullness/energy/cleanliness) are low —
 * a neglected companion gets sad faster than the base rate.
 */
function decayed(vitals: PetVitals, now = Date.now(), companionId?: string): PetVitals {
  const profile = getPetCareProfile(companionId);
  const hours = Math.max(0, (now - vitals.updatedAt) / 3_600_000);
  if (hours === 0) return vitals;

  const fullness = clamp(vitals.fullness - profile.decayPerHour.fullness * hours);
  const energy = clamp(vitals.energy - profile.decayPerHour.energy * hours);
  const cleanliness = clamp(vitals.cleanliness - profile.decayPerHour.cleanliness * hours);

  const needsAverage = (fullness + energy + cleanliness) / 3;
  const neglectMultiplier = needsAverage < 35 ? 2.1 : needsAverage < 55 ? 1.4 : 1;
  const happiness = clamp(vitals.happiness - profile.decayPerHour.happiness * hours * neglectMultiplier);

  return { ...vitals, happiness, fullness, energy, cleanliness };
}

/** The current, decay-adjusted vitals. Pure read — except for the
 *  one-shot nap-completion path, which persists the energy bump so the
 *  next reader sees the restored value. Auto-clearing the `napUntil`
 *  here means there's only ONE place in the codebase that knows about
 *  the nap timer; canvases just react to whatever `napping` reports. */
export function getPetVitals(): PetVitals {
  return getPetVitalsForCompanion();
}

export function getPetVitalsForCompanion(companionId?: string): PetVitals {
  const stored = rawRead(companionId);
  const profile = getPetCareProfile(companionId);
  // Resolve a completed nap: if napUntil has passed, credit +25% energy
  // (capped at 100), clear napUntil, persist, and dispatch the event so
  // listening UI re-renders.
  if (stored.napUntil && stored.napUntil <= Date.now()) {
    const realized = decayed(stored, Date.now(), companionId);
    const next: PetVitals = {
      ...realized,
      energy: clamp(realized.energy + profile.napEnergyRestore),
      updatedAt: Date.now(),
      napUntil: undefined,
    };
    rawWrite(next, companionId);
    return next;
  }
  return decayed(stored, Date.now(), companionId);
}

/** Derive movement / appearance / obedience flags from current vitals. */
export function getPetBehavior(vitals: PetVitals = getPetVitals()): PetBehavior {
  // Joy → speed: 100 joy = 1.0×, 0 joy = 0.5×. Smooth linear so the
  // keeper notices the slowdown across the range, not just at the
  // bottom.
  const speedMultiplier = 0.5 + 0.5 * (clamp(vitals.happiness) / 100);
  const profile = getPetCareProfile();
  const napping = Boolean(vitals.napUntil && vitals.napUntil > Date.now());
  return {
    speedMultiplier,
    dirty: vitals.cleanliness <= profile.thresholds.dirty,
    disobeys: vitals.fullness <= profile.thresholds.hungry,
    // An already-napping pet isn't "exhausted" in the trigger sense —
    // it's already addressing the exhaustion. This prevents the canvas
    // from re-triggering the flee animation every frame mid-nap.
    exhausted: !napping && vitals.energy <= profile.thresholds.exhausted,
    napping,
  };
}

/** Start a 5-minute nap. Idempotent: a nap already in progress returns
 *  its existing end timestamp. Returns the wall-clock ms when the nap
 *  ends so the caller can schedule a wake-up if it wants to. */
export function startPetNap(): number {
  const stored = rawRead();
  if (stored.napUntil && stored.napUntil > Date.now()) return stored.napUntil;
  const napUntil = Date.now() + getPetCareProfile().napDurationMs;
  rawWrite({ ...stored, napUntil, updatedAt: Date.now() });
  return napUntil;
}

/** Cancel an in-progress nap without crediting energy. Used by dev/reset
 *  flows; the keeper-facing app doesn't currently call it. */
export function cancelPetNap(): void {
  const stored = rawRead();
  if (!stored.napUntil) return;
  rawWrite({ ...stored, napUntil: undefined, updatedAt: Date.now() });
}

export function getPetMood(vitals: PetVitals = getPetVitals()): PetMood {
  const score = (vitals.happiness + vitals.fullness + vitals.energy + vitals.cleanliness) / 4;
  if (score >= 85) return "blissful";
  if (score >= 65) return "happy";
  if (score >= 45) return "content";
  if (score >= 25) return "restless";
  return "lonely";
}

/** Whichever vital is most in need of attention right now (for nudges). */
export function getNeediestVital(vitals: PetVitals = getPetVitals()): PetVitalKey {
  return VITAL_KEYS.reduce((lowest, key) => (vitals[key] < vitals[lowest] ? key : lowest), "happiness");
}

/** ms until a care action is available again (0 = ready now). */
export function getCooldownRemaining(action: PetCareAction, vitals: PetVitals = rawRead()): number {
  const elapsed = Date.now() - (vitals.lastActionAt[action] ?? 0);
  return Math.max(0, scaledAction(action).cooldownMs - elapsed);
}

export function getActionCooldownMs(action: PetCareAction): number {
  return scaledAction(action).cooldownMs;
}

/**
 * Perform a care action. Realizes pending decay, applies the action's vital
 * deltas, persists, pays the keeper a heart, and records the activity (which
 * advances daily tasks + achievements). No-ops with `ok: false` if the action
 * is still on cooldown.
 */
export function performPetAction(action: PetCareAction): PetCareResult {
  const stored = rawRead();
  const cooldownRemainingMs = getCooldownRemaining(action, stored);
  if (cooldownRemainingMs > 0) {
    return { ok: false, action, reason: "cooldown", cooldownRemainingMs };
  }

  const now = Date.now();
  const current = decayed(stored, now);
  const { deltas, hearts, activity } = scaledAction(action);

  const next: PetVitals = {
    happiness: clamp(current.happiness + (deltas.happiness ?? 0)),
    fullness: clamp(current.fullness + (deltas.fullness ?? 0)),
    energy: clamp(current.energy + (deltas.energy ?? 0)),
    cleanliness: clamp(current.cleanliness + (deltas.cleanliness ?? 0)),
    updatedAt: now,
    lastActionAt: { ...current.lastActionAt, [action]: now },
  };

  rawWrite(next);
  creditWallet({
    gameId: "pet-care",
    label: `Companion care · ${action}`,
    score: 0,
    coins: 0,
    hearts,
  });
  recordActivity(activity);

  return { ok: true, action, vitals: next, mood: getPetMood(next), heartsEarned: hearts };
}

export function performPetFood(foodId: PetFoodId): PetCareResult {
  const food = getPetFood(foodId);
  const stored = rawRead();
  const cooldownRemainingMs = getCooldownRemaining("feed", stored);
  if (cooldownRemainingMs > 0) {
    return { ok: false, action: "feed", reason: "cooldown", cooldownRemainingMs };
  }

  const now = Date.now();
  const current = decayed(stored, now);
  const next: PetVitals = {
    happiness: clamp(current.happiness + (food.deltas.happiness ?? 0)),
    fullness: clamp(current.fullness + (food.deltas.fullness ?? 0)),
    energy: clamp(current.energy + (food.deltas.energy ?? 0)),
    cleanliness: clamp(current.cleanliness + (food.deltas.cleanliness ?? 0)),
    updatedAt: now,
    lastActionAt: { ...current.lastActionAt, feed: now },
  };

  rawWrite(next);
  creditWallet({
    gameId: "pet-care",
    label: `Companion snack · ${food.name}`,
    score: 0,
    coins: 0,
    hearts: 1,
  });
  recordActivity("pet-fed");

  return { ok: true, action: "feed", vitals: next, mood: getPetMood(next), heartsEarned: 1, foodId: food.id, label: food.name };
}

/** Reset the companion to a content baseline (used by dev/account tools). */
export function resetPetVitals(): PetVitals {
  const fresh = freshVitals();
  rawWrite(fresh);
  return fresh;
}
