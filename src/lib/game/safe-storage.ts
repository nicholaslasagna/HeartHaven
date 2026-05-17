"use client";

/**
 * Small wrapper around `window.localStorage` that catches the two failure
 * modes that bite us in production:
 *
 *   1. **Quota exceeded** — once the keeper's tab hits the localStorage
 *      cap (~5 MB in Safari), every `setItem` throws. The old code
 *      didn't try/catch the write, so a single QuotaExceededError
 *      derailed whatever flow triggered it (e.g. a chat send that
 *      tried to log a rate-limit entry would throw and bubble out).
 *   2. **Storage disabled** — Safari private browsing, embedded
 *      WebViews with localStorage off, etc. Every access throws.
 *
 * This module exposes typed get/set/remove that silently swallow both
 * failure modes. Callers can opt into the error via `safeSetItem`'s
 * return value (`true` = persisted, `false` = dropped).
 */

export function safeGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[hearthaven safe-storage] setItem(${key}) failed:`, error);
    }
    return false;
  }
}

export function safeRemoveItem(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience: read+parse a JSON-encoded value, or return `fallback`.
 * Used by store modules that previously did `JSON.parse(... ?? "null")`
 * and risked throwing on corrupt entries.
 */
export function safeReadJSON<T>(key: string, fallback: T): T {
  const raw = safeGetItem(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Write a JSON-encoded value. Returns whether the write succeeded; on
 * quota failure, the previous value remains untouched.
 */
export function safeWriteJSON(key: string, value: unknown): boolean {
  try {
    return safeSetItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
