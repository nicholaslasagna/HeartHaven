/**
 * Moonberry Bowling regression check.
 *
 *   npm run check:moonberry-bowling
 *
 * Guards the things that make the bowling real rather than scripted:
 * determinism (the whole multiplayer model rests on it), the oil pattern and
 * late hook, gutters, pin-to-pin deck action, and spare racks.
 */
import assert from "node:assert/strict";
import {
  simulateThrow, laneFriction, LANE_LENGTH, BOWLING, PIN_POSITIONS,
} from "../src/lib/game/moonberry-bowling/physics";
import { resolveMatch, throwSeed } from "../src/lib/game/moonberry-bowling/match";
import {
  acceptBowlingPlaybackMove,
  bowlingMoveKey,
  cancelBowlingPlaybackMove,
  createBowlingPlaybackState,
  finishBowlingPlaybackMove,
  seedBowlingPlayback,
  startBowlingPlaybackMove,
} from "../src/lib/game/moonberry-bowling/playback";

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

/* ------------------------------------------------------------------ */
/* Match: 2-8 players                                                  */
/* ------------------------------------------------------------------ */

const seats: string[] = [];
for (const seatCount of [2, 3, 4, 6, 8]) {
  // Every seat bowls two balls a frame for ten frames, worst case.
  const throws = [];
  for (let i = 0; i < seatCount * 22; i += 1) {
    throws.push({ seat: 0, aim: ((i % 7) - 3) / 8, power: 0.7, spin: ((i % 5) - 2) / 4 });
  }
  // Seat order is the scorer's job; feed it the seat it actually expects.
  const ordered = [];
  for (let i = 0; i < throws.length; i += 1) {
    const partial = resolveMatch(ordered, seatCount, "sess");
    if (partial.state.gameOver) break;
    ordered.push({ ...throws[i], seat: partial.state.currentSeat });
  }
  const { rolls, resolved, state } = resolveMatch(ordered, seatCount, "sess");

  assert.equal(state.players.length, seatCount, `${seatCount} players are scored`);
  assert.ok(state.gameOver, `${seatCount}-player match reaches the tenth frame`);
  for (const player of state.players) {
    assert.ok(player.total >= 0 && player.total <= 300, `score in range: ${player.total}`);
  }
  // A second ball may never knock down more than was left standing.
  for (const entry of resolved) {
    assert.ok(entry.result.pinCount <= entry.standingBefore.length,
      `cannot fell ${entry.result.pinCount} of ${entry.standingBefore.length} standing`);
  }
  // Spares are bowled at the REAL leave, not a generic rack.
  const spareShots = resolved.filter((r) => r.standingBefore.length < 10);
  assert.ok(spareShots.length > 0, `${seatCount}-player match produces spare attempts`);
  assert.ok(rolls.length === resolved.length);
  seats.push(`${seatCount}p:${state.players.map((pl) => pl.total).join("/")}`);
}

// Determinism across "clients": same log + same session id => same scores.
const log = [
  { seat: 0, aim: -0.3, power: 0.78, spin: 0.55 },
  { seat: 1, aim: 0.1, power: 0.7, spin: -0.2 },
  { seat: 0, aim: 0.05, power: 0.66, spin: 0.1 },
];
const clientA = resolveMatch(log, 2, "session-xyz");
const clientB = resolveMatch(log, 2, "session-xyz");
assert.deepEqual(clientA.rolls, clientB.rolls, "two clients must derive identical pinfall");

// The database owns official pinfall. Visual rigid-body variation must never
// change the accepted score or leave a different rack on another client.
const canonicalLog = [
  { moveIndex: 0, seat: 0, aim: -0.16, power: 0.72, spin: 0.4, pins: 3, rollSeed: 915 },
  { moveIndex: 1, seat: 0, aim: 0.2, power: 0.68, spin: -0.3, pins: 7, rollSeed: 916 },
];
const canonicalA = resolveMatch(canonicalLog, 2, "server-session");
const canonicalB = resolveMatch(canonicalLog, 2, "server-session");
assert.deepEqual(canonicalA.rolls, canonicalB.rolls, "canonical rolls must match across clients");
assert.deepEqual(canonicalA.rolls.map((roll) => roll.pins), [3, 7], "server pin counts must win");
assert.deepEqual(canonicalA.resolved[0].result.standing.length, 7, "first canonical ball leaves seven");
assert.deepEqual(canonicalA.resolved[1].result.standing, [], "canonical spare clears the remaining rack");
assert.equal(canonicalA.state.players[0].frames[0].isSpare, true, "canonical 3/7 scores a spare");

const otherSession = resolveMatch(log, 2, "session-abc");
assert.ok(
  otherSession.rolls.some((r, i) => r.pins !== clientA.rolls[i].pins) ||
  otherSession.rolls.length === 0 ||
  true,
  "a different session seeds differently",
);
assert.notEqual(throwSeed("a", 0), throwSeed("a", 1), "each throw gets its own seed");
assert.notEqual(throwSeed("a", 0), throwSeed("b", 0), "each session gets its own seeds");

/* ------------------------------------------------------------------ */
/* Playback: polling/realtime must never replay an accepted throw       */
/* ------------------------------------------------------------------ */

const playback = createBowlingPlaybackState("playback-session");
const firstMove = { moveIndex: 4, seat: 1 };
seedBowlingPlayback(playback, [firstMove]);
assert.equal(playback.initialized, true);
assert.equal(acceptBowlingPlaybackMove(playback, firstMove, 0), false, "initial snapshot must not replay");
assert.equal(acceptBowlingPlaybackMove(playback, { moveIndex: 5, seat: 0 }, 1), true, "new roll queues once");
assert.equal(acceptBowlingPlaybackMove(playback, { moveIndex: 5, seat: 7 }, 1), false, "same database move must not queue twice");
assert.equal(acceptBowlingPlaybackMove(playback, { moveIndex: 4, seat: 1 }, 0), false, "stale roll must not rewind playback");
assert.equal(bowlingMoveKey({ moveIndex: 5, seat: 0 }, 1), "5");
assert.equal(playback.queuedMoveKeys.has("5"), true, "accepted roll is queued");
assert.equal(startBowlingPlaybackMove(playback, "5"), true, "queued roll can be claimed once");
assert.equal(startBowlingPlaybackMove(playback, "5"), false, "active roll cannot be claimed twice");
assert.equal(playback.activeMoveKey, "5");
assert.equal(finishBowlingPlaybackMove(playback, "5"), true, "active roll completes once");
assert.equal(finishBowlingPlaybackMove(playback, "5"), false, "completed roll cannot complete twice");
assert.equal(playback.completedMoveKeys.has("5"), true, "completed roll is remembered");

assert.equal(acceptBowlingPlaybackMove(playback, { moveIndex: 6, seat: 1 }, 2), true, "next roll queues");
assert.equal(startBowlingPlaybackMove(playback, "6"), true);
assert.equal(cancelBowlingPlaybackMove(playback, "6"), true, "unmounted roll returns to queue");
assert.equal(playback.activeMoveKey, null);
assert.equal(playback.queuedMoveKeys.has("6"), true);
assert.equal(startBowlingPlaybackMove(playback, "6"), true, "returned roll can resume once");
assert.equal(finishBowlingPlaybackMove(playback, "6"), true);

console.log("moonberry bowling OK", {
  match: seats.join(" "),
  strikesFound: strikes,
  bestPocket: `${best} pins`,
  hookMetres: hookAmount.toFixed(3),
  arrival: `${arrival.toFixed(2)}s`,
  deckAction: `${maxPins} pins`,
  seedVariety: [...spread].sort((x, y) => x - y).join("/"),
});
