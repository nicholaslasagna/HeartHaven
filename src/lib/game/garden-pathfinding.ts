import type { NavigationPoint } from "@/lib/game/garden-navigation";

export type NavigationBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type GridPoint = NavigationPoint & { column: number; row: number };

const DEFAULT_CELL_SIZE = 44;
const DEFAULT_MAX_VISITED = 12000;

function gridKey(column: number, row: number) {
  return `${column}:${row}`;
}

function octileDistance(left: GridPoint, right: GridPoint) {
  const dx = Math.abs(left.column - right.column);
  const dy = Math.abs(left.row - right.row);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function toGridPoint(
  column: number,
  row: number,
  bounds: NavigationBounds,
  cellSize: number,
): GridPoint {
  return {
    column,
    row,
    x: Math.min(bounds.maxX, bounds.minX + column * cellSize),
    y: Math.min(bounds.maxY, bounds.minY + row * cellSize),
  };
}

function nearestGridPoint(
  point: NavigationPoint,
  bounds: NavigationBounds,
  cellSize: number,
  isWalkable: (x: number, y: number) => boolean,
): GridPoint | null {
  const columns = Math.floor((bounds.maxX - bounds.minX) / cellSize);
  const rows = Math.floor((bounds.maxY - bounds.minY) / cellSize);
  const originColumn = Math.max(0, Math.min(columns, Math.round((point.x - bounds.minX) / cellSize)));
  const originRow = Math.max(0, Math.min(rows, Math.round((point.y - bounds.minY) / cellSize)));

  for (let radius = 0; radius <= 5; radius += 1) {
    let best: GridPoint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let row = originRow - radius; row <= originRow + radius; row += 1) {
      for (let column = originColumn - radius; column <= originColumn + radius; column += 1) {
        if (column < 0 || row < 0 || column > columns || row > rows) continue;
        if (radius > 0 && Math.abs(column - originColumn) !== radius && Math.abs(row - originRow) !== radius) continue;
        const candidate = toGridPoint(column, row, bounds, cellSize);
        if (!isWalkable(candidate.x, candidate.y)) continue;
        const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }
    if (best) return best;
  }

  return null;
}

export function hasNavigationLineOfSight(
  start: NavigationPoint,
  end: NavigationPoint,
  isWalkable: (x: number, y: number) => boolean,
  sampleSpacing = 16,
) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / sampleSpacing));
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const x = start.x + (end.x - start.x) * progress;
    const y = start.y + (end.y - start.y) * progress;
    if (!isWalkable(x, y)) return false;
  }
  return true;
}

function simplifyRoute(
  route: NavigationPoint[],
  isWalkable: (x: number, y: number) => boolean,
) {
  if (route.length <= 2) return route;
  const simplified: NavigationPoint[] = [route[0]];
  let anchor = 0;
  while (anchor < route.length - 1) {
    let next = route.length - 1;
    while (next > anchor + 1 && !hasNavigationLineOfSight(route[anchor], route[next], isWalkable)) {
      next -= 1;
    }
    simplified.push(route[next]);
    anchor = next;
  }
  return simplified;
}

/**
 * Finds a short, deterministic route around authored scenery and live decor.
 * The returned first/last points are the exact actor and destination points;
 * grid cells are only intermediate waypoints, so movement does not visibly
 * snap to a grid.
 */
export function findNavigationRoute(
  start: NavigationPoint,
  destination: NavigationPoint,
  bounds: NavigationBounds,
  isWalkable: (x: number, y: number) => boolean,
  options?: { cellSize?: number; maxVisited?: number },
): NavigationPoint[] | null {
  if (!isWalkable(start.x, start.y) || !isWalkable(destination.x, destination.y)) return null;
  if (hasNavigationLineOfSight(start, destination, isWalkable)) return [start, destination];

  const cellSize = options?.cellSize ?? DEFAULT_CELL_SIZE;
  const maxVisited = options?.maxVisited ?? DEFAULT_MAX_VISITED;
  const columns = Math.floor((bounds.maxX - bounds.minX) / cellSize);
  const rows = Math.floor((bounds.maxY - bounds.minY) / cellSize);
  const startCell = nearestGridPoint(start, bounds, cellSize, isWalkable);
  const destinationCell = nearestGridPoint(destination, bounds, cellSize, isWalkable);
  if (!startCell || !destinationCell) return null;

  const open: GridPoint[] = [startCell];
  const openKeys = new Set([gridKey(startCell.column, startCell.row)]);
  const cameFrom = new Map<string, string>();
  const cells = new Map<string, GridPoint>([
    [gridKey(startCell.column, startCell.row), startCell],
    [gridKey(destinationCell.column, destinationCell.row), destinationCell],
  ]);
  const gScore = new Map<string, number>([[gridKey(startCell.column, startCell.row), 0]]);
  const fScore = new Map<string, number>([
    [gridKey(startCell.column, startCell.row), octileDistance(startCell, destinationCell)],
  ]);
  const closed = new Set<string>();
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const;
  let visited = 0;

  while (open.length > 0 && visited < maxVisited) {
    let bestIndex = 0;
    for (let index = 1; index < open.length; index += 1) {
      const candidateKey = gridKey(open[index].column, open[index].row);
      const bestKey = gridKey(open[bestIndex].column, open[bestIndex].row);
      if ((fScore.get(candidateKey) ?? Number.POSITIVE_INFINITY) < (fScore.get(bestKey) ?? Number.POSITIVE_INFINITY)) {
        bestIndex = index;
      }
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = gridKey(current.column, current.row);
    openKeys.delete(currentKey);
    if (current.column === destinationCell.column && current.row === destinationCell.row) {
      const reversed: NavigationPoint[] = [destination];
      let cursorKey = currentKey;
      while (cursorKey !== gridKey(startCell.column, startCell.row)) {
        const cursor = cells.get(cursorKey);
        if (cursor) reversed.push({ x: cursor.x, y: cursor.y });
        const parent = cameFrom.get(cursorKey);
        if (!parent) return null;
        cursorKey = parent;
      }
      reversed.push(start);
      return simplifyRoute(reversed.reverse(), isWalkable);
    }

    closed.add(currentKey);
    visited += 1;
    for (const [columnOffset, rowOffset] of directions) {
      const neighbor = toGridPoint(
        current.column + columnOffset,
        current.row + rowOffset,
        bounds,
        cellSize,
      );
      if (neighbor.column < 0 || neighbor.row < 0 || neighbor.column > columns || neighbor.row > rows) continue;
      if (neighbor.x < bounds.minX || neighbor.y < bounds.minY || neighbor.x > bounds.maxX || neighbor.y > bounds.maxY) continue;
      const neighborKey = gridKey(neighbor.column, neighbor.row);
      if (closed.has(neighborKey) || !isWalkable(neighbor.x, neighbor.y)) continue;

      if (columnOffset !== 0 && rowOffset !== 0) {
        const horizontal = toGridPoint(current.column + columnOffset, current.row, bounds, cellSize);
        const vertical = toGridPoint(current.column, current.row + rowOffset, bounds, cellSize);
        if (!isWalkable(horizontal.x, horizontal.y) || !isWalkable(vertical.x, vertical.y)) continue;
      }
      if (!hasNavigationLineOfSight(current, neighbor, isWalkable, Math.max(10, cellSize / 3))) continue;

      cells.set(neighborKey, neighbor);
      const moveCost = columnOffset !== 0 && rowOffset !== 0 ? Math.SQRT2 : 1;
      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + moveCost;
      if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(neighborKey, currentKey);
      gScore.set(neighborKey, tentative);
      fScore.set(neighborKey, tentative + octileDistance(neighbor, destinationCell));
      if (!openKeys.has(neighborKey)) {
        open.push(neighbor);
        openKeys.add(neighborKey);
      }
    }
  }

  return null;
}
