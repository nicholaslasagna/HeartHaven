/**
 * bowling-scoring — a pure, deterministic ten-pin bowling engine.
 *
 * The multiplayer bowling game is driven entirely off the ordered move
 * log (`game_moves`). Each roll is one move with payload `{ pins }` and
 * the submitter's seat. Because this module derives the ENTIRE game
 * state (frames, scores, whose turn, game over) from that ordered list
 * of rolls, every client that replays the same log computes byte-for-byte
 * identical state. The server owns accepted pin counts; this module owns
 * deterministic replay, scoring, turn state, and exact visible rack state.
 *
 * Turn model: frame-major. Players alternate per frame —
 *   seat0 frame0, seat1 frame0, seat0 frame1, seat1 frame1, …
 * The active player bowls their whole frame (1 ball on a strike, 2 balls
 * otherwise; up to 3 in the 10th) before the turn passes. Scoring is
 * computed per player independently from their own roll sequence, so
 * spare/strike look-ahead never crosses players.
 *
 * Everything here is framework-free and side-effect-free so it can be
 * reasoned about + unit-tested in isolation.
 */

export const BOWLING_FRAMES = 10;
export const BOWLING_PINS = 10;
export const BOWLING_PIN_IDS = Array.from({ length: BOWLING_PINS }, (_, index) => index);

const BOWLING_PIN_LAYOUT = [
  { x: 0, row: 0 },
  { x: -0.18, row: 1 },
  { x: 0.18, row: 1 },
  { x: -0.35, row: 2 },
  { x: 0, row: 2 },
  { x: 0.35, row: 2 },
  { x: -0.52, row: 3 },
  { x: -0.18, row: 3 },
  { x: 0.18, row: 3 },
  { x: 0.52, row: 3 },
] as const;

export type BowlingRoll = {
  /** Seat index of the player who threw this ball (0 or 1). */
  seat: number;
  /** Pins knocked down on this ball (0–10). */
  pins: number;
  /** Optional aiming lane offset, -1 = far left, 1 = far right. */
  aim?: number;
  /** Optional locked power, 0–1. */
  power?: number;
};

export type BowlingFrame = {
  /** Pins for each ball thrown in this frame. */
  rolls: number[];
  /** Running total through this frame once it's scorable, else null. */
  cumulative: number | null;
  isStrike: boolean;
  isSpare: boolean;
  /** True once this frame has all the balls it will ever get. */
  complete: boolean;
};

export type BowlingPlayer = {
  seat: number;
  frames: BowlingFrame[];
  /** Best-known running total (last scorable cumulative). */
  total: number;
  /** True when all 10 frames are complete. */
  complete: boolean;
};

export type BowlingState = {
  players: BowlingPlayer[];
  /** Seat whose turn it is now (−1 when the game is over). */
  currentSeat: number;
  /** 0-based frame the current seat is bowling. */
  currentFrame: number;
  /** Balls already thrown in the current seat's current frame. */
  ballInFrame: number;
  /** Pins still standing for the NEXT ball of the current turn. */
  standingPins: number;
  gameOver: boolean;
  /** Seats tied for the highest total (length 1 = outright winner). */
  winnerSeats: number[];
};

function clampPins(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(BOWLING_PINS, Math.floor(value)));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function clampPower(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Resolve the number of pins from aim, power, and the authoritative rack.
 * This formula is mirrored by `public.resolve_bowling_pins` in the database.
 */
export function resolveBowlingPins(aim: number, power: number, standing: number): number {
  const safeStanding = Math.max(0, Math.min(BOWLING_PINS, Math.floor(standing)));
  const safeAim = clampUnit(aim);
  const safePower = clampPower(power);
  const aimError = Math.abs(safeAim);
  const powerError = Math.abs(safePower - 0.84);
  const aimQuality = Math.max(0, Math.min(1, 1 - aimError / 0.92));
  const powerQuality = Math.max(0, Math.min(1, 1 - powerError / 0.84));

  if (safeStanding <= 0) return 0;
  if (aimError > 0.78 || safePower < 0.14) return 0;
  if (safeStanding === BOWLING_PINS && aimError <= 0.13 && safePower >= 0.72 && safePower <= 0.98) {
    return BOWLING_PINS;
  }
  if (safeStanding < BOWLING_PINS && aimError <= 0.22 && safePower >= 0.55) return safeStanding;

  const base = Math.round(safeStanding * (0.12 + aimQuality * 0.52 + powerQuality * 0.34));
  const hookPenalty = Math.max(0, aimError - 0.42) * 3;
  const powerPenalty = safePower < 0.35 ? 2 : safePower > 0.98 ? 1 : 0;
  return Math.max(0, Math.min(safeStanding, base - Math.round(hookPenalty) - powerPenalty));
}

/** Pick the exact pins a canonical roll knocks down. */
export function selectBowlingKnockedPinIds(
  standingPinIds: readonly number[],
  roll: Pick<BowlingRoll, "aim" | "power" | "pins">,
): number[] {
  const count = Math.max(0, Math.min(standingPinIds.length, Math.floor(roll.pins)));
  if (count === 0) return [];
  const impactX = clampUnit(roll.aim ?? 0) * 0.58;
  const power = clampPower(roll.power ?? 0.7);

  return [...standingPinIds]
    .sort((leftId, rightId) => {
      const left = BOWLING_PIN_LAYOUT[leftId] ?? BOWLING_PIN_LAYOUT[0];
      const right = BOWLING_PIN_LAYOUT[rightId] ?? BOWLING_PIN_LAYOUT[0];
      // Strong throws carry through the back rows; softer throws favor the head pins.
      const rowWeight = 0.105 + power * 0.035;
      const leftDistance = Math.abs(left.x - impactX) + left.row * rowWeight;
      const rightDistance = Math.abs(right.x - impactX) + right.row * rowWeight;
      return leftDistance - rightDistance || leftId - rightId;
    })
    .slice(0, count);
}

/**
 * Replay canonical rolls and return the exact rack for the next ball.
 * A new frame (or a 10th-frame bonus ball) resets the active rack to ten.
 */
export function computeBowlingStandingPinIds(rolls: BowlingRoll[], seatCount = 2): number[] {
  const racks = new Map<number, number[]>();

  rolls.forEach((roll, rollIndex) => {
    const before = computeBowlingState(rolls.slice(0, rollIndex), seatCount);
    let rack = racks.get(roll.seat) ?? [...BOWLING_PIN_IDS];
    if (rack.length !== before.standingPins) {
      rack = before.standingPins === BOWLING_PINS
        ? [...BOWLING_PIN_IDS]
        : [...BOWLING_PIN_IDS].slice(0, before.standingPins);
    }
    const knocked = new Set(selectBowlingKnockedPinIds(rack, roll));
    racks.set(roll.seat, rack.filter((pinId) => !knocked.has(pinId)));
  });

  const state = computeBowlingState(rolls, seatCount);
  if (state.gameOver || state.currentSeat < 0) return [];
  const currentRack = racks.get(state.currentSeat) ?? [...BOWLING_PIN_IDS];
  if (currentRack.length === state.standingPins) return currentRack;
  if (state.standingPins === BOWLING_PINS) return [...BOWLING_PIN_IDS];
  return [...BOWLING_PIN_IDS].slice(0, state.standingPins);
}

/**
 * Parse one player's flat roll list into up to 10 frames, returning the
 * frames plus how far into the current (in-progress) frame they are.
 * Pure: no scoring lookahead here — that's layered on after.
 */
function parseFrames(rolls: number[]): {
  frames: { rolls: number[]; complete: boolean; isStrike: boolean; isSpare: boolean }[];
  /** Index of the first not-yet-complete frame (0–9), or 10 if all done. */
  currentFrame: number;
  ballInFrame: number;
  standingPins: number;
} {
  const frames: { rolls: number[]; complete: boolean; isStrike: boolean; isSpare: boolean }[] = [];
  let i = 0;

  for (let f = 0; f < BOWLING_FRAMES; f += 1) {
    if (i >= rolls.length) {
      // No balls thrown for this frame yet — it's the current frame.
      return { frames, currentFrame: f, ballInFrame: 0, standingPins: BOWLING_PINS };
    }

    if (f < BOWLING_FRAMES - 1) {
      // Frames 1–9.
      const first = rolls[i];
      if (first === BOWLING_PINS) {
        // Strike — single ball completes the frame.
        frames.push({ rolls: [first], complete: true, isStrike: true, isSpare: false });
        i += 1;
        continue;
      }
      if (i + 1 >= rolls.length) {
        // Only the first ball thrown — frame in progress.
        return {
          frames,
          currentFrame: f,
          ballInFrame: 1,
          standingPins: BOWLING_PINS - first,
        };
      }
      const second = rolls[i + 1];
      frames.push({
        rolls: [first, second],
        complete: true,
        isStrike: false,
        isSpare: first + second === BOWLING_PINS,
      });
      i += 2;
    } else {
      // 10th frame: 2 balls, or 3 if the first two make a strike/spare.
      const remaining = rolls.slice(i);
      const first = remaining[0];
      const hasFirst = remaining.length >= 1;
      const hasSecond = remaining.length >= 2;
      if (!hasFirst) {
        return { frames, currentFrame: f, ballInFrame: 0, standingPins: BOWLING_PINS };
      }
      const second = remaining[1] ?? 0;
      const earnsBonus = hasSecond && (first === BOWLING_PINS || first + second === BOWLING_PINS);
      const ballsNeeded = earnsBonus ? 3 : 2;
      if (remaining.length >= ballsNeeded) {
        frames.push({
          rolls: remaining.slice(0, ballsNeeded),
          complete: true,
          isStrike: first === BOWLING_PINS,
          isSpare: first !== BOWLING_PINS && first + second === BOWLING_PINS,
        });
        i += ballsNeeded;
      } else {
        // 10th frame in progress. Standing pins for the next ball:
        //   after a strike, pins reset to 10;
        //   after a spare's first two balls, pins reset for the bonus;
        //   otherwise it's 10 minus the first ball.
        let standing = BOWLING_PINS;
        if (remaining.length === 1) {
          standing = first === BOWLING_PINS ? BOWLING_PINS : BOWLING_PINS - first;
        } else if (remaining.length === 2) {
          // A spare resets for its one bonus ball. After a first-ball
          // strike, however, a non-strike second bonus leaves only the
          // pins it missed standing for ball three.
          standing = first === BOWLING_PINS
            ? second === BOWLING_PINS ? BOWLING_PINS : BOWLING_PINS - second
            : BOWLING_PINS;
        }
        return { frames, currentFrame: f, ballInFrame: remaining.length, standingPins: standing };
      }
    }
  }

  // All 10 frames complete.
  return { frames, currentFrame: BOWLING_FRAMES, ballInFrame: 0, standingPins: BOWLING_PINS };
}

/** Flat ball list for a player, used for strike/spare lookahead scoring. */
function scoreFrames(
  parsed: { rolls: number[]; complete: boolean; isStrike: boolean; isSpare: boolean }[],
): BowlingFrame[] {
  // Build the flat sequence of balls in order for lookahead.
  const balls: number[] = [];
  const frameStart: number[] = [];
  parsed.forEach((frame) => {
    frameStart.push(balls.length);
    balls.push(...frame.rolls);
  });

  const result: BowlingFrame[] = [];
  let cumulative = 0;
  let cumulativeValid = true;

  for (let f = 0; f < parsed.length; f += 1) {
    const frame = parsed[f];
    const start = frameStart[f];
    let frameScore: number | null = null;

    if (f < BOWLING_FRAMES - 1 && frame.isStrike) {
      // Strike: 10 + next two balls (which live in later frames).
      const b1 = balls[start + 1];
      const b2 = balls[start + 2];
      if (b1 !== undefined && b2 !== undefined) frameScore = BOWLING_PINS + b1 + b2;
    } else if (f < BOWLING_FRAMES - 1 && frame.isSpare) {
      // Spare: 10 + next one ball.
      const b1 = balls[start + 2];
      if (b1 !== undefined) frameScore = BOWLING_PINS + b1;
    } else if (frame.complete) {
      // Open frame, or the fully-resolved 10th frame.
      frameScore = frame.rolls.reduce((sum, p) => sum + p, 0);
    }

    if (frameScore === null) cumulativeValid = false;
    if (cumulativeValid && frameScore !== null) {
      cumulative += frameScore;
      result.push({
        rolls: frame.rolls,
        cumulative,
        isStrike: frame.isStrike,
        isSpare: frame.isSpare,
        complete: frame.complete,
      });
    } else {
      result.push({
        rolls: frame.rolls,
        cumulative: null,
        isStrike: frame.isStrike,
        isSpare: frame.isSpare,
        complete: frame.complete,
      });
    }
  }

  return result;
}

/**
 * Compute the full game state from the ordered roll log.
 *
 * @param rolls ordered list of `{ seat, pins }` (oldest first)
 * @param seatCount number of players (default 2)
 */
export function computeBowlingState(rolls: BowlingRoll[], seatCount = 2): BowlingState {
  const seats = Array.from({ length: Math.max(1, seatCount) }, (_, i) => i);

  // Group rolls per seat, preserving order.
  const perSeatRolls = new Map<number, number[]>();
  for (const seat of seats) perSeatRolls.set(seat, []);
  for (const roll of rolls) {
    if (!perSeatRolls.has(roll.seat)) perSeatRolls.set(roll.seat, []);
    perSeatRolls.get(roll.seat)!.push(clampPins(roll.pins));
  }

  // Parse + score each seat independently.
  const parsedBySeat = new Map<
    number,
    ReturnType<typeof parseFrames>
  >();
  const players: BowlingPlayer[] = seats.map((seat) => {
    const parsed = parseFrames(perSeatRolls.get(seat) ?? []);
    parsedBySeat.set(seat, parsed);
    const frames = scoreFrames(parsed.frames);
    const scorable = frames.filter((fr) => fr.cumulative !== null);
    const total = scorable.length > 0 ? (scorable[scorable.length - 1].cumulative ?? 0) : 0;
    const complete = parsed.currentFrame >= BOWLING_FRAMES;
    return { seat, frames, total, complete };
  });

  // Frame-major turn resolution: the current turn is the first
  // (frame, seat) slot in play-order that isn't fully complete.
  let currentSeat = -1;
  let currentFrame = 0;
  let ballInFrame = 0;
  let standingPins = BOWLING_PINS;

  outer: for (let f = 0; f < BOWLING_FRAMES; f += 1) {
    for (const seat of seats) {
      const parsed = parsedBySeat.get(seat)!;
      // Seat has completed frame f iff their currentFrame index is past it.
      const completedThroughF = parsed.currentFrame > f;
      if (!completedThroughF) {
        currentSeat = seat;
        currentFrame = f;
        // Only report in-frame ball progress if this seat is actually on
        // frame f (not blocked waiting on an earlier seat's frame).
        if (parsed.currentFrame === f) {
          ballInFrame = parsed.ballInFrame;
          standingPins = parsed.standingPins;
        } else {
          ballInFrame = 0;
          standingPins = BOWLING_PINS;
        }
        break outer;
      }
    }
  }

  const gameOver = players.every((p) => p.complete);
  let winnerSeats: number[] = [];
  if (gameOver) {
    const max = Math.max(...players.map((p) => p.total));
    winnerSeats = players.filter((p) => p.total === max).map((p) => p.seat);
    currentSeat = -1;
  }

  return {
    players,
    currentSeat,
    currentFrame,
    ballInFrame,
    standingPins,
    gameOver,
    winnerSeats,
  };
}
