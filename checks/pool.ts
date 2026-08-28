/**
 * Pool rack and session-state check.
 *
 *   npm run check:pool
 *
 * Written after multiplayer Pool was found to reject every shot. The server
 * racked nine object balls and hardcoded `length <> 10`; the client had been
 * upgraded to a fifteen-ball triangle and racked sixteen. Every submission
 * came back 'invalid settled ball state', so nobody could take a turn.
 *
 * What made it invisible for months is that parsePoolSessionMetadata
 * rebuilt the list from the LOCAL rack and merged the server's rows in by
 * id, so the client silently invented the six balls the server had never
 * racked instead of disagreeing out loud. Both halves are pinned here.
 */
import assert from "node:assert/strict";
import {
  createInitialPoolBalls,
  parsePoolSessionMetadata,
  createInitialPoolSessionMetadata,
  getCueBall,
  stepPoolPhysics,
  launchCueBall,
  POOL_OBJECT_BALL_COUNT,
  POOL_BALL_RADIUS,
  POOL_TABLE,
  type PoolBall,
} from "../src/lib/game/pool-physics";

const results: string[] = [];
const EXPECTED = POOL_OBJECT_BALL_COUNT + 1; // the cue rides along

/* -- the rack itself -- */
{
  const balls = createInitialPoolBalls();
  assert.equal(balls.length, EXPECTED, `the rack must be ${EXPECTED} balls (cue + ${POOL_OBJECT_BALL_COUNT})`);
  assert.equal(new Set(balls.map((b) => b.id)).size, EXPECTED, "ball ids must be unique");
  assert.equal(balls.filter((b) => b.kind === "cue").length, 1, "exactly one cue ball");

  const numbers = balls.filter((b) => b.kind === "object").map((b) => b.number).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(numbers, Array.from({ length: POOL_OBJECT_BALL_COUNT }, (_, i) => i + 1),
    "object balls must be numbered 1..N with no gaps or repeats");

  // Every ball starts on the felt, and no two are interpenetrating.
  const felt = POOL_TABLE.felt;
  for (const ball of balls) {
    assert.ok(ball.x - POOL_BALL_RADIUS >= felt.x && ball.x + POOL_BALL_RADIUS <= felt.x + felt.width,
      `${ball.id} starts outside the felt horizontally (x=${ball.x})`);
    assert.ok(ball.y - POOL_BALL_RADIUS >= felt.y && ball.y + POOL_BALL_RADIUS <= felt.y + felt.height,
      `${ball.id} starts outside the felt vertically (y=${ball.y})`);
  }
  for (let i = 0; i < balls.length; i += 1) {
    for (let j = i + 1; j < balls.length; j += 1) {
      const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
      assert.ok(d >= POOL_BALL_RADIUS * 2 - 1e-6,
        `${balls[i].id} and ${balls[j].id} start overlapping (${d.toFixed(2)} < ${POOL_BALL_RADIUS * 2})`);
    }
  }
  results.push(`rack      ${EXPECTED} balls, ids unique, numbered 1..${POOL_OBJECT_BALL_COUNT} · all on the table · none overlapping`);
}

/* -- session state must not invent balls the server never sent -- */
{
  const serialize = (b: PoolBall) => ({
    id: b.id, kind: b.kind, number: b.number, label: b.label, color: b.color,
    x: b.x, y: b.y, vx: 0, vy: 0, radius: b.radius, potted: b.potted,
  });

  // A faithful server payload round-trips unchanged.
  const full = createInitialPoolBalls();
  const parsed = parsePoolSessionMetadata(
    { balls: full.map(serialize), currentSeat: 0, scores: [0, 0], shotNumber: 0, shotsRemaining: 12, gameOver: false }, 2);
  assert.equal(parsed.balls.length, EXPECTED, "a full server payload must round-trip to the same count");
  assert.deepEqual(parsed.balls.map((b) => b.id), full.map((b) => b.id), "and keep the server's ids and order");

  /* THE REGRESSION. A server that sends fewer balls must NOT be topped up
     from the local rack — that is what hid the 10-vs-16 mismatch. The parse
     must report what the server actually sent. */
  const short = full.slice(0, 10).map(serialize);
  const shortParsed = parsePoolSessionMetadata(
    { balls: short, currentSeat: 0, scores: [0, 0], shotNumber: 0, shotsRemaining: 12, gameOver: false }, 2);
  assert.equal(shortParsed.balls.length, 10,
    "a short server payload must stay short, not be padded from the local rack");

  // But an unusable payload (no cue) still falls back to a playable table.
  const noCue = full.filter((b) => b.kind !== "cue").map(serialize);
  const recovered = parsePoolSessionMetadata({ balls: noCue }, 2);
  assert.equal(recovered.balls.length, EXPECTED, "a payload with no cue falls back to a full rack");
  assert.ok(getCueBall(recovered.balls), "and the fallback is playable");

  // Junk never throws.
  for (const junk of [null, undefined, 42, "nope", [], { balls: "no" }, { balls: [null, 7] }]) {
    const safe = parsePoolSessionMetadata(junk, 2);
    assert.ok(safe.balls.length > 0 && getCueBall(safe.balls), `junk payload ${JSON.stringify(junk)} must still yield a playable table`);
  }
  results.push("session   server list is trusted verbatim · short payloads stay short · no cue falls back · junk never throws");
}

/* -- physics settles and conserves the table -- */
{
  const balls = createInitialPoolBalls();
  launchCueBall(balls, { x: 1, y: 0.03 }, 1);
  let steps = 0;
  let moving = true;
  while (moving && steps < 120 * 30) {
    moving = stepPoolPhysics(balls, 1 / 120).moving;
    steps += 1;
  }
  assert.ok(!moving, "a full-power break must come to rest");
  assert.equal(balls.length, EXPECTED, "physics must never add or drop a ball");
  for (const ball of balls) {
    assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y), `${ball.id} went non-finite`);
    if (ball.potted) continue;
    const f = POOL_TABLE.felt;
    assert.ok(ball.x >= f.x - 1 && ball.x <= f.x + f.width + 1
      && ball.y >= f.y - 1 && ball.y <= f.y + f.height + 1,
      `${ball.id} escaped the felt at ${ball.x.toFixed(1)},${ball.y.toFixed(1)}`);
  }

  // Determinism: the same break twice gives bit-identical results, which is
  // what lets the opponent replay a shot instead of being sent every frame.
  const replay = createInitialPoolBalls();
  launchCueBall(replay, { x: 1, y: 0.03 }, 1);
  for (let i = 0; i < steps; i += 1) stepPoolPhysics(replay, 1 / 120);
  assert.deepEqual(replay.map((b) => [b.id, b.x, b.y, b.potted]), balls.map((b) => [b.id, b.x, b.y, b.potted]),
    "the same shot must simulate identically, or opponent replay desyncs");

  const potted = balls.filter((b) => b.potted).length;
  results.push(`physics   break settles in ${(steps / 120).toFixed(1)}s · ${EXPECTED} balls kept · none escape · replay is bit-identical (${potted} potted)`);
}

/* -- a fresh session's metadata agrees with the rack -- */
{
  const meta = createInitialPoolSessionMetadata(4);
  assert.equal(meta.balls.length, EXPECTED, "fresh session metadata must carry the full rack");
  assert.equal(meta.scores.length, 4, "one score per player");
  assert.equal(meta.currentSeat, 0, "play starts at seat 0");
  results.push("metadata  fresh session carries the full rack · one score per seat");
}

console.log(`\nPool: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
