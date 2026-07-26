/**
 * Strike Night regression check.
 *
 *   npm run check:strike-night
 *
 * Guards the things that make the bowling real rather than scripted:
 * determinism (the whole multiplayer model rests on it), the oil pattern and
 * late hook, gutters, pin-to-pin deck action, and spare racks.
 */
import assert from "node:assert/strict";
import {
  simulateThrow, laneFriction, LANE_LENGTH, BOWLING, PIN_POSITIONS,
} from "../src/lib/game/strike-night/ball-physics";

// --- determinism: the whole multiplayer model rests on this ---
const a = simulateThrow({ aim: 0.2, power: 0.7, spin: 0.5, seed: 42 });
const b = simulateThrow({ aim: 0.2, power: 0.7, spin: 0.5, seed: 42 });
assert.deepEqual(a.standing, b.standing, "same throw must give the same pins");
assert.equal(a.frames.length, b.frames.length, "same frame count");
const c = simulateThrow({ aim: 0.2, power: 0.7, spin: 0.5, seed: 43 });
assert.ok(a.duration > 0 && c.duration > 0);

// --- oil profile: straight through the heads, biting in the back end ---
assert.ok(laneFriction(0) === BOWLING.OIL_FRICTION, "head of the lane is oiled");
assert.ok(laneFriction(LANE_LENGTH) > laneFriction(LANE_LENGTH * 0.5) * 3, "back end is dry");

// --- a gutter ball knocks nothing down ---
const gutter = simulateThrow({ aim: -1, power: 0.8, spin: 0, seed: 1 });
assert.ok(gutter.gutter, "a full-left aim must find the channel");
assert.equal(gutter.pinCount, 0, `gutter must score 0, got ${gutter.pinCount}`);

// --- hook: spin must actually bend the path, and bend it LATE ---
const straight = simulateThrow({ aim: 0, power: 0.7, spin: 0, seed: 7 });
const hooked = simulateThrow({ aim: 0, power: 0.7, spin: 1, seed: 7 });
const hookAmount = Math.abs(hooked.entryX - straight.entryX);
assert.ok(hookAmount > 0.08, `spin must move the entry point, got ${hookAmount.toFixed(3)}m`);
const midFrame = hooked.frames[Math.floor(hooked.frames.length * 0.35)];
const earlyDrift = Math.abs(midFrame.ball.x - hooked.frames[0].ball.x);
assert.ok(earlyDrift < hookAmount * 0.7, `hook must break late, early drift ${earlyDrift.toFixed(3)} vs total ${hookAmount.toFixed(3)}`);

// --- the game must be winnable: some throw in the skill space strikes ---
let strikes = 0, best = 0; let bestShot = "";
for (let ai = -6; ai <= 6; ai += 1) {
  for (let si = -4; si <= 4; si += 1) {
    for (const power of [0.55, 0.75, 0.95]) {
      const r = simulateThrow({ aim: ai / 12, power, spin: si / 4, seed: 5 });
      if (r.pinCount === 10) strikes += 1;
      if (r.pinCount > best) { best = r.pinCount; bestShot = `aim ${(ai/12).toFixed(2)} spin ${(si/4).toFixed(2)} power ${power}`; }
    }
  }
}
assert.ok(strikes > 0, `a strike must be reachable; best was ${best} (${bestShot})`);

// --- deck action: pins must knock other pins, not just the ones hit ---
// The ball can physically touch at most ~4 pins; more than that means the
// scatter is coming from pin-to-pin contact.
let maxPins = 0;
for (let ai = -4; ai <= 4; ai += 1) {
  const r = simulateThrow({ aim: ai / 10, power: 0.8, spin: 0.6, seed: 11 });
  maxPins = Math.max(maxPins, r.pinCount);
}
assert.ok(maxPins >= 7, `pin-to-pin scatter must carry the deck, best ${maxPins}`);

// --- realistic timing: a real throw reaches the pins in about 2-3s ---
const timed = simulateThrow({ aim: 0.1, power: 0.7, spin: 0.4, seed: 3 });
const arrival = timed.frames.find((f) => f.ball.z >= LANE_LENGTH)?.t ?? 99;
assert.ok(arrival > 1.8 && arrival < 4.2, `ball should reach the deck in ~2-3s, got ${arrival.toFixed(2)}s`);

// --- spares: a second throw only clears pins that were left standing ---
const spare = simulateThrow({ aim: 0.35, power: 0.7, spin: 0, seed: 9 }, [6, 9]);
assert.ok(spare.standing.every((id) => [6, 9].includes(id)), "a spare throw cannot revive cleared pins");
assert.ok(spare.pinCount <= 2, "cannot knock more pins than were standing");

// --- geometry sanity against the regulation rack ---
assert.equal(PIN_POSITIONS.length, 10);
assert.ok(Math.abs(PIN_POSITIONS[6][0] - -0.4572) < 1e-3, "pin 7 sits 18in left of centre");

const spread = new Set<number>();
for (let seed = 0; seed < 40; seed += 1) spread.add(simulateThrow({ aim: 0.16, power: 0.72, spin: 0.55, seed }).pinCount);
console.log("strike night physics OK", {
  strikesFound: strikes,
  bestPocket: `${best} pins`,
  hookMetres: hookAmount.toFixed(3),
  arrival: `${arrival.toFixed(2)}s`,
  deckAction: `${maxPins} pins`,
  seedVariety: [...spread].sort((x, y) => x - y).join("/"),
});
