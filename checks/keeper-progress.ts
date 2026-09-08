/**
 * Keeper progress merge check.
 *
 *   npm run check:keeper-progress
 *
 * Two devices can both play offline and neither is more correct, so the merge
 * has to be conflict-free: order-independent, and unchanged by applying it
 * twice. If it is not, syncing can lose a badge or quietly inflate a counter
 * — and since the keeper abilities unlock off these metrics, an inflated
 * counter hands out an ability nobody earned.
 */
import assert from "node:assert/strict";
import {
  EMPTY_KEEPER_PROGRESS,
  mergeKeeperProgress,
  normalizeKeeperProgress,
  type KeeperProgress,
} from "../src/lib/game/keeper-progress";

const results: string[] = [];

const deviceA: KeeperProgress = {
  metrics: { "games-played": 12, "coins-earned": 900, "pet-care-actions": 4 },
  unlocked: ["first-steps", "regular-player"],
  unlockedAt: { "first-steps": "2026-01-02T10:00:00.000Z", "regular-player": "2026-03-01T10:00:00.000Z" },
  streak: 5,
  giftClaimedDate: "2026-09-06",
};
const deviceB: KeeperProgress = {
  metrics: { "games-played": 9, "coins-earned": 1400, "daily-streak": 7 },
  unlocked: ["first-steps", "coin-collector"],
  // The same badge, claimed later on this device — the earlier time must win.
  unlockedAt: { "first-steps": "2026-05-05T10:00:00.000Z", "coin-collector": "2026-04-01T10:00:00.000Z" },
  streak: 7,
  giftClaimedDate: "2026-09-07",
};

/* -- the rules themselves -- */
{
  const merged = mergeKeeperProgress(deviceA, deviceB);

  assert.equal(merged.metrics["games-played"], 12, "a counter takes the larger side, never the sum");
  assert.equal(merged.metrics["coins-earned"], 1400, "in either direction");
  assert.equal(merged.metrics["pet-care-actions"], 4, "a metric only one side knows survives");
  assert.equal(merged.metrics["daily-streak"], 7, "including from the other side");

  assert.deepEqual(merged.unlocked, ["coin-collector", "first-steps", "regular-player"],
    "badges are the union — earned is earned");
  assert.equal(merged.unlockedAt["first-steps"], "2026-01-02T10:00:00.000Z",
    "a badge keeps the earliest time it was earned, so a re-sync cannot make it look new");
  assert.equal(merged.streak, 7, "the streak is a high-water mark");
  assert.equal(merged.giftClaimedDate, "2026-09-07", "the later claim wins, so today's gift stays claimed");

  // Summing would inflate on every sync; this is the guard against that.
  assert.notEqual(merged.metrics["games-played"], 21, "counters must not accumulate across syncs");
  results.push("rules     counters take the max, badges union, earliest earn time wins, streak and gift date advance");
}

/* -- conflict-free: order and repetition must not matter -- */
{
  const ab = mergeKeeperProgress(deviceA, deviceB);
  const ba = mergeKeeperProgress(deviceB, deviceA);
  assert.deepEqual(ba, ab, "merging is order-independent, or two devices settle differently");

  const twice = mergeKeeperProgress(ab, deviceB);
  assert.deepEqual(twice, ab, "merging again changes nothing — syncing repeatedly must be safe");

  const withSelf = mergeKeeperProgress(ab, ab);
  assert.deepEqual(withSelf, ab, "merging with itself is a no-op");

  const withEmpty = mergeKeeperProgress(deviceA, EMPTY_KEEPER_PROGRESS);
  assert.deepEqual(withEmpty.metrics, deviceA.metrics, "a first sync against an empty server keeps everything");
  assert.deepEqual(mergeKeeperProgress(EMPTY_KEEPER_PROGRESS, deviceA).metrics, deviceA.metrics,
    "and in the other direction");
  results.push("safety    order-independent · idempotent · an empty server never wipes a device");
}

/* -- anything can come back from the wire -- */
{
  for (const junk of [null, undefined, 7, "no", [], { metrics: "nope" }, { unlocked: "first-steps" }]) {
    const safe = normalizeKeeperProgress(junk);
    assert.deepEqual(safe, EMPTY_KEEPER_PROGRESS, `junk (${JSON.stringify(junk)}) normalises to empty`);
  }

  const messy = normalizeKeeperProgress({
    metrics: { "games-played": "12", "coins-earned": -5, bogus: null, ok: 3.7 },
    unlocked: ["first-steps", "", 42, "first-steps"],
    unlockedAt: { "first-steps": "not a date", "coin-collector": "2026-04-01T10:00:00.000Z" },
    streak: -3,
    giftClaimedDate: "",
  });
  assert.equal(messy.metrics["games-played"], 12, "a numeric string is a count");
  assert.equal(messy.metrics["coins-earned"], undefined, "a negative count is dropped, not stored as negative");
  assert.equal(messy.metrics.bogus, undefined, "an unreadable count is dropped");
  assert.equal(messy.metrics.ok, 3, "fractional counts floor");
  assert.deepEqual(messy.unlocked, ["first-steps"], "badge ids are deduplicated and must be non-empty strings");
  assert.equal(messy.unlockedAt["first-steps"], undefined, "an unparseable earn time is dropped");
  assert.equal(messy.unlockedAt["coin-collector"], "2026-04-01T10:00:00.000Z", "a real one survives");
  assert.equal(messy.streak, 0, "a negative streak floors at zero");
  assert.equal(messy.giftClaimedDate, null, "an empty gift date is no date");

  // Normalising is also idempotent, so a round trip through storage is safe.
  assert.deepEqual(normalizeKeeperProgress(messy), messy, "normalising twice changes nothing");
  results.push("wire      junk normalises to empty · negatives and unreadable values dropped · normalising is idempotent");
}

console.log(`\nKeeper progress: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
