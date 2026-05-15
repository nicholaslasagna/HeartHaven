"use client";

/**
 * username-policy — enforces "3 username changes per rolling 365 days".
 *
 * Keeps the change history in localStorage so the limit holds even before
 * Supabase is configured. When Supabase IS configured, the server-side
 * username update reads the same history off the profile row, so the limit
 * is enforced authoritatively across devices.
 *
 * History shape: an array of ISO timestamps for every accepted change.
 * Entries older than the 365-day window are considered expired and ignored.
 */

export const USERNAME_HISTORY_KEY = "hearthaven:username-change-history";
export const USERNAME_HISTORY_EVENT = "hearthaven:username-history-changed";

/** Maximum permitted username changes within any rolling 365-day window. */
export const USERNAME_CHANGE_LIMIT = 3;

/** The rolling window in milliseconds — 365 days. */
export const USERNAME_CHANGE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export type UsernameChangeStatus = {
  /** Timestamps (most recent first) of changes within the rolling window. */
  recentChanges: string[];
  /** True if another change is permitted right now. */
  allowed: boolean;
  /** How many changes remain in the rolling window. */
  changesRemaining: number;
  /**
   * When the OLDEST in-window change will expire — i.e. the earliest moment a
   * blocked user can change their username again. `null` when not blocked.
   */
  nextAllowedAt: string | null;
};

function rawRead(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USERNAME_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function rawWrite(history: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USERNAME_HISTORY_KEY, JSON.stringify(history));
  window.dispatchEvent(new CustomEvent(USERNAME_HISTORY_EVENT, { detail: { history } }));
}

/**
 * Filter the history to entries that fall inside the rolling window from
 * `now`. Returns the filtered list in descending order (newest first).
 */
export function pruneUsernameHistory(history: string[] = rawRead(), now = Date.now()): string[] {
  const cutoff = now - USERNAME_CHANGE_WINDOW_MS;
  return history
    .map((entry) => ({ entry, time: Date.parse(entry) }))
    .filter(({ time }) => Number.isFinite(time) && time >= cutoff)
    .sort((a, b) => b.time - a.time)
    .map(({ entry }) => entry);
}

/**
 * Read the current username-change status from localStorage. Side-effect free.
 * Pass `now` to make tests deterministic.
 */
export function getUsernameChangeStatus(now = Date.now()): UsernameChangeStatus {
  return computeStatus(rawRead(), now);
}

export function computeStatus(history: string[], now = Date.now()): UsernameChangeStatus {
  const recentChanges = pruneUsernameHistory(history, now);
  const used = recentChanges.length;
  const allowed = used < USERNAME_CHANGE_LIMIT;
  const changesRemaining = Math.max(0, USERNAME_CHANGE_LIMIT - used);
  // If blocked, the oldest in-window change expires first — once it falls
  // outside the rolling window, the slot opens up again.
  const oldest = recentChanges[recentChanges.length - 1];
  const nextAllowedAt = !allowed && oldest
    ? new Date(Date.parse(oldest) + USERNAME_CHANGE_WINDOW_MS).toISOString()
    : null;
  return { recentChanges, allowed, changesRemaining, nextAllowedAt };
}

/**
 * Record a fresh username change. Caller must have already checked that a
 * change was permitted — otherwise this would silently exceed the cap.
 * Returns the new status.
 */
export function recordUsernameChange(now = new Date()): UsernameChangeStatus {
  const history = pruneUsernameHistory(rawRead(), now.getTime());
  const next = [now.toISOString(), ...history].slice(0, USERNAME_CHANGE_LIMIT * 2);
  rawWrite(next);
  return computeStatus(next, now.getTime());
}

/**
 * Hydrate the local history from an authoritative source — e.g. the
 * Supabase `profiles.username_changes` array on session load. We keep the
 * authoritative timestamps so the local UI shows the same "remaining" count
 * the server will enforce.
 */
export function hydrateUsernameHistory(history: string[] | null | undefined) {
  if (!Array.isArray(history)) return;
  const pruned = pruneUsernameHistory(history);
  rawWrite(pruned);
}
