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

results.push("store     snapshot reference-stable · write notifies once · listeners see fresh values · junk coerced · private mode survives");
console.log(`\nPlayer prefs: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
