/**
 * Moonberry Bowling — the contract between simulation and presentation.
 *
 * This file is the seam. `physics.ts` produces these snapshots and knows
 * nothing about three.js; `renderer.ts` consumes them and knows nothing
 * about rules or netcode. Anything that needs both belongs in the canvas.
 *
 * Keep this file free of three.js imports — the client page is
 * server-rendered, and dragging three into it defeats the `ssr: false`
 * boundary around the canvas.
 */

/** Where the camera should be looking, driven by the phase of a throw. */
export type CameraShot =
  | "idle"        // resting behind the approach
  | "aim"         // low, behind the ball, down the boards
  | "follow"      // tracking the ball down the lane
  | "pins"        // tight on the deck as it arrives
  | "result";     // pulled back over the settled deck

export type BallView = {
  x: number;
  z: number;
  /** Accumulated roll, radians. */
  roll: number;
  inGutter: boolean;
};

export type PinView = {
  id: number;
  x: number;
  z: number;
  /** 0 upright, 1 flat on the deck. */
  tilt: number;
  /** Direction the pin is falling, radians. */
  tiltAxis: number;
  spin: number;
};

export type LaneView = {
  ball: BallView;
  pins: PinView[];
  /** Null before the throw is released. */
  aimGuide: { x: number; spin: number } | null;
  shot: CameraShot;
  /** Seat whose turn it is, for lane colour and nameplate. */
  seat: number;
  seatName: string;
};

/** One player's standing in the match, for the on-lane scoreboard. */
export type ScoreView = {
  seat: number;
  name: string;
  total: number;
  frames: Array<{ rolls: number[]; running: number | null }>;
  active: boolean;
};

export type BowlingSnapshot = {
  lane: LaneView;
  scores: ScoreView[];
  /** Seconds since the scene opened; drives ambient animation. */
  time: number;
  /** Big centre-screen callout: "STRIKE!", "SPARE", "7-10 SPLIT". */
  callout: string | null;
};

export const SEAT_COLORS = [
  0xf07f9a, 0x7fc4f0, 0xf6c66a, 0x9ad98b,
  0xc79af0, 0xf09a6a, 0x6ad9c4, 0xe86a8f,
];

export const seatColor = (seat: number) => SEAT_COLORS[Math.abs(seat) % SEAT_COLORS.length];
export const seatCss = (seat: number) =>
  `#${seatColor(seat).toString(16).padStart(6, "0")}`;

/**
 * Name a result from the pins that fell and what was left standing.
 * Split detection is real: a split is a spare attempt where the head pin is
 * down and the remaining pins have a gap between them.
 */
export function describeResult(
  knocked: number,
  standingBefore: number,
  standingAfter: number[],
  ball: 0 | 1 | 2,
): string | null {
  if (standingBefore === 10 && knocked === 10) return "STRIKE!";
  if (knocked === standingBefore && knocked > 0) return ball === 0 ? "STRIKE!" : "SPARE!";
  if (knocked === 0) return ball === 0 ? "GUTTER" : "MISS";
  if (ball === 0 && standingAfter.length > 1 && !standingAfter.includes(0)) {
    const columns = standingAfter.map(pinColumn).sort((a, b) => a - b);
    for (let i = 1; i < columns.length; i += 1) {
      // A gap of more than one board between neighbours is a split.
      if (columns[i] - columns[i - 1] > 1.5) {
        return `${standingAfter.length}-PIN SPLIT`;
      }
    }
  }
  return null;
}

/** Horizontal board position of a pin, in half-spacings from centre. */
function pinColumn(id: number) {
  const columns = [0, -1, 1, -2, 0, 2, -3, -1, 1, 3];
  return columns[id] ?? 0;
}
