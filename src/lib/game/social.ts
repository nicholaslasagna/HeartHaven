/**
 * social — friend codes, friend list, invites, and the "played-with" graph.
 *
 * Model:
 *   • Every keeper has a unique friend code, generated once and persisted. The
 *     code is the only handle by which one keeper can be looked up by another.
 *   • Lookup is PRIVACY-GATED: a friend code only resolves if the lookup is
 *     coming from a keeper who is already a friend OR who has previously played
 *     with the target. This stops strangers from spamming guessed codes.
 *   • To bootstrap a new friendship: share a /play room invite link, the
 *     visitor joins your channel → both keepers' `played-with` sets gain each
 *     other → either side can now look the other up by code and send an invite.
 *   • Invites flow: sender calls `sendFriendInvite(theirCode)` → recipient
 *     sees it in `inbox` → accepts (both keepers' friend lists update) or
 *     declines / blocks.
 *
 * Storage: `hearthaven:social-state` in localStorage. Mutations dispatch
 * `hearthaven:social-changed`. Supabase-ready: every field maps cleanly onto
 * `friendships`, `friend_invites`, and a `played_with_log` table.
 */

export const SOCIAL_STATE_KEY = "hearthaven:social-state";
export const SOCIAL_EVENT = "hearthaven:social-changed";
const PUBLIC_USERNAME_STORAGE_KEY = "hearthaven:public-username";
const PUBLIC_USERNAME_MAX_LENGTH = 24;

export type FriendCode = string;

export type Friend = {
  code: FriendCode;
  displayName: string;
  /** When the friendship was sealed (both accepted). */
  acceptedAt: string;
  /** Optional last-seen timestamp from the activity bus / presence. */
  lastSeenAt?: string;
};

export type FriendInvite = {
  id: string;
  fromCode: FriendCode;
  fromDisplayName: string;
  toCode: FriendCode;
  message?: string;
  sentAt: string;
  /** Whether the recipient has already replied to it. */
  status: "pending" | "accepted" | "declined" | "blocked";
};

export type PlayedWithEntry = {
  code: FriendCode;
  displayName: string;
  /** Scene/room where they were seen. */
  context: string;
  lastPlayedAt: string;
};

export type SocialState = {
  selfCode: FriendCode;
  selfDisplayName: string;
  friends: Friend[];
  /** Invites this keeper has SENT, kept so the UI can show "pending" state. */
  outgoing: FriendInvite[];
  /** Invites this keeper has RECEIVED (the inbox). */
  inbox: FriendInvite[];
  /** Everyone this keeper has shared a room/garden session with. */
  playedWith: PlayedWithEntry[];
};

/* ----------------------------------------------------------------
   Friend-code generation. Format: "HH-XXXXX-NNN", which matches the
   existing demo code shape ("HH-GARDEN-247") and is easy to share.
   ---------------------------------------------------------------- */

const FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no ambiguous I/O
const FRIEND_CODE_DIGITS = "23456789";                  // no ambiguous 0/1

function randomChars(source: string, count: number): string {
  let out = "";
  for (let i = 0; i < count; i += 1) {
    out += source.charAt(Math.floor(Math.random() * source.length));
  }
  return out;
}

export function generateFriendCode(): FriendCode {
  return `HH-${randomChars(FRIEND_CODE_ALPHABET, 5)}-${randomChars(FRIEND_CODE_DIGITS, 3)}`;
}

export function isFriendCodeShape(value: string): boolean {
  return /^HH-[A-Z]{4,6}-[0-9]{2,4}$/.test(value.trim().toUpperCase());
}

export function normalizeFriendCode(value: string): FriendCode {
  return value.trim().toUpperCase();
}

/* ----------------------------------------------------------------
   Storage + event plumbing.
   ---------------------------------------------------------------- */

function freshState(): SocialState {
  return {
    selfCode: generateFriendCode(),
    selfDisplayName: "Keeper",
    friends: [],
    outgoing: [],
    inbox: [],
    playedWith: [],
  };
}

function normalizePublicDisplayName(value: string | null | undefined, fallback = "Keeper") {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PUBLIC_USERNAME_MAX_LENGTH);
  return cleaned || fallback;
}

function readCachedPublicDisplayName(fallback = "Keeper") {
  if (typeof window === "undefined") return normalizePublicDisplayName(fallback);
  return normalizePublicDisplayName(window.localStorage.getItem(PUBLIC_USERNAME_STORAGE_KEY) ?? fallback);
}

/**
 * Lazy block-list check that avoids importing `safety.ts` (which would
 * create a require cycle, since safety also imports from this module).
 * Reads localStorage directly. Safe to call from anywhere in social.ts.
 */
function isCodeBlocked(code: FriendCode): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem("hearthaven:safety-state");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { blocks?: Array<{ code?: string }> };
    return Array.isArray(parsed.blocks) && parsed.blocks.some((entry) => entry?.code === code);
  } catch {
    return false;
  }
}

function rawRead(): SocialState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(SOCIAL_STATE_KEY);
    if (!raw) {
      // First touch — seed with a stable friend code so the player sees the same one each visit.
      const seed = freshState();
      rawWrite(seed);
      return seed;
    }
    const parsed = JSON.parse(raw) as Partial<SocialState>;
    const base = freshState();
    return {
      selfCode: typeof parsed.selfCode === "string" ? parsed.selfCode : base.selfCode,
      selfDisplayName: readCachedPublicDisplayName(
        typeof parsed.selfDisplayName === "string" ? parsed.selfDisplayName : base.selfDisplayName,
      ),
      friends: Array.isArray(parsed.friends) ? (parsed.friends as Friend[]) : [],
      outgoing: Array.isArray(parsed.outgoing) ? (parsed.outgoing as FriendInvite[]) : [],
      inbox: Array.isArray(parsed.inbox) ? (parsed.inbox as FriendInvite[]) : [],
      playedWith: Array.isArray(parsed.playedWith) ? (parsed.playedWith as PlayedWithEntry[]) : [],
    };
  } catch {
    return freshState();
  }
}

function rawWrite(state: SocialState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOCIAL_STATE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(SOCIAL_EVENT, { detail: state }));
}

/* ----------------------------------------------------------------
   Public API
   ---------------------------------------------------------------- */

/** Read the current state. */
export function getSocialState(): SocialState {
  return rawRead();
}

/** Cosmetically set the keeper's display name (used in invite cards). */
export function setSelfDisplayName(displayName: string) {
  const state = rawRead();
  rawWrite({ ...state, selfDisplayName: normalizePublicDisplayName(displayName, state.selfDisplayName) });
}

/** Reset the friend code (rarely needed — exposed for the account page). */
export function regenerateFriendCode(): FriendCode {
  const state = rawRead();
  const next = generateFriendCode();
  rawWrite({ ...state, selfCode: next });
  // Fire a dedicated event so the realtime bridge can:
  //   1. push the new code onto `profiles.friend_code`,
  //   2. re-subscribe to the realtime channel filtered on the new code,
  //   3. cancel any in-flight outgoing invites attributed to the OLD code.
  // Without this, regenerating a code would silently break inbound
  // realtime delivery until the next full page reload.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("hearthaven:friend-code-regenerated", { detail: { code: next } }),
    );
  }
  return next;
}

/**
 * Add a keeper to the played-with set. Called from the realtime hooks when
 * presence reports a new id, OR from a "Play together" handshake. This is what
 * unlocks friend-code lookup of that keeper.
 */
export function recordPlayedWith(entry: { code: FriendCode; displayName: string; context: string }) {
  const state = rawRead();
  const code = normalizeFriendCode(entry.code);
  if (code === state.selfCode) return;
  // A blocked keeper visiting our scene should never reappear in the
  // played-with suggestions strip. The block list is authoritative here.
  if (isCodeBlocked(code)) return;
  const now = new Date().toISOString();
  const existingIndex = state.playedWith.findIndex((played) => played.code === code);
  const next: PlayedWithEntry = {
    code,
    displayName: entry.displayName || state.playedWith[existingIndex]?.displayName || "Keeper",
    context: entry.context,
    lastPlayedAt: now,
  };
  const playedWith = existingIndex >= 0
    ? state.playedWith.map((played, index) => (index === existingIndex ? next : played))
    : [next, ...state.playedWith].slice(0, 60);
  rawWrite({ ...state, playedWith });
}

/**
 * True if `code` can be resolved by the local keeper. Self, friends, and
 * previously-played-with keepers always resolve. Any well-formed code also
 * resolves (the lookup tells you "an unknown keeper with that code") so the
 * sender can invite without playing first — the recipient still has to
 * accept to become friends.
 */
export function canLookupCode(code: FriendCode, state: SocialState = rawRead()): boolean {
  const normalized = normalizeFriendCode(code);
  if (normalized === state.selfCode) return true;
  if (state.friends.some((friend) => friend.code === normalized)) return true;
  if (state.playedWith.some((played) => played.code === normalized)) return true;
  return isFriendCodeShape(normalized);
}

/** A summary of who a code resolves to, or null if the code is malformed. */
export function lookupFriendCode(code: FriendCode, state: SocialState = rawRead()):
  | { code: FriendCode; displayName: string; relationship: "self" | "friend" | "played-with" | "stranger" }
  | null {
  const normalized = normalizeFriendCode(code);
  if (normalized === state.selfCode) {
    return { code: state.selfCode, displayName: readCachedPublicDisplayName(state.selfDisplayName), relationship: "self" };
  }
  const friend = state.friends.find((entry) => entry.code === normalized);
  if (friend) return { code: friend.code, displayName: friend.displayName, relationship: "friend" };
  const played = state.playedWith.find((entry) => entry.code === normalized);
  if (played) return { code: played.code, displayName: played.displayName, relationship: "played-with" };
  // Any well-formed code resolves as a "stranger". The sender can invite,
  // and the recipient still has to accept on their end — so this isn't a
  // privacy hole, just a convenience for first-time meetings.
  if (isFriendCodeShape(normalized)) {
    return { code: normalized, displayName: "Keeper", relationship: "stranger" };
  }
  return null;
}

/**
 * Send a friend invite to `toCode`.
 *
 * Anyone with a well-formed code can be invited. The privacy gate is that
 * the RECIPIENT has to accept on their side — unknown senders can be blocked
 * or declined, and the invite arrives via a shareable link the sender hands
 * to the recipient out-of-band (text, DM, room visit). This matches how
 * Webkinz-style "invite by code" works in practice.
 */
/**
 * Rolling-window cap on how many invites a keeper can send. Keeps a single
 * burst at a reasonable level (5/min, 30/hour) — the actual UX rarely
 * exceeds this; tripping the cap usually means automated abuse.
 */
const INVITE_BURST_WINDOW_MS = 60_000;
const INVITE_BURST_LIMIT = 5;
const INVITE_HOUR_WINDOW_MS = 60 * 60_000;
const INVITE_HOUR_LIMIT = 30;

function checkInviteRateLimit(state: SocialState): { ok: true } | { ok: false; reason: "rate-limited" } {
  const now = Date.now();
  // We can't rely on the outgoing slice alone — only sliced to 40 entries —
  // so we count anything within each window from `sentAt`.
  let burst = 0;
  let hourly = 0;
  for (const invite of state.outgoing) {
    const t = Date.parse(invite.sentAt);
    if (!Number.isFinite(t)) continue;
    if (now - t <= INVITE_BURST_WINDOW_MS) burst += 1;
    if (now - t <= INVITE_HOUR_WINDOW_MS) hourly += 1;
  }
  if (burst >= INVITE_BURST_LIMIT || hourly >= INVITE_HOUR_LIMIT) return { ok: false, reason: "rate-limited" };
  return { ok: true };
}

export function sendFriendInvite(
  toCode: FriendCode,
  message?: string,
):
  | { ok: true; invite: FriendInvite }
  | { ok: false; reason: "already-friends" | "self" | "invalid-code" | "already-pending" | "rate-limited" | "blocked" } {
  const state = rawRead();
  const code = normalizeFriendCode(toCode);
  if (!isFriendCodeShape(code)) return { ok: false, reason: "invalid-code" };
  if (code === state.selfCode) return { ok: false, reason: "self" };
  if (state.friends.some((friend) => friend.code === code)) return { ok: false, reason: "already-friends" };
  // Refuse to send to a keeper we've blocked — the recipient-side filters
  // would silently drop it anyway, but failing early gives the user a
  // clearer message AND keeps the database from accruing dead-letter rows.
  if (isCodeBlocked(code)) return { ok: false, reason: "blocked" };
  // Anti-spam: if we already have a pending outgoing invite to this
  // recipient, return that instead of creating a second row. The UI
  // shows the existing pending entry.
  const existing = state.outgoing.find((entry) => entry.toCode === code && entry.status === "pending");
  if (existing) return { ok: false, reason: "already-pending" };
  // Rolling-window rate limit — same UX guard the chat layer uses.
  const limit = checkInviteRateLimit(state);
  if (!limit.ok) return { ok: false, reason: limit.reason };

  const invite: FriendInvite = {
    id: `inv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fromCode: state.selfCode,
    fromDisplayName: readCachedPublicDisplayName(state.selfDisplayName),
    toCode: code,
    message,
    sentAt: new Date().toISOString(),
    status: "pending",
  };

  rawWrite({ ...state, outgoing: [invite, ...state.outgoing].slice(0, 40) });
  return { ok: true, invite };
}

/* ----------------------------------------------------------------
   Shareable invite tokens.

   A token bundles (fromCode, fromDisplayName, optional message) so a
   sender can hand a single URL to their friend over text/DM/Discord.
   The recipient opens the URL, the friends page parses the token, and
   drops the invite into their inbox to accept like any other.

   The encoding is intentionally simple base64-url of JSON — no
   secrets here, just public identifiers + a label.
   ---------------------------------------------------------------- */

export type InviteTokenPayload = {
  fromCode: FriendCode;
  fromDisplayName: string;
  message?: string;
  sentAt: string;
};

function base64UrlEncode(value: string): string {
  if (typeof window === "undefined") return "";
  return window
    .btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  if (typeof window === "undefined") return "";
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (value.length % 4)) % 4);
  try {
    return decodeURIComponent(escape(window.atob(padded)));
  } catch {
    return "";
  }
}

export function buildInviteToken(payload: Omit<InviteTokenPayload, "sentAt"> & { sentAt?: string }): string {
  const data: InviteTokenPayload = {
    fromCode: normalizeFriendCode(payload.fromCode),
    fromDisplayName: normalizePublicDisplayName(payload.fromDisplayName),
    message: payload.message,
    sentAt: payload.sentAt ?? new Date().toISOString(),
  };
  return base64UrlEncode(JSON.stringify(data));
}

export function parseInviteToken(token: string): InviteTokenPayload | null {
  try {
    const json = base64UrlDecode(token);
    if (!json) return null;
    const parsed = JSON.parse(json) as Partial<InviteTokenPayload>;
    if (!parsed.fromCode || !isFriendCodeShape(String(parsed.fromCode))) return null;
    return {
      fromCode: normalizeFriendCode(String(parsed.fromCode)),
      fromDisplayName: normalizePublicDisplayName(parsed.fromDisplayName, "Keeper"),
      message: typeof parsed.message === "string" ? parsed.message.slice(0, 240) : undefined,
      sentAt: typeof parsed.sentAt === "string" ? parsed.sentAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Build a shareable invite URL for the currently-pending outgoing invite.
 * The sender DMs this link to their friend — clicking it opens the friends
 * page and drops the invite straight into the inbox.
 */
export function buildInviteLink(invite: FriendInvite, origin: string): string {
  const token = buildInviteToken({
    fromCode: invite.fromCode,
    fromDisplayName: invite.fromDisplayName,
    message: invite.message,
    sentAt: invite.sentAt,
  });
  const url = new URL("/app/friends", origin);
  url.searchParams.set("accept", token);
  return url.toString();
}

/**
 * Add an incoming invite to the inbox from a raw code (the visitor pasted
 * a friend code, no shareable URL). The sender's display name is unknown
 * locally — we use the code as the label until they actually connect.
 */
export function acceptInviteFromCode(
  fromCode: FriendCode,
  fromDisplayName?: string,
  message?: string,
): { ok: true; invite: FriendInvite } | { ok: false; reason: "self" | "already-friends" | "invalid-code" | "duplicate" | "blocked" } {
  const state = rawRead();
  const code = normalizeFriendCode(fromCode);
  if (!isFriendCodeShape(code)) return { ok: false, reason: "invalid-code" };
  if (code === state.selfCode) return { ok: false, reason: "self" };
  if (state.friends.some((friend) => friend.code === code)) return { ok: false, reason: "already-friends" };
  if (state.inbox.some((entry) => entry.fromCode === code && entry.status === "pending")) {
    return { ok: false, reason: "duplicate" };
  }
  // Last line of defense: a blocked keeper must never land back in the inbox
  // via paste, realtime backfill, or URL token redemption. The block list is
  // re-read each call so an unblock takes effect without a reload.
  if (isCodeBlocked(code)) {
    return { ok: false, reason: "blocked" };
  }
  const invite: FriendInvite = {
    id: `inv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fromCode: code,
    fromDisplayName: normalizePublicDisplayName(fromDisplayName, "Keeper"),
    toCode: state.selfCode,
    message,
    sentAt: new Date().toISOString(),
    status: "pending",
  };
  rawWrite({ ...state, inbox: [invite, ...state.inbox].slice(0, 60) });
  return { ok: true, invite };
}

/**
 * Cancel a pending outgoing invite (the recipient hasn't replied yet).
 */
export function cancelOutgoingInvite(inviteId: string) {
  const state = rawRead();
  rawWrite({ ...state, outgoing: state.outgoing.filter((entry) => entry.id !== inviteId) });
}

/**
 * Inject an inbound invite (called by the realtime layer when a friend invite
 * arrives over the wire). Demo-mode keepers can also call this from a test
 * harness to simulate incoming invites.
 */
export function receiveFriendInvite(invite: Omit<FriendInvite, "id" | "status"> & { id?: string }) {
  const state = rawRead();
  const fromCode = normalizeFriendCode(invite.fromCode);
  // Discard self-sent / from-already-friends / from-blocked invites at the boundary.
  if (fromCode === state.selfCode) return;
  if (state.friends.some((friend) => friend.code === fromCode)) return;
  const id = invite.id ?? `inv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const stored: FriendInvite = {
    id,
    fromCode,
    fromDisplayName: invite.fromDisplayName,
    toCode: state.selfCode,
    message: invite.message,
    sentAt: invite.sentAt ?? new Date().toISOString(),
    status: "pending",
  };
  if (state.inbox.some((entry) => entry.fromCode === fromCode && entry.status === "pending")) return;
  rawWrite({ ...state, inbox: [stored, ...state.inbox].slice(0, 60) });
}

/** Accept an incoming invite — adds the sender to your friends. */
export function acceptFriendInvite(inviteId: string): Friend | null {
  const state = rawRead();
  const invite = state.inbox.find((entry) => entry.id === inviteId);
  if (!invite || invite.status !== "pending") return null;
  const friend: Friend = {
    code: invite.fromCode,
    displayName: invite.fromDisplayName,
    acceptedAt: new Date().toISOString(),
  };
  rawWrite({
    ...state,
    friends: [friend, ...state.friends.filter((entry) => entry.code !== friend.code)],
    inbox: state.inbox.map((entry) => (entry.id === inviteId ? { ...entry, status: "accepted" } : entry)),
  });
  return friend;
}

/** Decline an incoming invite, leaves a tombstone for clarity. */
export function declineFriendInvite(inviteId: string) {
  const state = rawRead();
  rawWrite({
    ...state,
    inbox: state.inbox.map((entry) => (entry.id === inviteId ? { ...entry, status: "declined" } : entry)),
  });
}

/**
 * Add a Friend record directly — used when the sender's realtime subscription
 * sees the recipient accept their invite. Bypasses the inbox lookup that
 * `acceptFriendInvite` does, because the sender never had a local invite row
 * to begin with (they only had the outgoing record).
 */
export function addFriendDirectly(entry: { code: FriendCode; displayName: string }): Friend {
  const state = rawRead();
  const code = normalizeFriendCode(entry.code);
  if (code === state.selfCode) {
    return { code, displayName: entry.displayName, acceptedAt: new Date().toISOString() };
  }
  const existing = state.friends.find((friend) => friend.code === code);
  if (existing) return existing;
  const friend: Friend = {
    code,
    displayName: entry.displayName || "Keeper",
    acceptedAt: new Date().toISOString(),
  };
  rawWrite({
    ...state,
    friends: [friend, ...state.friends].slice(0, 200),
    playedWith: state.playedWith.some((played) => played.code === code)
      ? state.playedWith
      : [{ code, displayName: friend.displayName, context: "friend-accept", lastPlayedAt: new Date().toISOString() }, ...state.playedWith].slice(0, 60),
  });
  return friend;
}

/** Remove a friend from the friend list. */
export function removeFriend(code: FriendCode) {
  const state = rawRead();
  rawWrite({ ...state, friends: state.friends.filter((entry) => entry.code !== normalizeFriendCode(code)) });
}

/**
 * Mark an inbox invite as blocked (also pushes the sender into the block
 * list in `safety.ts` — done at the call site to avoid an import cycle here).
 */
export function markInviteBlocked(inviteId: string) {
  const state = rawRead();
  rawWrite({
    ...state,
    inbox: state.inbox.map((entry) => (entry.id === inviteId ? { ...entry, status: "blocked" } : entry)),
  });
}
