/**
 * Lantern Leap — level format, parsing and validation.
 *
 * Pure: levels are string art, so they can be read, diffed and reviewed in
 * a text editor, and validated headlessly against the real jump numbers
 * from `physics.ts`. A level that ships an unreachable gap is a bug the
 * validator catches, not something a player discovers.
 *
 * Rows run TOP to BOTTOM, matching how the art reads on screen.
 */

import {
  PHYSICS,
  TILE,
  type TileGrid,
  isFloor,
  isSlope,
  isSolid,
  tileAt,
} from "./physics";

export const LEGEND = {
  " ": TILE.EMPTY,
  ".": TILE.EMPTY,
  "#": TILE.SOLID,
  "=": TILE.ONEWAY,
  "/": TILE.SLOPE_R,
  "\\": TILE.SLOPE_L,
  "^": TILE.HAZARD,
  "~": TILE.ICE,
  "b": TILE.BOUNCE,
} as const;

/** Characters that mark an entity and leave the tile itself empty. */
export const SPAWN_CHARS = {
  o: "coin",
  "*": "gem",
  e: "walker",
  f: "flyer",
  s: "spinner",
  p: "spawn",
  G: "goal",
  L: "lantern",
} as const;

export type SpawnKind = (typeof SPAWN_CHARS)[keyof typeof SPAWN_CHARS];

export type Spawn = {
  kind: SpawnKind;
  /** Tile centre, world units, y-up. */
  x: number;
  y: number;
};

export type Level = {
  id: string;
  name: string;
  /** Drives sky, fog and palette in the renderer. */
  theme: "dusk" | "grove" | "cavern";
  grid: TileGrid;
  spawns: Spawn[];
  start: { x: number; y: number };
  goal: { x: number; y: number };
  /** Seconds before the level times out. */
  parTime: number;
};

export function parseLevel(
  meta: { id: string; name: string; theme: Level["theme"]; parTime: number },
  rows: string[],
): Level {
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  const tiles = new Uint8Array(width * height);
  const spawns: Spawn[] = [];
  let start: { x: number; y: number } | null = null;
  let goal: { x: number; y: number } | null = null;

  for (let row = 0; row < height; row += 1) {
    const line = rows[row].padEnd(width, " ");
    for (let col = 0; col < width; col += 1) {
      const char = line[col];
      const tile = LEGEND[char as keyof typeof LEGEND];
      if (tile !== undefined) {
        tiles[row * width + col] = tile;
        continue;
      }
      const kind = SPAWN_CHARS[char as keyof typeof SPAWN_CHARS];
      if (!kind) throw new Error(`Level ${meta.id}: unknown character "${char}" at row ${row}, col ${col}`);
      // Entity chars sit on empty tiles.
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

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type LevelIssue = { level: string; problem: string };

/** A tile you can stand on: open space with floor underneath, or a slope. */
function isStandable(grid: TileGrid, x: number, y: number) {
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return false;
  const here = tileAt(grid, x, y);
  if (isSolid(here)) return false;
  if (isSlope(here)) return true;
  return isFloor(tileAt(grid, x, y - 1));
}

/**
 * Where can the player actually get to?
 *
 * Not a flood fill — a flood fill spreads through empty air, so it happily
 * "chains jumps" across a pit of any width and declares every level fine.
 * Instead this launches real trajectories from every foothold, integrating
 * the same gravity the game uses, and records what they land on and pass
 * through. A gap is crossable only if some arc actually crosses it.
 *
 * Returns `landed` (footholds, for the search) and `touched` (every tile any
 * arc flies through, which is how a coin gets collected).
 */
export function reachableFrom(level: Level) {
  const { grid } = level;
  const key = (x: number, y: number) => y * grid.width + x;
  const landed = new Set<number>();
  const touched = new Set<number>();

  const maxV = PHYSICS.JUMP_VELOCITY + PHYSICS.JUMP_RUN_BONUS;
  // Straight down, a nudge, a half jump, and everything up to a full run
  // jump — enough spread to find any route a player would.
  const launches = [0, maxV * 0.4, maxV * 0.7, maxV];
  const speeds = [PHYSICS.WALK_SPEED, PHYSICS.RUN_SPEED];
  const dt = 1 / 120;

  // Drop the spawn onto whatever is under it.
  const startX = Math.floor(level.start.x);
  let startY = Math.floor(level.start.y);
  while (startY > 0 && !isStandable(grid, startX, startY)) startY -= 1;

  const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
  landed.add(key(startX, startY));
  touched.add(key(startX, startY));

  while (queue.length > 0) {
    const node = queue.pop()!;
    for (const dir of [-1, 1]) {
      for (const speed of speeds) {
        for (const v0 of launches) {
          let x = node.x + 0.5;
          let y = node.y + 0.05;
          let vy = v0;
          for (let step = 0; step < 400; step += 1) {
            vy -= (vy > 0 ? PHYSICS.GRAVITY_RISE : PHYSICS.GRAVITY_FALL) * dt;
            if (vy < -PHYSICS.TERMINAL_VELOCITY) vy = -PHYSICS.TERMINAL_VELOCITY;
            x += dir * speed * dt;
            y += vy * dt;

            const tx = Math.floor(x);
            const ty = Math.floor(y);
            if (tx < 0 || tx >= grid.width || ty < 0) break;
            if (ty >= grid.height) continue;
            // Ran into geometry — this arc is done.
            if (isSolid(tileAt(grid, tx, ty))) break;

            touched.add(key(tx, ty));
            // Coins sit at tile centres, so credit the head height too.
            if (ty + 1 < grid.height && !isSolid(tileAt(grid, tx, ty + 1))) touched.add(key(tx, ty + 1));

            if (vy < 0 && isStandable(grid, tx, ty)) {
              const id = key(tx, ty);
              if (!landed.has(id)) {
                landed.add(id);
                queue.push({ x: tx, y: ty });
              }
              break;
            }
          }
        }
      }
    }
  }
  return { landed, touched, key };
}

export function validateLevel(level: Level): LevelIssue[] {
  const issues: LevelIssue[] = [];
  const { grid } = level;
  const { landed, touched, key } = reachableFrom(level);

  const goalX = Math.floor(level.goal.x);
  const goalY = Math.floor(level.goal.y);
  // The goal flag floats above its platform, so accept a foothold beneath it.
  let goalReached = touched.has(key(goalX, goalY));
  for (let dy = 0; dy <= 2 && !goalReached; dy += 1) {
    if (landed.has(key(goalX, goalY - dy))) goalReached = true;
  }
  if (!goalReached) {
    issues.push({ level: level.id, problem: "the goal cannot be reached from the spawn" });
  }

  for (const spawn of level.spawns) {
    if (spawn.kind !== "coin" && spawn.kind !== "gem") continue;
    const tx = Math.floor(spawn.x);
    const ty = Math.floor(spawn.y);
    if (!touched.has(key(tx, ty))) {
      issues.push({ level: level.id, problem: `a ${spawn.kind} at (${tx}, ${ty}) cannot be reached` });
    }
  }

  // The spawn must not be inside geometry, and must have ground beneath it.
  if (isSolid(tileAt(grid, Math.floor(level.start.x), Math.floor(level.start.y)))) {
    issues.push({ level: level.id, problem: "the player spawn is inside a solid tile" });
  }

  // A level with no floor under the spawn column is an instant death.
  let hasFloorBelowSpawn = false;
  for (let y = Math.floor(level.start.y) - 1; y >= 0; y -= 1) {
    if (isFloor(tileAt(grid, Math.floor(level.start.x), y))) { hasFloorBelowSpawn = true; break; }
  }
  if (!hasFloorBelowSpawn) issues.push({ level: level.id, problem: "nothing to land on below the spawn" });

  return issues;
}
