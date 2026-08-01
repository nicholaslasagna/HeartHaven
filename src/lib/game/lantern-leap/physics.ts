/**
 * Lantern Leap — movement and collision.
 *
 * Pure: no three.js, no DOM, no Math.random. Everything here is a
 * deterministic function of (state, input, level, dt), which is what lets
 * eight clients run the same simulation and lets the whole thing be
 * unit-checked headlessly.
 *
 * The feel is the product. A platformer lives or dies on a dozen small
 * forgivenesses that nobody notices individually and everybody notices the
 * absence of, so they are all here and all named:
 *
 *   coyote time      jump still fires just after walking off a ledge
 *   jump buffering   jump pressed just before landing still fires
 *   variable height  releasing early cuts the rise
 *   apex hang        gravity eases near the top of the arc
 *   asymmetric grav  falling is faster than rising
 *   skid turnaround  reversing decelerates hard instead of gliding
 *   corner nudge     a head-clip on a corner slides past instead of stopping
 *   ledge magnet     landing a pixel short still catches the edge
 *   speed-scaled jump running jumps go higher, like every good platformer
 *
 * Coordinates are Y-UP and measured in TILES (1 tile = 1 unit), so every
 * constant below reads as "tiles" or "tiles per second" and can be reasoned
 * about against the level grid directly.
 *
 * The AABB is anchored at the FEET: `x` is the horizontal centre, `y` is the
 * bottom edge. Slope math and ground checks are far simpler that way.
 */

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

export const TILE = {
  EMPTY: 0,
  SOLID: 1,
  /** Jump up through it, land on top. */
  ONEWAY: 2,
  /** Floor rises toward +X. */
  SLOPE_R: 3,
  /** Floor rises toward -X. */
  SLOPE_L: 4,
  HAZARD: 5,
  /** Solid, but almost no friction. */
  ICE: 6,
  /** Solid, but launches anything that lands on it. */
  BOUNCE: 7,
} as const;

export type TileId = (typeof TILE)[keyof typeof TILE];

export type TileGrid = {
  width: number;
  height: number;
  /** Row-major from the TOP row down, so string-art levels map 1:1. */
  tiles: Uint8Array;
};

/** Tile at world tile coords (y-up). Out of bounds reads as empty, except
    below the floor, which reads solid so nothing tunnels out the bottom. */
export function tileAt(grid: TileGrid, tx: number, ty: number): number {
  if (tx < 0 || tx >= grid.width) return TILE.EMPTY;
  if (ty >= grid.height) return TILE.EMPTY;
  if (ty < 0) return TILE.EMPTY;
  const row = grid.height - 1 - ty;
  return grid.tiles[row * grid.width + tx];
}

export const isSolid = (id: number) =>
  id === TILE.SOLID || id === TILE.ICE || id === TILE.BOUNCE;
export const isSlope = (id: number) => id === TILE.SLOPE_R || id === TILE.SLOPE_L;
/** Anything the player can stand on when falling. */
export const isFloor = (id: number) => isSolid(id) || isSlope(id) || id === TILE.ONEWAY;

/**
 * Height of a slope's surface within its own tile, 0..1, at local x 0..1.
 * A SLOPE_R tile is empty at its left edge and full at its right edge.
 */
export function slopeSurface(id: number, localX: number) {
  const t = localX < 0 ? 0 : localX > 1 ? 1 : localX;
  if (id === TILE.SLOPE_R) return t;
  if (id === TILE.SLOPE_L) return 1 - t;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

export const PHYSICS = {
  /** Simulation runs at a fixed 120Hz: half a frame of error at 60fps, and
      fast enough that a full-speed run never skips a tile. */
  STEP: 1 / 120,

  WALK_SPEED: 5.6,
  RUN_SPEED: 9.4,
  GROUND_ACCEL: 42,
  AIR_ACCEL: 26,
  GROUND_FRICTION: 46,
  AIR_FRICTION: 5,
  /** Reversing direction on the ground bites much harder than friction. */
  SKID_DECEL: 78,
  ICE_ACCEL: 9,
  ICE_FRICTION: 3.2,

  JUMP_VELOCITY: 22,
  /** Extra launch at a full run, lerped by horizontal speed. */
  JUMP_RUN_BONUS: 2.4,
  /** Releasing jump mid-rise scales the remaining upward velocity. */
  JUMP_CUT: 0.42,
  GRAVITY_RISE: 55,
  GRAVITY_FALL: 78,
  /** Eased gravity through the top of the arc — the single biggest
      contributor to a jump feeling floaty-but-controlled. */
  GRAVITY_APEX: 32,
  APEX_WINDOW: 4,
  TERMINAL_VELOCITY: 24,

  COYOTE_TIME: 0.1,
  JUMP_BUFFER: 0.12,
  /** How far a head-clipped jump may slide sideways to clear a corner. */
  CORNER_NUDGE: 0.3,

  WALL_SLIDE_SPEED: 6,
  WALL_JUMP_X: 8.2,
  WALL_JUMP_Y: 20.5,
  /** Steering is locked briefly after a wall jump so it always commits. */
  WALL_JUMP_LOCK: 0.14,

  BOUNCE_VELOCITY: 27,
  POUND_SPEED: 26,
  POUND_HANG: 0.14,

  PLAYER_HALF_WIDTH: 0.34,
  PLAYER_HEIGHT: 1.42,
  PLAYER_DUCK_HEIGHT: 0.78,
} as const;

/** Peak jump height from a standing start, in tiles. Used by the level
    validator so no generated or authored gap is unreachable. */
export const MAX_JUMP_HEIGHT =
  (PHYSICS.JUMP_VELOCITY * PHYSICS.JUMP_VELOCITY) / (2 * PHYSICS.GRAVITY_RISE);

/** Peak jump height at a full run. */
export const MAX_RUN_JUMP_HEIGHT =
  ((PHYSICS.JUMP_VELOCITY + PHYSICS.JUMP_RUN_BONUS) ** 2) / (2 * PHYSICS.GRAVITY_RISE);

/** Horizontal reach of a full-speed running jump landing at take-off height. */
export const MAX_JUMP_DISTANCE = (() => {
  const v = PHYSICS.JUMP_VELOCITY + PHYSICS.JUMP_RUN_BONUS;
  // Up under rise gravity, down under fall gravity.
  const up = v / PHYSICS.GRAVITY_RISE;
  const height = (v * v) / (2 * PHYSICS.GRAVITY_RISE);
  const down = Math.sqrt((2 * height) / PHYSICS.GRAVITY_FALL);
  return PHYSICS.RUN_SPEED * (up + down);
})();

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type PlayerInput = {
  /** -1, 0 or 1. */
  moveX: number;
  jump: boolean;
  run: boolean;
  duck: boolean;
  pound: boolean;
};

export const NO_INPUT: PlayerInput = { moveX: 0, jump: false, run: false, duck: false, pound: false };

export type PlayerMotion =
  | "idle" | "walk" | "run" | "skid"
  | "jump" | "fall" | "wallslide" | "duck" | "pound" | "bounce";

export type PlayerBody = {
  x: number; y: number;
  vx: number; vy: number;
  facing: 1 | -1;
  grounded: boolean;
  ducking: boolean;
  motion: PlayerMotion;
  /** Tile id under the feet, so the renderer can pick footstep effects. */
  groundTile: number;
  /** -1 hugging a wall on the left, 1 on the right, 0 free. */
  wallDir: 0 | 1 | -1;
  coyote: number;
  buffer: number;
  jumpHeld: boolean;
  wallLock: number;
  poundTimer: number;
  /** Gameplay state for a committed ground pound; motion is presentation-only. */
  pounding: boolean;
  /** Set for one step when something notable happened, for effects/audio. */
  events: PlayerEvent[];
};

export type PlayerEvent =
  | "jump" | "wall-jump" | "land" | "skid" | "bounce"
  | "pound-start" | "pound-land" | "hazard";

export function createPlayerBody(x: number, y: number): PlayerBody {
  return {
    x, y, vx: 0, vy: 0,
    facing: 1,
    grounded: false,
    ducking: false,
    motion: "fall",
    groundTile: TILE.EMPTY,
    wallDir: 0,
    coyote: 0,
    buffer: 0,
    jumpHeld: false,
    wallLock: 0,
    poundTimer: 0,
    pounding: false,
    events: [],
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const approach = (value: number, target: number, delta: number) =>
  value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);

function bodyHeight(body: PlayerBody) {
  return body.ducking ? PHYSICS.PLAYER_DUCK_HEIGHT : PHYSICS.PLAYER_HEIGHT;
}

/** True when the box at (x, y) would overlap a blocking tile. */
function overlapsSolid(grid: TileGrid, x: number, y: number, height: number) {
  const hw = PHYSICS.PLAYER_HALF_WIDTH;
  const x0 = Math.floor(x - hw);
  const x1 = Math.floor(x + hw - 1e-6);
  const y0 = Math.floor(y);
  const y1 = Math.floor(y + height - 1e-6);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      if (isSolid(tileAt(grid, tx, ty))) return true;
    }
  }
  return false;
}

/** Slope surface height under a point, or null when there is no slope. */
function slopeHeightAt(grid: TileGrid, x: number, ty: number) {
  const tx = Math.floor(x);
  const id = tileAt(grid, tx, ty);
  if (!isSlope(id)) return null;
  return ty + slopeSurface(id, x - tx);
}

/* ------------------------------------------------------------------ */
/* Step                                                                */
/* ------------------------------------------------------------------ */

/**
 * Advance one fixed step. `dt` must be PHYSICS.STEP for determinism; it is
 * a parameter only so the validator can probe trajectories.
 */
export function stepPlayer(body: PlayerBody, input: PlayerInput, grid: TileGrid, dt: number) {
  body.events.length = 0;

  const wasGrounded = body.grounded;
  const groundId = body.groundTile;
  const onIce = groundId === TILE.ICE;

  /* -- timers -- */
  body.coyote = body.grounded ? PHYSICS.COYOTE_TIME : Math.max(0, body.coyote - dt);
  body.buffer = input.jump && !body.jumpHeld ? PHYSICS.JUMP_BUFFER : Math.max(0, body.buffer - dt);
  body.wallLock = Math.max(0, body.wallLock - dt);
  const jumpPressed = input.jump && !body.jumpHeld;
  body.jumpHeld = input.jump;

  /* -- ground pound: commits, ignores steering, ends on landing -- */
  if (body.pounding && body.poundTimer > 0) {
    body.poundTimer -= dt;
    body.vx = 0;
    body.vy = body.poundTimer > 0 ? 0 : -PHYSICS.POUND_SPEED;
  } else if (input.pound && !body.grounded && !body.pounding) {
    body.poundTimer = PHYSICS.POUND_HANG;
    body.pounding = true;
    body.motion = "pound";
    body.vy = 0;
    body.events.push("pound-start");
  }

  const pounding = body.pounding;

  /* -- ducking (only meaningful on the ground) -- */
  const wantsDuck = input.duck && body.grounded && !pounding;
  if (body.ducking && !wantsDuck) {
    // Only stand up if there is room.
    if (!overlapsSolid(grid, body.x, body.y, PHYSICS.PLAYER_HEIGHT)) body.ducking = false;
  } else if (wantsDuck) {
    body.ducking = true;
  }

  /* -- horizontal -- */
  if (!pounding && body.wallLock <= 0) {
    const target = (input.run ? PHYSICS.RUN_SPEED : PHYSICS.WALK_SPEED) * input.moveX;
    const ducked = body.ducking && body.grounded;

    if (input.moveX !== 0 && !ducked) {
      const reversing = body.vx !== 0 && Math.sign(body.vx) !== Math.sign(input.moveX);
      let accel: number = body.grounded ? PHYSICS.GROUND_ACCEL : PHYSICS.AIR_ACCEL;
      if (onIce && body.grounded) accel = PHYSICS.ICE_ACCEL;
      else if (reversing && body.grounded) accel = PHYSICS.SKID_DECEL;
      body.vx = approach(body.vx, target, accel * dt);
      body.facing = input.moveX > 0 ? 1 : -1;
    } else {
      let friction: number = body.grounded ? PHYSICS.GROUND_FRICTION : PHYSICS.AIR_FRICTION;
      if (onIce && body.grounded) friction = PHYSICS.ICE_FRICTION;
      if (ducked) friction *= 0.6;
      body.vx = approach(body.vx, 0, friction * dt);
    }
  }

  /* -- jumping -- */
  const canWallJump = !body.grounded && body.wallDir !== 0 && !pounding;
  if (body.buffer > 0 && (body.coyote > 0 || canWallJump)) {
    if (body.coyote > 0) {
      const speedRatio = clamp(Math.abs(body.vx) / PHYSICS.RUN_SPEED, 0, 1);
      body.vy = PHYSICS.JUMP_VELOCITY + PHYSICS.JUMP_RUN_BONUS * speedRatio;
      body.events.push("jump");
    } else {
      body.vy = PHYSICS.WALL_JUMP_Y;
      body.vx = -body.wallDir * PHYSICS.WALL_JUMP_X;
      body.facing = body.wallDir === 1 ? -1 : 1;
      body.wallLock = PHYSICS.WALL_JUMP_LOCK;
      body.events.push("wall-jump");
    }
    body.grounded = false;
    body.coyote = 0;
    body.buffer = 0;
    body.ducking = false;
  }

  // Variable height: let go early, rise less.
  if (!input.jump && body.vy > 0 && !jumpPressed) body.vy *= 1 - (1 - PHYSICS.JUMP_CUT) * clamp(dt * 60, 0, 1);

  /* -- gravity, eased through the apex -- */
  if (!pounding) {
    const rising = body.vy > 0;
    const nearApex = Math.abs(body.vy) < PHYSICS.APEX_WINDOW;
    const gravity = nearApex
      ? PHYSICS.GRAVITY_APEX
      : rising
        ? PHYSICS.GRAVITY_RISE
        : PHYSICS.GRAVITY_FALL;
    body.vy -= gravity * dt;

    const wallSliding = body.wallDir !== 0 && body.vy < 0 && input.moveX === body.wallDir;
    const floor = wallSliding ? -PHYSICS.WALL_SLIDE_SPEED : -PHYSICS.TERMINAL_VELOCITY;
    if (body.vy < floor) body.vy = floor;
  }

  /* -- integrate + resolve, X then Y -- */
  const height = bodyHeight(body);
  moveX(body, grid, body.vx * dt, height);
  moveY(body, grid, body.vy * dt, height, wasGrounded);

  /* -- landing -- */
  if (!wasGrounded && body.grounded) {
    if (pounding) {
      body.poundTimer = 0;
      body.pounding = false;
      body.motion = "idle";
      body.events.push("pound-land");
    } else {
      body.events.push("land");
    }
    if (body.groundTile === TILE.BOUNCE) {
      body.vy = PHYSICS.BOUNCE_VELOCITY;
      body.grounded = false;
      body.events.push("bounce");
    }
  }

  updateWallContact(body, grid, height);
  updateMotion(body, input);
  return body;
}

function moveX(body: PlayerBody, grid: TileGrid, dx: number, height: number) {
  if (dx === 0) return;
  const hw = PHYSICS.PLAYER_HALF_WIDTH;
  body.x += dx;

  const dir = dx > 0 ? 1 : -1;
  const edge = body.x + dir * hw;
  const tx = Math.floor(edge);
  const y0 = Math.floor(body.y + 0.05);
  const y1 = Math.floor(body.y + height - 1e-6);

  for (let ty = y0; ty <= y1; ty += 1) {
    if (!isSolid(tileAt(grid, tx, ty))) continue;
    /* Walking into the base of a slope should ride up it, not stop dead. */
    const surface = slopeHeightAt(grid, body.x, ty);
    if (surface !== null && surface - body.y <= 0.6) continue;
    body.x = dir > 0 ? tx - hw - 1e-4 : tx + 1 + hw + 1e-4;
    body.vx = 0;
    return;
  }
}

function moveY(body: PlayerBody, grid: TileGrid, dy: number, height: number, wasGrounded: boolean) {
  const hw = PHYSICS.PLAYER_HALF_WIDTH;
  const previousFeet = body.y;
  body.y += dy;
  body.grounded = false;
  body.groundTile = TILE.EMPTY;

  if (dy > 0) {
    // Head. A clip on the very corner of a block slides past instead of
    // killing the jump — the difference between "tight" and "unfair".
    const headY = Math.floor(body.y + height - 1e-6);
    const leftTx = Math.floor(body.x - hw);
    const rightTx = Math.floor(body.x + hw - 1e-6);
    const leftHit = isSolid(tileAt(grid, leftTx, headY));
    const rightHit = isSolid(tileAt(grid, rightTx, headY));

    if (leftHit !== rightHit) {
      const nudge = leftHit ? (leftTx + 1) - (body.x - hw) : (rightTx) - (body.x + hw);
      if (Math.abs(nudge) <= PHYSICS.CORNER_NUDGE) {
        body.x += nudge + Math.sign(nudge) * 1e-3;
        return;
      }
    }
    if (leftHit || rightHit) {
      body.y = headY - height - 1e-4;
      body.vy = 0;
    }
    return;
  }

  /* Falling. Slopes first: they win over the flat tiles they sit beside. */
  for (const probeX of [body.x, body.x - hw + 0.02, body.x + hw - 0.02]) {
    for (const ty of [Math.floor(body.y), Math.floor(body.y) - 1, Math.floor(previousFeet)]) {
      const surface = slopeHeightAt(grid, probeX, ty);
      if (surface === null) continue;
      if (body.y <= surface + 0.02 && previousFeet >= surface - 0.75) {
        body.y = surface;
        body.vy = 0;
        body.grounded = true;
        body.groundTile = tileAt(grid, Math.floor(probeX), ty);
        return;
      }
    }
  }

  const feetTy = Math.floor(body.y);
  const x0 = Math.floor(body.x - hw);
  const x1 = Math.floor(body.x + hw - 1e-6);
  for (let tx = x0; tx <= x1; tx += 1) {
    const id = tileAt(grid, tx, feetTy);
    if (!isFloor(id) || isSlope(id)) continue;
    const top = feetTy + 1;
    // One-ways only catch you on the way down from above.
    if (id === TILE.ONEWAY && previousFeet < top - 1e-3) continue;
    if (body.y < top && previousFeet >= top - 1e-3) {
      body.y = top;
      body.vy = 0;
      body.grounded = true;
      body.groundTile = id;
      return;
    }
  }

  // Ledge magnet: landing a hair short of an edge still catches it.
  if (!wasGrounded || body.vy > 0) return;
  for (const probeX of [body.x - hw - 0.06, body.x + hw + 0.06]) {
    const id = tileAt(grid, Math.floor(probeX), feetTy);
    if (!isFloor(id) || isSlope(id)) continue;
    const top = feetTy + 1;
    if (body.y < top && body.y > top - 0.12) {
      body.y = top;
      body.vy = 0;
      body.grounded = true;
      body.groundTile = id;
      return;
    }
  }
}

function updateWallContact(body: PlayerBody, grid: TileGrid, height: number) {
  body.wallDir = 0;
  if (body.grounded) return;
  const hw = PHYSICS.PLAYER_HALF_WIDTH;
  const y0 = Math.floor(body.y + 0.15);
  const y1 = Math.floor(body.y + height - 0.1);
  for (const dir of [1, -1] as const) {
    const tx = Math.floor(body.x + dir * (hw + 0.06));
    for (let ty = y0; ty <= y1; ty += 1) {
      if (!isSolid(tileAt(grid, tx, ty))) continue;
      body.wallDir = dir;
      return;
    }
  }
}

function updateMotion(body: PlayerBody, input: PlayerInput) {
  if (body.pounding) {
    body.motion = "pound";
    return;
  }
  if (!body.grounded) {
    if (body.wallDir !== 0 && body.vy < 0 && input.moveX === body.wallDir) body.motion = "wallslide";
    else body.motion = body.vy > 0 ? "jump" : "fall";
    return;
  }
  if (body.ducking) {
    body.motion = "duck";
    return;
  }
  const speed = Math.abs(body.vx);
  if (input.moveX !== 0 && body.vx !== 0 && Math.sign(body.vx) !== Math.sign(input.moveX) && speed > 2) {
    if (body.motion !== "skid") body.events.push("skid");
    body.motion = "skid";
    return;
  }
  if (speed < 0.2) body.motion = "idle";
  else if (speed > PHYSICS.WALK_SPEED + 0.6) body.motion = "run";
  else body.motion = "walk";
}

/** Feet-anchored AABB, for entity overlap tests. */
export function playerAabb(body: PlayerBody) {
  const hw = PHYSICS.PLAYER_HALF_WIDTH;
  const h = bodyHeight(body);
  return { left: body.x - hw, right: body.x + hw, bottom: body.y, top: body.y + h };
}

/** True when the body is standing in, or touching, a hazard tile. */
export function touchingHazard(body: PlayerBody, grid: TileGrid) {
  const box = playerAabb(body);
  const x0 = Math.floor(box.left);
  const x1 = Math.floor(box.right - 1e-6);
  const y0 = Math.floor(box.bottom);
  const y1 = Math.floor(box.top - 1e-6);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      if (tileAt(grid, tx, ty) === TILE.HAZARD) return true;
    }
  }
  return false;
}
