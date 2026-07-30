/**
 * Moonberry Racing — reading a race out of the move log.
 *
 * Pure, so the rules that decide what everyone is about to play can be
 * checked headlessly instead of only by clicking through a lobby with two
 * browsers open.
 *
 * The log is the single source of truth: course, lap count, power-ups,
 * who has confirmed, and when the lights go out. Every client folds the same
 * ordered list and lands on the same setup, which is why none of it needs to
 * be broadcast separately.
 */

export type RaceMove = {
  move_type: string;
  profile_id: string;
  payload: unknown;
};

export type RaceSetup = {
  courseId: string;
  /** Wall-clock ms the race begins, or null before the host starts. */
  startAt: number | null;
  laps: number;
  items: boolean;
  /** Profile ids that have confirmed they are ready for THIS race. */
  readyIds: Set<string>;
};

export const MIN_LAPS = 1;
export const MAX_LAPS = 5;
export const DEFAULT_LAPS = 3;

export function deriveRaceSetup(moves: RaceMove[], fallbackCourseId: string): RaceSetup {
  let courseId = fallbackCourseId;
  let startAt: number | null = null;
  let laps = DEFAULT_LAPS;
  let items = true;
  /* Ready flags are cleared by every start, so a rematch makes everyone
     confirm again rather than inheriting stale readiness from last race. */
  const readyIds = new Set<string>();

  for (const move of moves) {
    const payload = (move.payload ?? {}) as {
      courseId?: string;
      startAt?: number;
      laps?: number;
      items?: boolean;
      ready?: boolean;
    };

    switch (move.move_type) {
      case "course":
        if (payload.courseId) courseId = payload.courseId;
        break;
      case "settings":
        if (Number.isFinite(payload.laps)) {
          // Clamp rather than trust: the payload is client-supplied.
          laps = Math.max(MIN_LAPS, Math.min(MAX_LAPS, Math.floor(Number(payload.laps))));
        }
        if (typeof payload.items === "boolean") items = payload.items;
        break;
      case "ready":
        if (payload.ready === false) readyIds.delete(move.profile_id);
        else readyIds.add(move.profile_id);
        break;
      case "start":
        if (Number(payload.startAt) > 0) {
          // Later stamps win, so a rematch supersedes the previous race.
          startAt = Math.max(startAt ?? 0, Number(payload.startAt));
          readyIds.clear();
        }
        break;
      default:
        break;
    }
  }

  return { courseId, startAt, laps, items, readyIds };
}

/**
 * May the host drop the lights?
 *
 * Everyone must have confirmed. Starting while someone's course is still
 * building costs them the race before it begins, and a solo player has
 * nobody to wait for.
 */
export function canStartRace(seatIds: string[], readyIds: Set<string>) {
  if (seatIds.length <= 1) return true;
  return seatIds.every((id) => readyIds.has(id));
}
