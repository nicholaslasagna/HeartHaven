/**
 * Merging a keeper's progress between a device and the server.
 *
 * Achievement metrics, earned badges and the daily streak all live in local
 * storage while you play, which is why they vanish when a browser is cleared
 * and do not follow you to a phone. That matters more than it used to: the
 * keeper abilities unlock off these same metrics, so a cleared browser
 * currently takes every earned ability with it.
 *
 * The merge has to be conflict-free, because two devices can both play while
 * offline and neither is more correct than the other. Every field here is
 * therefore combined with a rule that does not depend on order:
 *
 *   * metrics    — the larger of the two. They are counters, so this never
 *                  loses ground. It can under-count when two devices advance
 *                  the same metric independently, which is the honest cost of
 *                  not double-counting; summing would inflate every total
 *                  each time a device synced.
 *   * badges     — the union. Earned is earned.
 *   * earned-at  — the earliest timestamp, so a re-sync cannot make an old
 *                  badge look new.
 *   * streak     — the larger. It is a high-water mark, not a running sum.
 *   * gift date  — the later. Claiming today is what stops a second claim.
 *
 * Applying it twice changes nothing, and the order the two sides arrive in
 * does not matter. The same rule is implemented in SQL by
 * sync_keeper_progress (migration 0094), so the server can merge atomically
 * rather than trusting whichever client wrote last.
 */

export type KeeperProgress = {
  metrics: Record<string, number>;
  unlocked: string[];
  unlockedAt: Record<string, string>;
  streak: number;
  giftClaimedDate: string | null;
};

export const EMPTY_KEEPER_PROGRESS: KeeperProgress = {
  metrics: {},
  unlocked: [],
  unlockedAt: {},
  streak: 0,
  giftClaimedDate: null,
};

function readCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function readDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** Coerce anything — a server row, a parsed blob, junk — into progress. */
export function normalizeKeeperProgress(raw: unknown): KeeperProgress {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_KEEPER_PROGRESS };
  const source = raw as Record<string, unknown>;

  const metrics: Record<string, number> = {};
  const rawMetrics = source.metrics;
  if (rawMetrics && typeof rawMetrics === "object" && !Array.isArray(rawMetrics)) {
    for (const [key, value] of Object.entries(rawMetrics as Record<string, unknown>)) {
      const count = readCount(value);
      if (count > 0) metrics[key] = count;
    }
  }

  const unlocked = Array.isArray(source.unlocked)
    ? [...new Set(source.unlocked.filter((id): id is string => typeof id === "string" && id !== ""))]
    : [];

  const unlockedAt: Record<string, string> = {};
  const rawAt = source.unlockedAt;
  if (rawAt && typeof rawAt === "object" && !Array.isArray(rawAt)) {
    for (const [key, value] of Object.entries(rawAt as Record<string, unknown>)) {
      const date = readDate(value);
      if (date) unlockedAt[key] = date;
    }
  }

  return {
    metrics,
    unlocked,
    unlockedAt,
    streak: readCount(source.streak),
    giftClaimedDate: readDate(source.giftClaimedDate),
  };
}

/** Combine two sides. Order-independent, and applying it twice changes nothing. */
export function mergeKeeperProgress(a: KeeperProgress, b: KeeperProgress): KeeperProgress {
  const metrics: Record<string, number> = { ...a.metrics };
  for (const [key, value] of Object.entries(b.metrics)) {
    metrics[key] = Math.max(metrics[key] ?? 0, value);
  }

  const unlocked = [...new Set([...a.unlocked, ...b.unlocked])].sort();

  const unlockedAt: Record<string, string> = { ...a.unlockedAt };
  for (const [key, value] of Object.entries(b.unlockedAt)) {
    const existing = unlockedAt[key];
    // Earliest wins: a badge cannot become newer than when it was earned.
    if (!existing || Date.parse(value) < Date.parse(existing)) unlockedAt[key] = value;
  }

  const giftClaimedDate =
    a.giftClaimedDate && b.giftClaimedDate
      ? (a.giftClaimedDate > b.giftClaimedDate ? a.giftClaimedDate : b.giftClaimedDate)
      : a.giftClaimedDate ?? b.giftClaimedDate;

  return {
    metrics,
    unlocked,
    unlockedAt,
    streak: Math.max(a.streak, b.streak),
    giftClaimedDate,
  };
}
