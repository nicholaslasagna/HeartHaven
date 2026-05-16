/**
 * safety — the blocking, reporting, and quarantine layer.
 *
 * Three responsibilities:
 *
 *   • Blocks   — keepers you never want to see again. Block prevents:
 *                receiving invites/gifts from them, seeing their chat bubbles,
 *                and seeing them in any presence list.
 *
 *   • Reports  — a structured record of a harmful interaction. Captures the
 *                offender's PUBLIC display info (friend code, display name) +
 *                a transcript window + scene context + timestamp. The record
 *                lives client-side here; production wires it to a Supabase
 *                `reports` table that ONLY service-role admins can read.
 *
 *   • Quarantine — when the moderation layer detects severe outbound content
 *                (explicit asks, grooming-pattern phrases), the local keeper's
 *                chat is auto-restricted (rate-limited / muted) pending a
 *                human review. This is preventative — it stops the harmful
 *                message before broadcast. The flag also rides with the next
 *                report so a moderator can prioritise.
 *
 * What this module deliberately DOES NOT do:
 *   - Collect or store payment card information (PCI-DSS territory).
 *   - Auto-forward PII off-device.
 * Server-side, Supabase's `auth.users` already records IP + user-agent; a
 * service-role admin can join reports against that table when responding to a
 * legitimate legal process. That belongs in admin tooling, not the client.
 *
 * Storage: `hearthaven:safety-state` in localStorage. Mutations dispatch
 * `hearthaven:safety-changed`.
 */

import type { FriendCode } from "@/lib/game/social";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const SAFETY_STATE_KEY = "hearthaven:safety-state";
export const SAFETY_EVENT = "hearthaven:safety-changed";

export type BlockedKeeper = {
  code: FriendCode;
  displayName: string;
  blockedAt: string;
};

export type ReportReason =
  | "harassment"
  | "explicit-content"
  | "grooming-suspected"
  | "spam-or-scam"
  | "hate-speech"
  | "other";

export type ReportRecord = {
  id: string;
  reporterCode: FriendCode;
  offenderCode: FriendCode;
  offenderDisplayName: string;
  reason: ReportReason;
  details?: string;
  /** A short window of chat context, if available. */
  chatExcerpt?: string;
  /** Scene/route the offense happened in, eg "/app/garden". */
  scene?: string;
  createdAt: string;
  /** True if the moderation engine auto-flagged this (severe pattern match). */
  autoFlagged: boolean;
};

export type SafetyState = {
  blocks: BlockedKeeper[];
  reports: ReportRecord[];
  /** Active until this ISO date — the keeper's outgoing chat is restricted. */
  quarantinedUntil: string | null;
  /** Counter of severe outgoing-message flags this keeper has triggered. */
  severeFlagCount: number;
};

function freshState(): SafetyState {
  return { blocks: [], reports: [], quarantinedUntil: null, severeFlagCount: 0 };
}

export function readSafetyState(): SafetyState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(SAFETY_STATE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<SafetyState>;
    return {
      blocks: Array.isArray(parsed.blocks) ? (parsed.blocks as BlockedKeeper[]) : [],
      reports: Array.isArray(parsed.reports) ? (parsed.reports as ReportRecord[]) : [],
      quarantinedUntil: typeof parsed.quarantinedUntil === "string" ? parsed.quarantinedUntil : null,
      severeFlagCount: Number.isFinite(parsed.severeFlagCount) ? Number(parsed.severeFlagCount) : 0,
    };
  } catch {
    return freshState();
  }
}

function writeState(next: SafetyState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAFETY_STATE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SAFETY_EVENT, { detail: next }));
}

/* ----------------------------------------------------------------
   Block list
   ---------------------------------------------------------------- */

export function blockKeeper(code: FriendCode, displayName: string) {
  const state = readSafetyState();
  if (state.blocks.some((entry) => entry.code === code)) return;
  writeState({
    ...state,
    blocks: [{ code, displayName, blockedAt: new Date().toISOString() }, ...state.blocks].slice(0, 200),
  });
}

export function unblockKeeper(code: FriendCode) {
  const state = readSafetyState();
  writeState({ ...state, blocks: state.blocks.filter((entry) => entry.code !== code) });
}

export function isBlocked(code: FriendCode, state: SafetyState = readSafetyState()): boolean {
  return state.blocks.some((entry) => entry.code === code);
}

/* ----------------------------------------------------------------
   Reports
   ---------------------------------------------------------------- */

export type SubmitReportInput = {
  reporterCode: FriendCode;
  offenderCode: FriendCode;
  offenderDisplayName: string;
  reason: ReportReason;
  details?: string;
  chatExcerpt?: string;
  scene?: string;
  autoFlagged?: boolean;
};

export function submitReport(input: SubmitReportInput): ReportRecord {
  const record: ReportRecord = {
    id: `rep-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    reporterCode: input.reporterCode,
    offenderCode: input.offenderCode,
    offenderDisplayName: input.offenderDisplayName,
    reason: input.reason,
    details: input.details,
    chatExcerpt: input.chatExcerpt,
    scene: input.scene,
    createdAt: new Date().toISOString(),
    autoFlagged: Boolean(input.autoFlagged),
  };
  const state = readSafetyState();
  writeState({ ...state, reports: [record, ...state.reports].slice(0, 200) });
  // Mirror to Supabase `moderator_reports` so it lands in the admin queue.
  // RLS on that table is INSERT-only for authenticated keepers — only the
  // service-role admin can SELECT, which is where the moderator joins the
  // row against `auth.users` to recover the offender's auth metadata (IP,
  // user-agent, email) for legitimate legal-process responses.
  void mirrorReportToSupabase(record);
  return record;
}

async function mirrorReportToSupabase(record: ReportRecord) {
  if (!isSupabaseConfigured() || typeof window === "undefined") return;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // anonymous report can't be attributed; admin won't be able to act on it anyway
    await supabase.from("moderator_reports").insert({
      reporter_profile_id: user.id,
      reporter_code: record.reporterCode,
      offender_code: record.offenderCode,
      offender_display_name: record.offenderDisplayName,
      reason: record.reason,
      details: record.details ?? null,
      chat_excerpt: record.chatExcerpt ?? null,
      scene: record.scene ?? null,
      auto_flagged: record.autoFlagged,
      client_user_agent: window.navigator?.userAgent ?? null,
      // Do NOT collect IP here — Supabase records the request IP automatically
      // on the auth.users row, which is the right legal-process surface.
    });
  } catch (error) {
    // Reports are queued locally regardless. A failed mirror just means the
    // admin won't see it in the dashboard — local state has the canonical
    // record and a retry path can sweep this up later.
    console.warn("[hearthaven safety] could not mirror report to Supabase:", error);
  }
}

/* ----------------------------------------------------------------
   Quarantine — preventative restriction of the LOCAL keeper's outbound chat
   when the moderation engine flags a severe outgoing message. The flag also
   raises a counter so repeated offenses extend the cooldown.
   ---------------------------------------------------------------- */

export function isLocallyQuarantined(state: SafetyState = readSafetyState()): boolean {
  if (!state.quarantinedUntil) return false;
  return new Date(state.quarantinedUntil).getTime() > Date.now();
}

export function quarantineRemainingMs(state: SafetyState = readSafetyState()): number {
  if (!state.quarantinedUntil) return 0;
  return Math.max(0, new Date(state.quarantinedUntil).getTime() - Date.now());
}

/**
 * Quarantine the local keeper for `durationMs` (default 30 minutes). Each
 * severe flag extends the cooldown by ~30 minutes; the third strike pins it to
 * 24 hours and is the strongest signal an admin gets in the report queue.
 */
export function quarantineSelf(opts: { reasonNote?: string; durationMs?: number } = {}): SafetyState {
  const state = readSafetyState();
  const severeFlagCount = state.severeFlagCount + 1;
  const baseDuration = opts.durationMs ?? 30 * 60_000;
  // Escalating: 30m, 30m, then 24h.
  const escalated = severeFlagCount >= 3 ? 24 * 60 * 60_000 : baseDuration;
  const until = new Date(Date.now() + escalated).toISOString();
  const next: SafetyState = { ...state, quarantinedUntil: until, severeFlagCount };
  writeState(next);
  if (opts.reasonNote) console.warn("[hearthaven safety] auto-quarantine:", opts.reasonNote);
  return next;
}

export function clearQuarantine() {
  const state = readSafetyState();
  writeState({ ...state, quarantinedUntil: null });
}
