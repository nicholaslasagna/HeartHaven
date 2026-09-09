/**
 * Lobby follow check.
 *
 *   npm run check:lobby-follow
 *
 * Being carried into the game the lobby started is visible when it goes wrong
 * in either direction: too eager and someone who walked back to the games
 * list is bounced out of it, too cautious and a guest sits in a lobby the
 * host has already left. The second is the one that actually happened, so
 * both directions are pinned here.
 */
import assert from "node:assert/strict";
import {
  shouldFollowLobbyIntoGame,
  LOBBY_FOLLOW_FRESH_MS,
  type LobbyFollowInput,
} from "../src/lib/game/lobby-follow";

const results: string[] = [];
const NOW = 1_800_000_000_000;

const base: LobbyFollowInput = {
  status: "active",
  sessionId: "session-1",
  sawWaitingSessionId: "session-1",
  seated: true,
  hasGameHref: true,
  updatedAtMs: NOW - 1000,
  nowMs: NOW,
};

/* -- the ordinary case: we watched the host press start -- */
{
  assert.equal(shouldFollowLobbyIntoGame(base), true, "watching a lobby start means going with it");

  // Even if the row is old, having watched it start is enough on its own.
  assert.equal(shouldFollowLobbyIntoGame({ ...base, updatedAtMs: NOW - 600_000 }), true,
    "having seen it start does not expire");
  assert.equal(shouldFollowLobbyIntoGame({ ...base, updatedAtMs: null }), true,
    "nor does it need a timestamp");
  results.push("watched   a lobby seen going from waiting to active is always followed");
}

/* -- THE BUG: a guest who never saw it waiting --
   Approval and the host's start can land inside the same poll window, so the
   guest's first read is already 'active'. Requiring that they had seen
   'waiting' left exactly the player who most wanted in sitting in an empty
   lobby. */
{
  const neverSawWaiting = { ...base, sawWaitingSessionId: null };
  assert.equal(shouldFollowLobbyIntoGame(neverSawWaiting), true,
    "a lobby that was already active on the first read, but only just, is still followed");

  const differentSession = { ...base, sawWaitingSessionId: "an-older-session" };
  assert.equal(shouldFollowLobbyIntoGame(differentSession), true,
    "having watched a DIFFERENT lobby earlier must not block this one");

  // ...but not one that has been running a while: that is someone opening the
  // games list who still holds a seat from earlier.
  assert.equal(
    shouldFollowLobbyIntoGame({ ...neverSawWaiting, updatedAtMs: NOW - LOBBY_FOLLOW_FRESH_MS - 1 }),
    false,
    "a lobby last touched longer ago than the window is not 'starting now'",
  );
  assert.equal(
    shouldFollowLobbyIntoGame({ ...neverSawWaiting, updatedAtMs: NOW - LOBBY_FOLLOW_FRESH_MS }),
    true,
    "the boundary itself still counts",
  );
  assert.equal(shouldFollowLobbyIntoGame({ ...neverSawWaiting, updatedAtMs: null }), false,
    "with no timestamp and no sighting there is nothing to justify a jump");

  // Server ahead of the device: a few seconds of skew must not strand anyone.
  assert.equal(shouldFollowLobbyIntoGame({ ...neverSawWaiting, updatedAtMs: NOW + 5_000 }), true,
    "a row stamped slightly in the future is clock skew, not a stale lobby");
  results.push(`unseen    a lobby active within ${LOBBY_FOLLOW_FRESH_MS / 1000}s is followed even if waiting was never seen · older is not · clock skew is tolerated`);
}

/* -- never follow when there is nothing to follow into -- */
{
  for (const status of ["waiting", "complete", "cancelled"] as const) {
    assert.equal(shouldFollowLobbyIntoGame({ ...base, status }), false, `a ${status} lobby goes nowhere`);
  }
  assert.equal(shouldFollowLobbyIntoGame({ ...base, seated: false }), false,
    "someone without a seat must never be pulled into a game");
  assert.equal(shouldFollowLobbyIntoGame({ ...base, hasGameHref: false }), false,
    "a lobby with no chosen game has nowhere to send anyone");

  // The two guards together: an unseated onlooker of a fresh lobby stays put.
  assert.equal(
    shouldFollowLobbyIntoGame({ ...base, seated: false, sawWaitingSessionId: null }),
    false,
    "watching a lobby start is not the same as being in it",
  );
  results.push("guards    only an active lobby, only with a game chosen, only for someone actually seated");
}

console.log(`\nLobby follow: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
