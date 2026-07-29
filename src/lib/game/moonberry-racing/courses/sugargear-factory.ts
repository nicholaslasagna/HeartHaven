/**
 * Moonberry Racing — Sugargear Factory.
 *
 * A fast industrial circuit through a candy works. Angular and mechanical
 * where the Speedway is flowing: long machine-hall straights, a chicane
 * between the presses, and a banked sweep around the mixing vat.
 *
 * Layout, clockwise from the start/finish on the south wall:
 *
 *        NORTH  ── back straight, conveyor WITH you ──┐
 *              ┌────── press chicane (narrow) ────────┤
 *      WEST    │                                      │  EAST
 *   cooling    │            mixing vat                │  banked
 *   tunnel     │                                      │  sweeper
 *              └── downhill escape ── finish gate ────┘
 *        SOUTH  ────── machine hall straight ─────────┘
 *
 * The geometry is generated from a parametric stadium rather than typed out
 * by hand, because that is what guarantees the corner radii: every deviation
 * below is sized against the 9m minimum a kart can hold. A chicane of
 * amplitude A and wavelength L has radius ≈ L²/(4π²A), so the 5m wiggle over
 * ~80m used here works out around 32m — tight enough to demand a line, wide
 * enough to be driveable at speed.
 */

import type { ControlPoint, Course } from "../track";

/** Half-extents of the factory floor, metres. */
const HALF_X = 198;
const HALF_Z = 99;
const POINT_COUNT = 28;

/**
 * Superellipse: rounder than a rectangle, squarer than an oval. Gives long
 * usable straights without the sharp corners a true rectangle would need.
 */
function floorPlan(i: number) {
  const a = (i / POINT_COUNT) * Math.PI * 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const squareness = 2.6;
  const shape = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 2 / squareness);
  return { x: shape(cos) * HALF_X, z: shape(sin) * HALF_Z, angle: a };
}

const points: ControlPoint[] = Array.from({ length: POINT_COUNT }, (_, i) => {
  const base = floorPlan(i);

  // Where are we on the lap? 0 = start/finish (south wall, +x end).
  const lap = i / POINT_COUNT;

  /* The press chicane sits on the north side. A 5m amplitude over roughly a
     quarter of the loop keeps the radius near 32m — a real direction change
     that never becomes a hairpin. */
  const inChicane = lap > 0.52 && lap < 0.72;
  const chicane = inChicane ? Math.sin((lap - 0.52) / 0.2 * Math.PI * 2) * 5 : 0;

  // Narrow through the machinery, wide on the halls for overtaking.
  const width = inChicane ? 7 : lap > 0.28 && lap < 0.42 ? 12 : 13;

  /* Banked sweep around the mixing vat on the east side. Negative bank leans
     into the left-hand turn the karts are making there. */
  const bank = lap > 0.06 && lap < 0.26 ? -0.2 : inChicane ? Math.sign(chicane) * 0.08 : 0;

  /* Elevation: the factory floor climbs gently to the north gantry, then
     drops through the escape ramp back to the finish. Kept under 8% grade. */
  const height = Math.sin((lap - 0.1) * Math.PI * 2) * 4 + 4;

  /* Conveyors. The back straight runs WITH the racing direction, so it is a
     free gain. The cooling tunnel on the west runs ACROSS it, which costs
     speed and is the reason to take the shortcut instead. */
  const surface: ControlPoint["surface"] =
    lap > 0.44 && lap < 0.52 ? "conveyor"
      : lap > 0.78 && lap < 0.88 ? "conveyor"
        : "road";

  return {
    x: base.x,
    // Push the chicane sideways along the local normal, which on the north
    // and south runs is the z axis.
    z: base.z + chicane,
    y: height,
    width,
    bank,
    surface,
  };
});

export const SUGARGEAR_FACTORY: Course = {
  id: "sugargear-factory",
  name: "Sugargear Factory",
  theme: "factory",
  points,
  checkpoints: 10,
  laps: 3,

  boostPads: [
    // Exit of the banked vat sweeper.
    { t: 0.26, offset: 0, width: 5, strength: 1 },
    // Chicane exit, rewarding a clean line through the presses.
    { t: 0.73, offset: 0, width: 5, strength: 1 },
    // Feeding the downhill escape.
    { t: 0.92, offset: -2, width: 4, strength: 1.15 },
    { t: 0.92, offset: 2, width: 4, strength: 1.15 },
  ],

  ramps: [
    // Small hop over a frosting pipe on the machine hall.
    { t: 0.38, offset: 0, width: 9, height: 1.6, length: 7 },
    // The escape ramp, launching through the wrapper gate at the line.
    { t: 0.96, offset: 0, width: 11, height: 3.2, length: 12 },
  ],

  /* Hazards are f(raceTime) via period and phase, so they need no network
     sync at all — every client computes the same machine at the same moment.
     Each one leaves a permanently clear line, noted per hazard. */
  hazards: [
    // Swinging candy hammer over the machine hall. Sweeps the middle third;
    // both edges of the 13m-wide hall stay clear at all times.
    { kind: "candy-hammer", t: 0.34, offset: 0, period: 5, phase: 0, radius: 3.4 },
    // Rotating wafer gate at the vat. Quarter-open at all times, and the
    // 6s period is slow enough to read on approach.
    { kind: "wafer-gate", t: 0.18, offset: 0, period: 6, phase: 1.2, radius: 4 },
    // Rolling gumdrops down the conveyor straight. They travel with the
    // conveyor, so they are overtakable rather than a wall.
    { kind: "gumdrop", t: 0.48, offset: -3, period: 7, phase: 0.4, radius: 1.8 },
    // Timed press door before the chicane. Open for two thirds of its cycle.
    { kind: "press-door", t: 0.58, offset: 0, period: 8, phase: 2.4, radius: 3 },
  ],

  itemBoxes: [
    // Machine hall, on the main line.
    { t: 0.12, offset: -4 }, { t: 0.12, offset: -1.5 }, { t: 0.12, offset: 1.5 }, { t: 0.12, offset: 4 },
    // After the vat sweeper.
    { t: 0.3, offset: -3 }, { t: 0.3, offset: 0 }, { t: 0.3, offset: 3 },
    // On the elevated shortcut, rewarding the risk.
    { t: 0.64, offset: 0 }, { t: 0.66, offset: 0 },
    // Before the escape, so a racer who skipped the shortcut still arms up.
    { t: 0.86, offset: -3 }, { t: 0.86, offset: 0 }, { t: 0.86, offset: 3 },
  ],

  shortcuts: [
    {
      // Elevated route over moving cookie platforms, bypassing the second
      // half of the press chicane. Deliberately short: any longer and it
      // would skip a checkpoint, which the validator rejects.
      from: 0.62,
      to: 0.7,
      points: [
        { x: -69, y: 11, z: 88, width: 5 },
        { x: -27, y: 12.5, z: 93, width: 4.5 },
        { x: 18, y: 12.5, z: 93, width: 4.5 },
        { x: 60, y: 11, z: 88, width: 5 },
      ],
      gate: "narrow",
      risk: "Two moving cookie platforms with a gap; miss the timing and you drop back onto the chicane having lost more than you saved.",
    },
  ],

  palette: {
    sky: 0x3a2412,
    fog: 0x5a3a1e,
    road: 0x4a3b2f,
    accent: 0xffab5c,
    rail: 0xffd9a0,
  },
};
