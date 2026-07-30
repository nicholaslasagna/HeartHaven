/**
 * Moonberry Racing — track format, lap validation and respawn.
 *
 * Pure: no three.js, no DOM, no Math.random. A course is data, so it can be
 * authored, diffed, validated headlessly, and — critically — validated the
 * SAME way on the host as on every client. Lap counting is the one thing a
 * racer will try to cheat, so it lives here rather than in the renderer.
 *
 * A course is a closed loop of control points. Everything else (track
 * surface, walls, checkpoint planes, respawn poses, the minimap) is derived
 * from that centreline, which means an author edits one array and the whole
 * circuit stays consistent.
 *
 * Units: metres, seconds. +Y is up. Karts drive along the centreline in the
 * direction the points are listed.
 */

export type Vec3 = { x: number; y: number; z: number };

export type ControlPoint = {
  /** Centre of the racing surface. */
  x: number;
  y: number;
  z: number;
  /** Half-width of drivable track here. Wide = overtaking, narrow = precision. */
  width: number;
  /** Banking in radians; positive leans into a left turn. */
  bank?: number;
  /** Surface under the karts from this point until the next. */
  surface?: SurfaceKind;
};

export type SurfaceKind = "road" | "ice" | "offroad" | "boost" | "conveyor";

export type BoostPad = { t: number; offset: number; width: number; strength?: number };
export type Ramp = { t: number; offset: number; width: number; height: number; length: number };
export type HazardSpec = {
  kind: string;
  t: number;
  offset: number;
  /** Seconds for one full cycle; hazards are f(raceTime) so they need no sync. */
  period: number;
  phase?: number;
  radius?: number;
};
export type ItemBoxSpec = { t: number; offset: number };
export type ShortcutSpec = {
  /** Where it leaves and rejoins the main line, as loop fractions. */
  from: number;
  to: number;
  points: ControlPoint[];
  /** A wall that must be broken, a narrow gap, etc. */
  gate?: "open" | "breakable" | "narrow";
  risk: string;
};

export type Course = {
  id: string;
  name: string;
  theme: "speedway" | "factory" | "falls";
  /** Closed loop; the last point connects back to the first. */
  points: ControlPoint[];
  checkpoints: number;
  boostPads: BoostPad[];
  ramps: Ramp[];
  hazards: HazardSpec[];
  itemBoxes: ItemBoxSpec[];
  shortcuts: ShortcutSpec[];
  /** Palette and fog, for the renderer. */
  palette: { sky: number; fog: number; road: number; accent: number; rail: number };
  laps: number;
};

/* ------------------------------------------------------------------ */
/* Centreline sampling                                                 */
/* ------------------------------------------------------------------ */

/** Catmull-Rom through the control points, wrapping at both ends. */
export function sampleCourse(course: Course, t: number): ControlPoint {
  const points = course.points;
  const n = points.length;
  const wrapped = ((t % 1) + 1) % 1;
  const scaled = wrapped * n;
  const i = Math.floor(scaled);
  const f = scaled - i;

  const p0 = points[(i - 1 + n) % n];
  const p1 = points[i % n];
  const p2 = points[(i + 1) % n];
  const p3 = points[(i + 2) % n];

  const cr = (a: number, b: number, c: number, d: number) => {
    const f2 = f * f;
    const f3 = f2 * f;
    return 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
  };

  return {
    x: cr(p0.x, p1.x, p2.x, p3.x),
    y: cr(p0.y, p1.y, p2.y, p3.y),
    z: cr(p0.z, p1.z, p2.z, p3.z),
    width: cr(p0.width, p1.width, p2.width, p3.width),
    bank: cr(p0.bank ?? 0, p1.bank ?? 0, p2.bank ?? 0, p3.bank ?? 0),
    surface: p1.surface ?? "road",
  };
}

/** Unit tangent along the centreline at t. */
export function courseTangent(course: Course, t: number): Vec3 {
  const step = 1 / (course.points.length * 24);
  const a = sampleCourse(course, t - step);
  const b = sampleCourse(course, t + step);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

/** Approximate loop length, for lap timing and minimap scaling. */
export function courseLength(course: Course, samples = 512) {
  let total = 0;
  let previous = sampleCourse(course, 0);
  for (let i = 1; i <= samples; i += 1) {
    const point = sampleCourse(course, i / samples);
    total += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    previous = point;
  }
  return total;
}

/**
 * Nearest point on the centreline, as a loop fraction, plus how far off the
 * line the kart is. Drives lap progress, wrong-way detection, off-road
 * penalties and respawn.
 */
export function projectToCourse(course: Course, x: number, z: number, hint?: number) {
  // Coarse sweep, then refine. A hint from the previous frame keeps this
  // cheap and stops a kart near a crossover snapping to the wrong lap point.
  const coarse = 128;
  let bestT = 0;
  let bestDist = Infinity;

  const consider = (t: number) => {
    const point = sampleCourse(course, t);
    const dist = Math.hypot(point.x - x, point.z - z);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = ((t % 1) + 1) % 1;
    }
  };

  if (hint === undefined) {
    for (let i = 0; i < coarse; i += 1) consider(i / coarse);
  } else {
    // Only look near where we were: a kart cannot teleport across the map.
    for (let i = -12; i <= 12; i += 1) consider(hint + i / coarse);
  }
  for (let i = -8; i <= 8; i += 1) consider(bestT + i / (coarse * 8));

  const point = sampleCourse(course, bestT);
  const tangent = courseTangent(course, bestT);
  // Signed lateral offset: negative is left of the racing line.
  const side = (x - point.x) * tangent.z - (z - point.z) * tangent.x;
  return { t: bestT, distance: bestDist, offset: side, point, tangent };
}

/**
 * What is under a kart at (x, z)?
 *
 * Everything the handling model needs, derived from the centreline: whether
 * they are on the road or in the verge, how slick it is, the ground height
 * (so banking and elevation are felt, not just seen), and how far past the
 * edge they are, which drives the steering assist.
 *
 * `hintT` should be the kart's last known loop position; it keeps the
 * projection cheap and stops a kart snapping to the wrong side of a crossover.
 */
export function surfaceAt(course: Course, x: number, z: number, hintT?: number) {
  const projected = projectToCourse(course, x, z, hintT);
  const half = projected.point.width / 2;
  const overrun = Math.max(0, Math.abs(projected.offset) - half);
  const kind = projected.point.surface ?? "road";

  // Banking tilts the surface, so height depends on how far out you are.
  const bank = projected.point.bank ?? 0;
  const groundY = projected.point.y + Math.sin(bank) * projected.offset;

  return {
    // Past the tarmac is verge: slower, but still driveable.
    offroad: overrun > 0 || kind === "offroad",
    ice: kind === "ice",
    conveyor: kind === "conveyor" ? 9 : undefined,
    groundY,
    edgeOverrun: overrun,
    // Point back along the racing line when assisting.
    edgeHeading: Math.atan2(projected.tangent.x, projected.tangent.z),
    t: projected.t,
    offset: projected.offset,
    width: projected.point.width,
    /** True once a kart is far enough off to be considered lost. */
    lost: overrun > VERGE_LIMIT || groundY - 40 > 0,
  };
}

/** How far beyond the verge a kart may stray before it is recovered. */
export const VERGE_LIMIT = 14;

/** How far a swinging hazard travels either side of its anchor. */
export const HAZARD_SWING = 6;

/**
 * Where a hazard is at a given race time.
 *
 * A pure function of race time, which is what lets eight clients agree on
 * hazard positions without a single byte of traffic. It lives here rather
 * than in the renderer so the COLLISION and the VISUAL read the same numbers
 * — a hazard you can see but not hit (or hit but not see) is worse than no
 * hazard at all.
 */
export function hazardPosition(course: Course, spec: HazardSpec, raceTime: number) {
  const point = sampleCourse(course, spec.t);
  const tangent = courseTangent(course, spec.t);
  const phase = (raceTime / spec.period + (spec.phase ?? 0)) * Math.PI * 2;
  const swing = Math.sin(phase) * HAZARD_SWING;
  // Perpendicular to the racing line, so it sweeps ACROSS the track.
  const px = -tangent.z;
  const pz = tangent.x;
  const radius = spec.radius ?? 1.6;
  return {
    x: point.x + px * (spec.offset + swing),
    y: point.y + radius + Math.abs(Math.cos(phase)) * 0.6,
    z: point.z + pz * (spec.offset + swing),
    radius,
  };
}

/**
 * How far behind the line to begin the starting grid.
 *
 * Courses are free to put a ramp or a climb just before the start — Moonberry
 * Speedway ends on a big jump — and laying a grid straight onto that slope
 * stands the back row metres above the front, which looks broken and gives
 * the rows uneven traction. So instead of a fixed offset, this walks back
 * along the centreline and picks the flattest stretch long enough to hold the
 * whole grid. Every course gets a level start line without any per-course
 * special casing.
 */
function flattestGridStart(course: Course, gridLength: number) {
  const MIN_LEAD = 8;
  const MAX_LEAD = 90;
  let bestLead = MIN_LEAD;
  let bestRise = Infinity;

  for (let lead = MIN_LEAD; lead <= MAX_LEAD; lead += 2) {
    // Height spread across the stretch this grid would occupy.
    let lowest = Infinity;
    let highest = -Infinity;
    for (let along = 0; along <= gridLength; along += 3) {
      const y = sampleCourse(course, retreatByDistance(course, 0, lead + along)).y;
      lowest = Math.min(lowest, y);
      highest = Math.max(highest, y);
    }
    const rise = highest - lowest;
    // Prefer the nearest acceptable stretch rather than the flattest overall,
    // so the grid stays close to the line when the run-up is already level.
    if (rise < bestRise - 0.05) {
      bestRise = rise;
      bestLead = lead;
    }
    if (rise < 0.35) break;
  }
  return bestLead;
}

/* ------------------------------------------------------------------ */
/* Lap and checkpoint validation                                       */
/* ------------------------------------------------------------------ */

export type LapProgress = {
  lap: number;
  /** Highest checkpoint index cleared this lap. */
  checkpoint: number;
  /** Loop fraction, monotonic within a lap. */
  t: number;
  finished: boolean;
  wrongWay: boolean;
  /** Total distance covered, for race positions. */
  progress: number;
};

export function createLapProgress(): LapProgress {
  return { lap: 0, checkpoint: -1, t: 0, finished: false, wrongWay: false, progress: 0 };
}

/**
 * Advance lap state from a new position.
 *
 * The rules that make this cheat-resistant, and why each exists:
 *
 *  • Checkpoints must be cleared IN ORDER. You cannot cut half the circuit
 *    and cross the line, because the line only counts when the final
 *    checkpoint was the last one you cleared.
 *  • The lap only increments crossing the line FORWARD (t wraps from high
 *    to low while moving along the tangent). Reversing over the line does
 *    nothing, which is the specific exploit called out in the design.
 *  • Progress is monotonic, so a racer reversing cannot inflate position.
 *
 * The host runs this same function over positions it receives, so a client
 * that lies about its lap is simply overruled.
 */
export function updateLapProgress(
  progress: LapProgress,
  course: Course,
  t: number,
  headingDotTangent: number,
): LapProgress {
  const count = course.checkpoints;
  const next = { ...progress };

  // Which checkpoint segment is this position in?
  const segment = Math.floor(t * count) % count;
  const expected = (progress.checkpoint + 1) % count;

  next.wrongWay = headingDotTangent < -0.35 && !progress.finished;

  if (segment === expected) {
    next.checkpoint = segment;
  }

  /* Movement since the last sample, as a SIGNED delta wrapped into
     (-0.5, 0.5]. Comparing raw t against thresholds does not work here:
     `projectToCourse` snaps to the nearest centreline point, and either side
     of the start/finish seam is geometrically almost the same place, so a
     kart crossing the line can legitimately project to t=0.9997 on one frame
     and t=0.0005 on the next — or the other way round. A delta has no such
     ambiguity, because the seam is simply a step like any other. */
  let delta = t - progress.t;
  if (delta > 0.5) delta -= 1;
  else if (delta < -0.5) delta += 1;

  // Guard against a teleport: no legitimate frame moves a tenth of a lap.
  const plausible = Math.abs(delta) < 0.1;

  // Crossing the line forwards means the continuous position passes a whole
  // lap boundary.
  const crossed = plausible && delta > 0 && progress.t + delta >= 1;

  if (crossed && headingDotTangent > 0) {
    // Only a full, in-order lap counts, so cutting the circuit banks nothing.
    if (progress.checkpoint === count - 1 || next.checkpoint === count - 1) {
      next.lap = progress.lap + 1;
      next.checkpoint = -1;
      if (next.lap >= course.laps) next.finished = true;
    }
  }

  next.t = t;
  // Progress only ever moves forwards; reversing must not renumber the field.
  next.progress = progress.progress + (plausible && delta > 0 ? delta : 0);
  return next;
}

/** Race order: furthest round the circuit leads. */
export function racePositions(entries: Array<{ id: string; progress: LapProgress }>) {
  return [...entries]
    .sort((a, b) => {
      if (a.progress.finished !== b.progress.finished) return a.progress.finished ? -1 : 1;
      return b.progress.progress - a.progress.progress;
    })
    .map((entry, index) => ({ id: entry.id, position: index + 1 }));
}

/* ------------------------------------------------------------------ */
/* Respawn                                                             */
/* ------------------------------------------------------------------ */

export type RespawnPose = { position: Vec3; heading: number };

/**
 * Where to put a racer who fell off or got stuck: on the centreline at the
 * last checkpoint they legitimately cleared, facing along the track, lifted
 * clear of the surface. Lap is preserved by the caller — falling off must
 * never cost a lap.
 */
export function respawnPose(course: Course, progress: LapProgress, laneOffset = 0): RespawnPose {
  const cleared = progress.checkpoint >= 0 ? progress.checkpoint : course.checkpoints - 1;
  const t = ((cleared + 0.5) / course.checkpoints) % 1;
  const point = sampleCourse(course, t);
  const tangent = courseTangent(course, t);
  // Nudge sideways so two racers respawning together do not overlap.
  const lateralX = -tangent.z * laneOffset;
  const lateralZ = tangent.x * laneOffset;
  return {
    position: { x: point.x + lateralX, y: point.y + 1.2, z: point.z + lateralZ },
    heading: Math.atan2(tangent.x, tangent.z),
  };
}

/**
 * Step backwards along the centreline by a real distance.
 *
 * `t` is NOT arc length — Catmull-Rom advances uniformly per control point,
 * so where points bunch together a small change in t covers very little
 * ground. Anything that needs even physical spacing has to walk the curve.
 */
export function retreatByDistance(course: Course, t: number, metres: number) {
  if (metres <= 0) return ((t % 1) + 1) % 1;
  const steps = 240;
  const stride = 1 / (course.points.length * steps);
  /* Budget enough sub-steps to walk the WHOLE loop. Arc length is not spread
     evenly over t — a tight chicane or a ramp packs control points close
     together — so a fixed small budget silently saturates in exactly those
     places and returns a point far nearer than asked for. That put the back
     rows of the starting grid on top of each other. */
  const guard = course.points.length * steps;
  let current = ((t % 1) + 1) % 1;
  let remaining = metres;
  let previous = sampleCourse(course, current);
  for (let i = 0; i < guard && remaining > 0; i += 1) {
    const next = current - stride;
    const point = sampleCourse(course, next);
    remaining -= Math.hypot(point.x - previous.x, point.z - previous.z);
    previous = point;
    current = next;
  }
  return ((current % 1) + 1) % 1;
}

/**
 * Starting grid for 2-8 karts: staggered rows behind the line.
 *
 * Rows are spaced by metres rather than by t, so the grid stays clear on
 * every course regardless of how its control points are distributed.
 */
export function startingGrid(course: Course, seatCount: number): RespawnPose[] {
  const poses: RespawnPose[] = [];
  /* Rows must be spaced further apart than the chase camera sits behind the
     kart it follows (~9.5m), or the row behind the pole sitter parks itself
     directly in the camera's sight line and the player cannot see their own
     kart on the grid. Alternate rows are also nudged sideways, which both
     reads as a proper staggered grid and keeps the sight line clear. */
  const ROW_GAP = 11;
  const rows = Math.ceil(seatCount / 2);
  const gridLength = ROW_GAP * Math.max(1, rows - 1);
  const lead = flattestGridStart(course, gridLength);

  for (let i = 0; i < seatCount; i += 1) {
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const t = retreatByDistance(course, 0, lead + row * ROW_GAP);
    const point = sampleCourse(course, t);
    const tangent = courseTangent(course, t);
    const stagger = row % 2 === 1 ? 1.1 : 0;
    const lateral = side * Math.min(2.4, point.width * 0.45) + stagger;
    poses.push({
      position: {
        x: point.x - tangent.z * lateral,
        y: point.y + 0.4,
        z: point.z + tangent.x * lateral,
      },
      heading: Math.atan2(tangent.x, tangent.z),
    });
  }
  return poses;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type CourseIssue = { course: string; problem: string };

/**
 * Catch the mistakes that are expensive to find by driving: a circuit that
 * does not close, a hairpin tighter than a kart can physically take, a
 * shortcut that skips checkpoints, track so narrow nobody can overtake.
 */
export function validateCourse(course: Course, maxCorneringRadius = 9): CourseIssue[] {
  const issues: CourseIssue[] = [];
  const add = (problem: string) => issues.push({ course: course.id, problem });

  if (course.points.length < 8) add("a circuit needs at least 8 control points to read as a loop");
  if (course.checkpoints < 4) add("needs at least 4 checkpoints to stop corner cutting");
  if (course.laps < 1) add("lap count must be at least 1");

  // Closed loop: sampling past the end must return to the start.
  const start = sampleCourse(course, 0);
  const end = sampleCourse(course, 1);
  if (Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z) > 0.01) {
    add("the loop does not close");
  }

  // Corner radius: three consecutive samples give the turn radius. A corner
  // tighter than the kart's minimum is undriveable at racing speed.
  const samples = 240;
  let tightest = Infinity;
  for (let i = 0; i < samples; i += 1) {
    const a = sampleCourse(course, (i - 1) / samples);
    const b = sampleCourse(course, i / samples);
    const c = sampleCourse(course, (i + 1) / samples);
    const radius = circumRadius(a, b, c);
    if (radius < tightest) tightest = radius;
  }
  if (tightest < maxCorneringRadius) {
    add(`tightest corner radius ${tightest.toFixed(1)}m is below the ${maxCorneringRadius}m a kart can hold`);
  }

  // Width: needs somewhere to overtake and somewhere that demands precision.
  const widths = course.points.map((p) => p.width);
  if (Math.max(...widths) < 8) add("no section wide enough to overtake");
  if (Math.min(...widths) <= 0) add("track width must be positive everywhere");

  if (course.boostPads.length === 0) add("no boost pads");
  if (course.ramps.length === 0) add("no ramps");
  if (course.itemBoxes.length === 0) add("no item boxes");
  if (course.hazards.length === 0) add("no moving hazard");
  if (course.shortcuts.length === 0) add("no optional shortcut");

  // A shortcut must not let a racer skip a checkpoint entirely.
  const perCheckpoint = 1 / course.checkpoints;
  for (const shortcut of course.shortcuts) {
    const span = ((shortcut.to - shortcut.from) + 1) % 1;
    if (span > perCheckpoint * 1.5) {
      add(`shortcut from ${shortcut.from.toFixed(2)} to ${shortcut.to.toFixed(2)} skips a checkpoint`);
    }
  }

  for (const box of course.itemBoxes) {
    if (box.t < 0 || box.t >= 1) add("item box t must be a loop fraction in [0, 1)");
  }
  for (const pad of course.boostPads) {
    if (pad.t < 0 || pad.t >= 1) add("boost pad t must be a loop fraction in [0, 1)");
  }

  return issues;
}

/** Radius of the circle through three points, in the XZ plane. */
function circumRadius(a: ControlPoint, b: ControlPoint, c: ControlPoint) {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  if (area < 1e-6) return Infinity;
  return (ab * bc * ca) / (4 * area);
}
