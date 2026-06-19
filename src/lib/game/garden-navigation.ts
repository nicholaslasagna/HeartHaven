export type GardenNavigationVariant = "personal" | "partner" | "park";
export type NavigationMapId = "garden" | "park";
export type NavigationPoint = { x: number; y: number };

export type NavigationPolygonZone = {
  id: string;
  kind: "polygon";
  label: string;
  points: NavigationPoint[];
};

export type NavigationEllipseZone = {
  id: string;
  kind: "ellipse";
  label: string;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
};

export type NavigationCapsuleZone = {
  id: string;
  kind: "capsule";
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
};

export type NavigationZone = NavigationPolygonZone | NavigationEllipseZone | NavigationCapsuleZone;

export const GARDEN_NAVIGATION_WORLD_SCALE = 1.25;

const polygon = (id: string, label: string, points: NavigationPoint[]): NavigationPolygonZone => ({
  id,
  kind: "polygon",
  label,
  points,
});

const capsule = (
  id: string,
  label: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
): NavigationCapsuleZone => ({ id, kind: "capsule", label, x1, y1, x2, y2, radius });

/**
 * Coordinates below use the unscaled 3400 x 1133 source-map space. The
 * runtime scales every zone with the same 1.25 factor as the Phaser world.
 * Keep each named zone small and intentional: extending one zone should not
 * silently make a neighbouring flower bed or water bank walkable.
 */
// GARDEN: one continuous ground silhouette prevents random seams between
// paths and lawns. Water and dense border art are subtracted below.
const gardenWalkableClearings: NavigationZone[] = [
  polygon("garden-open-terrain", "Open paths, lawns, and placement ground", [
    { x: 70, y: 820 },
    { x: 80, y: 330 },
    { x: 200, y: 250 },
    { x: 450, y: 130 },
    { x: 720, y: 100 },
    { x: 1050, y: 70 },
    { x: 1350, y: 65 },
    { x: 1650, y: 75 },
    { x: 1900, y: 90 },
    { x: 2150, y: 100 },
    { x: 2450, y: 100 },
    { x: 2750, y: 110 },
    { x: 3050, y: 120 },
    { x: 3320, y: 180 },
    { x: 3340, y: 880 },
    { x: 3220, y: 930 },
    { x: 3000, y: 980 },
    { x: 2700, y: 1010 },
    { x: 2400, y: 1030 },
    { x: 2100, y: 1040 },
    { x: 1850, y: 1060 },
    { x: 1650, y: 1060 },
    { x: 1450, y: 1040 },
    { x: 1200, y: 1030 },
    { x: 900, y: 1020 },
    { x: 650, y: 1000 },
    { x: 400, y: 980 },
    { x: 180, y: 920 },
  ]),
];

// The bridge is intentionally named separately in debug views. It overlaps
// the broad ground silhouette and lines up with the gap between water masks.
const gardenWalkablePaths: NavigationZone[] = [
  capsule("garden-bridge-deck", "Main path - stone bridge", 1730, 640, 2000, 640, 58),
];

// Plot approach areas are already part of open terrain. They remain named so
// future plot layouts can be tuned without changing the world silhouette.
const gardenPlotApproachAreas: NavigationZone[] = [];

const gardenBlockedWater: NavigationZone[] = [
  // x 1770-2300, y 0-615: upper stream. Ends before the visible bridge deck.
  polygon("garden-stream-upper", "Water - upper stream", [
    { x: 2100, y: 0 },
    { x: 2300, y: 0 },
    { x: 2280, y: 120 },
    { x: 2240, y: 180 },
    { x: 2190, y: 250 },
    { x: 2130, y: 330 },
    { x: 2070, y: 400 },
    { x: 2010, y: 480 },
    { x: 1970, y: 560 },
    { x: 1900, y: 615 },
    { x: 1770, y: 615 },
    { x: 1830, y: 550 },
    { x: 1870, y: 470 },
    { x: 1920, y: 390 },
    { x: 1980, y: 310 },
    { x: 2040, y: 230 },
    { x: 2090, y: 140 },
  ]),
  // x 1420-1950, y 700-1133: lower stream. Starts after the bridge deck.
  polygon("garden-stream-lower", "Water - lower stream", [
    { x: 1770, y: 700 },
    { x: 1950, y: 700 },
    { x: 1910, y: 760 },
    { x: 1850, y: 820 },
    { x: 1790, y: 880 },
    { x: 1740, y: 950 },
    { x: 1690, y: 1050 },
    { x: 1660, y: 1133 },
    { x: 1420, y: 1133 },
    { x: 1460, y: 1070 },
    { x: 1510, y: 1000 },
    { x: 1570, y: 920 },
    { x: 1640, y: 850 },
    { x: 1700, y: 780 },
  ]),
];

// Baked trees sit in the outer scenery silhouette; no guessed interior tree
// ellipses remain. This deliberately removes invisible walls from open grass.
const gardenBlockedTrees: NavigationZone[] = [];

const gardenBlockedFoliage: NavigationZone[] = [
  polygon("garden-north-scenery", "Dense foliage and trees - north border", [
    { x: 0, y: 0 },
    { x: 3400, y: 0 },
    { x: 3400, y: 180 },
    { x: 3320, y: 180 },
    { x: 3050, y: 120 },
    { x: 2750, y: 110 },
    { x: 2450, y: 100 },
    { x: 2150, y: 100 },
    { x: 1900, y: 90 },
    { x: 1650, y: 75 },
    { x: 1350, y: 65 },
    { x: 1050, y: 70 },
    { x: 720, y: 100 },
    { x: 450, y: 130 },
    { x: 200, y: 250 },
    { x: 80, y: 330 },
    { x: 0, y: 350 },
  ]),
  polygon("garden-south-scenery", "Dense foliage and trees - south border", [
    { x: 0, y: 900 },
    { x: 180, y: 920 },
    { x: 400, y: 980 },
    { x: 650, y: 1000 },
    { x: 900, y: 1020 },
    { x: 1200, y: 1030 },
    { x: 1450, y: 1040 },
    { x: 1650, y: 1060 },
    { x: 1850, y: 1060 },
    { x: 2100, y: 1040 },
    { x: 2400, y: 1030 },
    { x: 2700, y: 1010 },
    { x: 3000, y: 980 },
    { x: 3220, y: 930 },
    { x: 3400, y: 880 },
    { x: 3400, y: 1133 },
    { x: 0, y: 1133 },
  ]),
];

const gardenBlockedBorders: NavigationZone[] = [];
const gardenBlockedLargeDecor: NavigationZone[] = [];

const gardenWalkableZones = [
  ...gardenWalkableClearings,
  ...gardenWalkablePaths,
  ...gardenPlotApproachAreas,
];
const gardenBlockedZones = [
  ...gardenBlockedWater,
  ...gardenBlockedTrees,
  ...gardenBlockedFoliage,
  ...gardenBlockedBorders,
  ...gardenBlockedLargeDecor,
];

// PARK: paths and grass are one continuous playable silhouette. Water and
// dense edge scenery are the only baked static obstacles in the bare map.
const parkWalkableGrass: NavigationZone[] = [
  polygon("park-open-terrain", "Open paths, grass, and activity pads", [
    { x: 60, y: 880 },
    { x: 60, y: 220 },
    { x: 180, y: 170 },
    { x: 400, y: 130 },
    { x: 650, y: 100 },
    { x: 900, y: 90 },
    { x: 1200, y: 80 },
    { x: 1500, y: 70 },
    { x: 1700, y: 80 },
    { x: 1900, y: 90 },
    { x: 2100, y: 100 },
    { x: 2400, y: 100 },
    { x: 2700, y: 100 },
    { x: 3000, y: 90 },
    { x: 3280, y: 140 },
    { x: 3340, y: 240 },
    { x: 3340, y: 850 },
    { x: 3250, y: 920 },
    { x: 3100, y: 970 },
    { x: 2900, y: 1000 },
    { x: 2650, y: 1020 },
    { x: 2400, y: 1020 },
    { x: 2100, y: 1030 },
    { x: 1800, y: 1040 },
    { x: 1500, y: 1040 },
    { x: 1200, y: 1030 },
    { x: 900, y: 1020 },
    { x: 650, y: 1000 },
    { x: 400, y: 980 },
    { x: 180, y: 950 },
  ]),
];

// Paths are already included in the continuous terrain silhouette. Keeping a
// second approximate capsule here created a misleading debug stripe and made
// tuning feel disconnected from the painted roads.
const parkWalkablePaths: NavigationZone[] = [];

const parkBlockedWater: NavigationZone[] = [
  // x 1700-2630, y 0-450: waterfall and pond, tightened to the visible bank.
  polygon("park-lake", "Water - north pond and waterfall", [
    { x: 1730, y: 0 },
    { x: 2010, y: 0 },
    { x: 2020, y: 80 },
    { x: 2100, y: 130 },
    { x: 2250, y: 135 },
    { x: 2380, y: 125 },
    { x: 2500, y: 150 },
    { x: 2600, y: 220 },
    { x: 2630, y: 330 },
    { x: 2580, y: 400 },
    { x: 2460, y: 450 },
    { x: 2280, y: 445 },
    { x: 2140, y: 410 },
    { x: 1980, y: 390 },
    { x: 1850, y: 360 },
    { x: 1770, y: 300 },
    { x: 1750, y: 220 },
    { x: 1700, y: 180 },
  ]),
  // x 0-1100, y 730-900: west creek before the visible bridge.
  polygon("park-creek-upper", "Water - west creek before bridge", [
    { x: 0, y: 735 },
    { x: 180, y: 730 },
    { x: 350, y: 740 },
    { x: 520, y: 760 },
    { x: 700, y: 780 },
    { x: 860, y: 805 },
    { x: 1010, y: 830 },
    { x: 1100, y: 860 },
    { x: 1070, y: 900 },
    { x: 990, y: 900 },
    { x: 900, y: 870 },
    { x: 760, y: 840 },
    { x: 600, y: 820 },
    { x: 420, y: 805 },
    { x: 220, y: 790 },
    { x: 0, y: 790 },
  ]),
  // x 260-1050, y 920-1133: creek outlet after the bridge.
  polygon("park-creek-lower", "Water - west creek after bridge", [
    { x: 900, y: 930 },
    { x: 1030, y: 930 },
    { x: 960, y: 970 },
    { x: 880, y: 1000 },
    { x: 790, y: 1030 },
    { x: 700, y: 1070 },
    { x: 620, y: 1110 },
    { x: 570, y: 1133 },
    { x: 340, y: 1133 },
    { x: 400, y: 1090 },
    { x: 480, y: 1050 },
    { x: 560, y: 1010 },
    { x: 640, y: 980 },
    { x: 730, y: 950 },
    { x: 820, y: 935 },
  ]),
];

// No guessed interior ellipses: baked park trees, rocks, and dense bushes are
// on the outer silhouette or pond bank. Runtime props use per-item footprints.
const parkBlockedTrees: NavigationZone[] = [];
const parkBlockedBenches: NavigationZone[] = [];
const parkBlockedRocks: NavigationZone[] = [];
const parkBlockedDenseBushes: NavigationZone[] = [];

const parkBlockedBorders: NavigationZone[] = [
  polygon("park-north-scenery", "Dense trees and scenery - north border", [
    { x: 0, y: 0 },
    { x: 3400, y: 0 },
    { x: 3400, y: 240 },
    { x: 3340, y: 240 },
    { x: 3280, y: 140 },
    { x: 3000, y: 90 },
    { x: 2700, y: 100 },
    { x: 2400, y: 100 },
    { x: 2100, y: 100 },
    { x: 1900, y: 90 },
    { x: 1700, y: 80 },
    { x: 1500, y: 70 },
    { x: 1200, y: 80 },
    { x: 900, y: 90 },
    { x: 650, y: 100 },
    { x: 400, y: 130 },
    { x: 180, y: 170 },
    { x: 60, y: 220 },
    { x: 0, y: 220 },
  ]),
  polygon("park-south-scenery", "Dense trees and scenery - south border", [
    { x: 0, y: 900 },
    { x: 180, y: 950 },
    { x: 400, y: 980 },
    { x: 650, y: 1000 },
    { x: 900, y: 1020 },
    { x: 1200, y: 1030 },
    { x: 1500, y: 1040 },
    { x: 1800, y: 1040 },
    { x: 2100, y: 1030 },
    { x: 2400, y: 1020 },
    { x: 2650, y: 1020 },
    { x: 2900, y: 1000 },
    { x: 3100, y: 970 },
    { x: 3250, y: 920 },
    { x: 3400, y: 850 },
    { x: 3400, y: 1133 },
    { x: 0, y: 1133 },
  ]),
];

const parkWalkableZones = [...parkWalkableGrass, ...parkWalkablePaths];
const parkBlockedZones = [
  ...parkBlockedWater,
  ...parkBlockedTrees,
  ...parkBlockedBenches,
  ...parkBlockedRocks,
  ...parkBlockedBorders,
  ...parkBlockedDenseBushes,
];

function scalePoint(point: NavigationPoint): NavigationPoint {
  return {
    x: Math.round(point.x * GARDEN_NAVIGATION_WORLD_SCALE),
    y: Math.round(point.y * GARDEN_NAVIGATION_WORLD_SCALE),
  };
}

function scaleZone(zone: NavigationZone): NavigationZone {
  if (zone.kind === "polygon") return { ...zone, points: zone.points.map(scalePoint) };
  if (zone.kind === "ellipse") {
    return {
      ...zone,
      x: Math.round(zone.x * GARDEN_NAVIGATION_WORLD_SCALE),
      y: Math.round(zone.y * GARDEN_NAVIGATION_WORLD_SCALE),
      radiusX: Math.round(zone.radiusX * GARDEN_NAVIGATION_WORLD_SCALE),
      radiusY: Math.round(zone.radiusY * GARDEN_NAVIGATION_WORLD_SCALE),
    };
  }
  return {
    ...zone,
    x1: Math.round(zone.x1 * GARDEN_NAVIGATION_WORLD_SCALE),
    y1: Math.round(zone.y1 * GARDEN_NAVIGATION_WORLD_SCALE),
    x2: Math.round(zone.x2 * GARDEN_NAVIGATION_WORLD_SCALE),
    y2: Math.round(zone.y2 * GARDEN_NAVIGATION_WORLD_SCALE),
    radius: Math.round(zone.radius * GARDEN_NAVIGATION_WORLD_SCALE),
  };
}

const scaledWalkableZones: Record<NavigationMapId, NavigationZone[]> = {
  garden: gardenWalkableZones.map(scaleZone),
  park: parkWalkableZones.map(scaleZone),
};

const scaledBlockedZones: Record<NavigationMapId, NavigationZone[]> = {
  garden: gardenBlockedZones.map(scaleZone),
  park: parkBlockedZones.map(scaleZone),
};

export function navigationMapIdFromVariant(variant: GardenNavigationVariant): NavigationMapId {
  return variant === "park" ? "park" : "garden";
}

export function getNavigationWalkableZones(mapId: NavigationMapId): NavigationZone[] {
  return scaledWalkableZones[mapId];
}

export function getNavigationBlockedZones(mapId: NavigationMapId): NavigationZone[] {
  return scaledBlockedZones[mapId];
}

export function closestPointOnSegment(
  point: NavigationPoint,
  start: NavigationPoint,
  end: NavigationPoint,
): NavigationPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { ...start };
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return { x: start.x + dx * t, y: start.y + dy * t };
}

export function isPointInPolygon(point: NavigationPoint, points: NavigationPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || Number.EPSILON) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function isPointInNavigationZone(point: NavigationPoint, zone: NavigationZone): boolean {
  if (zone.kind === "polygon") return isPointInPolygon(point, zone.points);
  if (zone.kind === "ellipse") {
    const dx = (point.x - zone.x) / zone.radiusX;
    const dy = (point.y - zone.y) / zone.radiusY;
    return dx * dx + dy * dy <= 1;
  }
  const closest = closestPointOnSegment(point, { x: zone.x1, y: zone.y1 }, { x: zone.x2, y: zone.y2 });
  return Math.hypot(point.x - closest.x, point.y - closest.y) <= zone.radius;
}

function isInsideWalkableShape(mapId: NavigationMapId, point: NavigationPoint): boolean {
  return getNavigationWalkableZones(mapId).some((zone) => isPointInNavigationZone(point, zone));
}

function isInsideBlockedShape(mapId: NavigationMapId, point: NavigationPoint): boolean {
  return getNavigationBlockedZones(mapId).some((zone) => isPointInNavigationZone(point, zone));
}

export function isPointWalkable(mapId: NavigationMapId, x: number, y: number): boolean {
  const point = { x, y };
  return isInsideWalkableShape(mapId, point) && !isInsideBlockedShape(mapId, point);
}

function nearestPointInZone(point: NavigationPoint, zone: NavigationZone): NavigationPoint {
  if (isPointInNavigationZone(point, zone)) return point;
  if (zone.kind === "ellipse") {
    const dx = point.x - zone.x;
    const dy = point.y - zone.y;
    const angle = Math.atan2(dy, dx);
    return {
      x: zone.x + Math.cos(angle) * Math.max(1, zone.radiusX - 2),
      y: zone.y + Math.sin(angle) * Math.max(1, zone.radiusY - 2),
    };
  }
  if (zone.kind === "capsule") {
    const center = closestPointOnSegment(point, { x: zone.x1, y: zone.y1 }, { x: zone.x2, y: zone.y2 });
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: center.x + (dx / length) * Math.max(1, zone.radius - 2),
      y: center.y + (dy / length) * Math.max(1, zone.radius - 2),
    };
  }
  let closest = zone.points[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  zone.points.forEach((start, index) => {
    const end = zone.points[(index + 1) % zone.points.length];
    const candidate = closestPointOnSegment(point, start, end);
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      closest = candidate;
    }
  });
  const center = zone.points.reduce(
    (total, current) => ({ x: total.x + current.x / zone.points.length, y: total.y + current.y / zone.points.length }),
    { x: 0, y: 0 },
  );
  const dx = center.x - closest.x;
  const dy = center.y - closest.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: closest.x + (dx / length) * 2, y: closest.y + (dy / length) * 2 };
}

/**
 * Returns the closest authored ground point. A radial fallback handles
 * overlaps where the closest point on one walkable shape sits inside a tree
 * or water blocker. This is used for spawn/remote recovery, not every frame.
 */
export function getNearestWalkablePoint(
  mapId: NavigationMapId,
  x: number,
  y: number,
  maxDistance = Number.POSITIVE_INFINITY,
): NavigationPoint | null {
  if (isPointWalkable(mapId, x, y)) return { x, y };
  const point = { x, y };
  // Search outward first so a click in water/foliage resolves to the nearby
  // bank instead of a mathematically convenient but distant path shape.
  const radialSearchLimit = Math.min(720, maxDistance);
  for (let radius = 16; radius <= radialSearchLimit; radius += 16) {
    const sampleCount = Math.max(16, Math.ceil((Math.PI * 2 * radius) / 28));
    for (let index = 0; index < sampleCount; index += 1) {
      const angle = (index / sampleCount) * Math.PI * 2;
      const candidate = { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
      if (isPointWalkable(mapId, candidate.x, candidate.y)) return candidate;
    }
  }

  const directCandidates = getNavigationWalkableZones(mapId)
    .map((zone) => nearestPointInZone(point, zone))
    .filter((candidate) => isPointWalkable(mapId, candidate.x, candidate.y))
    .filter((candidate) => Math.hypot(candidate.x - x, candidate.y - y) <= maxDistance)
    .sort(
      (left, right) =>
        Math.hypot(left.x - x, left.y - y) - Math.hypot(right.x - x, right.y - y),
    );
  return directCandidates[0] ?? null;
}

export function clampToWalkable(mapId: NavigationMapId, x: number, y: number): NavigationPoint {
  return getNearestWalkablePoint(mapId, x, y) ?? { x, y };
}
