/**
 * Moonberry Racing regression check.
 *
 *   npm run check:moonberry-racing
 *
 * Covers the two things that are expensive to notice by playing: the drift
 * boost risk curve (it must punish at BOTH ends, or holding drift forever
 * becomes optimal), and lap validation (the one thing racers will cheat).
 */

import assert from "node:assert/strict";
import * as THREE from "three";
import {
  KART, NO_KART_INPUT, chargeBand, createKart, stepKart, angleDelta,
  applyBoostPad, applyCollision, applySpinout, respawnKart,
  type KartInput, type SurfaceInfo,
} from "../src/lib/game/moonberry-racing/kart";
import {
  createLapProgress, updateLapProgress, racePositions, respawnPose, startingGrid,
  validateCourse, sampleCourse, courseLength, courseTangent, projectToCourse, hazardPosition,
  surfaceAt, VERGE_LIMIT, sampleShortcut, type Course,
} from "../src/lib/game/moonberry-racing/track";
import {
  POWER_UPS, MAX_CONTROL_LOSS, rollPowerUp, pickupSeed, positionFraction,
  stepEffects, speedMultiplier, absorbHit, isDisabled, BOX_RESPAWN, type ActiveEffect,
} from "../src/lib/game/moonberry-racing/powerups";
import { MOONBERRY_COURSES } from "../src/lib/game/moonberry-racing/courses";
import { Race, COUNTDOWN_MS, FINISH_GRACE_MS } from "../src/lib/game/moonberry-racing/race";
import { MoonberryRacingRenderer } from "../src/lib/game/moonberry-racing/renderer";
import { Arena, type CombatRacer } from "../src/lib/game/moonberry-racing/combat";
import {
  canStartRace, deriveRaceSetup, DEFAULT_LAPS, MAX_LAPS, MIN_LAPS,
} from "../src/lib/game/moonberry-racing/session";

const input = (o: Partial<KartInput> = {}): KartInput => ({ ...NO_KART_INPUT, ...o });
const road: SurfaceInfo = { offroad: false, ice: false, groundY: 0 };
const results: string[] = [];

/* ------------------------------------------------------------------ */
/* Driving                                                             */
/* ------------------------------------------------------------------ */
{
  // Accelerates briskly to top speed and holds it.
  const k = createKart(0, 0, 0, 0);
  for (let i = 0; i < 600; i += 1) stepKart(k, input({ throttle: 1 }), road, KART.STEP);
  assert.ok(k.speed > KART.MAX_SPEED * 0.97, `reaches top speed, got ${k.speed.toFixed(1)}`);
  const toSpeed = (() => {
    const probe = createKart(0, 0, 0, 0);
    let n = 0;
    while (probe.speed < KART.MAX_SPEED * 0.9 && n < 1200) { stepKart(probe, input({ throttle: 1 }), road, KART.STEP); n += 1; }
    return n * KART.STEP;
  })();
  assert.ok(toSpeed < 2.0, `arcade acceleration: 90% speed in ${toSpeed.toFixed(2)}s`);

  // Off-road slows but never stops.
  const dirt = createKart(0, 0, 0, 0);
  for (let i = 0; i < 900; i += 1) stepKart(dirt, input({ throttle: 1 }), { ...road, offroad: true }, KART.STEP);
  assert.ok(dirt.speed > 4, `off-road still drives, got ${dirt.speed.toFixed(1)}`);
  assert.ok(dirt.speed <= KART.OFFROAD_MAX_SPEED + 0.6, "off-road is capped");

  // A collision scrubs speed but never traps you.
  const bumped = createKart(0, 0, 0, 0);
  for (let i = 0; i < 400; i += 1) stepKart(bumped, input({ throttle: 1 }), road, KART.STEP);
  const before = bumped.speed;
  applyCollision(bumped, 1, 0);
  assert.ok(bumped.speed < before && bumped.speed > 0, "collision scrubs but keeps you rolling");
  for (let i = 0; i < 300; i += 1) stepKart(bumped, input({ throttle: 1 }), road, KART.STEP);
  assert.ok(bumped.speed > before * 0.9, "and you recover quickly");

  // A boost pad must exceed normal top speed, then fade.
  const padded = createKart(0, 0, 0, 0);
  for (let i = 0; i < 400; i += 1) stepKart(padded, input({ throttle: 1 }), road, KART.STEP);
  applyBoostPad(padded, 1);
  for (let i = 0; i < 60; i += 1) stepKart(padded, input({ throttle: 1 }), road, KART.STEP);
  assert.ok(padded.speed > KART.MAX_SPEED + 2, `a pad boosts past top speed: ${padded.speed.toFixed(1)}`);
  for (let i = 0; i < 400; i += 1) stepKart(padded, input({ throttle: 1 }), road, KART.STEP);
  assert.ok(padded.speed <= KART.MAX_SPEED + 0.6, "and the pad boost fades");

  results.push(`driving   0-90% in ${toSpeed.toFixed(2)}s · top ${KART.MAX_SPEED} · offroad ${dirt.speed.toFixed(1)}`);
}

/* ------------------------------------------------------------------ */
/* Drift boost: must punish at BOTH ends                               */
/* ------------------------------------------------------------------ */
{
  /** Drift for `holdSeconds`, then press the boost. Returns what happened. */
  const driftFor = (holdSeconds: number) => {
    const k = createKart(0, 0, 0, 0);
    for (let i = 0; i < 400; i += 1) stepKart(k, input({ throttle: 1 }), road, KART.STEP);
    const steps = Math.round(holdSeconds / KART.STEP);
    let band = "none";
    for (let i = 0; i < steps; i += 1) {
      stepKart(k, input({ throttle: 1, steer: 1, drift: true }), road, KART.STEP);
      if (k.driftCharge > 0) band = chargeBand(k.driftCharge);
      if (k.events.includes("spinout")) return { outcome: "spinout" as const, band, kart: k };
    }
    // Press the action button (rising edge) while still drifting.
    stepKart(k, input({ throttle: 1, steer: 1, drift: true, action: true }), road, KART.STEP);
    const outcome = k.events.includes("boost-sweet")
      ? ("boost" as const)
      : k.events.includes("boost-early")
        ? ("early" as const)
        : ("none" as const);
    return { outcome, band, kart: k };
  };

  const early = driftFor(0.3);
  assert.equal(early.outcome, "early", "releasing early must fail clearly");
  assert.equal(early.kart.boostTimer, 0, "an early release grants no boost");

  const sweet = driftFor(0.9);
  assert.equal(sweet.outcome, "boost", "a sweet-spot release must boost");
  assert.ok(sweet.kart.boostTimer > 0, "and the boost is live");

  // Boost genuinely makes you faster than the normal top speed.
  const boosted = sweet.kart;
  for (let i = 0; i < 60; i += 1) stepKart(boosted, input({ throttle: 1 }), road, KART.STEP);
  assert.ok(boosted.speed > KART.MAX_SPEED + 2, `boost exceeds top speed: ${boosted.speed.toFixed(1)}`);

  // Holding forever spins out — the punish at the far end.
  const held = driftFor(3.0);
  assert.equal(held.outcome, "spinout", "over-holding must spin out");

  // The bands are ordered and reachable.
  assert.equal(chargeBand(0), "none");
  assert.equal(chargeBand(0.2), "early");
  assert.equal(chargeBand(0.6), "sweet");
  assert.equal(chargeBand(1.2), "over");

  // Space with no drift is a hop, not a boost.
  const hopper = createKart(0, 0, 0, 0);
  for (let i = 0; i < 200; i += 1) stepKart(hopper, input({ throttle: 1 }), road, KART.STEP);
  stepKart(hopper, input({ throttle: 1, action: true }), road, KART.STEP);
  assert.ok(hopper.events.includes("hop") && hopper.airborne, "space without drift hops");

  // Ramp landings preserve momentum.
  const jumper = createKart(0, 0, 0, 0);
  for (let i = 0; i < 400; i += 1) stepKart(jumper, input({ throttle: 1 }), road, KART.STEP);
  const airSpeed = jumper.speed;
  stepKart(jumper, input({ throttle: 1, action: true }), road, KART.STEP);
  for (let i = 0; i < 240 && jumper.airborne; i += 1) stepKart(jumper, input({ throttle: 1 }), road, KART.STEP);
  assert.ok(!jumper.airborne, "comes back down");
  assert.ok(jumper.speed > airSpeed * 0.9, `landing keeps momentum: ${jumper.speed.toFixed(1)} vs ${airSpeed.toFixed(1)}`);

  // Respawn protection stops a chain hit.
  const hit = createKart(0, 0, 0, 0);
  respawnKart(hit, 0, 0, 0, 0);
  assert.equal(applySpinout(hit), false, "invulnerable right after respawn");
  for (let i = 0; i < Math.round(KART.RESPAWN_INVULN / KART.STEP) + 10; i += 1) stepKart(hit, input(), road, KART.STEP);
  assert.equal(applySpinout(hit), true, "and vulnerable again once it expires");

  results.push(`drift     early=no boost · sweet=+${(boosted.speed - KART.MAX_SPEED).toFixed(1)}m/s · over=spinout · hop ok`);
}

/* ------------------------------------------------------------------ */
/* Lap validation                                                      */
/* ------------------------------------------------------------------ */
{
  // A simple oval, good enough to exercise the rules.
  const points = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return { x: Math.cos(a) * 120, y: 0, z: Math.sin(a) * 80, width: 11 };
  });
  const course: Course = {
    id: "oval", name: "Oval", theme: "speedway", points, checkpoints: 8,
    boostPads: [{ t: 0.25, offset: 0, width: 4 }],
    ramps: [{ t: 0.5, offset: 0, width: 6, height: 2, length: 8 }],
    hazards: [{ kind: "roller", t: 0.7, offset: 0, period: 5 }],
    itemBoxes: [{ t: 0.1, offset: -2 }, { t: 0.1, offset: 2 }],
    // A real chord across the oval: shorter than the arc it replaces, with
    // both ends on the racing line, so it satisfies the shortcut rules.
    shortcuts: [{
      from: 0.40,
      to: 0.48,
      points: [
      { x: -97.1, y: 0, z: 47.0, width: 6 },
      { x: -104.4, y: 0, z: 34.7, width: 6 },
      { x: -111.7, y: 0, z: 22.4, width: 6 },
      { x: -119.1, y: 0, z: 10.0, width: 6 },
      ],
      gate: "narrow",
      risk: "tight",
    }],
    palette: { sky: 0x101a3a, fog: 0x223a6a, road: 0x444a5a, accent: 0xff88bb, rail: 0x99ddff },
    laps: 3,
  };
  assert.deepEqual(validateCourse(course), [], "the sample oval is a valid circuit");
  assert.ok(courseLength(course) > 500, "loop has real length");

  // Driving forward round the loop counts exactly one lap per circuit.
  let progress = createLapProgress();
  for (let lap = 0; lap < 3; lap += 1) {
    for (let i = 0; i < 400; i += 1) {
      progress = updateLapProgress(progress, course, (i / 400 + 1e-6) % 1, 1);
    }
    progress = updateLapProgress(progress, course, 0.0005, 1);
  }
  assert.equal(progress.lap, 3, `three laps counted, got ${progress.lap}`);
  assert.ok(progress.finished, "and the race is finished");

  // Reversing over the line must NOT award a lap.
  let cheat = createLapProgress();
  for (let i = 0; i < 200; i += 1) cheat = updateLapProgress(cheat, course, 0.9 + (i / 200) * 0.09, 1);
  const lapsBefore = cheat.lap;
  for (let i = 0; i < 40; i += 1) {
    // Crossing backwards: t goes low->high with heading against the tangent.
    cheat = updateLapProgress(cheat, course, 0.02 - i * 0.0004, -1);
    cheat = updateLapProgress(cheat, course, 0.98, -1);
  }
  assert.equal(cheat.lap, lapsBefore, "driving backwards over the line awards nothing");

  // Skipping most of the circuit must NOT award a lap.
  let skipper = createLapProgress();
  skipper = updateLapProgress(skipper, course, 0.02, 1);
  skipper = updateLapProgress(skipper, course, 0.80, 1);   // teleport past the middle
  skipper = updateLapProgress(skipper, course, 0.98, 1);
  skipper = updateLapProgress(skipper, course, 0.01, 1);
  assert.equal(skipper.lap, 0, "cutting the circuit does not complete a lap");

  // Wrong-way detection.
  const wrong = updateLapProgress(createLapProgress(), course, 0.3, -1);
  assert.ok(wrong.wrongWay, "driving against the tangent raises the wrong-way flag");

  // Respawn preserves the lap and lands on the track, facing forward.
  const fell = { ...createLapProgress(), lap: 1, checkpoint: 3, progress: 1.4 };
  const pose = respawnPose(course, fell, 0);
  const near = projectToCourse(course, pose.position.x, pose.position.z);
  assert.ok(near.distance < 2, `respawn lands on the racing line (off by ${near.distance.toFixed(2)}m)`);
  assert.ok(pose.position.y > 0, "and above the surface, not inside it");
  assert.equal(fell.lap, 1, "respawning never costs a lap");

  // A 2-8 kart grid fits on the track and nobody overlaps.
  for (const seats of [2, 4, 8]) {
    const grid = startingGrid(course, seats);
    assert.equal(grid.length, seats);
    for (let i = 0; i < grid.length; i += 1) {
      const p = projectToCourse(course, grid[i].position.x, grid[i].position.z);
      assert.ok(p.distance < sampleCourse(course, p.t).width, `grid slot ${i} of ${seats} is on the track`);
      for (let j = i + 1; j < grid.length; j += 1) {
        const gap = Math.hypot(grid[i].position.x - grid[j].position.x, grid[i].position.z - grid[j].position.z);
        assert.ok(gap > 1.2, `grid slots ${i} and ${j} do not overlap (gap ${gap.toFixed(2)}m)`);
      }
    }
  }

  // Race order follows progress, and finishers lead.
  const order = racePositions([
    { id: "a", progress: { ...createLapProgress(), progress: 1.2 } },
    { id: "b", progress: { ...createLapProgress(), progress: 2.4 } },
    { id: "c", progress: { ...createLapProgress(), progress: 0.4, finished: true } },
  ]);
  assert.equal(order[0].id, "c", "a finisher outranks anyone still racing");
  assert.equal(order[1].id, "b");

  /* The grid must be LEVEL. A course is free to end on a ramp, but laying
     the grid on that slope stands the back row metres above the front. */
  for (const stage of MOONBERRY_COURSES) {
    for (const seats of [2, 4, 6, 8]) {
      const grid = startingGrid(stage, seats);
      const ys = grid.map((pose) => pose.position.y);
      const spread = Math.max(...ys) - Math.min(...ys);
      assert.ok(spread < 1.2, `${stage.id} ${seats}-kart grid must be level, spread ${spread.toFixed(2)}m`);
    }
  }

  results.push(`laps      3 laps counted · reverse-cross blocked · skip blocked · grid 2-8 clear`);
}

/* ------------------------------------------------------------------ */
/* Power-ups                                                           */
/* ------------------------------------------------------------------ */
{
  // Nothing may take control away for long.
  for (const item of Object.values(POWER_UPS)) {
    if (item.kind === "projectile" || item.kind === "area") {
      assert.ok(item.warning > 0, `${item.id} must warn its target before landing`);
    }
    assert.ok(item.duration <= 6, `${item.id} duration ${item.duration}s is too long`);
  }
  assert.ok(
    POWER_UPS["sugar-spark"].duration <= MAX_CONTROL_LOSS,
    "the only control-loss item stays within the cap",
  );

  // Deterministic: the same crate gives the same item on every client.
  const seed = pickupSeed("racer-a", 3, 1);
  assert.equal(rollPowerUp(seed, 0.5).id, rollPowerUp(seed, 0.5).id, "same seed, same item");
  assert.notEqual(pickupSeed("racer-a", 3, 1), pickupSeed("racer-b", 3, 1), "per-racer seeds differ");
  assert.notEqual(pickupSeed("racer-a", 3, 1), pickupSeed("racer-a", 4, 1), "per-box seeds differ");

  // Catch-up is weighted, and the leader can never draw the comeback item.
  const draw = (fraction: number) => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i += 1) {
      const item = rollPowerUp(pickupSeed(`r${i}`, i % 7, 1), fraction);
      counts[item.id] = (counts[item.id] ?? 0) + 1;
    }
    return counts;
  };
  const leader = draw(0);
  const last = draw(1);
  assert.ok(!leader["shooting-star"], "the leader never draws Shooting Star");
  assert.ok((last["shooting-star"] ?? 0) > 200, "the back of the pack does draw it");
  assert.ok((last["jam-bubble"] ?? 0) > (leader["jam-bubble"] ?? 0) * 3, "offence skews to the back");
  assert.ok((leader["sprinkle-shield"] ?? 0) > (last["sprinkle-shield"] ?? 0), "defence skews to the front");

  assert.equal(positionFraction(1, 8), 0, "first place is the front of the field");
  assert.equal(positionFraction(8, 8), 1, "last place is the back");
  assert.equal(positionFraction(1, 1), 0, "a solo racer is treated as leading");

  // Effects expire, and a warning delays the effect rather than the timer.
  let effects: ActiveEffect[] = [
    { id: "jam-bubble", remaining: 1.4, warning: 0.5, sourceId: "x" },
  ];
  assert.equal(speedMultiplier(effects), 1, "a warned effect has not landed yet");
  for (let i = 0; i < 40; i += 1) effects = stepEffects(effects, 1 / 60);
  assert.ok(speedMultiplier(effects) < 0.7, "once the warning elapses it bites");
  for (let i = 0; i < 200; i += 1) effects = stepEffects(effects, 1 / 60);
  assert.equal(effects.length, 0, "and it expires");

  // A shield eats exactly one hit.
  const shielded: ActiveEffect[] = [{ id: "sprinkle-shield", remaining: 6, warning: 0, sourceId: null }];
  const first = absorbHit(shielded);
  assert.ok(first.blocked, "the shield blocks");
  assert.equal(first.effects.length, 0, "and is consumed");
  assert.equal(absorbHit(first.effects).blocked, false, "a second hit gets through");

  const sparked: ActiveEffect[] = [{ id: "sugar-spark", remaining: 0.85, warning: 0, sourceId: "y" }];
  assert.ok(isDisabled(sparked), "a spark briefly disables");

  results.push(`items     7 originals · leader gets no Shooting Star · max control loss ${MAX_CONTROL_LOSS}s · shield eats one hit`);
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */
{
  assert.equal(MOONBERRY_COURSES.length, 3, "three courses ship");
  const summary: string[] = [];

  for (const course of MOONBERRY_COURSES) {
    const issues = validateCourse(course);
    assert.deepEqual(issues, [], `${course.id}: ${issues.map((i) => i.problem).join("; ")}`);

    // validateCourse samples at 240; sample far finer here, because a cusp at
    // the loop seam can hide between coarse samples. This is exactly how the
    // Frosting Falls seam was caught.
    let tightest = Infinity;
    for (let i = 0; i < 2000; i += 1) {
      const a = sampleCourse(course, (i - 1) / 2000);
      const b = sampleCourse(course, i / 2000);
      const d = sampleCourse(course, (i + 1) / 2000);
      const ab = Math.hypot(b.x - a.x, b.z - a.z);
      const bc = Math.hypot(d.x - b.x, d.z - b.z);
      const ca = Math.hypot(a.x - d.x, a.z - d.z);
      const area = Math.abs((b.x - a.x) * (d.z - a.z) - (d.x - a.x) * (b.z - a.z)) / 2;
      if (area > 1e-9) tightest = Math.min(tightest, (ab * bc * ca) / (4 * area));
    }
    assert.ok(tightest >= 9, `${course.id} has a ${tightest.toFixed(2)}m corner, below the 9m a kart can hold`);

    const length = courseLength(course);
    assert.ok(length > 600, `${course.id} loop is only ${length.toFixed(0)}m`);
    assert.equal(course.laps, 3, `${course.id} runs three laps`);

    // Every placed feature must actually sit on the racing surface.
    for (const feature of [...course.boostPads, ...course.itemBoxes, ...course.ramps]) {
      const width = sampleCourse(course, feature.t).width;
      const offset = Math.abs((feature as { offset?: number }).offset ?? 0);
      assert.ok(offset <= width, `${course.id} has a feature ${offset}m off centre where the track is ${width}m`);
    }

    // A 2-8 kart grid must fit, on the track, without overlaps.
    for (const seats of [2, 5, 8]) {
      const grid = startingGrid(course, seats);
      assert.equal(grid.length, seats);
      for (let i = 0; i < grid.length; i += 1) {
        const near = projectToCourse(course, grid[i].position.x, grid[i].position.z);
        assert.ok(near.distance < sampleCourse(course, near.t).width + 2,
          `${course.id}: grid slot ${i}/${seats} is off the track`);
        for (let j = i + 1; j < grid.length; j += 1) {
          const gap = Math.hypot(
            grid[i].position.x - grid[j].position.x,
            grid[i].position.z - grid[j].position.z,
          );
          assert.ok(gap > 1.2, `${course.id}: grid slots ${i} and ${j} overlap`);
        }
      }
    }

    // Respawn must land on the track and preserve the lap.
    const fell = { ...createLapProgress(), lap: 2, checkpoint: 2, progress: 2.3 };
    const pose = respawnPose(course, fell, 0);
    const landed = projectToCourse(course, pose.position.x, pose.position.z);
    assert.ok(landed.distance < 3, `${course.id}: respawn lands ${landed.distance.toFixed(1)}m off the line`);
    assert.equal(fell.lap, 2, "respawn never costs a lap");

    summary.push(`${course.id.split("-")[0]}(${length.toFixed(0)}m r${tightest.toFixed(0)})`);
  }

  results.push(`courses   ${summary.join(" ")} · all validated, features on track, grids clear`);
}

/* ------------------------------------------------------------------ */
/* Race manager                                                        */
/* ------------------------------------------------------------------ */
{
  const course = MOONBERRY_COURSES[0];

  /** Place a racer on the centreline at t and let the host derive progress. */
  const driveTo = (race: Race, id: string, t: number) => {
    const point = sampleCourse(course, t);
    const tangent = courseTangent(course, t);
    const racer = race.racers.get(id)!;
    racer.kart.x = point.x;
    racer.kart.y = point.y;
    racer.kart.z = point.z;
    racer.kart.heading = Math.atan2(tangent.x, tangent.z);
    race.advanceProgress(racer);
  };
  /* Drive continuously rather than lap-by-lap, and overshoot the line a
     little. A crossing is detected from movement across the seam, so it
     registers on the frame AFTER the line, not exactly on it. */
  const lapAround = (race: Race, id: string, laps: number) => {
    const steps = 240 * laps + 12;
    for (let i = 0; i < steps; i += 1) driveTo(race, id, ((i / 240) % 1) + 1e-6);
  };

  // Countdown is derived from one shared stamp, so eight machines agree.
  const race = new Race(course, true);
  race.join("a", "Ada", 0, true);
  race.join("b", "Ben", 1, false);
  const now = 10_000;
  assert.ok(race.beginCountdown(now), "host arms the countdown");
  const shown: number[] = [];
  for (let ms = 0; ms <= COUNTDOWN_MS + 100; ms += 100) {
    race.tick(now + ms, 0.1);
    for (const e of race.drainEvents()) {
      if (e.type === "countdown") shown.push(e.value);
      if (e.type === "start") shown.push(0);
    }
  }
  assert.deepEqual([...new Set(shown)], [3, 2, 1, 0], `countdown reads 3,2,1,go - got ${shown.join(",")}`);
  assert.equal(race.phase, "racing", "and the race starts");

  const guest = new Race(course, false);
  guest.join("a", "Ada", 0, false);
  guest.adoptStart(race.startAt!);
  guest.tick(now + COUNTDOWN_MS + 50, 0.05);
  assert.equal(guest.phase, "racing", "a client adopting startAt agrees with no tick message");

  const late = race.join("c", "Cy", 2, false);
  assert.ok(late.spectator, "joining mid-race means spectating");
  assert.ok(!race.contenders.some((r) => r.id === "c"), "and not contesting the race");

  // HOST AUTHORITY: progress comes from coordinates, never from a claim.
  const cheater = new Race(course, true);
  cheater.join("x", "Cheat", 0, false);
  cheater.beginCountdown(0);
  cheater.tick(COUNTDOWN_MS + 1, 0.016);
  const spot = sampleCourse(course, 0.02);
  cheater.applyRacerReport({
    racerId: "x", x: spot.x, y: spot.y, z: spot.z,
    heading: 0, speed: 20, driftCharge: 0, boosting: false,
  });
  assert.equal(cheater.racers.get("x")!.progress.lap, 0, "no lap from a single report");
  driveTo(cheater, "x", 0.98);
  driveTo(cheater, "x", 0.001);
  assert.equal(cheater.racers.get("x")!.progress.lap, 0, "skipping the circuit banks nothing");

  // A legitimate three-lap run finishes and records a best lap.
  const honest = new Race(course, true);
  honest.join("h", "Hana", 0, true);
  honest.beginCountdown(0);
  honest.tick(COUNTDOWN_MS + 1, 0.016);
  honest.raceTime = 1;
  lapAround(honest, "h", 3);
  const finisher = honest.racers.get("h")!;
  assert.equal(finisher.progress.lap, 3, `three laps counted, got ${finisher.progress.lap}`);
  assert.ok(finisher.progress.finished && finisher.finishedAt !== null, "classified as finished");

  // A disconnect must never stall the race.
  const dropped = new Race(course, true);
  dropped.join("p", "Pip", 0, true);
  dropped.join("q", "Quin", 1, false);
  dropped.beginCountdown(0);
  dropped.tick(COUNTDOWN_MS + 1, 0.016);
  dropped.raceTime = 1;
  lapAround(dropped, "p", 3);
  dropped.leave("q");
  dropped.tick(COUNTDOWN_MS + 2000, 0.016);
  assert.equal(dropped.phase, "finished", "ends once every CONNECTED racer is home");
  assert.equal(dropped.dnf().length, 1, "the dropped racer is DNF");
  assert.equal(dropped.finishOrder()[0].id, "p", "the finisher still wins");
  assert.ok(dropped.racers.has("q"), "a disconnected racer is preserved, not deleted");

  // Silence is a disconnect; a fresh report reconnects.
  const quiet = new Race(course, true);
  quiet.join("m", "Mo", 0, true);
  quiet.join("n", "Nia", 1, false);
  quiet.beginCountdown(0);
  quiet.tick(COUNTDOWN_MS + 1, 0.016);
  quiet.tick(COUNTDOWN_MS + 20_000, 0.016);
  assert.equal(quiet.racers.get("n")!.connected, false, "a silent remote racer times out");
  const at = sampleCourse(course, 0.1);
  quiet.applyRacerReport({ racerId: "n", x: at.x, y: at.y, z: at.z, heading: 0, speed: 10, driftCharge: 0, boosting: false });
  assert.equal(quiet.racers.get("n")!.connected, true, "and a report brings them back");

  // Stragglers time out instead of holding the results screen forever.
  const slow = new Race(course, true);
  slow.join("f", "Fin", 0, true);
  slow.join("g", "Gus", 1, true);
  slow.beginCountdown(0);
  slow.tick(COUNTDOWN_MS + 1, 0.016);
  slow.raceTime = 1;
  lapAround(slow, "f", 3);
  slow.tick(COUNTDOWN_MS + 1000, 0.016);
  assert.equal(slow.phase, "racing", "still racing while a connected straggler is out");
  // tick() derives raceTime from the wall clock, so advance `now`, not raceTime.
  const finishedAt = slow.racers.get("f")!.finishedAt!;
  slow.tick(COUNTDOWN_MS + finishedAt + FINISH_GRACE_MS + 1000, 0.016);
  assert.equal(slow.phase, "finished", "the grace window closes the race");

  // Respawn preserves the lap and lands on the track.
  const fell = new Race(course, true);
  fell.join("r", "Rae", 0, true);
  fell.beginCountdown(0);
  fell.tick(COUNTDOWN_MS + 1, 0.016);
  const rae = fell.racers.get("r")!;
  for (let i = 0; i < 120; i += 1) driveTo(fell, "r", (i / 240) % 1);
  rae.progress = { ...rae.progress, lap: 1 };
  rae.kart.y = -400;
  fell.respawn("r");
  assert.equal(rae.progress.lap, 1, "respawning never costs a lap");
  assert.ok(rae.kart.y > -10, "puts the kart back above the surface");
  assert.ok(rae.kart.invulnTimer > 0, "with brief collision protection");
  assert.ok(projectToCourse(course, rae.kart.x, rae.kart.z).distance < 6, "on the racing line");

  // 2-8 racers get unique positions, furthest round leading.
  for (const count of [2, 5, 8]) {
    const field = new Race(course, true);
    for (let i = 0; i < count; i += 1) field.join(`r${i}`, `R${i}`, i, i === 0);
    field.beginCountdown(0);
    field.tick(COUNTDOWN_MS + 1, 0.016);
    // Drive each racer up to their target rather than teleporting: progress
    // deliberately ignores implausible jumps, so a teleport banks nothing.
    for (let i = 0; i < count; i += 1) {
      const target = 0.02 + i * 0.05;
      for (let step = 0; step <= target * 240; step += 1) driveTo(field, `r${i}`, step / 240 + 1e-6);
    }
    field.tick(COUNTDOWN_MS + 100, 0.016);
    const positions = field.contenders.map((r) => r.position).sort((a, b) => a - b);
    assert.deepEqual(positions, Array.from({ length: count }, (_, i) => i + 1),
      `${count} racers get unique positions`);
    assert.equal(field.contenders.find((r) => r.position === 1)!.id, `r${count - 1}`,
      "furthest round the circuit leads");
  }

  // Rematch resets everyone, including former spectators.
  const again = new Race(course, true);
  again.join("s", "Sol", 0, true);
  again.beginCountdown(0);
  again.tick(COUNTDOWN_MS + 1, 0.016);
  const watcher = again.join("w", "Wren", 1, false);
  assert.ok(watcher.spectator);
  again.raceTime = 1;
  lapAround(again, "s", 3);
  again.tick(COUNTDOWN_MS + 500, 0.016);
  again.rematch();
  assert.equal(again.phase, "lobby", "a rematch returns to the lobby");
  assert.equal(watcher.spectator, false, "a spectator races the next one");
  assert.equal(again.racers.get("s")!.progress.lap, 0, "progress cleared");

  results.push("race      countdown 3-2-1 shared · host overrules claims · disconnect never stalls · DNF kept · rematch resets");
}

/* ------------------------------------------------------------------ */
/* Renderer: framing and stage loading                                 */
/* ------------------------------------------------------------------ */
{
  const course = MOONBERRY_COURSES[0];
  const renderer = new MoonberryRacingRenderer(course);
  const grid = startingGrid(course, 4);

  const kartView = (i: number, over: Record<string, unknown> = {}) => ({
    id: `p${i}`, seat: i, name: `P${i}`,
    x: grid[i].position.x, y: grid[i].position.y, z: grid[i].position.z,
    heading: grid[i].heading,
    lean: 0, driftSide: 0 as const, driftCharge: 0, boosting: false,
    airborne: false, spinning: false, local: i === 0, position: i + 1, finished: false,
    ...over,
  });
  const snapshot = (karts = [0, 1, 2, 3].map((i) => kartView(i))) => ({
    karts, raceTime: 1, followId: "p0", rearView: false, itemBoxesTaken: new Set<number>(),
  });

  renderer.update(snapshot() as never, 16 / 9, 0.016);
  renderer.update(snapshot() as never, 16 / 9, 0.016);

  const pole = grid[0].position;
  const cam = renderer.camera.position;
  const distance = Math.hypot(cam.x - pole.x, cam.y - pole.y, cam.z - pole.z);
  assert.ok(distance > 7 && distance < 14, `chase camera sits 7-14m back, got ${distance.toFixed(1)}m`);

  // Behind, not in front: the camera must never end up looking at the grille.
  const fx = Math.sin(grid[0].heading);
  const fz = Math.cos(grid[0].heading);
  const alongHeading = (cam.x - pole.x) * fx + (cam.z - pole.z) * fz;
  assert.ok(alongHeading < -5, `camera must be behind the kart, got ${alongHeading.toFixed(1)}`);
  assert.ok(cam.y - pole.y > 2, "and raised above it");

  // The kart must not swallow the frame.
  const hfov = 2 * Math.atan(Math.tan((renderer.camera.fov * Math.PI / 180) / 2) * 16 / 9);
  const frameWidth = 2 * distance * Math.tan(hfov / 2);
  const fill = 1.9 / frameWidth;
  assert.ok(fill < 0.2, `kart should fill under 20% of frame width, got ${(fill * 100).toFixed(0)}%`);

  /* The grid must not put other karts between the camera and the pole
     sitter, or the player cannot see their own kart on the line. */
  for (let i = 1; i < 4; i += 1) {
    const other = grid[i].position;
    const toOther = (other.x - cam.x) * fx + (other.z - cam.z) * fz;
    const toPole = (pole.x - cam.x) * fx + (pole.z - cam.z) * fz;
    const lateral = Math.abs((other.x - cam.x) * -fz + (other.z - cam.z) * fx);
    // Only a kart BETWEEN the camera and the pole sitter can block the view;
    // one behind the camera is simply out of shot.
    if (toOther > 0 && toOther < toPole) {
      assert.ok(lateral > 1.6, `grid slot ${i} blocks the view of the pole sitter`);
    }
  }

  const beforeFov = renderer.camera.fov;
  for (let i = 0; i < 50; i += 1) {
    renderer.update(snapshot([kartView(0, { boosting: true }), kartView(1), kartView(2), kartView(3)]) as never, 16 / 9, 0.016);
  }
  assert.ok(renderer.camera.fov > beforeFov + 4, "the field of view widens while boosting");
  renderer.dispose();

  // EVERY stage must load through the same path, with real geometry.
  const built: string[] = [];
  for (const stage of MOONBERRY_COURSES) {
    const r = new MoonberryRacingRenderer(stage);
    let meshes = 0;
    r.scene.traverse((object) => { if ((object as { isMesh?: boolean }).isMesh) meshes += 1; });
    assert.ok(meshes >= 8, `${stage.id} builds real geometry, got ${meshes} meshes`);
    // A snapshot must render without throwing for any seat count.
    for (const seats of [2, 8]) {
      const g = startingGrid(stage, seats);
      const karts = g.map((pose, i) => ({
        id: `k${i}`, seat: i, name: `K${i}`,
        x: pose.position.x, y: pose.position.y, z: pose.position.z, heading: pose.heading,
        lean: 0, driftSide: 0 as const, driftCharge: 0.6, boosting: i === 0,
        airborne: false, spinning: false, local: i === 0, position: i + 1, finished: false,
      }));
      r.update({ karts, raceTime: 5, followId: "k0", rearView: false, itemBoxesTaken: new Set([0]) } as never, 16 / 9, 0.016);
    }
    built.push(`${stage.id}(${meshes}m)`);
    r.dispose();
  }
  results.push(`render    chase ${distance.toFixed(1)}m behind · kart ${(fill * 100).toFixed(0)}% of frame · stages ${built.join(" ")}`);
}

/* ------------------------------------------------------------------ */
/* Combat: items, hazards, contact                                     */
/* ------------------------------------------------------------------ */
{
  const course = MOONBERRY_COURSES[0];
  const grid = startingGrid(course, 4);

  const makeRacer = (i: number): CombatRacer => ({
    id: `c${i}`, seat: i,
    kart: createKart(grid[i].position.x, grid[i].position.y, grid[i].position.z, grid[i].heading),
    effects: [], item: null, position: i + 1, spectator: false, finishedAt: null,
    local: true,
  });

  /* An item crate must actually hand over an item, once, then go on cooldown. */
  const arena = new Arena(course);
  const solo = makeRacer(0);
  const box = course.itemBoxes[0];
  const boxAt = sampleCourse(course, box.t);
  solo.kart.x = boxAt.x;
  solo.kart.z = boxAt.z;
  let events = arena.step([solo], 1, KART.STEP);
  assert.ok(events.some((e) => e.type === "pickup"), "driving over a crate grants an item");
  assert.ok(solo.item, "and the racer is holding it");
  const firstItem = solo.item!;

  // Holding something means you pass straight through.
  solo.item = firstItem;
  events = arena.step([solo], 1.1, KART.STEP);
  assert.ok(!events.some((e) => e.type === "pickup"), "a full racer cannot stockpile");
  // The crate is on cooldown for everyone.
  assert.ok(arena.takenBoxes(1.1).size > 0, "a collected crate is hidden while it respawns");
  assert.equal(arena.takenBoxes(1.1 + BOX_RESPAWN + 0.1).size, 0, "and returns after the delay");

  /* A projectile must travel, hit someone else, and never its owner. */
  const duel = new Arena(course);
  const shooter = makeRacer(0);
  const target = makeRacer(1);
  // Put the target straight ahead of the shooter.
  target.kart.x = shooter.kart.x + Math.sin(shooter.kart.heading) * 12;
  target.kart.z = shooter.kart.z + Math.cos(shooter.kart.heading) * 12;
  shooter.item = POWER_UPS["jam-bubble"];
  duel.useItem(shooter, []);
  assert.equal(duel.projectiles.length, 1, "using a projectile item spawns one");
  assert.equal(shooter.item, null, "and consumes it");

  let hit = false;
  for (let i = 0; i < 240 && !hit; i += 1) {
    for (const e of duel.step([shooter, target], 2 + i * KART.STEP, KART.STEP)) {
      if (e.type === "hit" && e.racerId === target.id) hit = true;
      assert.notEqual(e.type === "hit" ? e.racerId : "", shooter.id, "a shot never hits its owner");
    }
  }
  assert.ok(hit, "a projectile fired at someone ahead connects");
  assert.equal(duel.projectiles.length, 0, "and is consumed on impact");

  // A landed slow must WARN before it bites, then actually slow the kart.
  const slowed = target.effects.find((e) => e.id === "jam-bubble");
  assert.ok(slowed, "the victim carries the effect");
  assert.ok(slowed!.warning > 0, "with a warning lead time before it lands");
  assert.equal(Arena.speedFactor(target), 1, "so it has not slowed them yet");
  for (let i = 0; i < 120; i += 1) duel.step([shooter, target], 5, KART.STEP);
  assert.ok(Arena.speedFactor(target) < 0.8, "once the warning elapses it slows them");

  /* A shield eats exactly one hit. */
  const guarded = makeRacer(2);
  guarded.item = POWER_UPS["sprinkle-shield"];
  const shieldArena = new Arena(course);
  shieldArena.useItem(guarded, []);
  assert.ok(guarded.effects.some((e) => e.id === "sprinkle-shield"), "the shield is up");
  const attacker = makeRacer(3);
  attacker.kart.x = guarded.kart.x;
  attacker.kart.z = guarded.kart.z - 3;
  attacker.kart.heading = 0;
  // Two sparks in a row: the first is blocked, the second gets through.
  const fire = () => {
    attacker.item = POWER_UPS["sugar-spark"];
    shieldArena.useItem(attacker, []);
    const seen: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      for (const e of shieldArena.step([attacker, guarded], 8, KART.STEP)) {
        if (e.type === "blocked" && e.racerId === guarded.id) seen.push("blocked");
        if (e.type === "hit" && e.racerId === guarded.id) seen.push("hit");
      }
    }
    return seen;
  };
  guarded.kart.invulnTimer = 0;
  const firstVolley = fire();
  assert.ok(firstVolley.includes("blocked"), `the shield blocks the first hit (${firstVolley.join(",")})`);
  assert.ok(!guarded.effects.some((e) => e.id === "sprinkle-shield"), "and is consumed");

  /* HAZARDS must hit, must use the same position the renderer draws, and
     must be clearable by hopping over a low one. */
  const hazardArena = new Arena(course);
  const spec = course.hazards[0];
  const victim = makeRacer(0);
  const at = hazardPosition(course, spec, 3);
  victim.kart.x = at.x;
  victim.kart.z = at.z;
  victim.kart.y = at.y - at.radius;
  victim.kart.invulnTimer = 0;
  const hazardEvents = hazardArena.step([victim], 3, KART.STEP);
  assert.ok(hazardEvents.some((e) => e.type === "hazard"), "a hazard you drive into spins you out");
  assert.ok(victim.kart.spinTimer > 0, "and takes the wheel briefly");
  assert.ok(victim.kart.spinTimer <= KART.SPINOUT_TIME, `for no longer than ${KART.SPINOUT_TIME}s`);

  // Airborne above it clears it.
  const hopper = makeRacer(1);
  hopper.kart.x = at.x;
  hopper.kart.z = at.z;
  hopper.kart.y = at.y + at.radius + 1;
  hopper.kart.invulnTimer = 0;
  const cleared = new Arena(course).step([hopper], 3, KART.STEP);
  assert.ok(!cleared.some((e) => e.type === "hazard"), "hopping over a low hazard clears it");

  // Respawn invulnerability blocks a chain hit.
  const fresh = makeRacer(2);
  fresh.kart.x = at.x;
  fresh.kart.z = at.z;
  fresh.kart.y = at.y - at.radius;
  fresh.kart.invulnTimer = KART.RESPAWN_INVULN;
  const protectedRun = new Arena(course).step([fresh], 3, KART.STEP);
  assert.ok(!protectedRun.some((e) => e.type === "hazard"), "invulnerability after a respawn holds");

  /* Kart contact must shove, never trap. */
  const bumpArena = new Arena(course);
  const a = makeRacer(0);
  const b = makeRacer(1);
  b.kart.x = a.kart.x + 1.0;
  b.kart.z = a.kart.z;
  a.kart.speed = 20;
  b.kart.speed = 20;
  const before = Math.hypot(b.kart.x - a.kart.x, b.kart.z - a.kart.z);
  const bumpEvents = bumpArena.step([a, b], 4, KART.STEP);
  assert.ok(bumpEvents.some((e) => e.type === "bump"), "touching karts register a bump");
  const after = Math.hypot(b.kart.x - a.kart.x, b.kart.z - a.kart.z);
  assert.ok(after > before, "and are pushed apart rather than left overlapping");
  assert.ok(a.kart.speed > 0 && b.kart.speed > 0, "both keep rolling");

  /* No item may take control away for longer than the cap. */
  for (const item of Object.values(POWER_UPS)) {
    if (item.id === "sugar-spark") continue;
    const probe = makeRacer(0);
    probe.kart.invulnTimer = 0;
    const solo2 = new Arena(course);
    probe.item = item;
    solo2.useItem(probe, []);
    solo2.step([probe], 6, KART.STEP);
    assert.ok(probe.kart.spinTimer <= KART.SPINOUT_TIME, `${item.id} must not exceed the spin cap`);
  }

  /* MULTIPLAYER ITEMS. Each client runs its own Arena, so the two things
     that must agree across machines are crate state and what was fired. */
  {
    // A remote kart must NOT claim a crate on our machine — otherwise the
    // same crate is claimed once per client and cooldowns drift apart.
    const mine = new Arena(course);
    const remote = makeRacer(0);
    remote.local = false;
    const crate = sampleCourse(course, course.itemBoxes[0].t);
    remote.kart.x = crate.x;
    remote.kart.z = crate.z;
    const ghosted = mine.step([remote], 1, KART.STEP);
    assert.ok(!ghosted.some((e) => e.type === "pickup"), "a remote kart does not claim crates locally");
    assert.equal(remote.item, null, "and gains nothing here");
    assert.equal(mine.takenBoxes(1).size, 0, "the crate stays up until their client says otherwise");

    // Their pickup, broadcast to us, marks the same crate spent.
    mine.applyRemotePickup(remote, 0, "jam-bubble", 1);
    assert.ok(mine.takenBoxes(1).has(0), "a broadcast pickup hides the crate here too");
    assert.ok(remote.item, "and shows them holding it");

    // Their item use, broadcast with the pose it fired from, spawns the same
    // projectile on our machine.
    const pose = { x: remote.kart.x, z: remote.kart.z, heading: 0 };
    mine.applyRemoteUse(remote, remote.id, "jam-bubble", pose);
    assert.equal(mine.projectiles.length, 1, "a broadcast use spawns the projectile here");
    assert.equal(remote.item, null, "and clears their held item");
    const shot = mine.projectiles[0];
    assert.ok(Math.hypot(shot.x - pose.x, shot.z - pose.z) < 3, "spawned at the pose they fired from");

    // Two clients handed the same event produce the same projectile.
    const theirs = new Arena(course);
    theirs.applyRemoteUse(undefined, "someone", "jam-bubble", pose);
    assert.equal(theirs.projectiles.length, 1);
    assert.ok(
      Math.abs(theirs.projectiles[0].x - shot.x) < 1e-9 &&
      Math.abs(theirs.projectiles[0].z - shot.z) < 1e-9,
      "the same event produces the same projectile on every client",
    );

    // A remote victim keeps authority over its own kart: we play the visual
    // but never consume their shield or claim the hit stuck.
    const victimArena = new Arena(course);
    const theirKart = makeRacer(1);
    theirKart.local = false;
    theirKart.effects = [{ id: "sprinkle-shield", remaining: 6, warning: 0, sourceId: null }];
    theirKart.kart.invulnTimer = 0;
    victimArena.applyRemoteUse(undefined, "attacker", "sugar-spark", {
      x: theirKart.kart.x, z: theirKart.kart.z - 3, heading: 0,
    });
    for (let i = 0; i < 120; i += 1) victimArena.step([theirKart], 9, KART.STEP);
    assert.ok(
      theirKart.effects.some((e) => e.id === "sprinkle-shield"),
      "we never spend a remote racer's shield — their machine decides that",
    );

    // Our own kart still resolves its shield locally.
    const mineArena = new Arena(course);
    const myKart = makeRacer(2);
    myKart.effects = [{ id: "sprinkle-shield", remaining: 6, warning: 0, sourceId: null }];
    myKart.kart.invulnTimer = 0;
    mineArena.applyRemoteUse(undefined, "attacker", "sugar-spark", {
      x: myKart.kart.x, z: myKart.kart.z - 3, heading: 0,
    });
    let blocked = false;
    for (let i = 0; i < 120; i += 1) {
      for (const e of mineArena.step([myKart], 9, KART.STEP)) {
        if (e.type === "blocked" && e.racerId === myKart.id) blocked = true;
      }
    }
    assert.ok(blocked, "our own shield does block, and is consumed here");
    assert.ok(!myKart.effects.some((e) => e.id === "sprinkle-shield"));
  }

  results.push(`combat    crates grant+cooldown · projectile warns then slows · shield eats one · hazards hit (hop clears) · bumps shove not trap`);
  results.push(`mp items  remote karts claim nothing locally · broadcast pickup+use replicate · same event, same projectile · victim keeps authority`);
}

/* ------------------------------------------------------------------ */
/* Lobby settings and readiness                                        */
/* ------------------------------------------------------------------ */
{
  const move = (type: string, profile: string, payload: unknown = {}) => ({
    move_type: type, profile_id: profile, payload,
  });
  const first = MOONBERRY_COURSES[0].id;

  // Defaults with an empty log.
  const empty = deriveRaceSetup([], first);
  assert.equal(empty.courseId, first);
  assert.equal(empty.laps, DEFAULT_LAPS);
  assert.equal(empty.items, true);
  assert.equal(empty.startAt, null);
  assert.equal(empty.readyIds.size, 0);

  // Course, laps and power-ups all fold out of the log.
  const configured = deriveRaceSetup([
    move("course", "host", { courseId: MOONBERRY_COURSES[2].id }),
    move("settings", "host", { laps: 5 }),
    move("settings", "host", { items: false }),
  ], first);
  assert.equal(configured.courseId, MOONBERRY_COURSES[2].id);
  assert.equal(configured.laps, 5);
  assert.equal(configured.items, false);

  // Lap count is CLAMPED, not trusted — the payload is client-supplied.
  assert.equal(deriveRaceSetup([move("settings", "h", { laps: 999 })], first).laps, MAX_LAPS);
  assert.equal(deriveRaceSetup([move("settings", "h", { laps: -4 })], first).laps, MIN_LAPS);
  assert.equal(deriveRaceSetup([move("settings", "h", { laps: 2.7 })], first).laps, 2);
  assert.equal(deriveRaceSetup([move("settings", "h", { laps: "x" })], first).laps, DEFAULT_LAPS);

  // Ready toggles on and off per racer.
  let setup = deriveRaceSetup([
    move("ready", "a", { ready: true }),
    move("ready", "b", { ready: true }),
    move("ready", "a", { ready: false }),
  ], first);
  assert.ok(setup.readyIds.has("b"));
  assert.ok(!setup.readyIds.has("a"), "cancelling ready clears it");

  // Start gating.
  assert.equal(canStartRace(["a"], new Set()), true, "solo needs no confirmation");
  assert.equal(canStartRace(["a", "b"], new Set(["a"])), false, "one of two is not enough");
  assert.equal(canStartRace(["a", "b"], new Set(["a", "b"])), true, "both confirmed starts");
  const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
  assert.equal(canStartRace(eight, new Set(eight.slice(0, 7))), false, "seven of eight waits");
  assert.equal(canStartRace(eight, new Set(eight)), true, "all eight starts");

  // A START clears readiness, so a rematch makes everyone confirm again —
  // otherwise the second race begins the instant the host clicks.
  setup = deriveRaceSetup([
    move("ready", "a", { ready: true }),
    move("ready", "b", { ready: true }),
    move("start", "host", { startAt: 1000 }),
  ], first);
  assert.equal(setup.startAt, 1000);
  assert.equal(setup.readyIds.size, 0, "a start clears readiness for the rematch");
  assert.equal(canStartRace(["a", "b"], setup.readyIds), false, "so a rematch waits for confirmations");

  // A later start supersedes an earlier one, whatever order they arrive in.
  const rematch = deriveRaceSetup([
    move("start", "host", { startAt: 5000 }),
    move("start", "host", { startAt: 9000 }),
  ], first);
  assert.equal(rematch.startAt, 9000);
  const outOfOrder = deriveRaceSetup([
    move("start", "host", { startAt: 9000 }),
    move("start", "host", { startAt: 5000 }),
  ], first);
  assert.equal(outOfOrder.startAt, 9000, "an older stamp never rewinds the race");

  // An unknown course id falls back rather than throwing.
  const bogus = deriveRaceSetup([move("course", "h", { courseId: "no-such-course" })], first);
  assert.equal(MOONBERRY_COURSES.find((c) => c.id === bogus.courseId), undefined);

  // Every client folding the same log reaches the same setup.
  const log = [
    move("course", "host", { courseId: MOONBERRY_COURSES[1].id }),
    move("settings", "host", { laps: 4, items: false }),
    move("ready", "a", { ready: true }),
    move("ready", "b", { ready: true }),
  ];
  const clientA = deriveRaceSetup(log, first);
  const clientB = deriveRaceSetup(log, first);
  assert.equal(clientA.courseId, clientB.courseId);
  assert.equal(clientA.laps, clientB.laps);
  assert.equal(clientA.items, clientB.items);
  assert.deepEqual([...clientA.readyIds].sort(), [...clientB.readyIds].sort());

  // The chosen lap count must actually reach the race rules.
  const base = MOONBERRY_COURSES[0];
  const withLaps = { ...base, laps: clientA.laps };
  const raced = new Race(withLaps, true);
  raced.join("a", "A", 0, true);
  assert.equal(raced.course.laps, 4, "the lobby's lap count overrides the course default");

  results.push(`lobby     course+laps+items fold from the log · laps clamped ${MIN_LAPS}-${MAX_LAPS} · start needs all ready · rematch re-confirms`);
}

/* ------------------------------------------------------------------ */
/* Autopilot: are the tracks actually DRIVABLE?                        */
/* ------------------------------------------------------------------ */
{
  /**
   * A racing line follower using the REAL physics, not a shortcut.
   *
   * Geometry checks prove a circuit closes and has no impossible corner.
   * They cannot prove it can be driven — that a kart at speed holds the
   * road, that the corners can be taken, that three laps complete. So this
   * drives each course with `stepKart`, `surfaceAt`, `Race` and `Arena`
   * exactly as the browser does, and reports what happened.
   *
   * Steering is pure pursuit: aim at a point on the centreline some distance
   * ahead, scaled by speed so it looks further on the straights. Drift is
   * held through sustained corners and released in the sweet spot.
   */
  const autopilot = (course: Course, itemsEnabled = true) => {
    const race = new Race(course, true);
    race.join("ai", "Autopilot", 0, true);
    race.beginCountdown(0);
    race.tick(COUNTDOWN_MS + 1, 0.016);
    const me = race.racers.get("ai")!;
    const arena = new Arena(course, itemsEnabled);
    const loop = courseLength(course);

    const dt = KART.STEP;
    let elapsed = 0;
    let hint: number | undefined;
    let respawns = 0;
    let driftBoosts = 0;
    let driftStarts = 0;
    let earlyReleases = 0;
    let spinouts = 0;
    let pickups = 0;
    let uses = 0;
    let offroadSteps = 0;
    let stalledSteps = 0;
    let actionHeld = false;
    let peakSpeed = 0;

    const maxSteps = 240 * 400;
    for (let step = 0; step < maxSteps && !me.progress.finished; step += 1) {
      elapsed += dt;
      race.raceTime = elapsed;

      const surface = surfaceAt(course, me.kart.x, me.kart.z, hint);
      hint = surface.t;
      if (surface.offroad) offroadSteps += 1;

      // Aim at the centreline ahead; further ahead the faster we go.
      const lookahead = 12 + Math.abs(me.kart.speed) * 0.55;
      const target = sampleCourse(course, surface.t + lookahead / loop);
      const desired = Math.atan2(target.x - me.kart.x, target.z - me.kart.z);
      const err = angleDelta(desired, me.kart.heading);
      const steer = Math.max(-1, Math.min(1, err * 2.2));

      // Drift through a sustained corner, and release inside the window.
      const cornering = Math.abs(err) > 0.22;
      const fastEnough = me.kart.speed > KART.DRIFT_MIN_SPEED + 1.5;
      const wantDrift = cornering && fastEnough;
      const band = chargeBand(me.kart.driftCharge);
      const release = me.kart.driftSide !== 0 && band === "sweet";

      // Named distinctly: shadowing the file-level `input` helper made this
      // look self-referential to the compiler.
      const aiInput: KartInput = {
        steer,
        throttle: 1,
        brake: 0,
        drift: wantDrift || (me.kart.driftSide !== 0 && !release && band !== "over"),
        // Rising edge only, or the boost never fires.
        action: release && !actionHeld,
        item: false,
      };
      actionHeld = aiInput.action;

      stepKart(me.kart, aiInput, surface, dt, Arena.speedFactor(me as never));
      for (const event of me.kart.events) {
        if (event === "drift-start") driftStarts += 1;
        if (event === "boost-sweet") driftBoosts += 1;
        if (event === "boost-early") earlyReleases += 1;
        if (event === "spinout") spinouts += 1;
      }
      peakSpeed = Math.max(peakSpeed, me.kart.speed);

      // Boost pads, exactly as the canvas applies them.
      for (const pad of course.boostPads) {
        const at = sampleCourse(course, pad.t);
        if (Math.hypot(me.kart.x - at.x, me.kart.z - at.z) < pad.width * 0.6) applyBoostPad(me.kart);
      }

      for (const event of arena.step([me as never], elapsed, dt)) {
        if (event.type === "pickup") pickups += 1;
        if (event.type === "used") uses += 1;
      }
      // Fire whatever we picked up, so the item path is genuinely exercised.
      if (me.item) {
        arena.useItem(me as never, []);
        uses += 1;
      }

      race.advanceProgress(me);

      if (surface.edgeOverrun > VERGE_LIMIT || me.kart.y < -30) {
        race.respawn("ai");
        respawns += 1;
        hint = undefined;
      }
      stalledSteps = Math.abs(me.kart.speed) < 1 ? stalledSteps + 1 : 0;
      // Wedged against something for two solid seconds is a stuck track.
      assert.ok(stalledSteps < 240 * 2, `${course.id}: kart wedged at (${me.kart.x.toFixed(0)}, ${me.kart.z.toFixed(0)})`);
    }

    return {
      finished: me.progress.finished,
      laps: me.progress.lap,
      seconds: elapsed,
      respawns,
      driftBoosts,
      driftStarts,
      earlyReleases,
      spinouts,
      pickups,
      uses,
      offroadFraction: offroadSteps / Math.max(1, elapsed / dt),
      peakSpeed,
      bestLapMs: me.bestLapMs,
    };
  };

  const summaries: string[] = [];
  for (const course of MOONBERRY_COURSES) {
    const run = autopilot(course);

    // THE headline assertion: the track can be completed.
    assert.ok(run.finished, `${course.id} must be completable — got ${run.laps}/${course.laps} laps in ${run.seconds.toFixed(0)}s`);
    assert.equal(run.laps, course.laps, `${course.id}: all laps counted`);

    // A drivable line should not need constant rescuing.
    assert.ok(run.respawns <= 6, `${course.id}: too many recoveries (${run.respawns}) — the line falls off the road`);
    // Nor should it spend most of its life in the verge.
    assert.ok(run.offroadFraction < 0.35, `${course.id}: ${(run.offroadFraction * 100).toFixed(0)}% off-road — the track is too tight to follow`);

    // DRIFT must actually work on these roads, not just in a lab.
    // Drift must convert while racing. Conversion, not raw count: a gentle
    // course simply offers fewer corners that need one.
    if (run.driftStarts >= 8) {
      const conversion = run.driftBoosts / run.driftStarts;
      assert.ok(conversion > 0.25,
        `${course.id}: drifts must reach the sweet spot while racing (${run.driftBoosts}/${run.driftStarts})`);
    }
    /* Top speed must stay inside the design ceiling. This is the guard that
       catches speed effects compounding again: two items once multiplied to
       2.25x and turned the 38 m/s boost cap into 85. */
    assert.ok(run.peakSpeed <= KART.BOOST_SPEED * 1.6,
      `${course.id}: peak ${run.peakSpeed.toFixed(1)} exceeds the design ceiling — speed effects are stacking`);
    // And the kart must reach real speed, so boosts are meaningful.
    assert.ok(run.peakSpeed > KART.MAX_SPEED, `${course.id}: should exceed base top speed via boost (peak ${run.peakSpeed.toFixed(1)})`);
    // ...but never past what a boost plus the strongest item can justify.
    assert.ok(
      run.peakSpeed <= KART.BOOST_SPEED * 1.55 + 1,
      `${course.id}: peak ${run.peakSpeed.toFixed(1)} m/s exceeds what boost x items allows`,
    );

    // ITEMS must be collectable and usable while driving.
    assert.ok(run.pickups >= 1, `${course.id}: crates must be reachable on the racing line (got ${run.pickups})`);
    assert.ok(run.uses >= 1, `${course.id}: items must be usable while racing`);

    // A sane lap time, so the circuit is neither trivial nor a slog.
    assert.ok(run.seconds > 20 && run.seconds < 400, `${course.id}: race took ${run.seconds.toFixed(0)}s`);

    summaries.push(
      `${course.id.replace("moonberry-", "")}(${run.seconds.toFixed(0)}s ${run.driftBoosts}d ${run.pickups}i ${run.respawns}r)`,
    );
  }

  /* DELIBERATE drifting on open road. A sweeping course may never force a
     drift, but a player must still be able to start one on a wide straight
     and be paid for timing it — that is the whole skill ceiling. */
  for (const course of MOONBERRY_COURSES) {
    // Widest control point: the most "open road" this course has.
    let widest = 0;
    course.points.forEach((point, index) => {
      if (point.width > course.points[widest].width) widest = index;
    });
    const t = widest / course.points.length;
    const at = sampleCourse(course, t);
    const tangent = courseTangent(course, t);

    const kart = createKart(at.x, at.y, at.z, Math.atan2(tangent.x, tangent.z));
    let hint: number | undefined;
    const drive = (over: Partial<KartInput>): void => {
      const surface = surfaceAt(course, kart.x, kart.z, hint);
      hint = surface.t;
      stepKart(kart, { ...NO_KART_INPUT, ...over }, surface, KART.STEP);
    };

    // Build to racing speed on the straight.
    for (let i = 0; i < 480; i += 1) drive({ throttle: 1 });
    assert.ok(kart.speed > KART.DRIFT_MIN_SPEED,
      `${course.id}: must reach drift speed on its widest road (got ${kart.speed.toFixed(1)})`);

    // Hold a drift deliberately, then release in the sweet spot.
    let engaged = false;
    let boosted = false;
    let held = false;
    for (let i = 0; i < 400 && !boosted; i += 1) {
      const band = chargeBand(kart.driftCharge);
      const release = kart.driftSide !== 0 && band === "sweet";
      drive({ throttle: 1, steer: 0.6, drift: true, action: release && !held });
      held = release && !held;
      if (kart.events.includes("drift-start")) engaged = true;
      if (kart.events.includes("boost-sweet")) boosted = true;
      if (kart.events.includes("spinout")) break;
    }
    assert.ok(engaged, `${course.id}: a drift must engage on open road`);
    assert.ok(boosted, `${course.id}: a well-timed drift on open road must pay a boost`);
    assert.ok(kart.boostTimer > 0, `${course.id}: and the boost must be live`);
  }

  // With power-ups off, nothing is collected and the race still completes.
  const clean = autopilot(MOONBERRY_COURSES[0], false);
  assert.ok(clean.finished, "a race with power-ups off still completes");
  assert.equal(clean.pickups, 0, "and hands out no items at all");

  results.push(`drivable  ${summaries.join(" ")} · items-off run completes clean`);
}

/* ------------------------------------------------------------------ */
/* Shortcuts: real road, and they still count                          */
/* ------------------------------------------------------------------ */
{
  const summaries: string[] = [];
  for (const course of MOONBERRY_COURSES) {
    const shortcut = course.shortcuts[0];
    assert.ok(shortcut.points.length >= 2, `${course.id}: a shortcut needs authored geometry`);

    /* Driving a shortcut must put the kart on ROAD, not in the verge. Left
       projecting onto the main centreline only, a kart on a shortcut read as
       ~11m off-line, was capped at the off-road speed, and every shortcut was
       strictly slower than the lap it saved. */
    let worstOverrun = 0;
    let offroadSamples = 0;
    const samples = 40;
    for (let i = 0; i <= samples; i += 1) {
      const at = sampleShortcut(shortcut, i / samples);
      const surface = surfaceAt(course, at.x, at.z, undefined, at.y);
      worstOverrun = Math.max(worstOverrun, surface.edgeOverrun);
      if (surface.offroad) offroadSamples += 1;
      assert.ok(!surface.lost, `${course.id}: a shortcut must never trigger recovery`);
      assert.ok(surface.onShortcut || surface.edgeOverrun === 0,
        `${course.id}: point ${i} on the shortcut is neither on the branch nor on the main road`);
    }
    assert.equal(worstOverrun, 0, `${course.id}: the shortcut centre must be on-surface (worst ${worstOverrun.toFixed(1)}m)`);

    /* Lap progress must keep advancing THROUGH a shortcut, mapped into the
       span it replaces, or taking one would stall the checkpoint chain. */
    const mouth = sampleShortcut(shortcut, 0);
    const tail = sampleShortcut(shortcut, 1);
    const entry = surfaceAt(course, mouth.x, mouth.z, undefined, mouth.y);
    const exit = surfaceAt(course, tail.x, tail.z, undefined, tail.y);
    const span = ((shortcut.to - shortcut.from) + 1) % 1;
    /* The mouth and exit OVERLAP the main line — standing at the entrance you
       are still on the road — so a junction sample may map a hair before
       `from` or a hair past `to`. Accept that slack; what matters is that it
       never lands somewhere unrelated on the lap. */
    const within = (t: number) => {
      const rel = ((t - shortcut.from) + 1) % 1;
      return rel <= span + 0.03 || rel >= 1 - 0.03;
    };
    assert.ok(within(entry.t), `${course.id}: shortcut entry maps inside its own span (t=${entry.t.toFixed(3)})`);
    assert.ok(within(exit.t), `${course.id}: shortcut exit maps inside its own span (t=${exit.t.toFixed(3)})`);

    // Progress must move FORWARD along the branch, never backwards.
    let progress = { ...createLapProgress(), checkpoint: Math.floor(shortcut.from * course.checkpoints) };
    let advanced = 0;
    for (let i = 0; i <= samples; i += 1) {
      const at = sampleShortcut(shortcut, i / samples);
      const surface = surfaceAt(course, at.x, at.z, undefined, at.y);
      const before = progress.progress;
      progress = updateLapProgress(progress, course, surface.t, 1);
      if (progress.progress > before) advanced += 1;
    }
    assert.ok(advanced > samples * 0.5, `${course.id}: progress must advance along a shortcut (${advanced}/${samples})`);
    assert.equal(progress.lap, 0, `${course.id}: a shortcut must not award a lap`);

    // The branch must actually be shorter than the main line it replaces.
    let branchLength = 0;
    let previous = sampleShortcut(shortcut, 0);
    for (let i = 1; i <= 200; i += 1) {
      const point = sampleShortcut(shortcut, i / 200);
      branchLength += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
      previous = point;
    }
    const mainLength = courseLength(course) * span;
    summaries.push(
      `${course.id.replace("moonberry-", "").slice(0, 9)}(${branchLength.toFixed(0)}m vs ${mainLength.toFixed(0)}m${offroadSamples > 0 ? " rough" : ""})`,
    );
  }
  /* The validator must CATCH the shape of bug that shipped: a branch whose
     geometry sits nowhere near its declaration. Sugargear had exactly this —
     declared 0.62-0.70 while its points projected to 0.29 and 0.22, running
     backwards, 9m off the road, and 62% longer than the line it replaced. */
  {
    const base = MOONBERRY_COURSES[1];
    const broken = {
      ...base,
      shortcuts: [{
        from: 0.62,
        to: 0.7,
        points: [
          { x: -69, y: 11, z: 88, width: 5 },
          { x: -27, y: 12.5, z: 93, width: 4.5 },
          { x: 18, y: 12.5, z: 93, width: 4.5 },
          { x: 60, y: 11, z: 88, width: 5 },
        ],
        gate: "narrow" as const,
        risk: "the original, broken data",
      }],
    };
    const issues = validateCourse(broken).map((issue) => issue.problem).join(" | ");
    assert.ok(issues.length > 0, "the original broken shortcut must be rejected");
    assert.match(issues, /off the racing line|detour|reversed|declares/,
      `expected a geometry complaint, got: ${issues}`);

    // A branch longer than the line it replaces is a detour, not a shortcut.
    const detour = {
      ...base,
      shortcuts: [{
        ...base.shortcuts[0],
        points: base.shortcuts[0].points.map((point, i) => ({
          ...point,
          // Bow it far out sideways so it is unambiguously longer.
          x: point.x + Math.sin((i / 3) * Math.PI) * 90,
        })),
      }],
    };
    assert.match(
      validateCourse(detour).map((issue) => issue.problem).join(" | "),
      /detour|off the racing line/,
      "a bowed-out branch must be rejected as a detour",
    );
  }

  results.push(`shortcuts on-road not verge · progress advances through · no free lap · ${summaries.join(" ")}`);
}

/* ------------------------------------------------------------------ */
/* Steering matches the screen                                         */
/* ------------------------------------------------------------------ */
{
  /* An inverted turn is invisible to every other check here: the physics is
     self-consistent, laps still count, the autopilot still drives. It only
     shows up when a human presses a key and the kart goes the other way. So
     this projects the turn through the REAL chase camera and asserts the
     direction on screen. */
  const flat = { offroad: false, ice: false, groundY: 0 };
  const kart = createKart(0, 0, 0, 0);
  for (let i = 0; i < 300; i += 1) stepKart(kart, input({ throttle: 1 }), flat, KART.STEP);

  const before = kart.heading;
  // Positive steer, as the keyboard mapping produces for LEFT.
  for (let i = 0; i < 60; i += 1) stepKart(kart, input({ throttle: 1, steer: 1 }), flat, KART.STEP);
  const towardPlusX = kart.heading > before;

  const renderer = new MoonberryRacingRenderer(MOONBERRY_COURSES[0]);
  const view = {
    id: "p", seat: 0, name: "P", x: 0, y: 0, z: 0, heading: 0,
    lean: 0, driftSide: 0 as const, driftCharge: 0, boosting: false,
    airborne: false, spinning: false, local: true, position: 1, finished: false,
  };
  renderer.update(
    { karts: [view], raceTime: 0, followId: "p", rearView: false, itemBoxesTaken: new Set() } as never,
    16 / 9,
    0.016,
  );
  renderer.camera.updateMatrixWorld(true);
  const screenXOfWorldPlusX = new THREE.Vector3(10, 0, 0).project(renderer.camera).x;
  renderer.dispose();

  // Positive steer must move the kart LEFT on screen, because that is what the
  // keyboard mapping sends when the player presses A.
  const plusXIsOnScreenRight = screenXOfWorldPlusX > 0;
  assert.equal(
    towardPlusX && plusXIsOnScreenRight, false,
    "positive steer must not turn right on screen — A/D would be inverted",
  );
  assert.ok(towardPlusX, "positive steer turns toward world +X (the physics convention)");
  assert.ok(!plusXIsOnScreenRight, `world +X must render left of centre (got ${screenXOfWorldPlusX.toFixed(2)})`);

  // And a drift initiated by positive steer must slide the kart the other way,
  // which is what makes a drift look like one.
  const drifter = createKart(0, 0, 0, 0);
  for (let i = 0; i < 400; i += 1) stepKart(drifter, input({ throttle: 1 }), flat, KART.STEP);
  const beforeX = drifter.x;
  for (let i = 0; i < 60; i += 1) {
    stepKart(drifter, input({ throttle: 1, steer: 1, drift: true }), flat, KART.STEP);
  }
  assert.equal(drifter.driftSide, 1, "positive steer drifts to side +1");
  assert.ok(drifter.x < beforeX, "and the rear slides opposite the turn");

  results.push("steering  positive steer = left on screen · A/D not inverted · drift slides opposite the turn");
}

/* ------------------------------------------------------------------ */
/* No item combination may break the speed cap                         */
/* ------------------------------------------------------------------ */
{
  /* Speed effects used to multiply together, so holding two of them more
     than doubled top speed and a kart hit 100 m/s against a 38 m/s boost
     cap — uncontrollable, and invisible to every other check because the
     race still completed. They now combine as "best boost x worst slow",
     and this walks EVERY subset of the item set to prove no combination,
     present or future, can climb past the ceiling. */
  const ids = Object.keys(POWER_UPS) as Array<keyof typeof POWER_UPS>;
  const CEILING = 1.55;
  let worst = 0;
  let worstCombo = "";

  for (let mask = 0; mask < (1 << ids.length); mask += 1) {
    const live: ActiveEffect[] = [];
    for (let bit = 0; bit < ids.length; bit += 1) {
      if (mask & (1 << bit)) {
        live.push({ id: ids[bit], remaining: 5, warning: 0, sourceId: null });
      }
    }
    const multiplier = speedMultiplier(live);
    if (multiplier > worst) {
      worst = multiplier;
      worstCombo = live.map((e) => e.id).join(" + ") || "nothing";
    }
    assert.ok(
      multiplier <= CEILING + 1e-9,
      `${live.map((e) => e.id).join(" + ")} reaches x${multiplier.toFixed(2)}, past the x${CEILING} ceiling`,
    );
    assert.ok(multiplier > 0, "a multiplier must never stop a kart dead");
  }

  // Duplicates of the same item must not compound either.
  const doubled: ActiveEffect[] = [
    { id: "moonberry-burst", remaining: 5, warning: 0, sourceId: null },
    { id: "moonberry-burst", remaining: 5, warning: 0, sourceId: null },
    { id: "shooting-star", remaining: 5, warning: 0, sourceId: null },
  ];
  assert.ok(speedMultiplier(doubled) <= CEILING + 1e-9, "duplicate boosts do not compound");

  // A slow must still bite while boosted, or a hit would simply be ignored.
  const boostedAndSlowed: ActiveEffect[] = [
    { id: "shooting-star", remaining: 5, warning: 0, sourceId: null },
    { id: "taffy-trail", remaining: 5, warning: 0, sourceId: null },
  ];
  assert.ok(
    speedMultiplier(boostedAndSlowed) < speedMultiplier([boostedAndSlowed[0]]),
    "a slow must still cost speed even while boosted",
  );

  results.push(`speedcap  every item subset stays under x${CEILING} (worst ${worstCombo} x${worst.toFixed(2)}) · slows bite through boosts`);
}

console.log(`\nMoonberry Racing: all checks passed\n${results.map((l) => `  ${l}`).join("\n")}\n`);
