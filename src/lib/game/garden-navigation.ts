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

const ellipse = (
  id: string,
  label: string,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
): NavigationEllipseZone => ({ id, kind: "ellipse", label, x, y, radiusX, radiusY });

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
const gardenWalkableZones: NavigationZone[] = [
  // Main path: left entrance, center bridge approach, and east garden road.
  capsule("garden-main-path-a", "Main path - west entrance", 90, 700, 500, 575, 82),
  capsule("garden-main-path-b", "Main path - west bend", 500, 575, 920, 470, 82),
  capsule("garden-main-path-c", "Main path - central approach", 920, 470, 1510, 590, 84),
  capsule("garden-main-path-d", "Main path - bridge approach", 1510, 590, 1815, 625, 78),
  capsule("garden-main-path-e", "Main path - bridge crossing", 1780, 625, 2025, 625, 54),
  capsule("garden-main-path-f", "Main path - east bend", 2000, 625, 2480, 565, 84),
  capsule("garden-main-path-g", "Main path - east exit", 2480, 565, 3290, 650, 88),

  // Upper garden road and plot approach lanes.
  capsule("garden-upper-path-a", "Upper path - west plots", 390, 390, 1080, 355, 78),
  capsule("garden-upper-path-b", "Upper path - central plots", 1080, 355, 1750, 430, 78),
  capsule("garden-upper-path-c", "Upper path - east plots", 2050, 430, 2820, 365, 80),
  capsule("garden-west-approach", "Plot approach lane - west", 430, 345, 430, 930, 72),
  capsule("garden-center-approach", "Plot approach lane - center", 1020, 340, 1020, 930, 74),
  capsule("garden-east-approach", "Plot approach lane - east", 2380, 350, 2380, 950, 76),
  capsule("garden-far-east-approach", "Plot approach lane - far east", 2950, 320, 2950, 930, 76),
  capsule("garden-lower-path-west", "Lower path - west", 620, 805, 1510, 810, 86),
  capsule("garden-lower-path-east", "Lower path - east", 1940, 810, 3040, 810, 86),

  // Open ground intentionally available around paths and placement pads.
  ellipse("garden-west-round-plaza", "West round plaza", 820, 185, 330, 145),
  polygon("garden-west-court", "West placement court", [
    { x: 95, y: 300 },
    { x: 720, y: 260 },
    { x: 835, y: 485 },
    { x: 510, y: 610 },
    { x: 90, y: 530 },
  ]),
  ellipse("garden-west-lower-pad", "West lower clearing", 250, 720, 235, 125),
  ellipse("garden-southwest-soil", "Southwest garden beds", 720, 955, 365, 150),
  polygon("garden-central-upper-lawn", "Central upper lawn", [
    { x: 1030, y: 105 },
    { x: 1850, y: 90 },
    { x: 1880, y: 470 },
    { x: 1650, y: 585 },
    { x: 1120, y: 520 },
    { x: 920, y: 320 },
  ]),
  polygon("garden-central-lower-lawn", "Central lower clearing", [
    { x: 520, y: 585 },
    { x: 1680, y: 575 },
    { x: 1690, y: 980 },
    { x: 900, y: 1045 },
    { x: 420, y: 825 },
  ]),
  polygon("garden-east-upper-lawn", "East upper clearing", [
    { x: 2240, y: 85 },
    { x: 3280, y: 80 },
    { x: 3270, y: 355 },
    { x: 2460, y: 430 },
    { x: 2130, y: 330 },
  ]),
  polygon("garden-east-middle-lawn", "East middle clearing", [
    { x: 2070, y: 380 },
    { x: 3260, y: 340 },
    { x: 3260, y: 750 },
    { x: 2110, y: 750 },
  ]),
  polygon("garden-east-lower-lawn", "East lower clearing", [
    { x: 1950, y: 700 },
    { x: 3260, y: 670 },
    { x: 3260, y: 1035 },
    { x: 1900, y: 1035 },
  ]),
];

const gardenBlockedZones: NavigationZone[] = [
  // The stream is split at the visible bridge so the bridge remains usable.
  polygon("garden-stream-upper", "Pond/water block - upper stream", [
    { x: 2100, y: 0 },
    { x: 2350, y: 0 },
    { x: 2310, y: 105 },
    { x: 2260, y: 190 },
    { x: 2190, y: 270 },
    { x: 2130, y: 350 },
    { x: 2070, y: 425 },
    { x: 2020, y: 505 },
    { x: 1980, y: 585 },
    { x: 1815, y: 585 },
    { x: 1850, y: 500 },
    { x: 1890, y: 420 },
    { x: 1950, y: 340 },
    { x: 2010, y: 255 },
    { x: 2060, y: 155 },
  ]),
  polygon("garden-stream-lower", "Pond/water block - lower stream", [
    { x: 1785, y: 675 },
    { x: 1970, y: 675 },
    { x: 1925, y: 760 },
    { x: 1860, y: 835 },
    { x: 1785, y: 910 },
    { x: 1730, y: 995 },
    { x: 1690, y: 1133 },
    { x: 1400, y: 1133 },
    { x: 1470, y: 1010 },
    { x: 1535, y: 925 },
    { x: 1610, y: 850 },
    { x: 1690, y: 770 },
  ]),

  // Tree trunks and dense tree clusters inside otherwise walkable lawns.
  ellipse("garden-tree-northwest-a", "Tree cluster block - northwest", 350, 165, 78, 48),
  ellipse("garden-tree-northwest-b", "Tree cluster block - northwest", 505, 172, 72, 44),
  ellipse("garden-tree-north-a", "Tree cluster block - north", 1270, 115, 74, 46),
  ellipse("garden-tree-north-b", "Tree cluster block - north", 1490, 105, 74, 46),
  ellipse("garden-tree-northeast-a", "Tree cluster block - northeast", 2820, 125, 80, 48),
  ellipse("garden-tree-northeast-b", "Tree cluster block - northeast", 3040, 140, 84, 52),
  ellipse("garden-tree-west", "Tree cluster block - west", 120, 650, 76, 48),
  ellipse("garden-tree-southwest-a", "Tree cluster block - southwest", 330, 965, 82, 52),
  ellipse("garden-tree-southwest-b", "Tree cluster block - southwest", 720, 1050, 90, 54),
  ellipse("garden-tree-southeast-a", "Tree cluster block - southeast", 2820, 1055, 88, 52),
  ellipse("garden-tree-southeast-b", "Tree cluster block - southeast", 3090, 1010, 94, 58),

  // Background foliage is excluded even where it overlaps a broad clearing.
  capsule("garden-north-border", "Map border block - north foliage", 80, 38, 3320, 38, 42),
  capsule("garden-south-border", "Map border block - south foliage", 80, 1100, 3320, 1100, 46),
];

const parkWalkableZones: NavigationZone[] = [
  // Main park walkway and the branches leading to every activity clearing.
  capsule("park-main-path-a", "Main walkway - west", 70, 650, 420, 645, 92),
  capsule("park-main-path-b", "Main walkway - west bend", 420, 645, 760, 515, 88),
  capsule("park-main-path-c", "Main walkway - central west", 760, 515, 1320, 385, 86),
  capsule("park-main-path-d", "Main walkway - central", 1320, 385, 1660, 520, 86),
  capsule("park-main-path-e", "Main walkway - pond approach", 1660, 520, 2060, 420, 88),
  capsule("park-main-path-f", "Main walkway - east", 2060, 420, 2620, 600, 92),
  capsule("park-main-path-g", "Main walkway - far east", 2620, 600, 3290, 515, 92),
  capsule("park-lower-walkway", "Lower walkway", 680, 755, 3000, 755, 92),
  capsule("park-upper-west-walkway", "Upper walkway - west", 400, 290, 1220, 220, 88),
  capsule("park-upper-center-walkway", "Upper walkway - center", 1250, 245, 1910, 250, 90),
  capsule("park-upper-east-walkway", "Upper walkway - east", 2490, 250, 3230, 300, 88),
  capsule("park-west-approach", "Activity approach - west", 540, 220, 540, 910, 76),
  capsule("park-center-approach", "Activity approach - center", 1120, 210, 1120, 910, 76),
  capsule("park-pond-approach", "Activity approach - pond", 1510, 440, 1510, 930, 78),
  capsule("park-east-approach", "Activity approach - east", 2730, 250, 2730, 930, 78),

  // Open lawns and paved pads where keepers are meant to gather.
  ellipse("park-west-round-pad", "West round plaza", 760, 210, 330, 150),
  ellipse("park-west-small-pad", "West small plaza", 220, 600, 230, 125),
  polygon("park-west-lawn", "Grass clearing - west", [
    { x: 100, y: 200 },
    { x: 820, y: 160 },
    { x: 930, y: 610 },
    { x: 660, y: 790 },
    { x: 170, y: 760 },
  ]),
  polygon("park-center-lawn", "Grass clearing - center", [
    { x: 760, y: 250 },
    { x: 1540, y: 190 },
    { x: 1650, y: 850 },
    { x: 930, y: 930 },
    { x: 700, y: 650 },
  ]),
  ellipse("park-center-upper-pad", "Center upper plaza", 1350, 135, 300, 125),
  ellipse("park-center-small-pad", "Center activity pad", 1120, 380, 180, 110),
  polygon("park-east-upper-lawn", "Grass clearing - east upper", [
    { x: 2520, y: 160 },
    { x: 3290, y: 150 },
    { x: 3280, y: 620 },
    { x: 2470, y: 580 },
  ]),
  polygon("park-east-lower-lawn", "Grass clearing - east lower", [
    { x: 1770, y: 470 },
    { x: 3200, y: 430 },
    { x: 3220, y: 1015 },
    { x: 1710, y: 1025 },
  ]),
  ellipse("park-east-upper-pad", "East upper plaza", 2860, 210, 320, 145),
  ellipse("park-east-middle-pad", "East middle plaza", 2320, 470, 240, 135),
  ellipse("park-east-lower-pad", "East lower plaza", 2520, 855, 320, 150),
  ellipse("park-far-east-lower-pad", "Far east lower plaza", 3110, 790, 250, 135),
];

const parkBlockedZones: NavigationZone[] = [
  // Pond and creek polygons follow the visible banks; gaps preserve bridges.
  polygon("park-lake", "Pond/water block - lake", [
    { x: 1570, y: 0 },
    { x: 1780, y: 0 },
    { x: 1805, y: 70 },
    { x: 1890, y: 118 },
    { x: 2020, y: 135 },
    { x: 2140, y: 100 },
    { x: 2260, y: 85 },
    { x: 2410, y: 120 },
    { x: 2520, y: 205 },
    { x: 2570, y: 310 },
    { x: 2530, y: 400 },
    { x: 2410, y: 455 },
    { x: 2260, y: 445 },
    { x: 2120, y: 405 },
    { x: 1980, y: 395 },
    { x: 1850, y: 420 },
    { x: 1730, y: 385 },
    { x: 1640, y: 315 },
    { x: 1590, y: 225 },
    { x: 1560, y: 120 },
  ]),
  polygon("park-creek-upper", "Pond/water block - upper creek", [
    { x: 570, y: 700 },
    { x: 745, y: 700 },
    { x: 710, y: 770 },
    { x: 650, y: 835 },
    { x: 565, y: 880 },
    { x: 450, y: 875 },
    { x: 505, y: 810 },
  ]),
  polygon("park-creek-lower", "Pond/water block - lower creek", [
    { x: 400, y: 915 },
    { x: 585, y: 920 },
    { x: 535, y: 1000 },
    { x: 470, y: 1080 },
    { x: 430, y: 1133 },
    { x: 115, y: 1133 },
    { x: 210, y: 1060 },
    { x: 300, y: 995 },
  ]),

  // Tree and rock clearances prevent keepers disappearing into scenery.
  ellipse("park-tree-northwest-a", "Tree cluster block - northwest", 125, 185, 78, 48),
  ellipse("park-tree-northwest-b", "Tree cluster block - northwest", 395, 118, 86, 52),
  ellipse("park-tree-north-a", "Tree cluster block - north", 920, 100, 88, 54),
  ellipse("park-tree-north-b", "Tree cluster block - north", 1240, 84, 78, 48),
  ellipse("park-tree-northeast-a", "Tree cluster block - northeast", 2710, 100, 84, 52),
  ellipse("park-tree-northeast-b", "Tree cluster block - northeast", 3090, 205, 92, 56),
  ellipse("park-tree-west", "Tree cluster block - west", 105, 610, 82, 50),
  ellipse("park-tree-east", "Tree cluster block - east", 3270, 610, 84, 52),
  ellipse("park-tree-southeast-a", "Tree cluster block - southeast", 2780, 1050, 94, 58),
  ellipse("park-tree-southeast-b", "Tree cluster block - southeast", 3100, 1030, 94, 58),
  ellipse("park-rock-island-center", "Rock and foliage block - center", 1510, 360, 105, 55),
  ellipse("park-rock-island-east", "Rock and foliage block - east", 2590, 430, 110, 58),

  capsule("park-north-border", "Map border block - north foliage", 80, 38, 3320, 38, 42),
  capsule("park-south-border", "Map border block - south foliage", 80, 1100, 3320, 1100, 46),
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
): NavigationPoint | null {
  if (isPointWalkable(mapId, x, y)) return { x, y };
  const point = { x, y };
  // Search outward first so a click in water/foliage resolves to the nearby
  // bank instead of a mathematically convenient but distant path shape.
  for (let radius = 16; radius <= 720; radius += 16) {
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
    .sort(
      (left, right) =>
        Math.hypot(left.x - x, left.y - y) - Math.hypot(right.x - x, right.y - y),
    );
  return directCandidates[0] ?? null;
}

export function clampToWalkable(mapId: NavigationMapId, x: number, y: number): NavigationPoint {
  return getNearestWalkablePoint(mapId, x, y) ?? { x, y };
}
