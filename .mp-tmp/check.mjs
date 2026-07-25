// .mp-tmp/check.ts
import assert from "node:assert/strict";

// src/lib/game/lantern-leap/physics.ts
var TILE = {
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
  BOUNCE: 7
};
function tileAt(grid, tx, ty) {
  if (tx < 0 || tx >= grid.width) return TILE.EMPTY;
  if (ty >= grid.height) return TILE.EMPTY;
  if (ty < 0) return TILE.EMPTY;
  const row = grid.height - 1 - ty;
  return grid.tiles[row * grid.width + tx];
}
var isSolid = (id) => id === TILE.SOLID || id === TILE.ICE || id === TILE.BOUNCE;
var isSlope = (id) => id === TILE.SLOPE_R || id === TILE.SLOPE_L;
var isFloor = (id) => isSolid(id) || isSlope(id) || id === TILE.ONEWAY;
function slopeSurface(id, localX) {
  const t = localX < 0 ? 0 : localX > 1 ? 1 : localX;
  if (id === TILE.SLOPE_R) return t;
  if (id === TILE.SLOPE_L) return 1 - t;
  return 0;
}
var PHYSICS = {
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
  PLAYER_DUCK_HEIGHT: 0.78
};
var MAX_JUMP_HEIGHT = PHYSICS.JUMP_VELOCITY * PHYSICS.JUMP_VELOCITY / (2 * PHYSICS.GRAVITY_RISE);
var MAX_RUN_JUMP_HEIGHT = (PHYSICS.JUMP_VELOCITY + PHYSICS.JUMP_RUN_BONUS) ** 2 / (2 * PHYSICS.GRAVITY_RISE);
var MAX_JUMP_DISTANCE = (() => {
  const v = PHYSICS.JUMP_VELOCITY + PHYSICS.JUMP_RUN_BONUS;
  const up = v / PHYSICS.GRAVITY_RISE;
  const height = v * v / (2 * PHYSICS.GRAVITY_RISE);
  const down = Math.sqrt(2 * height / PHYSICS.GRAVITY_FALL);
  return PHYSICS.RUN_SPEED * (up + down);
})();
var NO_INPUT = { moveX: 0, jump: false, run: false, duck: false, pound: false };
function createPlayerBody(x, y) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
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
    events: []
  };
}
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
var approach = (value, target, delta) => value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);
function bodyHeight(body) {
  return body.ducking ? PHYSICS.PLAYER_DUCK_HEIGHT : PHYSICS.PLAYER_HEIGHT;
}
function overlapsSolid(grid, x, y, height) {
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
function slopeHeightAt(grid, x, ty) {
  const tx = Math.floor(x);
  const id = tileAt(grid, tx, ty);
  if (!isSlope(id)) return null;
  return ty + slopeSurface(id, x - tx);
}
function stepPlayer(body, input, grid, dt) {
  body.events.length = 0;
  const wasGrounded = body.grounded;
  const groundId = body.groundTile;
  const onIce = groundId === TILE.ICE;
  body.coyote = body.grounded ? PHYSICS.COYOTE_TIME : Math.max(0, body.coyote - dt);
  body.buffer = input.jump && !body.jumpHeld ? PHYSICS.JUMP_BUFFER : Math.max(0, body.buffer - dt);
  body.wallLock = Math.max(0, body.wallLock - dt);
  const jumpPressed = input.jump && !body.jumpHeld;
  body.jumpHeld = input.jump;
  if (body.poundTimer > 0) {
    body.poundTimer -= dt;
    body.vx = 0;
    body.vy = body.poundTimer > PHYSICS.POUND_HANG - 1e-4 ? 0 : -PHYSICS.POUND_SPEED;
  } else if (input.pound && !body.grounded && body.motion !== "pound") {
    body.poundTimer = PHYSICS.POUND_HANG + 10;
    body.motion = "pound";
    body.vy = 0;
    body.events.push("pound-start");
  }
  const pounding = body.motion === "pound";
  const wantsDuck = input.duck && body.grounded && !pounding;
  if (body.ducking && !wantsDuck) {
    if (!overlapsSolid(grid, body.x, body.y, PHYSICS.PLAYER_HEIGHT)) body.ducking = false;
  } else if (wantsDuck) {
    body.ducking = true;
  }
  if (!pounding && body.wallLock <= 0) {
    const target = (input.run ? PHYSICS.RUN_SPEED : PHYSICS.WALK_SPEED) * input.moveX;
    const ducked = body.ducking && body.grounded;
    if (input.moveX !== 0 && !ducked) {
      const reversing = body.vx !== 0 && Math.sign(body.vx) !== Math.sign(input.moveX);
      let accel = body.grounded ? PHYSICS.GROUND_ACCEL : PHYSICS.AIR_ACCEL;
      if (onIce && body.grounded) accel = PHYSICS.ICE_ACCEL;
      else if (reversing && body.grounded) accel = PHYSICS.SKID_DECEL;
      body.vx = approach(body.vx, target, accel * dt);
      body.facing = input.moveX > 0 ? 1 : -1;
    } else {
      let friction = body.grounded ? PHYSICS.GROUND_FRICTION : PHYSICS.AIR_FRICTION;
      if (onIce && body.grounded) friction = PHYSICS.ICE_FRICTION;
      if (ducked) friction *= 0.6;
      body.vx = approach(body.vx, 0, friction * dt);
    }
  }
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
  if (!input.jump && body.vy > 0 && !jumpPressed) body.vy *= 1 - (1 - PHYSICS.JUMP_CUT) * clamp(dt * 60, 0, 1);
  if (!pounding) {
    const rising = body.vy > 0;
    const nearApex = Math.abs(body.vy) < PHYSICS.APEX_WINDOW;
    const gravity = nearApex ? PHYSICS.GRAVITY_APEX : rising ? PHYSICS.GRAVITY_RISE : PHYSICS.GRAVITY_FALL;
    body.vy -= gravity * dt;
    const wallSliding = body.wallDir !== 0 && body.vy < 0 && input.moveX === body.wallDir;
    const floor = wallSliding ? -PHYSICS.WALL_SLIDE_SPEED : -PHYSICS.TERMINAL_VELOCITY;
    if (body.vy < floor) body.vy = floor;
  }
  const height = bodyHeight(body);
  moveX(body, grid, body.vx * dt, height);
  moveY(body, grid, body.vy * dt, height, wasGrounded);
  if (!wasGrounded && body.grounded) {
    if (pounding) {
      body.poundTimer = 0;
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
function moveX(body, grid, dx, height) {
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
    const surface = slopeHeightAt(grid, body.x, ty);
    if (surface !== null && surface - body.y <= 0.6) continue;
    body.x = dir > 0 ? tx - hw - 1e-4 : tx + 1 + hw + 1e-4;
    body.vx = 0;
    return;
  }
}
function moveY(body, grid, dy, height, wasGrounded) {
  const hw = PHYSICS.PLAYER_HALF_WIDTH;
  const previousFeet = body.y;
  body.y += dy;
  body.grounded = false;
  body.groundTile = TILE.EMPTY;
  if (dy > 0) {
    const headY = Math.floor(body.y + height - 1e-6);
    const leftTx = Math.floor(body.x - hw);
    const rightTx = Math.floor(body.x + hw - 1e-6);
    const leftHit = isSolid(tileAt(grid, leftTx, headY));
    const rightHit = isSolid(tileAt(grid, rightTx, headY));
    if (leftHit !== rightHit) {
      const nudge = leftHit ? leftTx + 1 - (body.x - hw) : rightTx - (body.x + hw);
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
    if (id === TILE.ONEWAY && previousFeet < top - 1e-3) continue;
    if (body.y < top && previousFeet >= top - 1e-3) {
      body.y = top;
      body.vy = 0;
      body.grounded = true;
      body.groundTile = id;
      return;
    }
  }
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
function updateWallContact(body, grid, height) {
  body.wallDir = 0;
  if (body.grounded) return;
  const hw = PHYSICS.PLAYER_HALF_WIDTH;
  const y0 = Math.floor(body.y + 0.15);
  const y1 = Math.floor(body.y + height - 0.1);
  for (const dir of [1, -1]) {
    const tx = Math.floor(body.x + dir * (hw + 0.06));
    for (let ty = y0; ty <= y1; ty += 1) {
      if (!isSolid(tileAt(grid, tx, ty))) continue;
      body.wallDir = dir;
      return;
    }
  }
}
function updateMotion(body, input) {
  if (body.motion === "pound") return;
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
function playerAabb(body) {
  const hw = PHYSICS.PLAYER_HALF_WIDTH;
  const h = bodyHeight(body);
  return { left: body.x - hw, right: body.x + hw, bottom: body.y, top: body.y + h };
}
function touchingHazard(body, grid) {
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

// src/lib/game/lantern-leap/entities.ts
var WALKER_SPEED = 2.2;
var WALKER_GRAVITY = 46;
var WALKER_TERMINAL = 22;
var FLYER_RANGE = 3.4;
var FLYER_SPEED = 1.5;
var SPINNER_RADIUS = 2.2;
var SPINNER_SPEED = 1.6;
var HALF_WIDTH = 0.36;
function spawnPhase(enemy) {
  return enemy.homeX * 0.7 + enemy.homeY * 1.3;
}
function updateEnemy(enemy, grid, dt) {
  if (enemy.dead) {
    enemy.deadTimer += dt;
    return;
  }
  enemy.phase += dt;
  switch (enemy.kind) {
    case "walker":
      updateWalker(enemy, grid, dt);
      break;
    case "flyer":
      updateFlyer(enemy);
      break;
    case "spinner":
      updateSpinner(enemy);
      break;
    default:
      break;
  }
}
function updateWalker(enemy, grid, dt) {
  enemy.vy = Math.max(-WALKER_TERMINAL, enemy.vy - WALKER_GRAVITY * dt);
  enemy.y += enemy.vy * dt;
  const feetTy = Math.floor(enemy.y);
  for (const probe of [enemy.x - HALF_WIDTH, enemy.x + HALF_WIDTH]) {
    if (!isFloor(tileAt(grid, Math.floor(probe), feetTy))) continue;
    const top = feetTy + 1;
    if (enemy.y < top && enemy.y > top - 0.9) {
      enemy.y = top;
      enemy.vy = 0;
      break;
    }
  }
  enemy.vx = WALKER_SPEED * enemy.facing;
  const nextX = enemy.x + enemy.vx * dt;
  const aheadX = nextX + enemy.facing * HALF_WIDTH;
  const wall = isSolid(tileAt(grid, Math.floor(aheadX), Math.floor(enemy.y + 0.4)));
  const groundAhead = isFloor(tileAt(grid, Math.floor(aheadX), Math.floor(enemy.y) - 1));
  if (wall || !groundAhead) {
    enemy.facing = enemy.facing === 1 ? -1 : 1;
    return;
  }
  enemy.x = nextX;
}
function updateFlyer(enemy) {
  const t = enemy.phase * FLYER_SPEED + spawnPhase(enemy);
  enemy.x = enemy.homeX + Math.sin(t) * FLYER_RANGE;
  enemy.y = enemy.homeY + Math.sin(t * 2) * 0.85;
  enemy.facing = Math.cos(t) >= 0 ? 1 : -1;
}
function updateSpinner(enemy) {
  const t = enemy.phase * SPINNER_SPEED + spawnPhase(enemy);
  enemy.x = enemy.homeX + Math.cos(t) * SPINNER_RADIUS;
  enemy.y = enemy.homeY + Math.sin(t) * SPINNER_RADIUS * 0.55;
  enemy.facing = Math.sin(t) >= 0 ? 1 : -1;
}
function createEnemy(id, kind, x, y) {
  return {
    id,
    kind,
    x,
    y,
    homeX: x,
    homeY: y,
    vx: kind === "walker" ? -WALKER_SPEED : 0,
    vy: 0,
    phase: 0,
    facing: -1,
    dead: false,
    deadTimer: 0
  };
}

// src/lib/game/lantern-leap/game.ts
var DEATH_MARGIN = 4;
var BUBBLE_MIN = 1.2;
var FREE_RADIUS = 1.4;
var LanternGame = class {
  constructor(level2) {
    this.level = level2;
    this.players = /* @__PURE__ */ new Map();
    this.pickups = [];
    this.enemies = [];
    this.events = [];
    this.time = 0;
    this.completed = false;
    this.accumulator = 0;
    let id = 0;
    for (const spawn of level2.spawns) {
      if (spawn.kind === "coin" || spawn.kind === "gem") {
        this.pickups.push({ id: id++, kind: spawn.kind, x: spawn.x, y: spawn.y, taken: false });
      } else if (spawn.kind === "lantern") {
        this.pickups.push({ id: id++, kind: "lantern", x: spawn.x, y: spawn.y, taken: false });
      } else if (spawn.kind === "walker" || spawn.kind === "flyer" || spawn.kind === "spinner") {
        this.enemies.push(createEnemy(this.enemies.length, spawn.kind, spawn.x, spawn.y));
      }
    }
  }
  addPlayer(id, name, seat, local) {
    const existing = this.players.get(id);
    if (existing) return existing;
    const player = {
      id,
      name,
      seat,
      local,
      body: createPlayerBody(this.level.start.x + seat * 0.7, this.level.start.y + 0.2),
      input: { ...NO_INPUT },
      squash: 1,
      bubbled: false,
      bubbleTimer: 0,
      coins: 0,
      finished: false,
      respawn: { ...this.level.start }
    };
    this.players.set(id, player);
    return player;
  }
  removePlayer(id) {
    this.players.delete(id);
  }
  setInput(id, input) {
    const player = this.players.get(id);
    if (player) player.input = input;
  }
  /** Advance by real elapsed seconds, in fixed steps. */
  advance(dt) {
    this.accumulator += Math.min(dt, 0.25);
    let steps = 0;
    while (this.accumulator >= PHYSICS.STEP && steps < 30) {
      this.accumulator -= PHYSICS.STEP;
      this.step(PHYSICS.STEP);
      steps += 1;
    }
  }
  step(dt) {
    this.time += dt;
    for (const enemy of this.enemies) updateEnemy(enemy, this.level.grid, dt);
    const rally = this.rallyPoint();
    for (const player of this.players.values()) {
      if (player.finished) continue;
      if (player.bubbled) {
        player.bubbleTimer += dt;
        const targetX = rally?.x ?? player.respawn.x;
        const targetY = (rally?.y ?? player.respawn.y) + 1.7;
        player.body.x += (targetX - player.body.x) * Math.min(1, dt * 1.4);
        player.body.y += (targetY - player.body.y) * Math.min(1, dt * 1.4);
        player.body.vx = 0;
        player.body.vy = 0;
        continue;
      }
      stepPlayer(player.body, player.input, this.level.grid, dt);
      for (const event of player.body.events) {
        this.events.push({ type: "player", playerId: player.id, kind: event });
        if (event === "land" || event === "pound-land") player.squash = 0.72;
        if (event === "jump" || event === "wall-jump") player.squash = 1.24;
      }
      player.squash += (1 - player.squash) * Math.min(1, dt * 14);
      this.resolveEnemies(player);
      this.resolvePickups(player);
      if (player.local && (touchingHazard(player.body, this.level.grid) || player.body.y < -DEATH_MARGIN)) {
        this.bubble(player);
      }
      const goal = this.level.goal;
      if (Math.abs(player.body.x - goal.x) < 1.1 && Math.abs(player.body.y - goal.y) < 2.2) {
        player.finished = true;
        this.events.push({ type: "finish", playerId: player.id, ms: Math.round(this.time * 1e3) });
        if ([...this.players.values()].every((entry) => entry.finished || entry.bubbled)) {
          this.completed = true;
        }
      }
    }
    this.resolveBubbleRescues();
  }
  resolveEnemies(player) {
    const body = player.body;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = Math.abs(body.x - enemy.x);
      const dy = body.y - enemy.y;
      if (dx > 0.72 || dy > 1.2 || dy < -0.85) continue;
      if (body.vy < 0 && dy > 0.15) {
        enemy.dead = true;
        enemy.deadTimer = 0;
        body.vy = PHYSICS.JUMP_VELOCITY * (player.input.jump ? 0.95 : 0.72);
        player.squash = 1.3;
        this.events.push({ type: "stomp", playerId: player.id, enemyId: enemy.id });
      } else if (player.local) {
        this.bubble(player);
      }
      return;
    }
  }
  resolvePickups(player) {
    const body = player.body;
    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      if (Math.abs(body.x - pickup.x) > 0.75) continue;
      if (Math.abs(body.y + 0.7 - pickup.y) > 0.95) continue;
      if (pickup.kind === "lantern") {
        pickup.taken = true;
        player.respawn = { x: pickup.x, y: pickup.y };
        this.events.push({ type: "checkpoint", playerId: player.id, x: pickup.x, y: pickup.y });
        continue;
      }
      pickup.taken = true;
      player.coins += pickup.kind === "gem" ? 10 : 1;
      this.events.push({
        type: pickup.kind === "gem" ? "gem" : "coin",
        playerId: player.id,
        pickupId: pickup.id
      });
    }
  }
  bubble(player) {
    if (player.bubbled) return;
    player.bubbled = true;
    player.bubbleTimer = 0;
    player.body.vx = 0;
    player.body.vy = 0;
    this.events.push({ type: "bubble", playerId: player.id });
  }
  /** Touch a floating teammate to pop them back into the level. */
  resolveBubbleRescues() {
    const alive = [...this.players.values()].filter((p) => !p.bubbled && !p.finished);
    for (const player of this.players.values()) {
      if (!player.bubbled || player.bubbleTimer < BUBBLE_MIN) continue;
      const soloTimeout = this.players.size === 1 && player.bubbleTimer > 2;
      const rescuer = alive.find(
        (other) => Math.abs(other.body.x - player.body.x) < FREE_RADIUS && Math.abs(other.body.y - player.body.y) < FREE_RADIUS + 0.6
      );
      if (!rescuer && !soloTimeout) continue;
      player.bubbled = false;
      player.bubbleTimer = 0;
      if (rescuer) {
        player.body.y += 0.3;
        player.body.vy = 6;
      } else {
        player.body.x = player.respawn.x;
        player.body.y = player.respawn.y + 0.2;
        player.body.vy = 0;
      }
      player.body.vx = 0;
      this.events.push({ type: "free", playerId: player.id });
    }
  }
  /** Camera framing that keeps every active player on screen. */
  cameraFor(aspect, viewHeight) {
    const everyone = [...this.players.values()];
    const active = everyone.some((p) => !p.bubbled) ? everyone.filter((p) => !p.bubbled) : everyone;
    if (active.length === 0) return { x: 0, y: 0, zoom: 1 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const player of active) {
      minX = Math.min(minX, player.body.x);
      maxX = Math.max(maxX, player.body.x);
      minY = Math.min(minY, player.body.y);
      maxY = Math.max(maxY, player.body.y);
    }
    const spanX = maxX - minX + 10;
    const spanY = maxY - minY + 7;
    const zoom = Math.min(1, Math.min(viewHeight * aspect / spanX, viewHeight / spanY));
    const halfHeight = viewHeight / 2 / zoom;
    const halfWidth = halfHeight * aspect;
    const level2 = this.level.grid;
    return {
      x: clamp2((minX + maxX) / 2, halfWidth, Math.max(halfWidth, level2.width - halfWidth)),
      y: clamp2((minY + maxY) / 2 + 1, halfHeight - 1.5, Math.max(halfHeight - 1.5, level2.height - halfHeight)),
      zoom
    };
  }
  /** Centre of the players still in the level, for bubbles to drift to. */
  rallyPoint() {
    let sumX = 0, sumY = 0, count = 0;
    for (const player of this.players.values()) {
      if (player.bubbled || player.finished) continue;
      sumX += player.body.x;
      sumY += player.body.y;
      count += 1;
    }
    return count === 0 ? null : { x: sumX / count, y: sumY / count };
  }
  drainEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }
};
var clamp2 = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// src/lib/game/lantern-leap/level.ts
var LEGEND = {
  " ": TILE.EMPTY,
  ".": TILE.EMPTY,
  "#": TILE.SOLID,
  "=": TILE.ONEWAY,
  "/": TILE.SLOPE_R,
  "\\": TILE.SLOPE_L,
  "^": TILE.HAZARD,
  "~": TILE.ICE,
  "b": TILE.BOUNCE
};
var SPAWN_CHARS = {
  o: "coin",
  "*": "gem",
  e: "walker",
  f: "flyer",
  s: "spinner",
  p: "spawn",
  G: "goal",
  L: "lantern"
};
function parseLevel(meta, rows) {
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  const tiles = new Uint8Array(width * height);
  const spawns = [];
  let start = null;
  let goal = null;
  for (let row = 0; row < height; row += 1) {
    const line = rows[row].padEnd(width, " ");
    for (let col = 0; col < width; col += 1) {
      const char = line[col];
      const tile = LEGEND[char];
      if (tile !== void 0) {
        tiles[row * width + col] = tile;
        continue;
      }
      const kind = SPAWN_CHARS[char];
      if (!kind) throw new Error(`Level ${meta.id}: unknown character "${char}" at row ${row}, col ${col}`);
      tiles[row * width + col] = TILE.EMPTY;
      const x = col + 0.5;
      const y = height - 1 - row;
      if (kind === "spawn") start = { x, y };
      else if (kind === "goal") goal = { x, y };
      else spawns.push({ kind, x, y: y + 0.5 });
    }
  }
  if (!start) throw new Error(`Level ${meta.id}: no player spawn ("p")`);
  if (!goal) throw new Error(`Level ${meta.id}: no goal ("G")`);
  return { ...meta, grid: { width, height, tiles }, spawns, start, goal };
}

// .mp-tmp/check.ts
var level = parseLevel({ id: "mp", name: "MP", theme: "dusk", parTime: 99 }, [
  "                                        ",
  "  p     o                            G  ",
  "  ###########   #######################  ",
  "  ###########   #######################  "
]);
var run = (g, seconds) => {
  for (let i = 0; i < seconds * 60; i += 1) g.advance(1 / 60);
};
{
  const g = new LanternGame(level);
  for (let i = 0; i < 8; i += 1) g.addPlayer(`p${i}`, `P${i}`, i, i === 0);
  assert.equal(g.players.size, 8);
  run(g, 1);
  for (const p of g.players.values()) assert.ok(Number.isFinite(p.body.x) && Number.isFinite(p.body.y), "no NaN");
  const tight = g.cameraFor(16 / 9, 15);
  [...g.players.values()].forEach((p, i) => {
    p.body.x = 4 + i * 4;
  });
  const wide = g.cameraFor(16 / 9, 15);
  assert.ok(wide.zoom < tight.zoom, `camera must zoom out for a spread group (${wide.zoom} < ${tight.zoom})`);
  assert.ok(wide.zoom > 0.1, "but not collapse");
}
{
  const g = new LanternGame(level);
  const a = g.addPlayer("a", "A", 0, true);
  const b = g.addPlayer("b", "B", 1, true);
  run(g, 0.5);
  b.body.x = 30;
  b.body.y = 2;
  a.body.x = 13;
  a.body.y = -10;
  run(g, 0.2);
  assert.ok(a.bubbled, "falling into the pit must bubble");
  const startDist = Math.abs(a.body.x - b.body.x);
  run(g, 1);
  const endDist = Math.abs(a.body.x - b.body.x);
  assert.ok(endDist < startDist, `bubble must drift toward the group (${startDist.toFixed(1)} -> ${endDist.toFixed(1)})`);
  assert.ok(a.body.x > 10, `and not back to the spawn checkpoint (x=${a.body.x.toFixed(1)})`);
}
{
  const g = new LanternGame(level);
  const a = g.addPlayer("a", "A", 0, true);
  const b = g.addPlayer("b", "B", 1, true);
  run(g, 0.5);
  b.body.x = 25;
  b.body.y = 2;
  a.body.x = 13;
  a.body.y = -10;
  run(g, 0.2);
  assert.ok(a.bubbled);
  run(g, 3);
  assert.ok(!a.bubbled, "a teammate in range must free the bubble");
  assert.ok(Math.abs(a.body.x - b.body.x) < 6, `freed next to the rescuer, not at spawn (a=${a.body.x.toFixed(1)} b=${b.body.x.toFixed(1)})`);
  assert.ok(a.body.x > 15, "definitely not teleported back to the start");
}
{
  const g = new LanternGame(level);
  const a = g.addPlayer("a", "A", 0, true);
  run(g, 0.5);
  a.body.x = 13;
  a.body.y = -10;
  run(g, 0.2);
  assert.ok(a.bubbled, "solo player bubbles");
  run(g, 4);
  assert.ok(!a.bubbled, "a lone keeper must self-free rather than deadlock");
  assert.ok(Math.abs(a.body.x - level.start.x) < 2, `solo respawn returns to the checkpoint (x=${a.body.x.toFixed(1)})`);
}
{
  const g = new LanternGame(level);
  const local = g.addPlayer("me", "Me", 0, true);
  const remote = g.addPlayer("them", "Them", 1, false);
  run(g, 0.5);
  local.body.x = 13;
  local.body.y = -10;
  remote.body.x = 13;
  remote.body.y = -10;
  run(g, 0.3);
  assert.ok(local.bubbled, "local player bubbles from the pit");
  assert.ok(!remote.bubbled, "remote player must NOT be bubbled by our simulation");
}
{
  const g = new LanternGame(level);
  g.addPlayer("a", "A", 0, true);
  const b = g.addPlayer("b", "B", 1, false);
  run(g, 0.5);
  const coin = g.pickups.find((p) => p.kind === "coin");
  assert.ok(!coin.taken);
  b.body.x = coin.x;
  b.body.y = coin.y - 0.7;
  run(g, 0.1);
  assert.ok(coin.taken, "a remote player's pickup must resolve locally too");
}
console.log("lantern-leap multiplayer OK");
