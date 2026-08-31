/**
 * Player preferences store check.
 *
 *   npm run check:player-prefs
 *
 * Lives apart from the game suites because it needs a `window` shim, and the
 * racing suite deliberately asserts the no-window path.
 *
 * The invariant that matters most is snapshot stability. `useSyncExternalStore`
 * compares snapshots by reference; returning a freshly-parsed object each
 * call makes React re-render forever and locks the page up. That failure is
 * invisible in review and obvious only when the browser stops responding.
 */

import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  },
  matchMedia: () => ({ matches: false }),
};

const prefs = await import("../src/lib/game/player-prefs");
const results: string[] = [];

/* -- reference stability -- */
const first = prefs.getPrefsSnapshot();
for (let i = 0; i < 200; i += 1) {
  assert.equal(prefs.getPrefsSnapshot(), first, `snapshot stable on call ${i}`);
}

/* -- a write must be observable -- */
let notified = 0;
const unsubscribe = prefs.subscribePrefs(() => { notified += 1; });
prefs.savePrefs({ ...first, quality: "low" });
const afterWrite = prefs.getPrefsSnapshot();
assert.notEqual(afterWrite, first, "a write produces a new reference, or React never re-renders");
assert.equal(afterWrite.quality, "low");
assert.equal(notified, 1, "subscribers notified exactly once per write");
assert.equal(prefs.getPrefsSnapshot(), afterWrite, "and stable again afterwards");

/* -- listeners must not read a stale value mid-notification -- */
let observed: string | null = null;
const unsubscribeReader = prefs.subscribePrefs(() => { observed = prefs.getPrefsSnapshot().quality; });
prefs.savePrefs({ ...afterWrite, quality: "high" });
assert.equal(observed, "high", "a listener reading during notification sees the NEW value");

/* -- persistence, and coercion on the way in -- */
assert.equal(JSON.parse(store.get("hearthaven:player-prefs")!).quality, "high", "persisted to storage");
prefs.savePrefs({ quality: "nonsense", reducedMotion: "x", touchControls: 1 } as never);
assert.ok(["low", "medium", "high"].includes(prefs.getPrefsSnapshot().quality), "a junk write is coerced");
assert.equal(typeof prefs.getPrefsSnapshot().reducedMotion, "boolean");
assert.ok(!("masterVolume" in prefs.getPrefsSnapshot()), "volume stays owned by cozy-audio");

/* -- unsubscribe actually detaches -- */
unsubscribe();
unsubscribeReader();
const before = notified;
prefs.savePrefs({ ...prefs.getPrefsSnapshot(), quality: "medium" });
assert.equal(notified, before, "unsubscribed listeners stop being called");

/* -- storage that throws must not take the app down -- */
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  },
  matchMedia: () => { throw new Error("blocked"); },
};
assert.doesNotThrow(() => prefs.savePrefs({ ...prefs.getPrefsSnapshot(), quality: "low" }),
  "a blocked localStorage (private mode) must not throw");
assert.doesNotThrow(() => prefs.loadPrefs(), "nor must reading it");

/* -- twin-axis stick: diagonals must not outrun straight pushes -- */
{
  const span = prefs.TOUCH_STICK_SPAN;
  const straight = prefs.padVector(span, 0);
  assert.equal(straight.x, 1, "a full push right reads +1");
  assert.equal(straight.z, 0, "and adds no forward component");

  const diagonal = prefs.padVector(span, span);
  const speed = Math.hypot(diagonal.x, diagonal.z);
  assert.ok(Math.abs(speed - 1) < 1e-9, `a corner push stays on the unit disc, got ${speed}`);
  assert.ok(diagonal.x > 0 && diagonal.z > 0, "and keeps both signs");

  // Inside the disc the raw ratio survives: small pushes stay analogue.
  const gentle = prefs.padVector(span / 2, 0);
  assert.equal(gentle.x, 0.5, "half a span reads 0.5, not snapped to full tilt");

  // Screen down is +y and the runner reads +z as away from camera.
  assert.equal(prefs.padVector(0, span).z, 1, "dragging down pushes away from the camera");

  const centred = prefs.padVector(0, 0);
  assert.ok(Object.is(centred.x, 0) && Object.is(centred.z, 0), "a centred stick is exactly zero, not -0");

  // Way past the edge still clamps, and stays a direction.
  const overshoot = prefs.padVector(span * 9, span * -3);
  assert.ok(Math.abs(Math.hypot(overshoot.x, overshoot.z) - 1) < 1e-9, "overshoot clamps to the rim");
}
/* -- platformer walk: one thumb gives direction and pace -- */
{
  const { TOUCH_WALK_DEADZONE, TOUCH_WALK_RUN_SPAN } = prefs;

  // A thumb resting on the pad must not creep the runner sideways. Without a
  // deadzone a still thumb reads as a tiny drag and the character never
  // quite stands still.
  assert.deepEqual(prefs.padWalk(0), { moveX: 0, run: false }, "a centred thumb stands still");
  assert.deepEqual(prefs.padWalk(TOUCH_WALK_DEADZONE - 1), { moveX: 0, run: false }, "inside the deadzone is still");
  assert.deepEqual(prefs.padWalk(-(TOUCH_WALK_DEADZONE - 1)), { moveX: 0, run: false }, "in both directions");

  // Past the deadzone you walk; further out you run.
  assert.deepEqual(prefs.padWalk(TOUCH_WALK_DEADZONE), { moveX: 1, run: false }, "just past the deadzone walks right");
  assert.deepEqual(prefs.padWalk(-TOUCH_WALK_DEADZONE), { moveX: -1, run: false }, "and left");
  assert.deepEqual(prefs.padWalk(TOUCH_WALK_RUN_SPAN), { moveX: 1, run: true }, "a long drag runs");
  assert.deepEqual(prefs.padWalk(-TOUCH_WALK_RUN_SPAN * 4), { moveX: -1, run: true }, "overshoot still runs, not faster");

  // moveX is a DIRECTION: the physics expects -1, 0 or 1, never a magnitude.
  for (const drag of [-500, -60, -13, 0, 13, 60, 500]) {
    const walk = prefs.padWalk(drag);
    assert.ok([-1, 0, 1].includes(walk.moveX), `moveX must be a direction, got ${walk.moveX}`);
  }
  assert.ok(TOUCH_WALK_DEADZONE < TOUCH_WALK_RUN_SPAN, "you must be able to walk before you run");
  assert.deepEqual(prefs.padWalk(Number.NaN), { moveX: 0, run: false }, "junk stands still rather than bolting");
  results.push("walk      deadzone holds still · past it walks · further runs · moveX stays a direction · junk is safe");
}

results.push("stick     unit disc, so diagonals match straight pushes · analogue inside the rim · down = away · centre is +0");

results.push("store     snapshot reference-stable · write notifies once · listeners see fresh values · junk coerced · private mode survives");
console.log(`\nPlayer prefs: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
