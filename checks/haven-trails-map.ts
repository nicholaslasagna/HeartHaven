import {
  HAVEN_TRAILS_EDGE_INSET,
  HAVEN_TRAILS_PATH_VISUAL_WIDTH,
  HAVEN_TRAILS_PATH_WALK_RADIUS,
  HAVEN_TRAILS_WORLD_HEIGHT,
  HAVEN_TRAILS_WORLD_WIDTH,
  havenTrailsLandmarks,
  havenTrailsPaths,
  havenTrailsPortals,
  findHavenTrailsRoute,
  isHavenTrailsWalkable,
  isInsideTrailBlocker,
} from "../src/lib/game/haven-trails-map";
import { getDailyTrailDiscoveries, getTrailDiscoveryDayKey } from "../src/lib/game/trail-discoveries";

function assertRouteIsWalkable(start: { x: number; y: number }, route: Array<{ x: number; y: number }>, label: string) {
  let previous = start;
  for (const point of route) {
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const samples = Math.max(2, Math.ceil(distance / 24));
    for (let sample = 0; sample <= samples; sample += 1) {
      const t = sample / samples;
      const x = previous.x + (point.x - previous.x) * t;
      const y = previous.y + (point.y - previous.y) * t;
      if (!isHavenTrailsWalkable(x, y)) {
        throw new Error(`Route crosses a blocked point for ${label} at ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
    previous = point;
  }
}

if (HAVEN_TRAILS_PATH_VISUAL_WIDTH / 2 !== HAVEN_TRAILS_PATH_WALK_RADIUS) {
  throw new Error("Painted trail width and walkable trail radius have diverged");
}

// Sample the centerline and both edges of every keeper-sized corridor. A
// centerline-only check misses the exact bug this map had: the line cleared a
// prop, but the visible/walkable road still overlapped its footprint.
for (const [index, path] of havenTrailsPaths.entries()) {
  const dx = path.x2 - path.x1;
  const dy = path.y2 - path.y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new Error(`Degenerate trail segment at index ${index}`);
  const normalX = -dy / length;
  const normalY = dx / length;
  for (let sample = 0; sample <= 40; sample += 1) {
    const t = sample / 40;
    const x = path.x1 + dx * t;
    const y = path.y1 + dy * t;
    for (const offset of [-HAVEN_TRAILS_PATH_WALK_RADIUS, 0, HAVEN_TRAILS_PATH_WALK_RADIUS]) {
      if (isInsideTrailBlocker(x + normalX * offset, y + normalY * offset)) {
        throw new Error(`Trail corridor overlaps a blocker at segment ${index}, sample ${sample}`);
      }
    }
  }
}

for (const portal of havenTrailsPortals) {
  if (isInsideTrailBlocker(portal.x, portal.y) || !isHavenTrailsWalkable(portal.x, portal.y)) {
    throw new Error(`Unreachable portal: ${portal.id}`);
  }
  const route = findHavenTrailsRoute({ x: 510, y: 570 }, portal);
  if (route.length === 0) {
    throw new Error(`No connected route to portal: ${portal.id}`);
  }
  assertRouteIsWalkable({ x: 510, y: 570 }, route, `portal ${portal.id}`);
}

for (const landmark of havenTrailsLandmarks) {
  if (isInsideTrailBlocker(landmark.x, landmark.y) || !isHavenTrailsWalkable(landmark.x, landmark.y)) {
    throw new Error(`Unreachable landmark: ${landmark.id}`);
  }
  const route = findHavenTrailsRoute({ x: 510, y: 570 }, landmark);
  if (route.length === 0) {
    throw new Error(`No connected route to landmark: ${landmark.id}`);
  }
  assertRouteIsWalkable({ x: 510, y: 570 }, route, `landmark ${landmark.id}`);
}

for (const [x, y] of [
  [HAVEN_TRAILS_EDGE_INSET - 1, HAVEN_TRAILS_WORLD_HEIGHT / 2],
  [HAVEN_TRAILS_WORLD_WIDTH - HAVEN_TRAILS_EDGE_INSET + 1, HAVEN_TRAILS_WORLD_HEIGHT / 2],
  [HAVEN_TRAILS_WORLD_WIDTH / 2, HAVEN_TRAILS_EDGE_INSET - 1],
  [HAVEN_TRAILS_WORLD_WIDTH / 2, HAVEN_TRAILS_WORLD_HEIGHT - HAVEN_TRAILS_EDGE_INSET + 1],
] as const) {
  if (isHavenTrailsWalkable(x, y)) throw new Error(`Walkable map escaped edge inset at ${x},${y}`);
}

const discoveries = getDailyTrailDiscoveries(getTrailDiscoveryDayKey());
for (const discovery of discoveries) {
  if (isInsideTrailBlocker(discovery.x, discovery.y) || !isHavenTrailsWalkable(discovery.x, discovery.y)) {
    throw new Error(`Unreachable daily discovery: ${discovery.id}`);
  }
}

console.log(`Haven Trails map OK (${havenTrailsPortals.length} portals, ${havenTrailsLandmarks.length} landmarks, ${discoveries.length} daily discoveries)`);
