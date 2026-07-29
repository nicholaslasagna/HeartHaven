/**
 * Moonberry Racing — power-ups.
 *
 * Pure and deterministic. The roll is seeded from (racer, box, lap) rather
 * than Math.random, so the host and every client independently agree on what
 * came out of a crate without the result needing to be broadcast.
 *
 * All items are original to HeartHaven. The design rules they follow, which
 * are the difference between a fun item set and an infuriating one:
 *
 *   • Nothing removes control for long. The worst case is a ~0.85s wobble,
 *     and most effects only slow or nudge.
 *   • Every incoming effect is telegraphed — each item carries a `warning`
 *     lead time so the target gets a visible cue before it lands.
 *   • Catch-up is weighted, not guaranteed. A racer at the back sees more
 *     recovery items, but the leader is never handed a loss.
 */

export type PowerUpId =
  | "moonberry-burst"
  | "sprinkle-shield"
  | "jam-bubble"
  | "taffy-trail"
  | "shooting-star"
  | "sugar-spark"
  | "fizzy-pop";

export type PowerUpKind = "self" | "projectile" | "trap" | "area" | "defence";

export type PowerUp = {
  id: PowerUpId;
  name: string;
  kind: PowerUpKind;
  /** Palette and silhouette hints, so an item reads at a glance. */
  color: number;
  icon: string;
  /** How long the effect lasts on whoever it affects, seconds. */
  duration: number;
  /** Lead time a target gets before it lands. 0 for items with no victim. */
  warning: number;
  description: string;
};

export const POWER_UPS: Record<PowerUpId, PowerUp> = {
  "moonberry-burst": {
    id: "moonberry-burst", name: "Moonberry Burst", kind: "self",
    color: 0xff6fa5, icon: "burst", duration: 1.6, warning: 0,
    description: "A short forward surge of speed.",
  },
  "sprinkle-shield": {
    id: "sprinkle-shield", name: "Sprinkle Shield", kind: "defence",
    color: 0x7fe3ff, icon: "shield", duration: 6, warning: 0,
    description: "Absorbs one hazard or hit, then breaks.",
  },
  "jam-bubble": {
    id: "jam-bubble", name: "Jam Bubble", kind: "projectile",
    color: 0xc94f8a, icon: "bubble", duration: 1.4, warning: 0.5,
    description: "A bouncing berry bubble that slows the first racer it touches.",
  },
  "taffy-trail": {
    id: "taffy-trail", name: "Taffy Trail", kind: "trap",
    color: 0xf0a94a, icon: "trail", duration: 1.2, warning: 0,
    description: "Drops a sticky patch behind you.",
  },
  "shooting-star": {
    id: "shooting-star", name: "Shooting Star", kind: "self",
    color: 0xffe98a, icon: "star", duration: 3.4, warning: 0,
    description: "Extra speed and grip. Only found near the back of the pack.",
  },
  "sugar-spark": {
    id: "sugar-spark", name: "Sugar Spark", kind: "projectile",
    color: 0xa9ff7f, icon: "spark", duration: 0.85, warning: 0.6,
    description: "A short-range spark that makes a nearby kart wobble.",
  },
  "fizzy-pop": {
    id: "fizzy-pop", name: "Fizzy Pop", kind: "area",
    color: 0xbfa8ff, icon: "pop", duration: 0.4, warning: 0.35,
    description: "A burst that shoves nearby racers away.",
  },
};

/** Longest any item takes control away. Kept small on purpose. */
export const MAX_CONTROL_LOSS = 0.85;

/** Seconds before a collected crate returns. */
export const BOX_RESPAWN = 5;

/**
 * Item weights by race position, as a fraction from 0 (leader) to 1 (last).
 *
 * The leader's table is deliberately defensive and trap-heavy: they can
 * protect a lead but cannot extend it much. The back of the pack gets the
 * recovery items. Nobody ever gets a guaranteed win item, because that
 * turns a race into a lottery.
 */
const WEIGHT_TABLE: Array<{ id: PowerUpId; front: number; back: number }> = [
  { id: "moonberry-burst", front: 30, back: 14 },
  { id: "sprinkle-shield", front: 26, back: 12 },
  { id: "taffy-trail", front: 24, back: 8 },
  { id: "fizzy-pop", front: 12, back: 14 },
  { id: "sugar-spark", front: 6, back: 18 },
  { id: "jam-bubble", front: 2, back: 20 },
  { id: "shooting-star", front: 0, back: 14 },
];

/** mulberry32 — identical in every browser, which is what keeps clients agreed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seed for one crate pickup. Derived from values every client already holds,
 * so the roll needs no round trip and cannot drift between machines.
 */
export function pickupSeed(racerId: string, boxIndex: number, lap: number) {
  let hash = 0x811c9dc5;
  const key = `${racerId}:${boxIndex}:${lap}`;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Roll an item. `positionFraction` is 0 for the leader and 1 for last place;
 * with a single racer it is treated as the front of the field.
 */
export function rollPowerUp(seed: number, positionFraction: number): PowerUp {
  const f = positionFraction < 0 ? 0 : positionFraction > 1 ? 1 : positionFraction;
  const weights = WEIGHT_TABLE.map((row) => ({
    id: row.id,
    weight: row.front + (row.back - row.front) * f,
  }));
  const total = weights.reduce((sum, row) => sum + row.weight, 0);

  let ticket = rng(seed)() * total;
  for (const row of weights) {
    ticket -= row.weight;
    if (ticket <= 0) return POWER_UPS[row.id];
  }
  return POWER_UPS["moonberry-burst"];
}

/** Position fraction from a 1-based race position. */
export function positionFraction(position: number, fieldSize: number) {
  if (fieldSize <= 1) return 0;
  return (position - 1) / (fieldSize - 1);
}

export type ActiveEffect = {
  id: PowerUpId;
  /** Seconds remaining. */
  remaining: number;
  /** Set while the target has been warned but the effect has not landed. */
  warning: number;
  sourceId: string | null;
};

/** Advance an effect list, dropping anything that has expired. */
export function stepEffects(effects: ActiveEffect[], dt: number): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  for (const effect of effects) {
    if (effect.warning > 0) {
      const warning = effect.warning - dt;
      out.push({ ...effect, warning: Math.max(0, warning) });
      continue;
    }
    const remaining = effect.remaining - dt;
    if (remaining > 0) out.push({ ...effect, remaining });
  }
  return out;
}

/** Speed multiplier from everything currently affecting a racer. */
export function speedMultiplier(effects: ActiveEffect[]) {
  let multiplier = 1;
  for (const effect of effects) {
    if (effect.warning > 0) continue;
    if (effect.id === "moonberry-burst") multiplier *= 1.45;
    else if (effect.id === "shooting-star") multiplier *= 1.55;
    else if (effect.id === "jam-bubble") multiplier *= 0.62;
    else if (effect.id === "taffy-trail") multiplier *= 0.55;
  }
  return multiplier;
}

/** True while an effect is actively taking control away. */
export function isDisabled(effects: ActiveEffect[]) {
  return effects.some((e) => e.warning <= 0 && e.id === "sugar-spark" && e.remaining > 0);
}

/** A shield eats the next hit. Returns the surviving effect list. */
export function absorbHit(effects: ActiveEffect[]): { blocked: boolean; effects: ActiveEffect[] } {
  const index = effects.findIndex((e) => e.id === "sprinkle-shield" && e.warning <= 0);
  if (index < 0) return { blocked: false, effects };
  const next = effects.slice();
  next.splice(index, 1);
  return { blocked: true, effects: next };
}
