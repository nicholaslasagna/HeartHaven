/**
 * Lantern Leap — enemy behaviour.
 *
 * Pure and deterministic, same contract as physics.ts: no three.js, no
 * randomness, no clock. Every client runs these and reaches the same state,
 * so only kills ever need to travel over the wire.
 */

import { isFloor, isSolid, tileAt, type TileGrid } from "./physics";

export type EnemyKind = "walker" | "flyer" | "spinner";

export type Enemy = {
  id: number;
  kind: EnemyKind | string;
  x: number;
  y: number;
  /** Spawn point: patrols and orbits are anchored to it. */
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  /** Seconds alive, so drifting enemies advance without reading a clock. */
  phase: number;
  facing: 1 | -1;
  dead: boolean;
  deadTimer: number;
};

const WALKER_SPEED = 2.2;
const WALKER_GRAVITY = 46;
const WALKER_TERMINAL = 22;
const FLYER_RANGE = 3.4;
const FLYER_SPEED = 1.5;
const SPINNER_RADIUS = 2.2;
const SPINNER_SPEED = 1.6;
const HALF_WIDTH = 0.36;

/** Starting phase offset from the spawn position — stable across clients. */
function spawnPhase(enemy: Enemy) {
  return enemy.homeX * 0.7 + enemy.homeY * 1.3;
}

export function updateEnemy(enemy: Enemy, grid: TileGrid, dt: number) {
  if (enemy.dead) {
    enemy.deadTimer += dt;
    return;
  }
  enemy.phase += dt;

  switch (enemy.kind) {
    case "walker": updateWalker(enemy, grid, dt); break;
    case "flyer": updateFlyer(enemy); break;
    case "spinner": updateSpinner(enemy); break;
    default: break;
  }
}

function updateWalker(enemy: Enemy, grid: TileGrid, dt: number) {
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

  // Turn at a wall, and at a ledge rather than walking off it.
  const wall = isSolid(tileAt(grid, Math.floor(aheadX), Math.floor(enemy.y + 0.4)));
  const groundAhead = isFloor(tileAt(grid, Math.floor(aheadX), Math.floor(enemy.y) - 1));
  if (wall || !groundAhead) {
    enemy.facing = enemy.facing === 1 ? -1 : 1;
    return;
  }
  enemy.x = nextX;
}

/** Lazy figure-eight around the spawn: readable, and it never leaves its lane. */
function updateFlyer(enemy: Enemy) {
  const t = enemy.phase * FLYER_SPEED + spawnPhase(enemy);
  enemy.x = enemy.homeX + Math.sin(t) * FLYER_RANGE;
  enemy.y = enemy.homeY + Math.sin(t * 2) * 0.85;
  enemy.facing = Math.cos(t) >= 0 ? 1 : -1;
}

/** Slow elliptical orbit — a moving hazard you time rather than fight. */
function updateSpinner(enemy: Enemy) {
  const t = enemy.phase * SPINNER_SPEED + spawnPhase(enemy);
  enemy.x = enemy.homeX + Math.cos(t) * SPINNER_RADIUS;
  enemy.y = enemy.homeY + Math.sin(t) * SPINNER_RADIUS * 0.55;
  enemy.facing = Math.sin(t) >= 0 ? 1 : -1;
}

export function createEnemy(id: number, kind: string, x: number, y: number): Enemy {
  return {
    id, kind, x, y,
    homeX: x, homeY: y,
    vx: kind === "walker" ? -WALKER_SPEED : 0,
    vy: 0,
    phase: 0,
    facing: -1,
    dead: false,
    deadTimer: 0,
  };
}
