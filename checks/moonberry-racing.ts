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
import {
  KART, NO_KART_INPUT, chargeBand, createKart, stepKart,
  applyBoostPad, applyCollision, applySpinout, respawnKart,
  type KartInput, type SurfaceInfo,
} from "../src/lib/game/moonberry-racing/kart";
import {
  createLapProgress, updateLapProgress, racePositions, respawnPose, startingGrid,
  validateCourse, sampleCourse, courseLength, courseTangent, projectToCourse, type Course,
} from "../src/lib/game/moonberry-racing/track";
import {
  POWER_UPS, MAX_CONTROL_LOSS, rollPowerUp, pickupSeed, positionFraction,
  stepEffects, speedMultiplier, absorbHit, isDisabled, type ActiveEffect,
} from "../src/lib/game/moonberry-racing/powerups";
import { MOONBERRY_COURSES } from "../src/lib/game/moonberry-racing/courses";
import { Race, COUNTDOWN_MS, FINISH_GRACE_MS } from "../src/lib/game/moonberry-racing/race";
import { MoonberryRacingRenderer } from "../src/lib/game/moonberry-racing/renderer";

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
    shortcuts: [{ from: 0.40, to: 0.48, points: [], gate: "narrow", risk: "tight" }],
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

console.log(`\nMoonberry Racing: all checks passed\n${results.map((l) => `  ${l}`).join("\n")}\n`);
