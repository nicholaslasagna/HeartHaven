/**
 * Shared HeartRush constants + wire types.
 *
 * This module must NEVER import three.js. The client page imports these
 * values, and the client page is server-rendered — pulling three in here
 * would drag the whole engine into the SSR bundle and defeat the
 * `ssr:false` dynamic import around the canvas. That is exactly what
 * caused HeartRush to hang on its Suspense fallback (blank screen).
 */

/** Seat colours, shared by the canvas avatars and the results list. */
export const HEARTRUSH_COLORS = [
  0xf07f9a, 0x7fc4f0, 0xf6c66a, 0x9ad98b,
  0xc79af0, 0xf09a6a, 0x6ad9c4, 0xe86a8f,
];

export function heartRushSeatColor(seatIndex: number) {
  return HEARTRUSH_COLORS[Math.abs(seatIndex) % HEARTRUSH_COLORS.length];
}

/** CSS hex for the same seat colour, for plain DOM UI. */
export function heartRushSeatCss(seatIndex: number) {
  return `#${heartRushSeatColor(seatIndex).toString(16).padStart(6, "0")}`;
}

export type HeartRushState = {
  x: number;
  y: number;
  z: number;
  /** 0 idle, 1 running, 2 airborne, 3 diving */
  a: number;
  /** checkpoint index, so late joiners see roughly where someone is */
  c: number;
};

export type HeartRushRemote = HeartRushState & {
  id: string;
  name: string;
  seat: number;
};
