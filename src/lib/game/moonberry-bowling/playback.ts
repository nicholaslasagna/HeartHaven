/**
 * Append-only playback cursor for Moonberry Bowling.
 *
 * The database move log is authoritative and polling/realtime can deliver the
 * same rows in either order. Keeping this tiny state machine outside React
 * makes the one-shot rule testable: a move may be accepted once per session,
 * never again because a stale snapshot was merged back in.
 */

export type BowlingPlaybackMove = {
  moveIndex?: number;
  seat?: number;
};

export type BowlingPlaybackState = {
  initialized: boolean;
  lastMoveIndex: number;
  sessionId: string | null;
  seenMoveKeys: Set<string>;
  queuedMoveKeys: Set<string>;
  activeMoveKey: string | null;
  completedMoveKeys: Set<string>;
};

export function createBowlingPlaybackState(sessionId: string | null): BowlingPlaybackState {
  return {
    initialized: false,
    lastMoveIndex: -1,
    sessionId,
    seenMoveKeys: new Set<string>(),
    queuedMoveKeys: new Set<string>(),
    activeMoveKey: null,
    completedMoveKeys: new Set<string>(),
  };
}

export function bowlingMoveKey(entry: BowlingPlaybackMove | undefined, index: number) {
  const moveIndex = Number.isFinite(entry?.moveIndex) ? Number(entry?.moveIndex) : index;
  // `move_index` is the database's session-scoped identity. Seat is payload,
  // not identity, so a realtime row and its polled copy must resolve to the
  // same animation even if one copy has not hydrated seat data yet.
  return String(moveIndex);
}

/** Mark the first server snapshot as already viewed; it must not replay. */
export function seedBowlingPlayback(
  state: BowlingPlaybackState,
  entries: BowlingPlaybackMove[],
) {
  state.initialized = true;
  state.lastMoveIndex = entries.reduce(
    (highest, entry, index) => Math.max(highest, Number.isFinite(entry.moveIndex) ? Number(entry.moveIndex) : index),
    -1,
  );
  for (let index = 0; index < entries.length; index += 1) {
    const key = bowlingMoveKey(entries[index], index);
    state.seenMoveKeys.add(key);
    // Existing rows are the opening state, not new events. Marking them
    // completed prevents a remount from replaying the opening log.
    state.completedMoveKeys.add(key);
  }
}

/**
 * Accept an unseen append-only move. Returning false means it is a duplicate
 * or stale row and must not be placed in the animation queue.
 */
export function acceptBowlingPlaybackMove(
  state: BowlingPlaybackState,
  entry: BowlingPlaybackMove | undefined,
  index: number,
) {
  const moveIndex = Number.isFinite(entry?.moveIndex) ? Number(entry?.moveIndex) : index;
  const key = bowlingMoveKey(entry, index);
  if (
    state.seenMoveKeys.has(key)
    || state.queuedMoveKeys.has(key)
    || state.activeMoveKey === key
    || state.completedMoveKeys.has(key)
    || moveIndex <= state.lastMoveIndex
  ) return false;
  state.seenMoveKeys.add(key);
  state.queuedMoveKeys.add(key);
  state.lastMoveIndex = moveIndex;
  return true;
}

/** Claim a queued move for the renderer's single active playback slot. */
export function startBowlingPlaybackMove(state: BowlingPlaybackState, key: string) {
  if (state.activeMoveKey !== null || !state.queuedMoveKeys.delete(key)) return false;
  state.activeMoveKey = key;
  return true;
}

/** Complete a move exactly once; a second completion is ignored. */
export function finishBowlingPlaybackMove(state: BowlingPlaybackState, key: string) {
  if (state.activeMoveKey !== key) return false;
  state.activeMoveKey = null;
  state.completedMoveKeys.add(key);
  return true;
}

/**
 * Put a move back into the queue when its renderer is torn down mid-shot.
 * React can remount the WebGL scene during a resize, route transition, or
 * development Strict Mode pass. Without this transition the move would be
 * neither queued nor finishable, leaving the UI stuck in "settling" forever.
 */
export function cancelBowlingPlaybackMove(state: BowlingPlaybackState, key: string) {
  if (state.activeMoveKey !== key || state.completedMoveKeys.has(key)) return false;
  state.activeMoveKey = null;
  state.queuedMoveKeys.add(key);
  return true;
}
