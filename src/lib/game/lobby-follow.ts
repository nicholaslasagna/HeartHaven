/**
 * Whether a seated keeper should be carried into the game the lobby started.
 *
 * Getting this wrong is visible in both directions. Too eager and someone who
 * deliberately walked back to the games list is bounced straight out of it.
 * Too cautious and a guest is left sitting in a lobby the host has already
 * left — which is exactly what used to happen, and why the decision now
 * leans on hydrated state rather than a single realtime event that RLS could
 * drop.
 *
 * There were two ways to be stuck, and the follow rule has to cover both:
 *
 *   1. The lobby was watched going from waiting to active. That is the
 *      ordinary case: the host pressed start while everyone was looking.
 *   2. The lobby was ALREADY active on the very first read. A guest whose
 *      approval and the host's start land inside the same poll window never
 *      observes `waiting` at all, so a rule that requires having seen it
 *      leaves them behind — the one player who most obviously wanted in.
 *
 * The second case is separated from "I opened the games list and happen to
 * still hold a seat in something from earlier" by how recently the lobby
 * changed. A session that went active in the last few seconds is one that is
 * starting now.
 */

/** How recently an already-active lobby must have changed to count as new. */
export const LOBBY_FOLLOW_FRESH_MS = 15_000;

export type LobbyFollowInput = {
  status: "waiting" | "active" | "complete" | "cancelled";
  sessionId: string;
  /** The session this client watched in `waiting`, if any. */
  sawWaitingSessionId: string | null;
  /** Whether this keeper holds a seat (or is the host). */
  seated: boolean;
  /** A lobby with no chosen game has nowhere to send anyone. */
  hasGameHref: boolean;
  /** `updated_at` from the lobby row, in ms. */
  updatedAtMs: number | null;
  nowMs: number;
};

export function shouldFollowLobbyIntoGame(input: LobbyFollowInput): boolean {
  if (input.status !== "active") return false;
  if (!input.seated) return false;
  if (!input.hasGameHref) return false;

  // Case 1: we watched this very lobby start.
  if (input.sawWaitingSessionId === input.sessionId) return true;

  // Case 2: it was already active when we first saw it, but only just.
  if (input.updatedAtMs === null || !Number.isFinite(input.updatedAtMs)) return false;
  const age = input.nowMs - input.updatedAtMs;
  // A negative age means the row is stamped in the future — clock skew
  // between the server and this device. Treat it as fresh rather than
  // stranding the guest over a few seconds of drift.
  if (age < 0) return true;
  return age <= LOBBY_FOLLOW_FRESH_MS;
}
