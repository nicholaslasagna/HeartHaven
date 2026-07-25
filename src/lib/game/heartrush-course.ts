/**
 * HeartRush course planner.
 *
 * Pure data — no three.js — so a course can be generated and validated
 * without a WebGL context. `heartrush-canvas.tsx` turns a plan into meshes;
 * nothing in here knows what a mesh is.
 *
 * Every racer must run the SAME three courses or the finish times mean
 * nothing, so the seed comes from the shared race-start stamp that already
 * travels through the move log. No extra netcode, and nobody can reroll
 * themselves an easier track.
 */

export const HEARTRUSH_LEVELS = 3;

/* Movement constants live here, not in the canvas, so "can the player clear
   this gap?" is answered with the same numbers the physics actually use. */
export const HEARTRUSH_GRAVITY = 52;
export const HEARTRUSH_JUMP_VELOCITY = 17.5;
export const HEARTRUSH_MAX_SPEED = 12.5;

/** Furthest a flat running jump carries, ignoring the dive. ~8.4 units. */
export const HEARTRUSH_MAX_JUMP =
  ((2 * HEARTRUSH_JUMP_VELOCITY) / HEARTRUSH_GRAVITY) * HEARTRUSH_MAX_SPEED;

/** The budget the generator is allowed to spend — this is the "fair" in
    "randomly generated but fair". Every gap is clearable below top speed,
    so the dive is a shortcut and never a requirement. */
export const HEARTRUSH_SAFE_JUMP = HEARTRUSH_MAX_JUMP * 0.75;

/** Biggest step up the generator may place across a gap. */
export const HEARTRUSH_SAFE_RISE = 1;

export type Sway = { range: number; phase: number; speed: number };
export type PadSpec = {
  x: number; y: number; z: number;
  width: number; depth: number; color: number;
  /** Present when the pad slides side to side. */
  sway?: Sway;
};
export type SweeperSpec = {
  x: number; y: number; z: number;
  length: number; speed: number; phase: number; color: number;
};
export type BumperSpec = { x: number; y: number; z: number; radius: number; phase: number };
export type RailSpec = { x: number; y: number; z: number; depth: number };
export type CheckpointSpec = { index: number; x: number; y: number; z: number };

export type CoursePlan = {
  level: number;
  pads: PadSpec[];
  sweepers: SweeperSpec[];
  bumpers: BumperSpec[];
  rails: RailSpec[];
  ramp: { z: number; y: number; length: number } | null;
  checkpoints: CheckpointSpec[];
  finishZ: number;
  /** Where the finish gate arch is drawn. */
  gateZ: number;
};

type Rng = () => number;

/** mulberry32 — small, fast, and identical in every browser. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same race start + same level = same course, on every racer's machine. */
export function heartRushLevelSeed(raceStartAt: number, level: number) {
  return (Math.imul(raceStartAt >>> 0, 2654435761) + (level + 1) * 40503) >>> 0;
}

const PAD_COLOR = 0xfff0d6;
const ARM_COLORS = [0xf2789b, 0xa07ff0, 0x7fc4f0, 0xf6c66a];

const between = (rng: Rng, min: number, max: number) => min + rng() * (max - min);

function shuffled<T>(items: readonly T[], rng: Rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SECTION_KINDS = ["sweepers", "gap", "bumpers", "bridge"] as const;

export function planHeartRushCourse(seed: number, level: number): CoursePlan {
  const rng = mulberry32(seed);
  // 0 on the first level, 1 on the last. Everything scales off this.
  const difficulty = HEARTRUSH_LEVELS > 1 ? level / (HEARTRUSH_LEVELS - 1) : 0;

  const plan: CoursePlan = {
    level,
    pads: [],
    sweepers: [],
    bumpers: [],
    rails: [],
    ramp: null,
    checkpoints: [],
    finishZ: 0,
    gateZ: 0,
  };

  // Start pad. The spawn checkpoint sits on it.
  plan.pads.push({ x: 0, y: 0, z: 4, width: 16, depth: 16, color: 0xffd9e4 });
  plan.checkpoints.push({ index: 0, x: 0, y: 0, z: 0 });
  let z = -4;

  /* A short solid pad after every section: guarantees a safe landing, keeps
     the respawn cheap, and means no two hazards can ever run together. */
  const connector = (from: number) => {
    const depth = 8;
    const center = from - depth / 2;
    plan.pads.push({ x: 0, y: 0, z: center, width: 12, depth, color: PAD_COLOR });
    plan.checkpoints.push({ index: plan.checkpoints.length, x: 0, y: 0, z: center });
    return from - depth;
  };

  const sweeperSection = (from: number) => {
    const width = between(rng, 12, 15);
    const arms = 2 + Math.round(difficulty * 2);
    const spacing = between(rng, 8, 10);
    const depth = spacing * arms + 6;
    plan.pads.push({ x: 0, y: 0, z: from - depth / 2, width, depth, color: PAD_COLOR });
    for (let i = 0; i < arms; i += 1) {
      plan.sweepers.push({
        x: 0,
        y: 1.2,
        z: from - 5 - i * spacing,
        // Short enough that the ends never overhang the platform edge.
        length: width * 0.78,
        speed: (rng() < 0.5 ? -1 : 1) * between(rng, 1.2, 1.4 + difficulty * 1.2),
        phase: rng() * Math.PI * 2,
        color: ARM_COLORS[i % ARM_COLORS.length],
      });
    }
    return from - depth;
  };

  const gapSection = (from: number) => {
    const count = 3 + Math.round(difficulty * 2);
    const depth = 5;
    const spacing = 8.2;
    const swayRange = between(rng, 3, 3.5 + difficulty * 1.5);
    const swaySpeed = between(rng, 0.9, 1.05 + difficulty * 0.35);
    const basePhase = rng() * Math.PI * 2;
    for (let i = 0; i < count; i += 1) {
      plan.pads.push({
        x: 0,
        y: 0,
        z: from - 4 - i * spacing,
        width: 6,
        depth,
        color: 0xbfe6ff,
        /* Neighbours share one rhythm and a small phase step, so the pads
           drift together and the jump between them never stretches past
           the budget — the timing is the challenge, not the distance. */
        sway: { range: swayRange, phase: basePhase + i * 0.28, speed: swaySpeed },
      });
    }
    return from - 4 - (count - 1) * spacing - depth / 2;
  };

  const bumperSection = (from: number) => {
    const width = 14;
    const count = 4 + Math.round(difficulty * 3);
    const depth = 10 + count * 3;
    plan.pads.push({ x: 0, y: 0, z: from - depth / 2, width, depth, color: 0xffe0ef });
    // Keep them off the lip: a bump should cost tempo, not the whole run.
    const limit = width / 2 - 3;
    const lane = (depth - 10) / Math.max(1, count - 1);
    for (let i = 0; i < count; i += 1) {
      plan.bumpers.push({
        x: between(rng, -limit, limit),
        y: 0.8,
        z: from - 6 - i * lane,
        radius: between(rng, 1, 1.35),
        phase: rng() * Math.PI * 2,
      });
    }
    return from - depth;
  };

  const bridgeSection = (from: number) => {
    const width = 3.4 - difficulty * 0.8;
    const depth = between(rng, 20, 26);
    const center = from - depth / 2;
    plan.pads.push({ x: 0, y: 0, z: center, width, depth, color: 0xd8c8ff });
    for (const side of [-1, 1]) {
      plan.rails.push({ x: side * (width / 2 + 0.1), y: 0.4, z: center, depth });
    }
    return from - depth;
  };

  const build = { sweepers: sweeperSection, gap: gapSection, bumpers: bumperSection, bridge: bridgeSection };

  // Two sections on level 1, four on level 3 — longer as well as harder.
  for (const kind of shuffled(SECTION_KINDS, rng).slice(0, 2 + level)) {
    z = build[kind](z);
    z = connector(z);
  }

  /* Finish: a run-up, a stepped ramp (the arcade collision is AABB tops, so
     a slope is a stack of shallow steps) and a raised gate deck. */
  const runUp = 12;
  plan.pads.push({ x: 0, y: 0, z: z - runUp / 2, width: 10, depth: runUp, color: PAD_COLOR });
  z -= runUp;

  const steps = 10;
  plan.ramp = { z: z - steps / 2, y: 1.1, length: steps };
  for (let i = 0; i < steps; i += 1) {
    plan.pads.push({ x: 0, y: 0.25 + i * 0.29, z: z - 0.5 - i, width: 8, depth: 1.05, color: 0xffc98d });
  }
  z -= steps;

  const deckY = 0.25 + (steps - 1) * 0.29;
  plan.pads.push({ x: 0, y: deckY, z: z - 6, width: 14, depth: 12, color: 0xc8ffd8 });
  plan.gateZ = z - 4;
  plan.finishZ = z - 2;

  return plan;
}

/**
 * Worst jump the plan ever demands, and the biggest step up across a gap.
 * Used by the fairness check — if either exceeds its budget the course is
 * not completable and the generator has a bug.
 */
export function heartRushWorstJump(plan: CoursePlan) {
  // Nearest to the start first; the player always travels toward -Z.
  const pads = plan.pads.slice().sort((a, b) => b.z - a.z);
  let jump = 0;
  let rise = 0;

  for (let i = 0; i < pads.length - 1; i += 1) {
    const near = pads[i];
    const far = pads[i + 1];
    const gapZ = (near.z - near.depth / 2) - (far.z + far.depth / 2);
    if (gapZ <= 0) continue; // Overlapping or touching: walk across.

    let centerDx: number;
    if (near.sway && far.sway && near.sway.speed === far.sway.speed) {
      // Same rhythm, so the separation is bounded by the phase difference.
      let worst = 0;
      for (let s = 0; s < 128; s += 1) {
        const t = (s / 128) * Math.PI * 2;
        const a = near.x + Math.sin(t + near.sway.phase) * near.sway.range;
        const b = far.x + Math.sin(t + far.sway.phase) * far.sway.range;
        worst = Math.max(worst, Math.abs(a - b));
      }
      centerDx = worst;
    } else {
      // Different rhythms drift apart eventually — assume they do.
      centerDx = Math.abs(near.x - far.x) + (near.sway?.range ?? 0) + (far.sway?.range ?? 0);
    }

    const lateral = Math.max(0, centerDx - (near.width / 2 + far.width / 2));
    jump = Math.max(jump, Math.hypot(gapZ, lateral));
    rise = Math.max(rise, far.y - near.y);
  }

  return { jump, rise };
}
