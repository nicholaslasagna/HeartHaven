"use client";

import { quarantineSelf } from "@/lib/game/safety";

export type GardenChatMessage = {
  id: string;
  playerId: string;
  displayName: string;
  /** Public friend code, used only for block/report filtering. */
  friendCode?: string;
  text: string;
  createdAt: number;
};

export type ChatSeverity = "ok" | "soft-block" | "hard-block";

/**
 * The result of moderating a chat input.
 *
 *   • `ok: true`              — pass through; broadcast as normal.
 *   • `ok: false, soft-block` — message was rejected; show the reason but no
 *                                penalty (links, emails, length, mild slurs).
 *   • `ok: false, hard-block` — message contained content we will NEVER let
 *                                leave this device (predatory phrasing,
 *                                explicit requests, requests for media from
 *                                someone implied to be a minor). The local
 *                                keeper is also auto-quarantined and the
 *                                event is queued for moderator review.
 */
export type ChatModerationResult =
  | { ok: true; text: string }
  | { ok: false; severity: ChatSeverity; reason: string };

const MAX_CHAT_LENGTH = 240;
const CHAT_RATE_KEY = "hearthaven:chat-rate-window";
const CHAT_WINDOW_MS = 10_000;
const CHAT_MAX_PER_WINDOW = 5;
const CHAT_REPEAT_WINDOW_MS = 6_000;

type ChatRateEntry = {
  text: string;
  at: number;
};

/** Soft-blocks: rejected with a reason, no penalty. */
const softPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /https?:\/\/|www\./i, reason: "Links aren't allowed in chat." },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, reason: "Email addresses aren't allowed in chat." },
  { pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/, reason: "Phone numbers aren't allowed in chat." },
  // A conservative profanity list — easy to extend; covers the common ones.
  { pattern: /\b(?:f[u\*]+ck|sh[i\*]+t|b[i\*]+tch|c[u\*]+nt|d[i\*]+ck|p[u\*]+ssy|a[s\*]+hole|wh[o\*]+re|sl[u\*]+t|f[a\*]+g|n[i\*]+gg(?:er|a))\b/i, reason: "Let's keep the haven warm — that word's filtered." },
];

/**
 * Hard-blocks: severe patterns. These suggest predatory or explicit conduct.
 * Hits trigger an auto-quarantine on the SENDER (their outgoing chat is muted
 * for a cooldown) AND surface as a high-priority moderator-review record.
 *
 * The patterns are intentionally conservative — they catch obvious instances
 * without trying to be perfect. The goal is to STOP the message before it
 * broadcasts and flag for human review, not to score every interaction.
 */
const hardPatterns: Array<{ pattern: RegExp; reason: string }> = [
  // Explicit-content asks / nudity requests.
  { pattern: /\b(?:send|show|share|post|trade|see)\s+(?:me\s+)?(?:your\s+|some\s+)?(?:nudes?|naked\s+(?:pics?|photos?|videos?)|n[u\*]+des?|d[i\*]+ck\s+pics?|t[i\*]+ts?|boobs?|pussy|underwear\s+pics?|in\s+the\s+shower|in\s+the\s+bath)\b/i, reason: "We don't allow sexual requests in HeartHaven." },
  { pattern: /\bgive\s+me\s+(?:a\s+)?(?:nude|naked|s[e\*]+xy)\b/i, reason: "We don't allow sexual requests in HeartHaven." },
  { pattern: /\bsext(?:ing)?|cybering|cyber\s*sex|jerk\s*off|j(?:o|0)\s+together\b/i, reason: "We don't allow sexual chat in HeartHaven." },

  // Predatory phrasing toward implied minors.
  { pattern: /\b(?:are\s+you|r\s+u)\s+(?:a\s+)?(?:minor|underage|kid|child|young)|\bhow\s+old\s+are\s+you\b.{0,30}\b(?:in\s+real|irl|actually)\b/i, reason: "Asking that here isn't allowed." },
  { pattern: /\b(?:our|this\s+is\s+a)\s+secret\b.{0,40}\b(?:don'?t\s+tell|never\s+tell)\b/i, reason: "Asking someone to keep secrets isn't allowed here." },
  { pattern: /\bmeet\s+(?:me\s+)?in\s+(?:real\s+life|person|irl)\b.{0,40}\b(?:alone|no\s+(?:parents?|mom|dad))\b/i, reason: "Asking to meet privately isn't allowed here." },
  { pattern: /\b(?:send|pick\s+you?\s+up)\b.{0,40}\b(?:my\s+(?:car|place|house))\b/i, reason: "That kind of request isn't allowed here." },

  // Threats / explicit self-harm targeting.
  { pattern: /\b(?:kill\s+yourself|k[\*y]s\b|i\s+will\s+(?:find|hurt|kill)\s+you)\b/i, reason: "Threats are not allowed." },
  { pattern: /\b(?:doxx?|leak\s+your?\s+address|i\s+know\s+where\s+you\s+live)\b/i, reason: "Doxxing isn't allowed." },
];

function checkChatRateLimit(cleaned: string): string | null {
  if (typeof window === "undefined") return null;
  const now = Date.now();
  let entries: ChatRateEntry[] = [];
  try {
    const raw = window.localStorage.getItem(CHAT_RATE_KEY);
    entries = raw ? JSON.parse(raw) as ChatRateEntry[] : [];
  } catch {
    entries = [];
  }

  const recent = entries.filter((entry) => now - entry.at <= CHAT_WINDOW_MS);
  if (recent.length >= CHAT_MAX_PER_WINDOW) {
    window.localStorage.setItem(CHAT_RATE_KEY, JSON.stringify(recent));
    return "Slow down a little so everyone can keep up.";
  }

  const normalized = cleaned.toLowerCase();
  const repeated = recent.some((entry) => entry.text.toLowerCase() === normalized && now - entry.at <= CHAT_REPEAT_WINDOW_MS);
  if (repeated) {
    window.localStorage.setItem(CHAT_RATE_KEY, JSON.stringify(recent));
    return "Try not to repeat the same message.";
  }

  window.localStorage.setItem(CHAT_RATE_KEY, JSON.stringify([...recent, { text: cleaned, at: now }]));
  return null;
}

export function moderateChatMessage(input: string): ChatModerationResult {
  const cleaned = input.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

  if (!cleaned) return { ok: false, severity: "soft-block", reason: "Write a message first." };
  if (cleaned.length > MAX_CHAT_LENGTH) {
    return { ok: false, severity: "soft-block", reason: `Keep chat under ${MAX_CHAT_LENGTH} characters.` };
  }

  // Hard-block first — these never leave the device, and quarantine the sender.
  const hard = hardPatterns.find(({ pattern }) => pattern.test(cleaned));
  if (hard) {
    try {
      quarantineSelf({ reasonNote: hard.reason });
    } catch {
      // Even if quarantine fails to persist, we still block the message.
    }
    return { ok: false, severity: "hard-block", reason: hard.reason };
  }

  const soft = softPatterns.find(({ pattern }) => pattern.test(cleaned));
  if (soft) return { ok: false, severity: "soft-block", reason: soft.reason };

  const rateLimit = checkChatRateLimit(cleaned);
  if (rateLimit) return { ok: false, severity: "soft-block", reason: rateLimit };

  return { ok: true, text: cleaned };
}
