"use client";

export type GardenChatMessage = {
  id: string;
  playerId: string;
  displayName: string;
  text: string;
  createdAt: number;
};

export type ChatModerationResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

const MAX_CHAT_LENGTH = 160;
const blockedPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /https?:\/\/|www\./i, reason: "Links are blocked in garden chat." },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, reason: "Email addresses are blocked in garden chat." },
  { pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/, reason: "Phone numbers are blocked in garden chat." },
  { pattern: /\b(?:kill yourself|kys|doxx?|address leak)\b/i, reason: "That message is not allowed." },
];

export function moderateChatMessage(input: string): ChatModerationResult {
  const cleaned = input.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

  if (!cleaned) return { ok: false, reason: "Write a message first." };
  if (cleaned.length > MAX_CHAT_LENGTH) return { ok: false, reason: `Keep chat under ${MAX_CHAT_LENGTH} characters.` };

  const blocked = blockedPatterns.find(({ pattern }) => pattern.test(cleaned));
  if (blocked) return { ok: false, reason: blocked.reason };

  return { ok: true, text: cleaned };
}
