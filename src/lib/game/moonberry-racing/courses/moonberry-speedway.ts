/**
 * Moonberry Speedway — the night-time oval-and-village circuit.
 *
 * Layout (top-down, +Z north, +X east; travel is clockwise):
 *
 *                         corner A (banked, apex ~z=225)
 *                       .-------------------------.
 *                    .-'                             '-.
 *                  .'                                   '.
 *          home   |                                       |   back
 *        straight |            glowing berry fields        |  straight
 *         (x=-85) |                                        |  (x=+85)
 *                  |        .------------------.           |
 *                  |       /  village chicane   \          |
 *                  |      |  (narrow, S-curve,    |         |
 *                  |      |   crystal-berry       |         |
 *                  |       \  tunnel shortcut)    /         |
 *                  |        '------------------'           |
 *                   '.                                   .'
 *                     '-.                             .-'
 *                        '---------------------------'
 *                         corner B (banked, apex ~z=-225)
 *
 * The home straight carries the start/finish line partway along its length:
 * a lap runs finish -> north up the home straight -> corner A -> south down
 * the back straight, through (or around) the village -> corner B -> back
 * onto the home straight, over the final ramp, and across the line again.
 *
 * Both sweepers turn the same way (a real oval commonly does), so the
 * village chicane is where the course earns its left-right variety.
 */

import type { Course, ControlPoint, ItemBoxSpec } from "../track";

/** One end of the oval: a banked 180 degree sweeper around `center`. */
function sweeper(
  center: { x: number; z: number },
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
  width: number,
  bank: number,
): ControlPoint[] {
  const points: ControlPoint[] = [];
  for (let i = 1; i < segments; i += 1) {
    const angle = startAngle + (endAngle - startAngle) * (i / segments);
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: 0,
      z: center.z + radius * Math.sin(angle),
      width,
      bank,
    });
  }
  return points;
}

/** A row of pickups spanning the track width at one point on the loop. */
function itemRow(t: number, offsets: number[]): ItemBoxSpec[] {
  return offsets.map((offset) => ({ t, offset }));
}

const CORNER_RADIUS = 85;
const NORTH_CENTER = { x: 0, z: 140 };
const SOUTH_CENTER = { x: 0, z: -140 };

const points: ControlPoint[] = [
  // -- home straight, finish line to the ramp-out of corner B's exit --
  { x: -85, y: 0, z: -90, width: 13 }, // 0: start/finish line
  { x: -85, y: 0, z: -40, width: 13 }, // 1
  { x: -85, y: 0, z: 10, width: 13 }, // 2
  { x: -85, y: 0, z: 60, width: 12 }, // 3: braking zone begins
  { x: -85, y: 0, z: 110, width: 11, bank: -0.06 }, // 4: turn-in
  { x: -85, y: 0, z: 140, width: 10, bank: -0.16 }, // 5: corner A entry (sweeper start)

  // -- corner A: banked right-hand sweeper over the top of the loop --
  ...sweeper(NORTH_CENTER, CORNER_RADIUS, Math.PI, 0, 6, 10, -0.24),

  { x: 85, y: 0, z: 140, width: 11, bank: -0.08 }, // 11: corner A exit

  // -- back straight, north half, with a small hop over a berry gully --
  { x: 85, y: 0, z: 100, width: 13 }, // 12
  { x: 85, y: 0, z: 70, width: 12 }, // 13
  { x: 85, y: 1.6, z: 55, width: 11 }, // 14: small ramp peak
  { x: 85, y: 0, z: 40, width: 11 }, // 15: landing, village entry ahead

  // -- village chicane: narrow S through the candy village --
  { x: 78, y: 0, z: 20, width: 8, bank: -0.05 }, // 16: village entry / shortcut split
  { x: 55, y: 0, z: 0, width: 7, bank: -0.14 }, // 17: kink right
  { x: 60, y: 0, z: -30, width: 7, bank: 0.12 }, // 18: kink left
  { x: 78, y: 0, z: -55, width: 8, bank: 0.05 }, // 19: village exit / shortcut rejoin
  { x: 85, y: 0, z: -80, width: 12 }, // 20: back to full width

  // -- back straight, south half --
  { x: 85, y: 0, z: -110, width: 13 }, // 21
  { x: 85, y: 0, z: -140, width: 11, bank: -0.08 }, // 22: corner B entry (sweeper start)

  // -- corner B: banked right-hand sweeper under the bottom of the loop --
  ...sweeper(SOUTH_CENTER, CORNER_RADIUS, 0, -Math.PI, 6, 10, -0.2),

  { x: -85, y: 0, z: -140, width: 11, bank: -0.06 }, // 28: corner B exit

  // -- home straight, south end, over the big final ramp, back to the line --
  { x: -85, y: 0, z: -125, width: 12 }, // 29
  { x: -85, y: 0, z: -115, width: 11 }, // 30: ramp lead-in / boost pad here
  { x: -85, y: 4.2, z: -105, width: 10 }, // 31: FINAL RAMP peak
  { x: -85, y: 0, z: -97, width: 12 }, // 32: landing, one breath before the line
];

const n = points.length; // 33 control points -> t = index / 33 below
const t = (index: number) => index / n;

export const MOONBERRY_SPEEDWAY: Course = {
  id: "moonberry-speedway",
  name: "Moonberry Speedway",
  theme: "speedway",
  points,
  checkpoints: 10,
  laps: 3,

  boostPads: [
    { t: t(11), offset: 0, width: 6, strength: 1.3 }, // corner A exit
    { t: t(20), offset: 0, width: 6, strength: 1.3 }, // village exit
    { t: t(28), offset: 0, width: 6, strength: 1.3 }, // corner B exit
    { t: t(30), offset: 0, width: 8, strength: 1.6 }, // send into the final ramp
  ],

  ramps: [
    { t: t(14), offset: 0, width: 10, height: 1.6, length: 10 }, // small gully hop
    { t: t(31), offset: 0, width: 10, height: 4.2, length: 18 }, // large final ramp
  ],

  hazards: [
    // Paper lanterns strung across the berry fields, drifting side to side.
    { kind: "drifting-lantern-cluster", t: 0.15, offset: 0, period: 5, phase: 0, radius: 4 },
    // The village windmill's vane dips low enough to clip a careless kart.
    { kind: "windmill-vane", t: 0.5, offset: 0, period: 6, phase: 1.5, radius: 3.5 },
  ],

  itemBoxes: [
    ...itemRow(0.06, [-4, -2, 0, 2, 4]), // home straight, main line
    ...itemRow(0.36, [-3, 0, 3]), // back straight before the village, main line
    ...itemRow(0.53, [-2, 0, 2]), // inside the village span, favours the tunnel
    ...itemRow(0.7, [-3, -1, 1, 3]), // back straight after the village, main line
  ],

  shortcuts: [
    {
      from: t(16),
      to: t(19),
      gate: "narrow",
      risk:
        "A crystal-berry tunnel cuts straight under the village's S-bend. It saves the wiggle, " +
        "but the walls glow because they're barely a kart's width apart — clip one and you scrub " +
        "every second you just saved.",
      points: [
        { x: 78, y: 0, z: 20, width: 6 },
        { x: 70, y: -1.5, z: -5, width: 5 },
        { x: 70, y: -1.5, z: -30, width: 5 },
        { x: 78, y: 0, z: -55, width: 6 },
      ],
    },
  ],

  palette: {
    sky: 0x141235,
    fog: 0x241c4a,
    road: 0x332a4d,
    accent: 0xff5fa8,
    rail: 0xffd27a,
  },
};
