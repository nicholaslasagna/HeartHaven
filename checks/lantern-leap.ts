/**
 * Lantern Leap regression check.
 *
 *   npm run check:lantern-leap
 *
 * No test framework on purpose — this bundles the real modules with esbuild
 * and asserts against them, so it exercises exactly the code that ships.
 * It covers the three things that are expensive to notice by playing:
 * movement feel, level completability, and co-op behaviour.
 */

import assert from "node:assert/strict";
import {
  MAX_JUMP_DISTANCE,
  MAX_JUMP_HEIGHT,
  MAX_RUN_JUMP_HEIGHT,
  NO_INPUT,
  PHYSICS,
  TILE,
  createPlayerBody,
  stepPlayer,
  type PlayerInput,
  type TileGrid,
} from "../src/lib/game/lantern-leap/physics";
import { parseLevel, validateLevel } from "../src/lib/game/lantern-leap/level";
import { LANTERN_LEAP_LEVELS } from "../src/lib/game/lantern-leap/levels";
import { LanternGame } from "../src/lib/game/lantern-leap/game";

const input = (o: Partial<PlayerInput> = {}): PlayerInput => ({ ...NO_INPUT, ...o });
const flat = (w = 400, h = 20): TileGrid => {
  const tiles = new Uint8Array(w * h);
  for (let x = 0; x < w; x += 1) tiles[(h - 1) * w + x] = TILE.SOLID;
  return { width: w, height: h, tiles };
};
const results: string[] = [];

/* ------------------------------------------------------------------ */
/* Movement                                                            */
/* ------------------------------------------------------------------ */
{
  const grid = flat();

  const body = createPlayerBody(5, 8);
  for (let i = 0; i < 240; i += 1) stepPlayer(body, input(), grid, PHYSICS.STEP);
  assert.ok(body.grounded && Math.abs(body.y - 1) < 1e-3, `rests on the floor (y=${body.y})`);

  const peakOf = (holdSteps: number) => {
    const b = createPlayerBody(5, 1);
    let top = 0;
    for (let i = 0; i < 300; i += 1) { stepPlayer(b, input({ jump: i < holdSteps }), grid, PHYSICS.STEP); top = Math.max(top, b.y); }
    return top - 1;
  };
  const tap = peakOf(6);
  const hold = peakOf(60);
  assert.ok(Math.abs(hold - MAX_JUMP_HEIGHT) < 0.35, `standing jump matches the constant the level validator trusts`);
  assert.ok(tap < hold * 0.75, `variable jump height: tap ${tap.toFixed(2)} << hold ${hold.toFixed(2)}`);

  const runner = createPlayerBody(5, 1);
  let runPeak = 0;
  for (let i = 0; i < 400; i += 1) {
    stepPlayer(runner, input({ moveX: 1, run: true, jump: i > 90 && i < 150 }), grid, PHYSICS.STEP);
    if (i > 90) runPeak = Math.max(runPeak, runner.y);
  }
  assert.ok(Math.abs((runPeak - 1) - MAX_RUN_JUMP_HEIGHT) < 0.45, "running jump matches its constant");
  assert.ok(runPeak - 1 > hold, "running jumps clear more than standing ones");

  // Ground pound: the short hang should lead to a landing, never suspend the
  // keeper for the old accidental ten-second timer.
  const pounder = createPlayerBody(5, 6);
  let poundStarted = false;
  let poundLanded = false;
  for (let i = 0; i < 240; i += 1) {
    stepPlayer(pounder, input({ pound: true }), grid, PHYSICS.STEP);
    poundStarted ||= pounder.events.includes("pound-start");
    if (pounder.events.includes("pound-land")) {
      poundLanded = true;
      break;
    }
  }
  assert.ok(poundStarted && poundLanded && pounder.grounded, "ground pound hangs briefly and lands");

  // Coyote time fires just after the ledge, and expires rather than
  // granting a free mid-air jump.
  const ledge = flat();
  for (let x = 10; x < ledge.width; x += 1) ledge.tiles[(ledge.height - 1) * ledge.width + x] = TILE.EMPTY;
  const walk = (b: ReturnType<typeof createPlayerBody>) => {
    let n = 0;
    while (b.grounded || n === 0) { stepPlayer(b, input({ moveX: 1, run: true }), ledge, PHYSICS.STEP); n += 1; assert.ok(n < 500); }
  };
  const early = createPlayerBody(8, 1); walk(early);
  const beforeEarly = early.vy;
  stepPlayer(early, input({ moveX: 1, jump: true }), ledge, PHYSICS.STEP);
  assert.ok(early.vy > beforeEarly + 10, "coyote jump fires just after the ledge");

  const late = createPlayerBody(8, 1); walk(late);
  for (let i = 0; i < 30; i += 1) stepPlayer(late, input({ moveX: 1 }), ledge, PHYSICS.STEP);
  const beforeLate = late.vy;
  stepPlayer(late, input({ moveX: 1, jump: true }), ledge, PHYSICS.STEP);
  assert.ok(late.vy < beforeLate + 1, "coyote expires; no free mid-air jump");

  // Jump pressed just before landing still fires.
  const buffered = createPlayerBody(5, 6);
  let fired = false;
  for (let i = 0; i < 200 && !fired; i += 1) {
    stepPlayer(buffered, input({ jump: buffered.y < 1.6 && !buffered.grounded }), flat(), PHYSICS.STEP);
    if (buffered.events.includes("jump")) fired = true;
  }
  assert.ok(fired, "jump buffering");

  // No tunnelling through a one-tile floor at any step size we feed it.
  for (const dt of [PHYSICS.STEP, 1 / 60]) {
    const probe = createPlayerBody(2, 1);
    for (let i = 0; i < 700; i += 1) {
      stepPlayer(probe, input({ moveX: 1, run: true, jump: i % 70 === 0 }), grid, dt);
      assert.ok(probe.y > 0.5, `no tunnelling at dt=${dt.toFixed(4)} (step ${i})`);
    }
  }

  // One-ways: up through, land on top.
  const oneway = flat();
  const Y = 3;
  for (let x = 4; x < 12; x += 1) oneway.tiles[(oneway.height - 1 - Y) * oneway.width + x] = TILE.ONEWAY;
  const hopper = createPlayerBody(6, 1);
  let through = false, landed = false;
  for (let i = 0; i < 400; i += 1) {
    stepPlayer(hopper, input({ jump: i < 40 }), oneway, PHYSICS.STEP);
    if (hopper.y > Y + 1.1) through = true;
    if (through && hopper.grounded && hopper.y > Y + 0.9) landed = true;
  }
  assert.ok(through && landed, "one-way platforms pass up and catch on the way down");

  results.push(`movement  standing ${hold.toFixed(2)}t · running ${(runPeak - 1).toFixed(2)}t · reach ${MAX_JUMP_DISTANCE.toFixed(2)}t · tap/hold ${tap.toFixed(2)}/${hold.toFixed(2)}`);
}

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */
{
  assert.ok(LANTERN_LEAP_LEVELS.length > 0, "there is at least one level");
  for (const level of LANTERN_LEAP_LEVELS) {
    const issues = validateLevel(level);
    assert.equal(issues.length, 0, `${level.id}: ${issues.map((i) => i.problem).join("; ")}`);
  }
  // The validator must actually be capable of failing.
  const broken = parseLevel({ id: "broken", name: "b", theme: "dusk", parTime: 60 },
    ["                    ", " p              G   ", "###              ###"]);
  assert.ok(validateLevel(broken).length > 0, "validator rejects an uncrossable pit");

  results.push(`levels    ${LANTERN_LEAP_LEVELS.length} valid · ${LANTERN_LEAP_LEVELS.map((l) => `${l.id}(${l.grid.width}w)`).join(" ")}`);
}

/* ------------------------------------------------------------------ */
/* Co-op                                                               */
/* ------------------------------------------------------------------ */
{
  const level = parseLevel({ id: "mp", name: "MP", theme: "dusk", parTime: 99 }, [
    "                                        ",
    "  p     o                            G  ",
    "  ###########   #######################  ",
    "  ###########   #######################  ",
  ]);
  const run = (g: LanternGame, seconds: number) => { for (let i = 0; i < seconds * 60; i += 1) g.advance(1 / 60); };

  // Eight keepers, shared camera.
  const eight = new LanternGame(level);
  for (let i = 0; i < 8; i += 1) eight.addPlayer(`p${i}`, `P${i}`, i, i === 0);
  run(eight, 1);
  for (const p of eight.players.values()) assert.ok(Number.isFinite(p.body.x + p.body.y), "no NaN with 8 players");
  const tight = eight.cameraFor(16 / 9, 15);
  [...eight.players.values()].forEach((p, i) => { p.body.x = 4 + i * 4; });
  const wide = eight.cameraFor(16 / 9, 15);
  assert.ok(wide.zoom < tight.zoom && wide.zoom > 0.1, "camera zooms out to hold a spread group");

  // A bubble drifts to the living group, and a rescue frees you in place.
  const pair = new LanternGame(level);
  const a = pair.addPlayer("a", "A", 0, true);
  const b = pair.addPlayer("b", "B", 1, true);
  run(pair, 0.5);
  b.body.x = 25; b.body.y = 2;
  a.body.x = 13; a.body.y = -10;
  run(pair, 0.2);
  assert.ok(a.bubbled, "falling bubbles the player");
  run(pair, 3);
  assert.ok(!a.bubbled, "a teammate in range frees the bubble");
  assert.ok(a.body.x > 15, "freed beside the rescuer, not teleported to the checkpoint");

  // Solo play must not deadlock waiting for a rescuer who cannot exist.
  const solo = new LanternGame(level);
  const lone = solo.addPlayer("a", "A", 0, true);
  run(solo, 0.5);
  lone.body.x = 13; lone.body.y = -10;
  run(solo, 0.2);
  assert.ok(lone.bubbled);
  run(solo, 4);
  assert.ok(!lone.bubbled && Math.abs(lone.body.x - level.start.x) < 2, "a lone keeper self-frees at the checkpoint");

  // Remote players decide their own death; we only draw what they tell us.
  const mixed = new LanternGame(level);
  const mine = mixed.addPlayer("me", "Me", 0, true);
  const theirs = mixed.addPlayer("them", "Them", 1, false);
  run(mixed, 0.5);
  mine.body.x = 13; mine.body.y = -10;
  theirs.body.x = 13; theirs.body.y = -10;
  run(mixed, 0.3);
  assert.ok(mine.bubbled, "local player bubbles");
  assert.ok(!theirs.bubbled, "remote player is not bubbled by our simulation");

  // Pickups are shared, whoever touches them.
  const shared = new LanternGame(level);
  shared.addPlayer("a", "A", 0, true);
  const remote = shared.addPlayer("b", "B", 1, false);
  run(shared, 0.5);
  const coin = shared.pickups.find((p) => p.kind === "coin")!;
  remote.body.x = coin.x; remote.body.y = coin.y - 0.7;
  run(shared, 0.1);
  assert.ok(coin.taken, "a remote player's pickup resolves on our screen too");

  results.push("co-op     8 players · group camera · bubble drift + rescue · solo self-free · remote authority · shared pickups");
}

console.log(`\nLantern Leap: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
