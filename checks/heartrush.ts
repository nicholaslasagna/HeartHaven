/**
 * HeartRush course generator check.
 *
 *   npm run check:heartrush
 *
 * The courses are generated from a seed at runtime, so nobody ever sees them
 * before a player does. Two things therefore have to hold for every seed,
 * not just the ones that got played during development:
 *
 *   1. Determinism. Every racer builds the course locally from the shared
 *      race start time. If two machines could disagree, players would fall
 *      through platforms that exist on someone else's screen.
 *   2. Fairness. "Randomly generated but fair" means no gap may exceed what
 *      a flat running jump covers. A single unfair seed is an unwinnable
 *      race for everyone in it.
 *
 * heartRushWorstJump and the SAFE_* budgets existed but nothing called them,
 * so the guarantee was documented rather than enforced. This enforces it.
 */
import assert from "node:assert/strict";
import {
  planHeartRushCourse,
  heartRushWorstJump,
  heartRushLevelSeed,
  mulberry32,
  HEARTRUSH_LEVELS,
  HEARTRUSH_SAFE_JUMP,
  HEARTRUSH_SAFE_RISE,
  HEARTRUSH_MAX_JUMP,
} from "../src/lib/game/heartrush-course";

const results: string[] = [];
const SEEDS = 3000;

/* -- determinism: the whole of multiplayer rests on this -- */
{
  const seed = heartRushLevelSeed(1_700_000_000_000, 1);
  const a = JSON.stringify(planHeartRushCourse(seed, 1));
  const b = JSON.stringify(planHeartRushCourse(seed, 1));
  assert.equal(a, b, "the same seed must build the same course, or clients desync");

  // A different race, or a different level, must not reuse the same course.
  const other = JSON.stringify(planHeartRushCourse(heartRushLevelSeed(1_700_000_000_001, 1), 1));
  assert.notEqual(a, other, "a different race start must give a different course");
  const nextLevel = JSON.stringify(planHeartRushCourse(heartRushLevelSeed(1_700_000_000_000, 2), 2));
  assert.notEqual(a, nextLevel, "a different level must give a different course");

  // The seed derivation itself must be stable, not just the plan.
  assert.equal(heartRushLevelSeed(1_700_000_000_000, 1), heartRushLevelSeed(1_700_000_000_000, 1));

  // And the PRNG must be a pure function of its seed.
  const r1 = mulberry32(12345); const r2 = mulberry32(12345);
  const draws1 = Array.from({ length: 50 }, () => r1());
  const draws2 = Array.from({ length: 50 }, () => r2());
  assert.deepEqual(draws1, draws2, "mulberry32 must be reproducible");
  results.push("seeding   same seed = same course · new race or level = new course · prng reproducible");
}

/* -- fairness across a wide sweep of seeds -- */
{
  let worstJump = 0;
  let worstRise = 0;
  let worstSeed = "";
  let courses = 0;

  for (let s = 0; s < SEEDS; s += 1) {
    const raceStartAt = 1_700_000_000_000 + s * 9973;
    for (let level = 0; level < HEARTRUSH_LEVELS; level += 1) {
      const seed = heartRushLevelSeed(raceStartAt, level);
      const plan = planHeartRushCourse(seed, level);
      const { jump, rise } = heartRushWorstJump(plan);
      courses += 1;

      assert.ok(
        jump <= HEARTRUSH_SAFE_JUMP,
        `seed ${seed} level ${level} demands a ${jump.toFixed(2)} jump, over the ${HEARTRUSH_SAFE_JUMP.toFixed(2)} budget`,
      );
      assert.ok(
        jump < HEARTRUSH_MAX_JUMP,
        `seed ${seed} level ${level} is physically impossible: ${jump.toFixed(2)} > ${HEARTRUSH_MAX_JUMP.toFixed(2)}`,
      );
      assert.ok(
        rise <= HEARTRUSH_SAFE_RISE,
        `seed ${seed} level ${level} steps up ${rise.toFixed(2)} across a gap, over ${HEARTRUSH_SAFE_RISE}`,
      );

      if (jump > worstJump) { worstJump = jump; worstSeed = `${seed}/${level}`; }
      worstRise = Math.max(worstRise, rise);
    }
  }
  const headroom = ((1 - worstJump / HEARTRUSH_MAX_JUMP) * 100).toFixed(0);
  results.push(
    `fairness  ${courses} courses · worst jump ${worstJump.toFixed(2)} of ${HEARTRUSH_MAX_JUMP.toFixed(2)} possible (${headroom}% headroom, seed ${worstSeed}) · worst rise ${worstRise.toFixed(2)}`,
  );
}

/* -- the finish must sit AT or BEYOND the gate --
   finishZ used to be `z - 2` while gateZ was `z - 4`. Since the runner
   travels toward -Z, the run completed two units in FRONT of the arch and
   the player never passed through it. */
{
  for (let s = 0; s < 200; s += 1) {
    for (let level = 0; level < HEARTRUSH_LEVELS; level += 1) {
      const plan = planHeartRushCourse(heartRushLevelSeed(1_700_000_000_000 + s * 7919, level), level);
      assert.ok(
        plan.finishZ <= plan.gateZ,
        `the run must not finish before the gate: finishZ ${plan.finishZ} > gateZ ${plan.gateZ}`,
      );
      // The finish must land on the deck, not past its far edge.
      const deck = plan.pads[plan.pads.length - 1];
      assert.ok(
        plan.finishZ <= deck.z + deck.depth / 2 && plan.finishZ >= deck.z - deck.depth / 2,
        "the finish plane must lie on the final deck",
      );
    }
  }
  results.push("finish    crossing the gate ends the run · finish plane sits on the deck");
}

/* -- structure: nothing NaN, checkpoints ordered, courses get longer -- */
{
  const lengths: number[] = [];
  for (let level = 0; level < HEARTRUSH_LEVELS; level += 1) {
    const plan = planHeartRushCourse(heartRushLevelSeed(1_700_000_000_000, level), level);
    lengths.push(Math.abs(plan.finishZ));

    for (const pad of plan.pads) {
      for (const [key, value] of Object.entries(pad)) {
        if (typeof value === "number") {
          assert.ok(Number.isFinite(value), `pad.${key} must be finite, got ${value}`);
        }
      }
      assert.ok(pad.width > 0 && pad.depth > 0, "every pad must have a positive footprint");
    }

    // Checkpoints run from the spawn toward the finish, never backwards.
    for (let i = 1; i < plan.checkpoints.length; i += 1) {
      assert.ok(
        plan.checkpoints[i].z < plan.checkpoints[i - 1].z,
        "checkpoints must advance toward -Z",
      );
    }
    assert.ok(plan.checkpoints.length >= 2, "a course needs a spawn and at least one checkpoint");
  }

  for (let i = 1; i < lengths.length; i += 1) {
    assert.ok(lengths[i] > lengths[i - 1], `level ${i} must be longer than level ${i - 1}`);
  }
  results.push(`structure no NaN · checkpoints advance · course grows ${lengths.map((l) => Math.round(l)).join(" -> ")}`);
}

console.log(`\nHeartRush: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
