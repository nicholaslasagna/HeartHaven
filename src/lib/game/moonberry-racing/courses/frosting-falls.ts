/**
 * Moonberry Racing — "Frosting Falls Circuit".
 *
 * A snowy dessert-mountain loop: frosted roads at the valley floor, an
 * ice-cream cave climbing the mountainside, a high traverse along the
 * sprinkle cliffs, a waffle bridge over the gap at the top, a downhill
 * run back to the valley, and a launch over the chocolate river back to
 * the line.
 *
 * Layout sketch (looking down from above; points run in array order,
 * tracing a single oval with no reversals):
 *
 *                    12 (north vertex — traverse peak, bridge)
 *              10  11        13  14
 *          9              |            15
 *        8   (traverse)   |  (bridge)   16   (descent)
 *      7                  |                    17
 *     6 (cave, east vtx)  |                     18 (west vertex)
 *      5                  |                    19
 *        4   (cave)       |    (gorge/jump)   20
 *          3                                21
 *              2      0/1 (start/finish)  22  23
 *                    (south vertex)
 *
 * The planform is a plain oval (semi-axes 224m x 165m, 24 points evenly
 * spaced by angle), not a hand-drawn shape. That is a deliberate choice:
 * this file's Catmull-Rom is UNIFORM (see sampleCourse in track.ts), which
 * loops and cusps badly if consecutive control points turn sharply or are
 * unevenly spaced — an earlier hand-drawn draft of this course put the
 * final approach back on the same side as the exit and produced a near
 * 170-degree reversal right at the start/finish line, which the curve
 * turned into a sub-1m-radius cusp (caught by validateCourse, not by eye).
 * An oval guarantees every turn angle between neighbours stays small
 * (about 11-20 degrees here) with no near-reversal anywhere, while still
 * reading as a real circuit once elevation, width and surface vary
 * around it — which is what the rest of this file does.
 *
 * Elevation was assigned by cumulative arc-length fraction through two
 * smoothstep ramps (zero slope at both ends, so nothing kinks): climb
 * from the start up to the north-vertex plateau, flat across the
 * traverse/bridge, descend back down, then a short dip-and-rise through
 * the chocolate river gorge that the final ramp launches over. Measured
 * directly off the finished course (see the throwaway check run before
 * this file was finished):
 *   loop length      ~1226m
 *   elevation range  -1.0m (river gorge) to 41.0m (traverse/bridge plateau)
 *   steepest grade   ~11.6%, on the descent past the west vertex —
 *                    everywhere else on the main line is gentler.
 * The shortcut (below) is a little steeper than that by design — the
 * steepness is part of its risk, not a mistake.
 *
 * Ice sits on the three widest, longest-radius sections (turn out of the
 * start straight, the traverse before the bridge, and the final bend
 * back to the line). The cave and the bridge — the narrowest sections —
 * stay plain road on purpose: slippery *and* narrow *and* tight is the
 * unfair combination the brief calls out, not the challenging one.
 */

import type { Course } from "../track";

export const FROSTING_FALLS: Course = {
  id: "frosting-falls",
  name: "Frosting Falls Circuit",
  theme: "falls",
  laps: 3,
  checkpoints: 10,

  points: [
    // Start/finish straight — flat valley floor, wide enough for the grid.
    { x: 0.0, y: 3.0, z: 0.0, width: 13, surface: "road" },
    { x: 58.0, y: 4.1, z: 5.6, width: 13, surface: "road" },

    // Turn 1: a wide, gentle sweeper leading toward the cave mouth. Long
    // radius here is exactly why it's safe to ice up.
    { x: 112.0, y: 7.1, z: 22.1, width: 13, surface: "ice" },
    { x: 158.4, y: 11.1, z: 48.3, width: 12, surface: "ice" },

    // Ice-cream cave: the track narrows and climbs past the east vertex.
    // These are the tightest turns on the main line, so no ice here.
    { x: 194.0, y: 15.6, z: 82.5, width: 8, surface: "road" }, // cave mouth (shortcut branches here)
    { x: 216.4, y: 20.1, z: 122.3, width: 8, surface: "road" },
    { x: 224.0, y: 24.5, z: 165.0, width: 7, surface: "road" }, // east vertex, narrowest of the cave
    { x: 216.4, y: 28.7, z: 207.7, width: 8, surface: "road" }, // cave exit (shortcut rejoins here)

    // Onto the high traverse along the sprinkle cliffs: widens back out
    // and sweeps toward the bridge — the second ice section.
    { x: 194.0, y: 32.9, z: 247.5, width: 10, surface: "road" },
    { x: 158.4, y: 36.6, z: 281.7, width: 12, surface: "ice" },
    { x: 112.0, y: 39.6, z: 307.9, width: 12, surface: "ice" },
    { x: 58.0, y: 41.0, z: 324.4, width: 10, surface: "road" }, // narrowing into the bridge

    // Waffle bridge at the north vertex, the plateau's high point.
    // Narrow and no ice — the other tight, precision section.
    { x: 0.0, y: 41.0, z: 330.0, width: 7, surface: "road" }, // bridge span, narrowest point on course
    { x: -58.0, y: 39.5, z: 324.4, width: 8, surface: "road" },

    // Downhill descent back toward the valley: wide, fast, boosted.
    { x: -112.0, y: 35.7, z: 307.9, width: 11, surface: "road" },
    { x: -158.4, y: 30.7, z: 281.7, width: 12, surface: "road" },
    { x: -194.0, y: 25.2, z: 247.5, width: 13, surface: "road" },
    { x: -216.4, y: 19.9, z: 207.7, width: 13, surface: "road" }, // steepest grade is around here
    { x: -224.0, y: 15.0, z: 165.0, width: 12, surface: "road" }, // west vertex
    { x: -216.4, y: 10.6, z: 122.3, width: 11, surface: "road" },
    { x: -194.0, y: 6.7, z: 82.5, width: 11, surface: "road" },

    // Final bend back toward the line: wide and gentle again (mirrors
    // turn 1 on the other side of the oval) — the third ice section.
    { x: -158.4, y: 3.9, z: 48.3, width: 12, surface: "ice" },
    // Ice ends here, before the ramp: a slippery launch would make the
    // jump's trajectory unreliable, which is the "unfair" failure mode.
    { x: -112.0, y: 2.8, z: 22.1, width: 12, surface: "road" },
    // Chocolate river gorge floor, dipping toward river level before
    // rising back into the start/finish straight; the big ramp (below)
    // launches karts clear across this low stretch.
    { x: -58.0, y: -1.0, z: 5.6, width: 13, surface: "road" },
  ],

  boostPads: [
    // Two on the descent, one right before the final jump.
    { t: 0.61, offset: 0, width: 6, strength: 1.3 },
    { t: 0.71, offset: 0, width: 6, strength: 1.3 },
    { t: 0.86, offset: 0, width: 7, strength: 1.6 },
  ],

  ramps: [
    // Small hop leaving the cave onto the cliff traverse — a warm-up jump.
    { t: 0.31, offset: 0, width: 8, height: 1.4, length: 7 },
    // The big one: launches over the chocolate river gorge. Placed just
    // before the dip in the points above so the kart is airborne for the
    // low stretch instead of driving through it. Kept last so it reads
    // as the finishing set piece.
    { t: 0.90, offset: 0, width: 9, height: 5.5, length: 18 },
  ],

  hazards: [
    // Falling candy icicles in the cave. Telegraphed by a cracking groan
    // and a shadow a beat before impact; they always drop on the
    // centreline, so the safe line is to hold either edge of the cave lane.
    { kind: "falling-icicle", t: 0.23, offset: 0, period: 4.0, phase: 0, radius: 1.4 },
    // A loose waffle plank slides across the bridge deck. Telegraphed by
    // its visible slide; the safe line is to watch which side it's swung
    // to and take the other — the bridge is too narrow to just outrun it.
    { kind: "waffle-plank", t: 0.50, offset: 0, period: 5.0, phase: 1.0, radius: 3.0 },
    // A rolling snowball sweet drifts back and forth across the wide
    // descent lane. Telegraphed by its rolling arc and crumb trail; the
    // descent is wide enough (11-13m) to just pick the side it isn't on.
    { kind: "rolling-snowball", t: 0.67, offset: 0, period: 6.0, phase: 2.0, radius: 4.0 },
  ],

  itemBoxes: [
    // Post-start row.
    { t: 0.02, offset: -3 }, { t: 0.02, offset: 0 }, { t: 0.02, offset: 3 },
    // Reward for climbing the cave, at the traverse.
    { t: 0.30, offset: -2 }, { t: 0.30, offset: 0 }, { t: 0.30, offset: 2 },
    // Inside the shortcut (t falls within its 0.1667-0.2917 span, so
    // this row only exists for karts that took the breakable-wall route).
    { t: 0.22, offset: -1.5 }, { t: 0.22, offset: 1.5 },
    // Pre-jump row before the final ramp.
    { t: 0.86, offset: -3 }, { t: 0.86, offset: 0 }, { t: 0.86, offset: 3 },
  ],

  shortcuts: [
    {
      // Branches at the cave mouth (control point index 4, t = 4/24 =
      // 0.1667) and rejoins at the cave exit (index 7, t = 7/24 =
      // 0.2917). Span is 0.125 of the loop, under the 0.15 (1.5
      // checkpoints, at 10 checkpoints) limit.
      from: 0.1667,
      to: 0.2917,
      gate: "breakable",
      risk:
        "The frosting wall hides a straight bore through the mountain instead of the winding cave path. It's only a little shorter than the main line, and entirely on rough, offroad rock-candy footing, so the time it saves evaporates unless entry speed is under control.",
      points: [
        { x: 194, y: 16.5, z: 90, width: 7, surface: "offroad" },
        { x: 201, y: 21.0, z: 124, width: 6, surface: "offroad" },
        { x: 209, y: 25.5, z: 166, width: 6, surface: "offroad" },
        { x: 213, y: 28.0, z: 200, width: 8, surface: "offroad" },
      ],
    },
  ],

  // Cold blue-white sky and icy fog, buttercream road, mint and cocoa trim.
  palette: { sky: 0xbfe6ff, fog: 0xeaf6ff, road: 0xf2ead9, accent: 0x8fd9c4, rail: 0x6b4a3a },
};
