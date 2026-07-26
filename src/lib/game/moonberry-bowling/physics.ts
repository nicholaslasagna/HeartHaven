/**
 * Strike Night — real bowling physics.
 *
 * Replaces "pick which pins fall from a table, then play a canned
 * animation" with an actual simulation: the ball skids, hooks, strikes the
 * deck, and the pins knock each other over. Splits, taps and messy 9s all
 * fall out of contact instead of being authored.
 *
 * DETERMINISTIC BY CONSTRUCTION. Fixed timestep, seeded jitter, no
 * Math.random and no clock. That is deliberate and it is what preserves the
 * existing multiplayer model: the server stores only (aim, power, spin,
 * seed), every client simulates the throw itself, and all eight agree on
 * the pinfall without a byte of pin state on the wire.
 *
 * Model: planar rigid bodies. Bowling pin scatter is essentially a 2D
 * problem — pins are upright cylinders on a flat deck, and what makes the
 * deck read as real is pins striking *other pins*, which is planar. Pin
 * toppling is tracked as a scalar so the renderer can lay them over, but it
 * does not feed back into the contact solver.
 *
 * SI units throughout: metres, seconds, kilograms. Every dimension below is
 * the regulation figure, so the geometry is right before any tuning starts.
 */

/* ------------------------------------------------------------------ */
/* Regulation geometry                                                 */
/* ------------------------------------------------------------------ */

/** Foul line to head pin: 60 ft. */
export const LANE_LENGTH = 18.288;
/** Lane width between gutters: 41.5 in. */
export const LANE_WIDTH = 1.0541;
/** Pin centres are 12 in apart; rows are 12·cos30° apart down the lane. */
export const PIN_SPACING = 0.3048;
export const PIN_ROW_SPACING = PIN_SPACING * Math.cos(Math.PI / 6);

export const BALL_RADIUS = 0.1085;
export const BALL_MASS = 7.26;
/** Pin belly is the widest contact band, 4.766 in across. */
export const PIN_RADIUS = 0.0605;
export const PIN_MASS = 1.531;
export const PIN_HEIGHT = 0.381;

const GRAVITY = 9.80665;

/** The rack sits at the far end; the ball is released at z = 0. */
export const HEAD_PIN_Z = LANE_LENGTH;

/** Standard triangle RELATIVE TO THE HEAD PIN. x across the lane (+ right),
    z further down the lane. Add HEAD_PIN_Z for world coordinates. */
export const PIN_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-PIN_SPACING / 2, PIN_ROW_SPACING], [PIN_SPACING / 2, PIN_ROW_SPACING],
  [-PIN_SPACING, PIN_ROW_SPACING * 2], [0, PIN_ROW_SPACING * 2], [PIN_SPACING, PIN_ROW_SPACING * 2],
  [-PIN_SPACING * 1.5, PIN_ROW_SPACING * 3], [-PIN_SPACING / 2, PIN_ROW_SPACING * 3],
  [PIN_SPACING / 2, PIN_ROW_SPACING * 3], [PIN_SPACING * 1.5, PIN_ROW_SPACING * 3],
];

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

export const BOWLING = {
  STEP: 1 / 240,
  /** Ball speed at power 0 and power 1, m/s (~11 to ~20 mph). */
  MIN_SPEED: 5.0,
  MAX_SPEED: 9.0,
  /** Peak side-rotation the player can impart, rad/s. */
  MAX_SPIN: 34,

  /** Oiled head of the lane: the ball skids nearly straight here. */
  OIL_FRICTION: 0.036,
  /** Dry back end: friction bites and the ball breaks toward the pocket. */
  DRY_FRICTION: 0.21,
  /** Oil covers this fraction of the lane, then ramps off. */
  OIL_LENGTH: 0.62,
  OIL_RAMP: 0.16,

  /** How strongly side-rotation converts to lateral force while sliding. */
  HOOK_GAIN: 1.2,
  /** Spin bleeds off as the ball transitions from skid to true roll. */
  SPIN_DECAY: 0.62,

  RESTITUTION_BALL_PIN: 0.52,
  RESTITUTION_PIN_PIN: 0.62,
  /** Deck friction on a struck pin — pins slide, they do not glide forever. */
  PIN_DRAG: 2.6,
  /** Contact speed above which a pin goes down rather than rattling. */
  PIN_TOPPLE_SPEED: 0.45,
  /** A toppling pin keeps sweeping others for this long. */
  PIN_FALL_TIME: 0.42,

  /** Behind the pin deck; pins past this are swept into the pit. */
  PIT_Z: LANE_LENGTH + 1.6,
  /** Side walls beside the deck. */
  DECK_HALF_WIDTH: 0.66,
} as const;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type Pin = {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** 0 upright, 1 flat. Once past the threshold the pin is scored down. */
  tilt: number;
  tiltAxis: number;
  down: boolean;
  /** Spin for the renderer, rad/s. */
  spin: number;
};

export type BallState = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Side rotation about the vertical axis; the source of hook. */
  spin: number;
  /** Accumulated roll for the renderer, radians. */
  roll: number;
  inGutter: boolean;
  /** True only if it found the channel BEFORE reaching the pins. */
  missedDeck: boolean;
  stopped: boolean;
};

export type ThrowInput = {
  /** Lateral start position across the lane, -1 (left gutter) to 1. */
  aim: number;
  /** 0..1, maps to MIN_SPEED..MAX_SPEED. */
  power: number;
  /** -1 full hook left, 0 straight, 1 full hook right. */
  spin: number;
  /** Launch angle in radians; small, and usually 0. */
  angle?: number;
  /** Reproducible micro-variation, so two identical throws are not clones. */
  seed?: number;
};

export type ThrowFrame = {
  t: number;
  ball: { x: number; z: number; roll: number; inGutter: boolean };
  pins: Array<{ id: number; x: number; z: number; tilt: number; tiltAxis: number; spin: number }>;
};

export type ThrowResult = {
  /** Pin ids left standing when the deck settles. */
  standing: number[];
  knocked: number[];
  pinCount: number;
  /** Sampled for playback; the renderer interpolates between frames. */
  frames: ThrowFrame[];
  duration: number;
  gutter: boolean;
  /** Where the ball crossed the head pin's row, for "pocket" feedback. */
  entryX: number;
};

/** mulberry32 — identical in every browser, which is the point. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Friction under the ball at a given distance down the lane. Low through
 * the oil, ramping up to dry — this profile IS the hook: the ball tracks
 * almost straight to the break point, then turns hard.
 */
export function laneFriction(z: number) {
  const travel = z / LANE_LENGTH;
  const oilEnd = BOWLING.OIL_LENGTH;
  if (travel <= oilEnd) return BOWLING.OIL_FRICTION;
  const ramp = Math.min(1, (travel - oilEnd) / BOWLING.OIL_RAMP);
  // Smoothstep so the transition is not a visible kink in the path.
  const eased = ramp * ramp * (3 - 2 * ramp);
  return BOWLING.OIL_FRICTION + (BOWLING.DRY_FRICTION - BOWLING.OIL_FRICTION) * eased;
}

export function createPins(): Pin[] {
  return PIN_POSITIONS.map(([x, z], id) => ({
    id, x, z: z + HEAD_PIN_Z, vx: 0, vz: 0, tilt: 0, tiltAxis: 0, down: false, spin: 0,
  }));
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Simulate one throw to completion. Pure: same input, same output, on every
 * machine — which is what lets the netcode ship three numbers instead of a
 * pin-by-pin state stream.
 */
export function simulateThrow(input: ThrowInput, standingPins?: number[]): ThrowResult {
  const random = rng((input.seed ?? 0) | 0);
  // A few millimetres of release variation: enough that repeated throws
  // differ like a real bowler's, small enough that skill still dominates.
  const jitterX = (random() - 0.5) * 0.012;
  const jitterSpin = (random() - 0.5) * 0.9;

  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  const aim = clamp(input.aim, -1, 1);
  const power = clamp(input.power, 0, 1);
  const spinInput = clamp(input.spin, -1, 1);

  const speed = BOWLING.MIN_SPEED + (BOWLING.MAX_SPEED - BOWLING.MIN_SPEED) * power;
  const angle = input.angle ?? 0;

  const ball: BallState = {
    /* Aim reaches a little PAST the lane edge on purpose: the outer ~15% of
       the range is a genuine gutter, so a bad line is punished the way it
       is in a real house. Anything inside that is a legal board. */
    x: aim * (LANE_WIDTH / 2 + BALL_RADIUS * 0.6) + jitterX,
    z: 0,
    vx: Math.sin(angle) * speed,
    vz: Math.cos(angle) * speed,
    spin: spinInput * BOWLING.MAX_SPIN + jitterSpin,
    roll: 0,
    inGutter: false,
    missedDeck: false,
    stopped: false,
  };

  const pins = createPins();
  if (standingPins) {
    const keep = new Set(standingPins);
    for (const pin of pins) {
      if (keep.has(pin.id)) continue;
      pin.down = true;
      pin.tilt = 1;
      // Cleared off the deck, so it cannot take part in contacts.
      pin.x = 999;
      pin.z = 999;
    }
  }

  const frames: ThrowFrame[] = [];
  const dt = BOWLING.STEP;
  const sampleEvery = Math.round(1 / 60 / dt);
  let entryX = ball.x;
  let crossedHeadPin = false;
  let t = 0;
  let settleTimer = 0;

  for (let step = 0; step < 240 * 14; step += 1) {
    t += dt;
    stepBall(ball, dt);
    for (const pin of pins) stepPin(pin, dt);

    resolveBallPins(ball, pins);
    resolvePinPins(pins);

    if (!crossedHeadPin && ball.z >= HEAD_PIN_Z) {
      crossedHeadPin = true;
      entryX = ball.x;
    }

    if (step % sampleEvery === 0) {
      frames.push({
        t,
        ball: { x: ball.x, z: ball.z, roll: ball.roll, inGutter: ball.inGutter },
        pins: pins.map((pin) => ({
          id: pin.id, x: pin.x, z: pin.z, tilt: pin.tilt, tiltAxis: pin.tiltAxis, spin: pin.spin,
        })),
      });
    }

    // Settled once the ball is past/into the pit and nothing is moving.
    const moving = pins.some((pin) => Math.hypot(pin.vx, pin.vz) > 0.05 || (pin.tilt > 0 && pin.tilt < 1));
    const ballDone = ball.z > BOWLING.PIT_Z || ball.stopped;
    if (ballDone && !moving) {
      settleTimer += dt;
      if (settleTimer > 0.25) break;
    } else {
      settleTimer = 0;
    }
  }

  const standing = pins.filter((pin) => !pin.down).map((pin) => pin.id);
  const knocked = pins.filter((pin) => pin.down).map((pin) => pin.id);
  const originallyStanding = standingPins ? standingPins.length : 10;

  return {
    standing,
    knocked: standingPins ? knocked.filter((id) => standingPins.includes(id)) : knocked,
    pinCount: originallyStanding - standing.length,
    frames,
    duration: t,
    gutter: ball.missedDeck,
    entryX,
  };
}

function stepBall(ball: BallState, dt: number) {
  if (ball.stopped) return;

  if (ball.inGutter) {
    // Down the channel, no hook, just drag.
    ball.vx = 0;
    ball.vz = Math.max(0, ball.vz - 1.2 * dt);
    ball.z += ball.vz * dt;
    ball.roll += (ball.vz / BALL_RADIUS) * dt;
    if (ball.z > BOWLING.PIT_Z) ball.stopped = true;
    return;
  }

  const edge = LANE_WIDTH / 2 - BALL_RADIUS * 0.35;
  if (Math.abs(ball.x) > edge) {
    ball.inGutter = true;
    // Only a channel ball short of the deck is a gutter for scoring.
    ball.missedDeck = ball.z < HEAD_PIN_Z;
    ball.x = Math.sign(ball.x) * (LANE_WIDTH / 2 + BALL_RADIUS * 0.4);
    return;
  }

  const mu = laneFriction(ball.z);
  const speed = Math.hypot(ball.vx, ball.vz);

  /* Hook. Side rotation only bites where the lane is dry, and it bites on
     a SQUARED dryness term — in the oil the sideways force is a rounding
     error, and in the back end it is the whole story. That asymmetry is
     what makes the path read as a real hook (straight, then a hard late
     break) instead of a uniform arc drawn across the whole lane. */
  const dryness = mu / BOWLING.DRY_FRICTION;
  const lateral = mu * GRAVITY * BOWLING.HOOK_GAIN * dryness * dryness * Math.tanh(ball.spin / 22);
  ball.vx += lateral * dt;

  // Rolling resistance along the direction of travel.
  if (speed > 0.001) {
    const drag = mu * GRAVITY * 0.32;
    ball.vx -= (ball.vx / speed) * drag * dt;
    ball.vz -= (ball.vz / speed) * drag * dt;
  }

  // Spin bleeds off as skid becomes roll — the hook has a finite budget.
  ball.spin -= ball.spin * BOWLING.SPIN_DECAY * (mu / BOWLING.DRY_FRICTION) * dt * 4;

  ball.x += ball.vx * dt;
  ball.z += ball.vz * dt;
  ball.roll += (Math.hypot(ball.vx, ball.vz) / BALL_RADIUS) * dt;

  if (ball.vz <= 0.05 && ball.z < BOWLING.PIT_Z) ball.stopped = true;
}

function stepPin(pin: Pin, dt: number) {
  if (pin.tilt > 0 && pin.tilt < 1) {
    // Falling: keeps sweeping neighbours until it is flat.
    pin.tilt = Math.min(1, pin.tilt + dt / BOWLING.PIN_FALL_TIME);
  }
  const speed = Math.hypot(pin.vx, pin.vz);
  if (speed < 0.001) {
    pin.vx = 0;
    pin.vz = 0;
    return;
  }
  const drag = Math.min(speed, BOWLING.PIN_DRAG * dt);
  pin.vx -= (pin.vx / speed) * drag;
  pin.vz -= (pin.vz / speed) * drag;
  pin.x += pin.vx * dt;
  pin.z += pin.vz * dt;
  pin.spin *= 1 - Math.min(1, dt * 1.4);

  // Off the back or the sides of the deck.
  if (pin.z > BOWLING.PIT_Z || Math.abs(pin.x) > BOWLING.DECK_HALF_WIDTH) {
    pin.down = true;
    pin.tilt = 1;
  }
}

/** A pin still standing occupies the deck; a flattened one does not. */
const pinBlocks = (pin: Pin) => pin.tilt < 1;

function topple(pin: Pin, impactX: number, impactZ: number) {
  if (pin.tilt > 0) return;
  pin.tilt = 0.001;
  pin.down = true;
  pin.tiltAxis = Math.atan2(impactX, impactZ);
  pin.spin = (impactX * 2.4) % 6;
}

function resolveBallPins(ball: BallState, pins: Pin[]) {
  if (ball.inGutter) return;
  const minDist = BALL_RADIUS + PIN_RADIUS;

  for (const pin of pins) {
    if (!pinBlocks(pin)) continue;
    const dx = pin.x - ball.x;
    const dz = pin.z - ball.z;
    const dist = Math.hypot(dx, dz);
    if (dist >= minDist || dist < 1e-6) continue;

    const nx = dx / dist;
    const nz = dz / dist;
    const rvx = pin.vx - ball.vx;
    const rvz = pin.vz - ball.vz;
    const along = rvx * nx + rvz * nz;
    if (along > 0) continue;

    // The ball barely slows: it is nearly five times the pin's mass, which
    // is exactly why a good hit carries through the deck instead of stalling.
    const impulse = (-(1 + BOWLING.RESTITUTION_BALL_PIN) * along) / (1 / BALL_MASS + 1 / PIN_MASS);
    pin.vx += (impulse / PIN_MASS) * nx;
    pin.vz += (impulse / PIN_MASS) * nz;
    ball.vx -= (impulse / BALL_MASS) * nx;
    ball.vz -= (impulse / BALL_MASS) * nz;

    // Separate so they do not re-collide next step.
    const overlap = minDist - dist;
    pin.x += nx * overlap;
    pin.z += nz * overlap;

    if (Math.hypot(pin.vx, pin.vz) > BOWLING.PIN_TOPPLE_SPEED) topple(pin, nx, nz);
  }
}

function resolvePinPins(pins: Pin[]) {
  const minDist = PIN_RADIUS * 2;
  for (let i = 0; i < pins.length; i += 1) {
    const a = pins[i];
    if (!pinBlocks(a) && Math.hypot(a.vx, a.vz) < 0.05) continue;
    for (let j = i + 1; j < pins.length; j += 1) {
      const b = pins[j];
      if (!pinBlocks(a) && !pinBlocks(b)) continue;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= minDist || dist < 1e-6) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      const along = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (along > 0) continue;

      const impulse = (-(1 + BOWLING.RESTITUTION_PIN_PIN) * along) / (2 / PIN_MASS);
      a.vx -= (impulse / PIN_MASS) * nx;
      a.vz -= (impulse / PIN_MASS) * nz;
      b.vx += (impulse / PIN_MASS) * nx;
      b.vz += (impulse / PIN_MASS) * nz;

      const overlap = (minDist - dist) / 2;
      a.x -= nx * overlap;
      a.z -= nz * overlap;
      b.x += nx * overlap;
      b.z += nz * overlap;

      if (Math.hypot(a.vx, a.vz) > BOWLING.PIN_TOPPLE_SPEED) topple(a, -nx, -nz);
      if (Math.hypot(b.vx, b.vz) > BOWLING.PIN_TOPPLE_SPEED) topple(b, nx, nz);
    }
  }
}
