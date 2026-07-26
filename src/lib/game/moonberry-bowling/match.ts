/**
 * Moonberry Bowling — match state for 2-8 players.
 *
 * Pure, and deliberately thin: ten-pin scoring already exists and is well
 * tested in `bowling-scoring.ts`, so this only does the part that is new —
 * turning a logged throw into a pin count using the real simulation, and
 * deriving the shared seed that keeps every client's simulation identical.
 *
 * WHY PINS ARE DERIVED, NOT STORED
 *
 * The old `submit_bowling_roll` RPC computed pins server-side from a simple
 * SQL model. That cannot run the rigid-body simulation, so the number the
 * server produced and the pins the player actually watched fall would
 * disagree — the scoreboard would contradict the screen.
 *
 * Instead the log stores only what the player did (aim, power, spin) and
 * every client replays `simulateThrow` to get the pinfall. The function is
 * deterministic and the seed comes from the session id and the throw's
 * position in the log, so all eight clients independently agree without
 * syncing a single pin.
 *
 * The trade this makes, stated plainly: pin counts are no longer computed
 * by the server, so a modified client could log an aim/power/spin it never
 * really performed. That exposure already existed — aim and power were
 * always client-supplied — and the reward path is unaffected, since payouts
 * are still capped server-side by the game's reward spec. It is a real
 * change in where trust sits, and worth knowing about.
 */

import { computeBowlingState, type BowlingRoll, type BowlingState } from "@/lib/game/bowling-scoring";
import { simulateThrow, type ThrowResult } from "./physics";

export type LoggedThrow = {
  seat: number;
  aim: number;
  power: number;
  spin: number;
};

/**
 * Seed for the Nth throw of a session. Derived from values every client
 * already holds, so it needs no server round trip and cannot drift.
 */
export function throwSeed(sessionId: string | null, throwIndex: number) {
  let hash = 0x811c9dc5;
  const key = `${sessionId ?? "solo"}:${throwIndex}`;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type ResolvedThrow = {
  /** The physics run, including frames for playback. */
  result: ThrowResult;
  /** Pins standing before this ball. */
  standingBefore: number[];
  roll: BowlingRoll;
};

/**
 * Replay the whole logged match through the simulation.
 *
 * Every throw is resolved against the deck the previous throws left behind,
 * which is what makes spares real: the second ball only sees the pins that
 * survived the first.
 */
export function resolveMatch(
  throws: LoggedThrow[],
  seatCount: number,
  sessionId: string | null,
): { rolls: BowlingRoll[]; resolved: ResolvedThrow[]; state: BowlingState } {
  const rolls: BowlingRoll[] = [];
  const resolved: ResolvedThrow[] = [];

  for (let index = 0; index < throws.length; index += 1) {
    const entry = throws[index];
    // Turn order and rack resets are the scorer's business, so ask it what
    // the deck looks like before this ball rather than tracking it here.
    const before = computeBowlingState(rolls, seatCount);
    const freshRack = before.ballInFrame === 0 || before.standingPins === 10;
    const standingBefore = freshRack
      ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      : standingFromCount(before.standingPins, resolved[index - 1]);

    const result = simulateThrow(
      {
        aim: entry.aim,
        power: entry.power,
        spin: entry.spin,
        seed: throwSeed(sessionId, index),
      },
      standingBefore,
    );

    const roll: BowlingRoll = {
      seat: entry.seat,
      pins: result.pinCount,
      aim: entry.aim,
      power: entry.power,
      rollSeed: throwSeed(sessionId, index),
    };
    rolls.push(roll);
    resolved.push({ result, standingBefore, roll });
  }

  return { rolls, resolved, state: computeBowlingState(rolls, seatCount) };
}

/**
 * Which pin ids are still up. Prefers the previous throw's actual survivors
 * so a spare is bowled at the real leave; the count-based fallback only
 * matters for a log written before the simulation existed.
 */
function standingFromCount(count: number, previous?: ResolvedThrow): number[] {
  if (previous && previous.result.standing.length === count) return previous.result.standing;
  return Array.from({ length: count }, (_, i) => i);
}
