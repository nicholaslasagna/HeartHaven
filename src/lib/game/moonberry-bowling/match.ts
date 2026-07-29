/**
 * Moonberry Bowling — match state for 2-8 players.
 *
 * Pure, and deliberately thin: ten-pin scoring already exists and is well
 * tested in `bowling-scoring.ts`, so this only does the part that is new —
 * turning a logged throw into a pin count using the real simulation, and
 * deriving the shared seed that keeps every client's simulation identical.
 *
 * WHY THE SERVER RESULT AND BROWSER SIMULATION BOTH EXIST
 *
 * `submit_bowling_roll` owns membership, turn order, frame/ball validation,
 * canonical pinfall and the roll seed. Browsers replay the richer rigid-body
 * animation from that seed, then reconcile which pins fall to the canonical
 * count. That keeps every score trustworthy and every client visually in
 * agreement without streaming physics transforms sixty times per second.
 */

import { computeBowlingState, type BowlingRoll, type BowlingState } from "@/lib/game/bowling-scoring";
import {
  createPins,
  HEAD_PIN_Z,
  simulateThrow,
  type ThrowFrame,
  type ThrowResult,
} from "./physics";

export type LoggedThrow = {
  moveIndex?: number;
  seat: number;
  aim: number;
  power: number;
  spin: number;
  /** Canonical server result. Local preview throws omit this. */
  pins?: number;
  rollSeed?: number;
  standingBefore?: number;
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
  frameBefore: number;
  ballBefore: number;
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

    const seed = Number.isFinite(entry.rollSeed)
      ? Number(entry.rollSeed)
      : throwSeed(sessionId, entry.moveIndex ?? index);
    const simulated = simulateThrow(
      {
        aim: entry.aim,
        power: entry.power,
        spin: entry.spin,
        seed,
      },
      standingBefore,
    );
    const result = Number.isFinite(entry.pins)
      ? reconcileCanonicalPinfall(simulated, standingBefore, Number(entry.pins))
      : simulated;

    const roll: BowlingRoll = {
      seat: entry.seat,
      pins: result.pinCount,
      aim: entry.aim,
      power: entry.power,
      rollSeed: seed,
    };
    rolls.push(roll);
    resolved.push({
      result,
      standingBefore,
      roll,
      frameBefore: before.currentFrame,
      ballBefore: before.ballInFrame,
    });
  }

  return { rolls, resolved, state: computeBowlingState(rolls, seatCount) };
}

/**
 * The server owns the official pin count. The browser owns the richer rigid
 * body playback, so reconcile the visual simulation to the accepted count
 * instead of letting the scorecard and the deck disagree.
 */
function reconcileCanonicalPinfall(
  result: ThrowResult,
  standingBefore: number[],
  canonicalPins: number,
): ThrowResult {
  const wanted = Math.max(0, Math.min(standingBefore.length, Math.floor(canonicalPins)));
  const standingSet = new Set(standingBefore);
  const simulatedKnocked = result.knocked.filter((id) => standingSet.has(id));
  const chosen = simulatedKnocked.slice(0, wanted);
  if (chosen.length < wanted) {
    const original = createPins();
    const remaining = standingBefore
      .filter((id) => !chosen.includes(id))
      .sort((a, b) => {
        const pinA = original[a];
        const pinB = original[b];
        const aDistance = Math.abs(pinA.x - result.entryX) + (pinA.z - HEAD_PIN_Z) * 0.18;
        const bDistance = Math.abs(pinB.x - result.entryX) + (pinB.z - HEAD_PIN_Z) * 0.18;
        return aDistance - bDistance;
      });
    chosen.push(...remaining.slice(0, wanted - chosen.length));
  }

  const knockedSet = new Set(chosen);
  const originalPins = createPins();
  const impactIndex = Math.max(
    0,
    result.frames.findIndex((frame) => frame.ball.z >= HEAD_PIN_Z - 0.7),
  );
  const frames = result.frames.map((frame, frameIndex) => {
    const progress = frameIndex < impactIndex
      ? 0
      : Math.min(1, (frameIndex - impactIndex) / 22);
    return {
      ...frame,
      pins: frame.pins.map((pin) => reconcilePinFrame(
        pin,
        originalPins[pin.id],
        standingSet.has(pin.id),
        knockedSet.has(pin.id),
        progress,
      )),
    } satisfies ThrowFrame;
  });
  const standing = standingBefore.filter((id) => !knockedSet.has(id));
  return {
    ...result,
    frames,
    knocked: chosen,
    standing,
    pinCount: wanted,
    gutter: wanted === 0 && result.gutter,
  };
}

function reconcilePinFrame(
  pin: ThrowFrame["pins"][number],
  original: ReturnType<typeof createPins>[number],
  existedBefore: boolean,
  shouldFall: boolean,
  progress: number,
): ThrowFrame["pins"][number] {
  if (!existedBefore) return { ...pin, x: 999, z: 999, tilt: 1, spin: 0 };
  if (!shouldFall) {
    return { ...pin, x: original.x, z: original.z, tilt: 0, tiltAxis: 0, spin: 0 };
  }
  if (pin.tilt > 0 || progress <= 0) return pin;
  const direction = pin.id % 2 === 0 ? 1 : -1;
  return {
    ...pin,
    x: original.x + direction * progress * 0.13,
    z: original.z + progress * 0.2,
    tilt: progress,
    tiltAxis: direction * 0.82,
    spin: direction * progress * 3.2,
  };
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
