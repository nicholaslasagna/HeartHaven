export type GardenNavigationVariant = "personal" | "partner" | "park";

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

export type NavigationBlockedZone =
  | NavigationPolygonZone
  | NavigationEllipseZone
  | NavigationCapsuleZone;

export const GARDEN_NAVIGATION_WORLD_SCALE = 1.25;

function scalePoint(point: NavigationPoint): NavigationPoint {
  return {
    x: Math.round(point.x * GARDEN_NAVIGATION_WORLD_SCALE),
    y: Math.round(point.y * GARDEN_NAVIGATION_WORLD_SCALE),
  };
}

function scaleZone(zone: NavigationBlockedZone): NavigationBlockedZone {
  if (zone.kind === "polygon") {
    return { ...zone, points: zone.points.map(scalePoint) };
  }
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

const gardenBlockedZones: NavigationBlockedZone[] = [
  {
    id: "garden-stream-upper",
    kind: "polygon",
    label: "Upper stream",
    points: [
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
    ],
  },
  {
    id: "garden-stream-lower",
    kind: "polygon",
    label: "Lower stream",
    points: [
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
    ],
  },
  { id: "garden-tree-northwest-a", kind: "ellipse", label: "Northwest tree", x: 350, y: 165, radiusX: 78, radiusY: 48 },
  { id: "garden-tree-northwest-b", kind: "ellipse", label: "Northwest tree", x: 505, y: 172, radiusX: 72, radiusY: 44 },
  { id: "garden-tree-north-a", kind: "ellipse", label: "North tree", x: 1270, y: 115, radiusX: 74, radiusY: 46 },
  { id: "garden-tree-north-b", kind: "ellipse", label: "North tree", x: 1490, y: 105, radiusX: 74, radiusY: 46 },
  { id: "garden-tree-northeast-a", kind: "ellipse", label: "Northeast tree", x: 2820, y: 125, radiusX: 80, radiusY: 48 },
  { id: "garden-tree-northeast-b", kind: "ellipse", label: "Northeast tree", x: 3040, y: 140, radiusX: 84, radiusY: 52 },
  { id: "garden-tree-west", kind: "ellipse", label: "West tree", x: 120, y: 650, radiusX: 76, radiusY: 48 },
  { id: "garden-tree-southwest-a", kind: "ellipse", label: "Southwest tree", x: 330, y: 965, radiusX: 82, radiusY: 52 },
  { id: "garden-tree-southwest-b", kind: "ellipse", label: "Southwest tree", x: 720, y: 1050, radiusX: 90, radiusY: 54 },
  { id: "garden-tree-southeast-a", kind: "ellipse", label: "Southeast tree", x: 2820, y: 1055, radiusX: 88, radiusY: 52 },
  { id: "garden-tree-southeast-b", kind: "ellipse", label: "Southeast tree", x: 3090, y: 1010, radiusX: 94, radiusY: 58 },
  { id: "garden-north-border", kind: "capsule", label: "North foliage border", x1: 80, y1: 38, x2: 3320, y2: 38, radius: 42 },
  { id: "garden-south-border", kind: "capsule", label: "South foliage border", x1: 80, y1: 1100, x2: 3320, y2: 1100, radius: 46 },
];

const parkBlockedZones: NavigationBlockedZone[] = [
  {
    id: "park-lake",
    kind: "polygon",
    label: "Park lake",
    points: [
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
    ],
  },
  {
    id: "park-creek-upper",
    kind: "polygon",
    label: "Park creek",
    points: [
      { x: 570, y: 700 },
      { x: 745, y: 700 },
      { x: 710, y: 770 },
      { x: 650, y: 835 },
      { x: 565, y: 880 },
      { x: 450, y: 875 },
      { x: 505, y: 810 },
    ],
  },
  {
    id: "park-creek-lower",
    kind: "polygon",
    label: "Park creek",
    points: [
      { x: 400, y: 915 },
      { x: 585, y: 920 },
      { x: 535, y: 1000 },
      { x: 470, y: 1080 },
      { x: 430, y: 1133 },
      { x: 115, y: 1133 },
      { x: 210, y: 1060 },
      { x: 300, y: 995 },
    ],
  },
  { id: "park-tree-northwest-a", kind: "ellipse", label: "Northwest tree", x: 125, y: 185, radiusX: 78, radiusY: 48 },
  { id: "park-tree-northwest-b", kind: "ellipse", label: "Northwest tree", x: 395, y: 118, radiusX: 86, radiusY: 52 },
  { id: "park-tree-north-a", kind: "ellipse", label: "North tree", x: 920, y: 100, radiusX: 88, radiusY: 54 },
  { id: "park-tree-north-b", kind: "ellipse", label: "North tree", x: 1240, y: 84, radiusX: 78, radiusY: 48 },
  { id: "park-tree-northeast-a", kind: "ellipse", label: "Northeast tree", x: 2710, y: 100, radiusX: 84, radiusY: 52 },
  { id: "park-tree-northeast-b", kind: "ellipse", label: "Northeast tree", x: 3090, y: 205, radiusX: 92, radiusY: 56 },
  { id: "park-tree-west", kind: "ellipse", label: "West tree", x: 105, y: 610, radiusX: 82, radiusY: 50 },
  { id: "park-tree-east", kind: "ellipse", label: "East tree", x: 3270, y: 610, radiusX: 84, radiusY: 52 },
  { id: "park-tree-southeast-a", kind: "ellipse", label: "Southeast tree", x: 2780, y: 1050, radiusX: 94, radiusY: 58 },
  { id: "park-tree-southeast-b", kind: "ellipse", label: "Southeast tree", x: 3100, y: 1030, radiusX: 94, radiusY: 58 },
  { id: "park-north-border", kind: "capsule", label: "North foliage border", x1: 80, y1: 38, x2: 3320, y2: 38, radius: 42 },
  { id: "park-south-border", kind: "capsule", label: "South foliage border", x1: 80, y1: 1100, x2: 3320, y2: 1100, radius: 46 },
];

const scaledGardenZones = gardenBlockedZones.map(scaleZone);
const scaledParkZones = parkBlockedZones.map(scaleZone);

export function getNavigationBlockedZones(variant: GardenNavigationVariant): NavigationBlockedZone[] {
  return variant === "park" ? scaledParkZones : scaledGardenZones;
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

export function isPointBlocked(point: NavigationPoint, zone: NavigationBlockedZone): boolean {
  if (zone.kind === "polygon") return isPointInPolygon(point, zone.points);
  if (zone.kind === "ellipse") {
    const dx = (point.x - zone.x) / zone.radiusX;
    const dy = (point.y - zone.y) / zone.radiusY;
    return dx * dx + dy * dy < 1;
  }
  const closest = closestPointOnSegment(point, { x: zone.x1, y: zone.y1 }, { x: zone.x2, y: zone.y2 });
  return Math.hypot(point.x - closest.x, point.y - closest.y) < zone.radius;
}

export function projectPointOutsideZone(
  point: NavigationPoint,
  zone: NavigationBlockedZone,
  padding = 6,
): NavigationPoint {
  if (!isPointBlocked(point, zone)) return point;

  if (zone.kind === "ellipse") {
    let dx = point.x - zone.x;
    const dy = point.y - zone.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.001) dx = 1;
    const scale = 1 / Math.sqrt((dx * dx) / (zone.radiusX * zone.radiusX) + (dy * dy) / (zone.radiusY * zone.radiusY));
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: zone.x + dx * scale + (dx / length) * padding,
      y: zone.y + dy * scale + (dy / length) * padding,
    };
  }

  if (zone.kind === "capsule") {
    const closest = closestPointOnSegment(point, { x: zone.x1, y: zone.y1 }, { x: zone.x2, y: zone.y2 });
    let dx = point.x - closest.x;
    let dy = point.y - closest.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.001) {
      dx = -(zone.y2 - zone.y1);
      dy = zone.x2 - zone.x1;
    }
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: closest.x + (dx / length) * (zone.radius + padding),
      y: closest.y + (dy / length) * (zone.radius + padding),
    };
  }

  let closest = point;
  let closestDistance = Number.POSITIVE_INFINITY;
  zone.points.forEach((start, index) => {
    const end = zone.points[(index + 1) % zone.points.length];
    const candidate = closestPointOnSegment(point, start, end);
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = candidate;
    }
  });
  const center = zone.points.reduce(
    (total, current) => ({ x: total.x + current.x / zone.points.length, y: total.y + current.y / zone.points.length }),
    { x: 0, y: 0 },
  );
  const dx = closest.x - center.x;
  let dy = closest.y - center.y;
  if (Math.abs(dx) + Math.abs(dy) < 0.001) dy = 1;
  const length = Math.hypot(dx, dy) || 1;
  return { x: closest.x + (dx / length) * padding, y: closest.y + (dy / length) * padding };
}

export function resolveStaticNavigationPoint(
  point: NavigationPoint,
  variant: GardenNavigationVariant,
): NavigationPoint {
  let resolved = { ...point };
  const zones = getNavigationBlockedZones(variant);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = { ...resolved };
    zones.forEach((zone) => {
      resolved = projectPointOutsideZone(resolved, zone);
    });
    if (Math.hypot(resolved.x - before.x, resolved.y - before.y) < 0.25) break;
  }
  return resolved;
}

export function isStaticNavigationPointValid(
  point: NavigationPoint,
  variant: GardenNavigationVariant,
): boolean {
  return !getNavigationBlockedZones(variant).some((zone) => isPointBlocked(point, zone));
}
