/**
 * Moonberry Racing — kart handling, drift and boost.
 *
 * Pure and deterministic: fixed timestep, no three.js, no Math.random, no
 * clock. The host replays these same steps to validate what clients report,
 * and the whole thing is unit-checkable headlessly.
 *
 * Arcade, not simulation. No tyre slip curves, no weight transfer — the kart
 * accelerates hard, turns predictably, and never punishes a player for a
 * mistake longer than about a second. Everything below serves that.
 *
 * THE DRIFT BOOST is the skill expression, so it is worth stating plainly:
 *
 *   hold drift + steer   the kart slides and a charge meter fills
 *   release too EARLY    no boost, and the meter is spent (a real cost)
 *   release in the SWEET SPOT   a strong boost
 *   hold too LONG        the kart overcharges and spins out briefly
 *
 * That is a risk/reward curve with a punishment at BOTH ends, which is what
 * stops "always hold drift forever" from being the optimal strategy.
 *
 * Units: metres, seconds, radians. +Y up. Heading 0 faces +Z.
 */

export const KART = {
  /** 120Hz so a fast kart never skips a collision at any frame rate. */
  STEP: 1 / 120,

  MAX_SPEED: 26,
  REVERSE_SPEED: 8,
  ACCEL: 22,
  BRAKE: 34,
  /** Coasting drag; low, because an arcade kart should keep rolling. */
  DRAG: 2.4,
  OFFROAD_DRAG: 15,
  /** Off-road slows you but must never stop you dead. */
  OFFROAD_MAX_SPEED: 12,

  TURN_RATE: 2.0,
  /** Steering authority falls off with speed so high speed feels heavy. */
  TURN_SPEED_FALLOFF: 0.45,
  DRIFT_TURN_RATE: 3.1,
  /** How much the kart slides sideways while drifting. */
  DRIFT_SLIP: 0.55,
  /** Minimum speed before a drift will engage at all. */
  DRIFT_MIN_SPEED: 9,

  /** Seconds of held drift to fill the charge meter to 1.0. */
  DRIFT_CHARGE_TIME: 1.4,
  /** Below this the release is early: no boost, meter lost. */
  DRIFT_EARLY: 0.45,
  /** The sweet spot is [DRIFT_EARLY, DRIFT_SWEET_END]. */
  DRIFT_SWEET_END: 0.85,
  /** Past this the meter is overcharged and a spin-out is imminent. */
  DRIFT_OVERCHARGE: 1.0,
  /** Charge value at which the kart actually spins out. */
  DRIFT_BURST: 1.35,

  BOOST_SPEED: 38,
  BOOST_ACCEL: 60,
  BOOST_TIME: 1.15,
  PAD_BOOST_TIME: 1.4,

  SPINOUT_TIME: 0.85,
  /** Control returns quickly; a long punish is not fun. */
  COLLISION_SPEED_KEEP: 0.55,

  HOP_VELOCITY: 5.2,
  GRAVITY: 26,
  /** Landing keeps this much of the speed carried into the air. */
  LANDING_MOMENTUM_KEEP: 0.97,

  /** Gentle nudge away from the track edge; assistance, not autopilot. */
  EDGE_ASSIST: 1.6,
  RESPAWN_INVULN: 2.0,

  /** A kart within this of the surface is ON it, not flying.
      Without a real tolerance here, any slope or crest drops the ground away
      from under a moving kart and it is flagged airborne for a frame — which
      silently cancelled the drift and made drift boosts almost unobtainable
      while actually racing. */
  GROUND_SNAP: 0.4,
  /** A drift survives this much genuine airtime, so a bump does not end it
      but a real jump off a ramp still does. */
  DRIFT_AIR_GRACE: 0.22,
} as const;

export type DriftSide = 0 | 1 | -1;
export type ChargeBand = "none" | "early" | "sweet" | "over";

export type KartInput = {
  /** -1..1, analogue-friendly. */
  steer: number;
  throttle: number;
  brake: number;
  /** Shift: hold to drift. */
  drift: boolean;
  /** Space: hop, or release a drift boost. */
  action: boolean;
  item: boolean;
};

export const NO_KART_INPUT: KartInput = {
  steer: 0, throttle: 0, brake: 0, drift: false, action: false, item: false,
};

export type KartEvent =
  | "hop" | "land" | "drift-start" | "boost-sweet" | "boost-early"
  | "spinout" | "collide" | "respawn" | "pad";

export type KartBody = {
  x: number; y: number; z: number;
  heading: number;
  /** Forward speed along heading. */
  speed: number;
  /** Vertical velocity, for hops and ramps. */
  vy: number;
  airborne: boolean;

  driftSide: DriftSide;
  driftCharge: number;
  boostTimer: number;
  spinTimer: number;
  invulnTimer: number;

  /** Held-action edge detection. */
  actionHeld: boolean;
  /** Seconds continuously off the ground, for drift tolerance. */
  airTime: number;
  events: KartEvent[];
};

export function createKart(x: number, y: number, z: number, heading: number): KartBody {
  return {
    x, y, z, heading,
    speed: 0, vy: 0, airborne: false,
    driftSide: 0, driftCharge: 0,
    boostTimer: 0, spinTimer: 0, invulnTimer: 0,
    actionHeld: false, airTime: 0, events: [],
  };
}

/** Which band the charge meter is in, for the HUD and for scoring a release. */
export function chargeBand(charge: number): ChargeBand {
  if (charge <= 0) return "none";
  if (charge < KART.DRIFT_EARLY) return "early";
  if (charge <= KART.DRIFT_SWEET_END) return "sweet";
  return "over";
}

export type SurfaceInfo = {
  /** Off the racing surface: slower, but never stopped. */
  offroad: boolean;
  ice: boolean;
  /** Signed push along the kart's forward axis, m/s². */
  conveyor?: number;
  /** Ground height here. */
  groundY: number;
  /** Distance outside the track edge; drives the edge assist. */
  edgeOverrun?: number;
  /** Which way is back toward the racing line, radians. */
  edgeHeading?: number;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const approach = (v: number, target: number, delta: number) =>
  v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);

/**
 * Advance one fixed step.
 *
 * `dt` should be KART.STEP; it is a parameter only so tests can probe.
 */
export function stepKart(
  kart: KartBody,
  input: KartInput,
  surface: SurfaceInfo,
  dt: number,
  /** Multiplier from active items: a burst speeds you up, taffy slows you. */
  speedScale = 1,
) {
  kart.events.length = 0;

  const actionPressed = input.action && !kart.actionHeld;
  kart.actionHeld = input.action;
  kart.invulnTimer = Math.max(0, kart.invulnTimer - dt);

  /* -- spinning out: brief, and completely uninterruptible so it reads as a
        real consequence rather than a stutter -- */
  if (kart.spinTimer > 0) {
    kart.spinTimer -= dt;
    kart.heading += (Math.PI * 2.4) * dt;
    kart.speed = approach(kart.speed, 0, 26 * dt);
    integrate(kart, surface, dt);
    return kart;
  }

  /* -- boost -- */
  if (kart.boostTimer > 0) kart.boostTimer -= dt;
  const boosting = kart.boostTimer > 0;

  /* -- drift state machine -- */
  const fastEnough = kart.speed > KART.DRIFT_MIN_SPEED;
  const steering = Math.abs(input.steer) > 0.15;

  if (input.drift && !kart.airborne && fastEnough && steering && kart.driftSide === 0) {
    kart.driftSide = input.steer > 0 ? 1 : -1;
    kart.driftCharge = 0;
    kart.events.push("drift-start");
  }

  if (kart.driftSide !== 0) {
    // A drift ends the moment the button or the speed goes.
    // Brief airtime over a bump must not cancel a drift; a real jump does.
    const flying = kart.airborne && kart.airTime > KART.DRIFT_AIR_GRACE;
    const stillDrifting = input.drift && kart.speed > KART.DRIFT_MIN_SPEED * 0.7 && !flying;

    if (stillDrifting) {
      kart.driftCharge += dt / KART.DRIFT_CHARGE_TIME;
      // Overcharged and held: the kart lets go for you.
      if (kart.driftCharge >= KART.DRIFT_BURST) {
        kart.driftSide = 0;
        kart.driftCharge = 0;
        kart.spinTimer = KART.SPINOUT_TIME;
        kart.events.push("spinout");
        integrate(kart, surface, dt);
        return kart;
      }
      // Releasing the boost is the SPACE press, mid-drift.
      if (actionPressed) {
        releaseDrift(kart);
      }
    } else {
      // Let go of drift without pressing boost: the charge is simply lost.
      kart.driftSide = 0;
      kart.driftCharge = 0;
    }
  } else if (actionPressed && !kart.airborne) {
    // Space with no drift is a hop, which is also how you enter a drift on
    // a straight and how you shake off a bad line.
    kart.vy = KART.HOP_VELOCITY;
    kart.airborne = true;
    kart.events.push("hop");
  }

  /* -- steering -- */
  const speedRatio = clamp(Math.abs(kart.speed) / KART.MAX_SPEED, 0, 1);
  const authority = 1 - KART.TURN_SPEED_FALLOFF * speedRatio;
  let turnRate = KART.TURN_RATE * authority;

  if (kart.driftSide !== 0) {
    // A drift turns harder, and always at least a little toward its side, so
    // the slide commits instead of straightening under a neutral stick.
    const bias = kart.driftSide * 0.45;
    const combined = clamp(input.steer * 0.6 + bias, -1, 1);
    kart.heading += combined * KART.DRIFT_TURN_RATE * authority * dt;
  } else {
    if (surface.ice) turnRate *= 0.72;
    if (kart.airborne) turnRate *= 0.35;
    kart.heading += input.steer * turnRate * dt;
  }

  // Edge assist: a gentle steer back toward the line, never a takeover.
  if (surface.edgeOverrun && surface.edgeOverrun > 0 && surface.edgeHeading !== undefined) {
    const delta = angleDelta(surface.edgeHeading, kart.heading);
    kart.heading += clamp(delta, -1, 1) * KART.EDGE_ASSIST * Math.min(1, surface.edgeOverrun) * dt;
  }

  /* -- longitudinal -- */
  const maxSpeed = (boosting
    ? KART.BOOST_SPEED
    : surface.offroad
      ? KART.OFFROAD_MAX_SPEED
      : KART.MAX_SPEED) * speedScale;

  if (boosting) {
    kart.speed = approach(kart.speed, KART.BOOST_SPEED * speedScale, KART.BOOST_ACCEL * dt);
  } else if (input.throttle > 0) {
    kart.speed = approach(kart.speed, maxSpeed * input.throttle, KART.ACCEL * dt);
  } else if (input.brake > 0) {
    kart.speed = approach(kart.speed, -KART.REVERSE_SPEED * input.brake, KART.BRAKE * dt);
  } else {
    const drag = surface.offroad ? KART.OFFROAD_DRAG : KART.DRAG;
    kart.speed = approach(kart.speed, 0, drag * dt);
  }

  // Off-road bleeds speed even on full throttle, but leaves you driving.
  const offroadCap = KART.OFFROAD_MAX_SPEED * speedScale;
  if (surface.offroad && kart.speed > offroadCap) {
    kart.speed = approach(kart.speed, offroadCap, KART.OFFROAD_DRAG * dt);
  }
  if (surface.conveyor) kart.speed += surface.conveyor * dt;

  integrate(kart, surface, dt);
  return kart;
}

/** Score a drift release. Both failure modes cost something real. */
function releaseDrift(kart: KartBody) {
  const band = chargeBand(kart.driftCharge);
  kart.driftSide = 0;

  if (band === "sweet" || band === "over") {
    kart.boostTimer = KART.BOOST_TIME;
    kart.events.push("boost-sweet");
  } else {
    // Too early: no boost, and the charge is gone. Mashing must not pay.
    kart.events.push("boost-early");
  }
  kart.driftCharge = 0;
}

function integrate(kart: KartBody, surface: SurfaceInfo, dt: number) {
  // Drifting slides the kart slightly sideways of where it points, which is
  // what makes a drift look and feel like one.
  const slip = kart.driftSide !== 0 ? -kart.driftSide * KART.DRIFT_SLIP : 0;
  const moveHeading = kart.heading + slip;

  kart.x += Math.sin(moveHeading) * kart.speed * dt;
  kart.z += Math.cos(moveHeading) * kart.speed * dt;

  /* Ground contact. The tolerance matters: a kart following a descending
     road is momentarily above the new surface height every frame, and
     treating that as flight both cancelled drifts and fired spurious landing
     effects. Only a genuine gap counts as airborne. */
  const gap = kart.y - surface.groundY;
  if (kart.airborne || gap > KART.GROUND_SNAP) {
    kart.vy -= KART.GRAVITY * dt;
    kart.y += kart.vy * dt;
    kart.airborne = true;
    kart.airTime += dt;
    if (kart.y <= surface.groundY) {
      kart.y = surface.groundY;
      kart.vy = 0;
      kart.airborne = false;
      kart.airTime = 0;
      // Landing keeps almost all momentum: ramps should reward, not punish.
      kart.speed *= KART.LANDING_MOMENTUM_KEEP;
      kart.events.push("land");
    }
  } else {
    // Stick to the surface, following slopes and banking.
    kart.y = surface.groundY;
    kart.vy = 0;
    kart.airborne = false;
    kart.airTime = 0;
  }
}

/** Drive over a boost pad. */
export function applyBoostPad(kart: KartBody, strength = 1) {
  kart.boostTimer = Math.max(kart.boostTimer, KART.PAD_BOOST_TIME * strength);
  kart.events.push("pad");
}

/**
 * Bump into a wall or another kart. Speed is scrubbed and the kart is pushed
 * out, but control is never taken away — the design brief is explicit that a
 * collision must not leave anyone stuck.
 */
export function applyCollision(kart: KartBody, pushX: number, pushZ: number) {
  const len = Math.hypot(pushX, pushZ) || 1;
  kart.x += (pushX / len) * 0.35;
  kart.z += (pushZ / len) * 0.35;
  kart.speed *= KART.COLLISION_SPEED_KEEP;
  kart.driftSide = 0;
  kart.driftCharge = 0;
  kart.events.push("collide");
}

/** Hit by an item or hazard: a short spin, then straight back to racing. */
export function applySpinout(kart: KartBody) {
  if (kart.invulnTimer > 0) return false;
  kart.spinTimer = KART.SPINOUT_TIME;
  kart.driftSide = 0;
  kart.driftCharge = 0;
  kart.events.push("spinout");
  return true;
}

export function respawnKart(kart: KartBody, x: number, y: number, z: number, heading: number) {
  kart.x = x;
  kart.y = y;
  kart.z = z;
  kart.heading = heading;
  kart.speed = 0;
  kart.vy = 0;
  kart.airborne = false;
  kart.driftSide = 0;
  kart.driftCharge = 0;
  kart.boostTimer = 0;
  kart.spinTimer = 0;
  // Brief protection so a respawn cannot chain into another hit.
  kart.invulnTimer = KART.RESPAWN_INVULN;
  kart.events.push("respawn");
}

/** Shortest signed angle from b to a, in radians. */
export function angleDelta(a: number, b: number) {
  return ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}
