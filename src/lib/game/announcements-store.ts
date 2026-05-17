"use client";

/**
 * announcements-store — fetches developer-managed announcements from
 * Supabase, tracks per-user "seen" + "claimed" state locally, and surfaces
 * the result via a single function the React hook consumes.
 *
 * Two flavours of progress:
 *   • SEEN — the keeper has viewed the announcement (acknowledges the
 *     notification). Tracked locally only — no server write needed for
 *     simple visibility.
 *   • CLAIMED — for announcements with a reward, the keeper hit "Claim"
 *     and the reward got credited to their wallet. Tracked BOTH in
 *     localStorage (immediate UX) AND in Supabase `announcement_claims`
 *     (server-authoritative — used to gate double-claim across devices).
 */

import { creditWallet } from "@/lib/game/wallet-store";
import type { GameReward } from "@/lib/game/rewards";
import { addItem as addInventoryItem } from "@/lib/game/inventory-store";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const SEEN_STORAGE_KEY = "hearthaven:announcements-seen";
export const CLAIMED_STORAGE_KEY = "hearthaven:announcements-claimed";
export const ANNOUNCEMENTS_EVENT = "hearthaven:announcements-changed";

export type AnnouncementKind = "info" | "reward" | "login-bonus" | "event" | "maintenance";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  rewardCoins: number;
  rewardHearts: number;
  rewardCatalogItemId: string | null;
  publishesAt: string;
  expiresAt: string | null;
  createdAt: string;
};

type RawAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  kind: AnnouncementKind | string;
  reward_coins: number | null;
  reward_hearts: number | null;
  reward_catalog_item_id: string | null;
  publishes_at: string;
  expires_at: string | null;
  created_at: string;
};

/**
 * Minimal demo fallback so local-only builds (no Supabase) still render the
 * Announcements page with something. Cleared as soon as a real fetch
 * succeeds.
 */
const DEMO_ANNOUNCEMENTS: Announcement[] = [
  {
    id: "demo-welcome",
    title: "Welcome to HeartHaven 💕",
    body: "Friends, gardens, and a soft companion. Check this page for new gifts, login bonuses, and event news.",
    kind: "info",
    rewardCoins: 0,
    rewardHearts: 0,
    rewardCatalogItemId: null,
    publishesAt: new Date().toISOString(),
    expiresAt: null,
    createdAt: new Date().toISOString(),
  },
];

let cachedAnnouncements: Announcement[] = DEMO_ANNOUNCEMENTS;

function normalize(row: RawAnnouncementRow): Announcement {
  const kind: AnnouncementKind =
    row.kind === "reward" ||
    row.kind === "login-bonus" ||
    row.kind === "event" ||
    row.kind === "maintenance"
      ? row.kind
      : "info";
  return {
    id: row.id,
    title: String(row.title ?? "").slice(0, 80),
    body: String(row.body ?? "").slice(0, 4000),
    kind,
    rewardCoins: Math.max(0, Number(row.reward_coins ?? 0)),
    rewardHearts: Math.max(0, Number(row.reward_hearts ?? 0)),
    rewardCatalogItemId: row.reward_catalog_item_id ?? null,
    publishesAt: row.publishes_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function readSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(Array.from(set)));
  window.dispatchEvent(new CustomEvent(ANNOUNCEMENTS_EVENT));
}

export function getSeenAnnouncementIds(): Set<string> {
  return readSet(SEEN_STORAGE_KEY);
}

export function getClaimedAnnouncementIds(): Set<string> {
  return readSet(CLAIMED_STORAGE_KEY);
}

export function markAnnouncementSeen(id: string) {
  const seen = readSet(SEEN_STORAGE_KEY);
  if (seen.has(id)) return;
  seen.add(id);
  writeSet(SEEN_STORAGE_KEY, seen);
}

/**
 * Mark every currently-cached announcement as seen. Called when the user
 * actually opens the announcements page so the unseen badge clears.
 */
export function markAllAnnouncementsSeen() {
  const seen = readSet(SEEN_STORAGE_KEY);
  let changed = false;
  for (const a of cachedAnnouncements) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      changed = true;
    }
  }
  if (changed) writeSet(SEEN_STORAGE_KEY, seen);
}

/**
 * Return the locally cached announcements (sorted newest first). For the
 * first render before the network responds, this is the demo fallback.
 */
export function getCachedAnnouncements(): Announcement[] {
  return cachedAnnouncements
    .slice()
    .sort((a, b) => Date.parse(b.publishesAt) - Date.parse(a.publishesAt));
}

/** Number of un-seen, currently-visible announcements. Used in the nav badge. */
export function getUnseenCount(): number {
  const seen = readSet(SEEN_STORAGE_KEY);
  return cachedAnnouncements.filter((a) => !seen.has(a.id)).length;
}

/**
 * Pull fresh announcements from Supabase. Updates the local cache and
 * fires `ANNOUNCEMENTS_EVENT`. Also pulls down the keeper's claim list
 * so the UI hides "Claim" on rewards already collected on another device.
 */
export async function fetchAnnouncements(): Promise<Announcement[]> {
  if (!isSupabaseConfigured() || typeof window === "undefined") {
    return cachedAnnouncements;
  }
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: rows } = await supabase
      .from("announcements")
      .select("*")
      .eq("active", true)
      .lte("publishes_at", new Date().toISOString())
      .order("publishes_at", { ascending: false })
      .limit(60);
    if (Array.isArray(rows)) {
      const live = (rows as RawAnnouncementRow[]).map(normalize).filter(
        (a) => !a.expiresAt || Date.parse(a.expiresAt) > Date.now(),
      );
      // Preserve demo entries when Supabase is empty so first-run users
      // don't see a totally blank page.
      cachedAnnouncements = live.length > 0 ? live : DEMO_ANNOUNCEMENTS;
    }

    // Reconcile server-side claims into local cache.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: claimRows } = await supabase
        .from("announcement_claims")
        .select("announcement_id")
        .eq("profile_id", user.id);
      if (Array.isArray(claimRows)) {
        const local = readSet(CLAIMED_STORAGE_KEY);
        let changed = false;
        for (const row of claimRows as Array<{ announcement_id: string }>) {
          if (!local.has(row.announcement_id)) {
            local.add(row.announcement_id);
            changed = true;
          }
        }
        if (changed) writeSet(CLAIMED_STORAGE_KEY, local);
      }
    }

    window.dispatchEvent(new CustomEvent(ANNOUNCEMENTS_EVENT));
  } catch (error) {
    console.warn("[hearthaven announcements] fetch failed:", error);
  }
  return cachedAnnouncements;
}

/**
 * Claim an announcement's reward. Idempotent — calling twice doesn't
 * double-credit. Returns `{ ok: true, reward }` on success, or a reason
 * code on failure.
 */
export async function claimAnnouncement(
  announcementId: string,
): Promise<
  | { ok: true; reward: { coins: number; hearts: number; itemId: string | null } }
  | { ok: false; reason: "not-found" | "already-claimed" | "no-reward" | "auth" | "server" }
> {
  const announcement = cachedAnnouncements.find((a) => a.id === announcementId);
  if (!announcement) return { ok: false, reason: "not-found" };
  const reward = {
    coins: announcement.rewardCoins,
    hearts: announcement.rewardHearts,
    itemId: announcement.rewardCatalogItemId,
  };
  if (reward.coins <= 0 && reward.hearts <= 0 && !announcement.rewardCatalogItemId) {
    return { ok: false, reason: "no-reward" };
  }
  const claimed = readSet(CLAIMED_STORAGE_KEY);
  if (claimed.has(announcementId)) return { ok: false, reason: "already-claimed" };

  // Authoritative-first ordering: write the server row BEFORE crediting
  // the wallet + marking claimed locally. The previous optimistic-
  // first ordering could leave the local cache in a "claimed" state if
  // the auth call hung or the network died mid-flight — meaning the
  // user couldn't retry but never actually received their reward.
  // Now we hit the server first and only commit local state once
  // we know the claim landed (or unambiguously skip it for the local-
  // only demo mode).
  let serverCommitted = false;
  if (isSupabaseConfigured() && typeof window !== "undefined") {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // No auth — local-only claim still works for demo, but no
        // cross-device dedupe is possible. We treat this as committed.
        serverCommitted = true;
      } else {
        const { error } = await supabase
          .from("announcement_claims")
          .insert({ announcement_id: announcementId, profile_id: user.id });
        if (error) {
          if (/duplicate key|already exists/i.test(error.message)) {
            // The server already has a claim row (cross-device). Mark
            // local cache so we never show "Claim" again, but don't
            // credit the reward twice.
            claimed.add(announcementId);
            writeSet(CLAIMED_STORAGE_KEY, claimed);
            return { ok: false, reason: "already-claimed" };
          }
          console.warn("[hearthaven announcements] claim insert failed:", error.message);
          return { ok: false, reason: "server" };
        }
        serverCommitted = true;
      }
    } catch (error) {
      console.warn("[hearthaven announcements] claim exception:", error);
      // Don't roll local cache forward when the server call threw —
      // the user retains the ability to retry.
      return { ok: false, reason: "server" };
    }
  } else {
    // Local-only / demo mode — treat as committed.
    serverCommitted = true;
  }

  if (!serverCommitted) return { ok: false, reason: "server" };

  // Commit the local side: mark claimed, credit wallet, drop item.
  claimed.add(announcementId);
  writeSet(CLAIMED_STORAGE_KEY, claimed);
  if (reward.coins > 0 || reward.hearts > 0) {
    const ledgerReward: GameReward = {
      gameId: `announcement:${announcementId}`,
      label: announcement.title,
      score: 0,
      coins: reward.coins,
      hearts: reward.hearts,
    };
    creditWallet(ledgerReward);
  }
  if (announcement.rewardCatalogItemId) {
    addInventoryItem(announcement.rewardCatalogItemId, "daily-drop");
  }
  return { ok: true, reward };
}
