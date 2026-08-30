/**
 * Remote character pacing check.
 *
 *   npm run check:remote-interpolation
 *
 * Written for a specific report: "pets look choppy when another player is
 * controlling them — keepers walk just fine". Both travel over the same
 * channel at the same rate, so the difference was never the network. The
 * pet's glide was timed from how far the KEEPER had moved, so a player
 * driving their companion — keeper standing still — gave their pet the
 * "barely moved" glide and it froze between packets.
 *
 * stallFraction is the measure that matters: the share of each packet
 * interval a character spends motionless because its glide ended early.
 */
import assert from "node:assert/strict";
import {
  remoteGlideMs,
  stallFraction,
  REMOTE_GLIDE_MIN_MS,
  REMOTE_GLIDE_MAX_MS,
  REMOTE_GLIDE_DEFAULT_MS,
} from "../src/lib/game/remote-interpolation";

const results: string[] = [];

/* -- the reported bug, as numbers -- */
{
  // Positions are sent every 120ms by the garden canvas.
  const ARRIVAL = 120;

  // What the pet used to get when its owner drove it: the keeper had not
  // moved, so the pet took the short "barely moved" tween.
  const oldPetGlide = 100;
  const before = stallFraction(oldPetGlide, ARRIVAL);
  assert.ok(before > 0, "the old pacing did stall — that is the reported choppiness");

  // What it gets now: the measured arrival interval.
  const after = stallFraction(remoteGlideMs(ARRIVAL), ARRIVAL);
  assert.equal(after, 0, "a glide paced to the arrival interval never stalls");
  assert.ok(after < before, "and it is strictly better than what it replaced");

  // The old receive poll made it worse: sampling a 120ms stream every 250ms
  // meant updates landed ~250ms apart while the pet still glided for 100ms.
  const beforeWithOldPoll = stallFraction(oldPetGlide, 250);
  assert.ok(beforeWithOldPoll > 0.5,
    `the pet used to stand still for most of each interval, got ${(beforeWithOldPoll * 100).toFixed(0)}%`);
  assert.equal(stallFraction(remoteGlideMs(250), 250), 0, "even at the old poll rate the new pacing is continuous");

  results.push(`reported  old pet pacing stalled ${(before * 100).toFixed(0)}% of each 120ms interval (${(beforeWithOldPoll * 100).toFixed(0)}% at the old 250ms poll) · now 0%`);
}

/* -- pacing tracks whatever the connection actually does -- */
{
  for (const interval of [90, 100, 120, 165, 200, 250, 300, 420]) {
    assert.equal(stallFraction(remoteGlideMs(interval), interval), 0,
      `a steady ${interval}ms connection must glide continuously`);
  }

  // Clamps: a burst of packets must not produce a jittery micro-glide, and a
  // long gap must not leave a character sliding for a full second.
  assert.equal(remoteGlideMs(10), REMOTE_GLIDE_MIN_MS, "very close packets clamp up to the floor");
  assert.equal(remoteGlideMs(5000), REMOTE_GLIDE_MAX_MS, "a long stall clamps down to the ceiling");
  assert.equal(remoteGlideMs(null), REMOTE_GLIDE_DEFAULT_MS, "the first update uses the default");
  assert.equal(remoteGlideMs(undefined), REMOTE_GLIDE_DEFAULT_MS, "so does a missing interval");
  assert.equal(remoteGlideMs(Number.NaN), REMOTE_GLIDE_DEFAULT_MS, "and junk never yields NaN");
  assert.ok(REMOTE_GLIDE_MIN_MS < REMOTE_GLIDE_MAX_MS, "the clamp range must be the right way round");

  // Monotonic: a slower connection never glides faster.
  let previous = 0;
  for (let interval = 0; interval <= 600; interval += 10) {
    const glide = remoteGlideMs(interval);
    assert.ok(glide >= previous, `glide went backwards at ${interval}ms`);
    previous = glide;
  }
  results.push(`pacing    continuous from 90ms to 420ms · clamped either side · monotonic · junk falls back to ${REMOTE_GLIDE_DEFAULT_MS}ms`);
}

/* -- stallFraction itself -- */
{
  assert.equal(stallFraction(120, 120), 0, "gliding exactly the interval is continuous");
  assert.equal(stallFraction(200, 120), 0, "gliding longer than the interval is also continuous");
  assert.equal(stallFraction(60, 120), 0.5, "half the interval means standing still half the time");
  assert.equal(stallFraction(0, 120), 1, "no glide at all is a hard snap every packet");
  assert.equal(stallFraction(100, 0), 0, "a zero interval cannot be divided by");
  results.push("measure   stall is 0 when the glide covers the interval, 1 when there is no glide at all");
}

console.log(`\nRemote interpolation: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
