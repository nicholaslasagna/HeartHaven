/**
 * Authoritative design-space map data for Haven Trails.
 *
 * Keep this file free of Phaser so path edits can be checked in a headless
 * test and reused by a future minimap or server-side route validator.
 */

export type TrailPath = { x1: number; y1: number; x2: number; y2: number };
export type TrailPoint = { x: number; y: number };
export type TrailBlockedZone = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rounded-corner radius of the visible scenery footprint. */
  radius: number;
  /** Extra keeper clearance around a prop body, in design-space pixels. */
  clearance?: number;
  label: string;
};
export type TrailLandmark = { id: string; x: number; y: number; label: string; copy: string; artKey: string };
export type TrailPortal = { id: string; x: number; y: number; label: string; href: string; artKey: string };

export const HAVEN_TRAILS_WORLD_WIDTH = 2200;
export const HAVEN_TRAILS_WORLD_HEIGHT = 1240;
export const HAVEN_TRAILS_EDGE_INSET = 96;
/**
 * The road overlay and collision corridor intentionally share one source of
 * truth. Keeping these separate in the past made the keeper look like they
 * were walking beside the painted road, especially while the camera moved.
 */
export const HAVEN_TRAILS_PATH_VISUAL_WIDTH = 144;
export const HAVEN_TRAILS_PATH_WALK_RADIUS = HAVEN_TRAILS_PATH_VISUAL_WIDTH / 2;
export const HAVEN_TRAILS_INTERACTION_ACCESS_RADIUS = 118;

export const havenTrailsPaths: TrailPath[] = [
  { x1: 150, y1: 760, x2: 510, y2: 570 },
  { x1: 510, y1: 570, x2: 910, y2: 650 },
  // Bend below the pond before climbing toward the loft. The old diagonal
  // technically missed the pond centre but its keeper-sized corridor clipped
  // the pond's rounded footprint.
  { x1: 910, y1: 650, x2: 1320, y2: 500 },
  { x1: 1320, y1: 500, x2: 1450, y2: 500 },
  { x1: 1450, y1: 500, x2: 1780, y2: 280 },
  { x1: 910, y1: 650, x2: 1450, y2: 860 },
  { x1: 1450, y1: 860, x2: 1910, y2: 980 },
  { x1: 510, y1: 570, x2: 420, y2: 240 },
  { x1: 510, y1: 570, x2: 760, y2: 160 },
  { x1: 1450, y1: 860, x2: 1320, y2: 1110 },
  { x1: 1780, y1: 280, x2: 1780, y2: 500 },
  // Quiet side paths make the two discovery landmarks reachable without
  // widening the main roads through the pond and thicket footprints.
  { x1: 910, y1: 650, x2: 930, y2: 285 },
  { x1: 510, y1: 570, x2: 560, y2: 930 },
];

export const havenTrailsBlockedZones: TrailBlockedZone[] = [
  { x: 1120, y: 180, width: 330, height: 210, radius: 52, clearance: 28, label: "Moonlit pond" },
  { x: 690, y: 865, width: 300, height: 190, radius: 48, clearance: 24, label: "Rose thicket" },
  { x: 1645, y: 590, width: 300, height: 220, radius: 56, clearance: 30, label: "Firefly grove" },
  { x: 1960, y: 250, width: 190, height: 260, radius: 32, clearance: 20, label: "Old conservatory" },
];

export const havenTrailsLandmarks: TrailLandmark[] = [
  { id: "memory-tree", x: 930, y: 285, label: "Memory tree", copy: "A new leaf is waiting.", artKey: "trails-memory-tree" },
  { id: "firefly-bridge", x: 1450, y: 865, label: "Firefly bridge", copy: "The lights hum when friends are near.", artKey: "trails-firefly-bridge" },
  { id: "moonberry-cart", x: 420, y: 240, label: "Moonberry cart", copy: "A sweet little trail snack.", artKey: "trails-moonberry-cart" },
  { id: "lantern-circle", x: 560, y: 930, label: "Lantern circle", copy: "A cozy place to pause together.", artKey: "trails-lantern-circle" },
];

export const havenTrailsPortals: TrailPortal[] = [
  { id: "room", x: 1780, y: 280, label: "Moonlit Loft", href: "/app/area?zone=room", artKey: "trails-loft" },
  { id: "garden", x: 150, y: 760, label: "Moonberry Garden", href: "/app/area?zone=garden", artKey: "trails-garden" },
  { id: "park", x: 1910, y: 980, label: "Honeyheart Park", href: "/app/area?zone=park", artKey: "trails-park" },
  { id: "games", x: 420, y: 240, label: "Arcade Meadow", href: "/app/games", artKey: "trails-arcade" },
  { id: "studio", x: 760, y: 160, label: "Companion Studio", href: "/app/pet", artKey: "trails-studio" },
  { id: "market", x: 1320, y: 1110, label: "Moonberry Market", href: "/app/shop", artKey: "trails-market" },
  { id: "heart-garden", x: 1780, y: 500, label: "Heart Garden", href: "/app/partner-garden", artKey: "trails-heart-garden" },
  { id: "lantern-hollow", x: 1510, y: 362, label: "Lantern Hollow", href: "/app/lantern-leap", artKey: "trails-firefly-bridge" },
];

export const havenTrailsWorldArt: Record<string, string> = {
  "trails-memory-tree": "/game-assets/generated/world/sakura-tree.png",
  "trails-firefly-bridge": "/game-assets/generated/world/rose-arch.png",
  "trails-moonberry-cart": "/game-assets/generated/world/flower-cart.png",
  "trails-lantern-circle": "/game-assets/generated/world/gazebo.png",
  "trails-loft": "/game-assets/generated/world/conservatory.png",
  "trails-garden": "/game-assets/generated/world/flower-cart.png",
  "trails-park": "/game-assets/generated/world/theater-stage.png",
  "trails-arcade": "/game-assets/generated/world/bowling-shop.png",
  "trails-studio": "/game-assets/generated/world/conservatory.png",
  "trails-market": "/game-assets/generated/world/flower-cart.png",
  "trails-heart-garden": "/game-assets/generated/world/gazebo.png",
};

export function distanceToTrailSegment(x: number, y: number, segment: TrailPath) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - segment.x1, y - segment.y1);
  const t = Math.max(0, Math.min(1, ((x - segment.x1) * dx + (y - segment.y1) * dy) / lengthSquared));
  return Math.hypot(x - (segment.x1 + t * dx), y - (segment.y1 + t * dy));
}

function closestPointOnTrailSegment(x: number, y: number, segment: TrailPath): TrailPoint & { distance: number } {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { x: segment.x1, y: segment.y1, distance: Math.hypot(x - segment.x1, y - segment.y1) };
  }
  const t = Math.max(0, Math.min(1, ((x - segment.x1) * dx + (y - segment.y1) * dy) / lengthSquared));
  const point = { x: segment.x1 + t * dx, y: segment.y1 + t * dy };
  return { ...point, distance: Math.hypot(x - point.x, y - point.y) };
}

function sameTrailPoint(a: TrailPoint, b: TrailPoint) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

function lineIsWalkable(start: TrailPoint, end: TrailPoint) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const samples = Math.max(2, Math.ceil(distance / 24));
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const x = start.x + (end.x - start.x) * t;
    const y = start.y + (end.y - start.y) * t;
    if (!isHavenTrailsWalkable(x, y)) return false;
  }
  return true;
}

/**
 * Find connected waypoints on the painted road network.
 *
 * The Phaser scene uses this for click-to-move, while tests and future map
 * editors can use it to prove that a portal or discovery is reachable. The
 * route never crosses a blocked footprint: it travels only through authored
 * segment endpoints and the same walkable corridor the renderer paints.
 */
export function findHavenTrailsRoute(
  start: TrailPoint,
  target: TrailPoint,
): TrailPoint[] {
  if (lineIsWalkable(start, target)) return [target];

  const nodes: TrailPoint[] = [];
  const nodeIndex = new Map<string, number>();
  const edges: Array<Array<{ to: number; cost: number }>> = [];
  const key = (point: TrailPoint) => `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
  const addNode = (point: TrailPoint) => {
    const existing = nodeIndex.get(key(point));
    if (existing !== undefined) return existing;
    const index = nodes.length;
    nodes.push(point);
    nodeIndex.set(key(point), index);
    edges.push([]);
    return index;
  };
  const connect = (from: number, to: number) => {
    // A graph edge is only valid when the same sampled walkability predicate
    // accepts the complete segment. Without this check, a nearest-point
    // attachment could jump across a blocker even though both endpoints sit
    // on painted road.
    if (!lineIsWalkable(nodes[from], nodes[to])) return false;
    const cost = Math.hypot(nodes[to].x - nodes[from].x, nodes[to].y - nodes[from].y);
    edges[from].push({ to, cost });
    edges[to].push({ to: from, cost });
    return true;
  };

  const segmentNodePairs = havenTrailsPaths.map((segment) => {
    const a = addNode({ x: segment.x1, y: segment.y1 });
    const b = addNode({ x: segment.x2, y: segment.y2 });
    connect(a, b);
    return { segment, a, b };
  });

  const nearestSegment = (point: TrailPoint) => {
    let best: { segment: TrailPath; a: number; b: number; anchor: TrailPoint; distance: number } | null = null;
    for (const entry of segmentNodePairs) {
      const anchor = closestPointOnTrailSegment(point.x, point.y, entry.segment);
      if (!best || anchor.distance < best.distance) {
        best = { ...entry, anchor: { x: anchor.x, y: anchor.y }, distance: anchor.distance };
      }
    }
    return best;
  };

  const startEntry = nearestSegment(start);
  const targetEntry = nearestSegment(target);
  if (!startEntry || !targetEntry) return [];

  const startAnchorPoint = startEntry.anchor;
  const targetAnchorPoint = targetEntry.anchor;
  const startAnchor = addNode(startAnchorPoint);
  const targetAnchor = addNode(targetAnchorPoint);
  connect(startAnchor, startEntry.a);
  connect(startAnchor, startEntry.b);
  connect(targetAnchor, targetEntry.a);
  connect(targetAnchor, targetEntry.b);

  const startIndex = addNode(start);
  const targetIndex = addNode(target);
  connect(startIndex, startAnchor);
  connect(targetIndex, targetAnchor);

  const distances = new Array(nodes.length).fill(Infinity) as number[];
  const previous = new Array(nodes.length).fill(-1) as number[];
  const visited = new Set<number>();
  distances[startIndex] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (visited.has(index)) continue;
      if (current < 0 || distances[index] < distances[current]) current = index;
    }
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === targetIndex) break;
    visited.add(current);
    for (const edge of edges[current]) {
      const nextDistance = distances[current] + edge.cost;
      if (nextDistance >= distances[edge.to]) continue;
      distances[edge.to] = nextDistance;
      previous[edge.to] = current;
    }
  }

  if (!Number.isFinite(distances[targetIndex])) return [];
  const route: TrailPoint[] = [];
  for (let current = targetIndex; current >= 0; current = previous[current]) {
    route.push(nodes[current]);
    if (current === startIndex) break;
  }
  route.reverse();

  // The final interaction zone can sit just off the road. Keep that small
  // approach only when every point remains inside the authored access zone.
  const output = route.slice(1);
  if (!sameTrailPoint(target, targetAnchorPoint) && lineIsWalkable(targetAnchorPoint, target)) {
    output.push(target);
  }
  return output;
}

function pointInsideRoundedRect(
  x: number,
  y: number,
  zone: TrailBlockedZone,
  extraClearance = 0,
) {
  const clearance = Math.max(0, (zone.clearance ?? 0) + extraClearance);
  const radius = Math.min(
    Math.max(0, zone.radius + clearance),
    (zone.width + clearance * 2) / 2,
    (zone.height + clearance * 2) / 2,
  );
  const left = zone.x - clearance;
  const top = zone.y - clearance;
  const width = zone.width + clearance * 2;
  const height = zone.height + clearance * 2;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const qx = Math.abs(x - centerX) - (width / 2 - radius);
  const qy = Math.abs(y - centerY) - (height / 2 - radius);
  const outsideDistance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const insideDistance = Math.min(Math.max(qx, qy), 0);
  return outsideDistance + insideDistance <= 0;
}

export function isInsideTrailBlocker(x: number, y: number) {
  return havenTrailsBlockedZones.some((zone) => pointInsideRoundedRect(x, y, zone));
}

export function isHavenTrailsWalkable(x: number, y: number) {
  if (
    x < HAVEN_TRAILS_EDGE_INSET
    || y < HAVEN_TRAILS_EDGE_INSET
    || x > HAVEN_TRAILS_WORLD_WIDTH - HAVEN_TRAILS_EDGE_INSET
    || y > HAVEN_TRAILS_WORLD_HEIGHT - HAVEN_TRAILS_EDGE_INSET
  ) return false;
  if (isInsideTrailBlocker(x, y)) return false;
  if (havenTrailsPaths.some((path) => distanceToTrailSegment(x, y, path) <= HAVEN_TRAILS_PATH_WALK_RADIUS)) return true;
  return havenTrailsPortals.some((portal) => Math.hypot(x - portal.x, y - portal.y) <= HAVEN_TRAILS_INTERACTION_ACCESS_RADIUS)
    || havenTrailsLandmarks.some((landmark) => Math.hypot(x - landmark.x, y - landmark.y) <= HAVEN_TRAILS_INTERACTION_ACCESS_RADIUS);
}

/** Use this in editor/debug tooling to show the actual blocked footprint. */
export function getTrailBlockedFootprint(zone: TrailBlockedZone, extraClearance = 0) {
  const clearance = Math.max(0, (zone.clearance ?? 0) + extraClearance);
  return {
    x: zone.x - clearance,
    y: zone.y - clearance,
    width: zone.width + clearance * 2,
    height: zone.height + clearance * 2,
    radius: zone.radius + clearance,
  };
}
