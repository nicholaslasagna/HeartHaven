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

/** Points lost per hour for each vital, with the tab open or closed. */
const DECAY_PER_HOUR: Record<PetVitalKey, number> = {
  fullness: 7,
  energy: 5,
  cleanliness: 4,
  happiness: 3,
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
/** Thresholds for derived behaviour (kept here so canvases stay in sync). */
const DIRTY_THRESHOLD = 10;
const HUNGRY_THRESHOLD = 5;
const EXHAUSTED_THRESHOLD = 5;

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function freshVitals(): PetVitals {
  const now = Date.now();
  return {
    happiness: 86,
    fullness: 74,
    energy: 80,
    cleanliness: 78,
    updatedAt: now,
    lastActionAt: { feed: 0, play: 0, pamper: 0, rest: 0 },
  };
}

function rawRead(): PetVitals {
  if (typeof window === "undefined") return freshVitals();
  try {
    const raw = window.localStorage.getItem(PET_VITALS_KEY);
    if (!raw) return freshVitals();
    const parsed = JSON.parse(raw) as Partial<PetVitals>;
    const base = freshVitals();
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
  } catch {
    return freshVitals();
  }
}

function rawWrite(vitals: PetVitals) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PET_VITALS_KEY, JSON.stringify(vitals));
  window.dispatchEvent(new CustomEvent(PET_VITALS_EVENT, { detail: vitals }));
}

export function replacePetVitalsState(vitals: PetVitals) {
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
  });
}

/**
 * Apply real-time decay to a stored snapshot WITHOUT persisting. Happiness takes
 * an extra hit when the practical needs (fullness/energy/cleanliness) are low —
 * a neglected companion gets sad faster than the base rate.
 */
function decayed(vitals: PetVitals, now = Date.now()): PetVitals {
  const hours = Math.max(0, (now - vitals.updatedAt) / 3_600_000);
  if (hours === 0) return vitals;

  const fullness = clamp(vitals.fullness - DECAY_PER_HOUR.fullness * hours);
  const energy = clamp(vitals.energy - DECAY_PER_HOUR.energy * hours);
  const cleanliness = clamp(vitals.cleanliness - DECAY_PER_HOUR.cleanliness * hours);

  const needsAverage = (fullness + energy + cleanliness) / 3;
  const neglectMultiplier = needsAverage < 35 ? 2.1 : needsAverage < 55 ? 1.4 : 1;
  const happiness = clamp(vitals.happiness - DECAY_PER_HOUR.happiness * hours * neglectMultiplier);

  return { ...vitals, happiness, fullness, energy, cleanliness };
}

/** The current, decay-adjusted vitals. Pure read — except for the
 *  one-shot nap-completion path, which persists the energy bump so the
 *  next reader sees the restored value. Auto-clearing the `napUntil`
 *  here means there's only ONE place in the codebase that knows about
 *  the nap timer; canvases just react to whatever `napping` reports. */
export function getPetVitals(): PetVitals {
  const stored = rawRead();
  // Resolve a completed nap: if napUntil has passed, credit +25% energy
  // (capped at 100), clear napUntil, persist, and dispatch the event so
  // listening UI re-renders.
  if (stored.napUntil && stored.napUntil <= Date.now()) {
    const realized = decayed(stored);
    const next: PetVitals = {
      ...realized,
      energy: clamp(realized.energy + PET_NAP_ENERGY_RESTORE),
      updatedAt: Date.now(),
      napUntil: undefined,
    };
    rawWrite(next);
    return next;
  }
  return decayed(stored);
}

/** Derive movement / appearance / obedience flags from current vitals. */
export function getPetBehavior(vitals: PetVitals = getPetVitals()): PetBehavior {
  // Joy → speed: 100 joy = 1.0×, 0 joy = 0.5×. Smooth linear so the
  // keeper notices the slowdown across the range, not just at the
  // bottom.
  const speedMultiplier = 0.5 + 0.5 * (clamp(vitals.happiness) / 100);
  const napping = Boolean(vitals.napUntil && vitals.napUntil > Date.now());
  return {
    speedMultiplier,
    dirty: vitals.cleanliness <= DIRTY_THRESHOLD,
    disobeys: vitals.fullness <= HUNGRY_THRESHOLD,
    // An already-napping pet isn't "exhausted" in the trigger sense —
    // it's already addressing the exhaustion. This prevents the canvas
    // from re-triggering the flee animation every frame mid-nap.
    exhausted: !napping && vitals.energy <= EXHAUSTED_THRESHOLD,
    napping,
  };
}

/** Start a 5-minute nap. Idempotent: a nap already in progress returns
 *  its existing end timestamp. Returns the wall-clock ms when the nap
 *  ends so the caller can schedule a wake-up if it wants to. */
export function startPetNap(): number {
  const stored = rawRead();
  if (stored.napUntil && stored.napUntil > Date.now()) return stored.napUntil;
  const napUntil = Date.now() + PET_NAP_DURATION_MS;
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
  return Math.max(0, CARE_ACTIONS[action].cooldownMs - elapsed);
}

export function getActionCooldownMs(action: PetCareAction): number {
  return CARE_ACTIONS[action].cooldownMs;
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
  const { deltas, hearts, activity } = CARE_ACTIONS[action];

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
