"use client";

/**
 * realtime-hardening — defensive sanitization for every untrusted payload
 * received from Supabase Realtime. Presence and broadcast events arrive
 * over a public channel, which means a malicious client could put anything
 * in them (display names with HTML, NaN coords, fake friend codes, etc.).
 *
 * React already escapes text content, so XSS via `{displayName}` is fine.
 * The real risks are:
 *   • Spoofed display name with control characters or 10000-char garbage.
 *   • Spoofed friend code that doesn't match the shape (blocks our
 *     block-by-code logic).
 *   • Out-of-bounds avatar / pet positions that throw off camera math or
 *     waste GPU rendering off-screen sprites.
 *   • Invalid customization ids that crash the sprite-frame lookup.
 *
 * This module is the single chokepoint every realtime hook routes through
 * before handing payloads to the renderer.
 */

import { moderateChatMessage, type GardenChatMessage } from "@/lib/game/chat-moderation";
import { isFriendCodeShape, normalizeFriendCode } from "@/lib/game/social";
import type { FacingDirection, RealtimeRoomPlayer } from "@/lib/game/types";

/** Maximum permitted chars in a public display name. Matches the server-side
 *  normalizer used by `profiles.username`. */
const DISPLAY_NAME_MAX = 32;
/** Stripped chars / replaced with `?`. Mirrors `normalizePublicUsername` but
 *  more lenient (we have to accept whatever the sender chose). */
const DISPLAY_NAME_OK = /^[a-zA-Z0-9 _.\-@]+$/;

/** Sane numeric ranges per coord. These match the GARDEN_WORLD bounds and
 *  the ROOM bounds — anything outside is almost certainly garbage. */
const COORD_MIN = -200;
const COORD_MAX = 4000;

function clampCoord(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < COORD_MIN) return COORD_MIN;
  if (num > COORD_MAX) return COORD_MAX;
  return num;
}

function sanitizeDisplayName(value: unknown, fallback = "Keeper"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, DISPLAY_NAME_MAX);
  if (!trimmed) return fallback;
  // Drop anything outside the allowlist so a "<script>" or zero-width
  // bidi-override never reaches the renderer.
  if (!DISPLAY_NAME_OK.test(trimmed)) {
    return trimmed.replace(/[^a-zA-Z0-9 _.\-@]/g, "").slice(0, DISPLAY_NAME_MAX) || fallback;
  }
  return trimmed;
}

function sanitizeFriendCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeFriendCode(value);
  return isFriendCodeShape(normalized) ? normalized : undefined;
}

function sanitizeFacing(value: unknown): FacingDirection {
  return value === "left" ? "left" : "right";
}

function sanitizeControlMode(value: unknown): "keeper" | "companion" {
  return value === "companion" ? "companion" : "keeper";
}

/**
 * Validate + clamp a realtime presence row before we hand it to the
 * renderer. Returns `null` for payloads we can't recover (no id, no
 * coords) — the realtime hook should just drop those entirely.
 */
export function hardenRealtimePlayer(raw: unknown): RealtimeRoomPlayer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.slice(0, 80) : null;
  if (!id) return null;
  const color = typeof r.color === "string" ? r.color.slice(0, 16) : "#D87E8C";

  // Friend code is OPTIONAL but, when present, MUST match the canonical
  // shape — otherwise the block / lookup paths can't trust it.
  const friendCode = sanitizeFriendCode(r.friendCode);

  // The Phaser scene's tinting + frame-lookup functions already coerce
  // unknown ids to fallback constants via their `normalizeKeeper*` /
  // `normalizePet*` helpers, so we just slice extreme strings here.
  const slice = (value: unknown, max = 32) => (typeof value === "string" ? value.slice(0, max) : "");

  return {
    id,
    displayName: sanitizeDisplayName(r.displayName),
    friendCode,
    color,
    bodyId: slice(r.bodyId),
    skinId: slice(r.skinId),
    hairStyleId: slice(r.hairStyleId),
    hairColorId: slice(r.hairColorId),
    paletteId: slice(r.paletteId),
    outfitId: slice(r.outfitId),
    petName: sanitizeDisplayName(r.petName, "Casper"),
    petSpeciesId: slice(r.petSpeciesId),
    petToneId: slice(r.petToneId),
    petAccessory: slice(r.petAccessory),
    facing: sanitizeFacing(r.facing),
    x: clampCoord(r.x, 5000),
    y: clampCoord(r.y, 5000),
    petX: r.petX === undefined ? undefined : clampCoord(r.petX, 5000),
    petY: r.petY === undefined ? undefined : clampCoord(r.petY, 5000),
    petFacing: r.petFacing === undefined ? undefined : sanitizeFacing(r.petFacing),
    controlMode: r.controlMode === undefined ? undefined : sanitizeControlMode(r.controlMode),
    emote: typeof r.emote === "string" && r.emote.length < 24 ? (r.emote as RealtimeRoomPlayer["emote"]) : undefined,
    updatedAt: Number(r.updatedAt) || Date.now(),
  };
}

/**
 * Validate + re-moderate an incoming chat message. A malicious client can
 * bypass its OWN moderation (the client-side filter is advisory) — so we
 * re-run the same moderation pipeline on receive. Anything that would have
 * been hard-blocked on the way out gets dropped on the way in too. The
 * recipient is the second safety net.
 */
export function hardenIncomingChat(raw: unknown): GardenChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.slice(0, 60) : null;
  const playerId = typeof r.playerId === "string" ? r.playerId.slice(0, 80) : null;
  const text = typeof r.text === "string" ? r.text : "";
  if (!id || !playerId || !text) return null;

  // Re-moderate. If the sender bypassed their local filter, drop the
  // message here. Soft-blocks are also dropped — the recipient simply
  // never sees the bad content.
  const result = moderateChatMessage(text);
  if (!result.ok) return null;

  return {
    id,
    playerId,
    displayName: sanitizeDisplayName(r.displayName),
    friendCode: sanitizeFriendCode(r.friendCode),
    text: result.text,
    createdAt: Number(r.createdAt) || Date.now(),
  };
}

/**
 * Filter that drops players the local keeper has blocked. Block-by-friend-
 * code is the only filter — players without a verified friend code render
 * normally (visitors are anonymous on purpose). The block list is re-read
 * each call so an unblock takes effect on the next presence frame.
 */
export function filterBlockedPlayers(players: RealtimeRoomPlayer[]): RealtimeRoomPlayer[] {
  if (typeof window === "undefined") return players;
  try {
    const raw = window.localStorage.getItem("hearthaven:safety-state");
    if (!raw) return players;
    const parsed = JSON.parse(raw) as { blocks?: Array<{ code?: string }> };
    const blocked = new Set(
      Array.isArray(parsed.blocks)
        ? parsed.blocks.map((entry) => entry?.code).filter((value): value is string => Boolean(value))
        : [],
    );
    if (blocked.size === 0) return players;
    return players.filter((player) => !player.friendCode || !blocked.has(player.friendCode));
  } catch {
    return players;
  }
}
