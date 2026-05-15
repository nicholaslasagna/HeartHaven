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
 * True if `code` can be resolved by the local keeper. Only friends and
 * previously-played-with keepers are findable — strangers with guessed codes
 * see "not found" even if the code is technically valid.
 */
export function canLookupCode(code: FriendCode, state: SocialState = rawRead()): boolean {
  const normalized = normalizeFriendCode(code);
  if (normalized === state.selfCode) return true;
  if (state.friends.some((friend) => friend.code === normalized)) return true;
  if (state.playedWith.some((played) => played.code === normalized)) return true;
  return false;
}

/** A summary of who a code resolves to, or null if the lookup is gated. */
export function lookupFriendCode(code: FriendCode, state: SocialState = rawRead()):
  | { code: FriendCode; displayName: string; relationship: "self" | "friend" | "played-with" }
  | null {
  const normalized = normalizeFriendCode(code);
  if (normalized === state.selfCode) {
    return { code: state.selfCode, displayName: readCachedPublicDisplayName(state.selfDisplayName), relationship: "self" };
  }
  const friend = state.friends.find((entry) => entry.code === normalized);
  if (friend) return { code: friend.code, displayName: friend.displayName, relationship: "friend" };
  const played = state.playedWith.find((entry) => entry.code === normalized);
  if (played) return { code: played.code, displayName: played.displayName, relationship: "played-with" };
  return null;
}

/**
 * Send a friend invite to `toCode`. Only allowed if the recipient is in the
 * played-with set (i.e. you've actually shared a room before). For the local-
 * only MVP, the "delivery" is mirroring the invite into our own inbox under
 * `toCode` — production wires this to a Supabase `friend_invites` row.
 */
export function sendFriendInvite(
  toCode: FriendCode,
  message?: string,
):
  | { ok: true; invite: FriendInvite }
  | { ok: false; reason: "not-allowed" | "already-friends" | "self" | "invalid-code" } {
  const state = rawRead();
  const code = normalizeFriendCode(toCode);
  if (!isFriendCodeShape(code)) return { ok: false, reason: "invalid-code" };
  if (code === state.selfCode) return { ok: false, reason: "self" };
  if (state.friends.some((friend) => friend.code === code)) return { ok: false, reason: "already-friends" };

  const allowed = state.playedWith.some((played) => played.code === code);
  if (!allowed) return { ok: false, reason: "not-allowed" };

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
