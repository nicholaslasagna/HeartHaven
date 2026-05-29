export type RoomSurfaceKind = "floor" | "wall";

export type RoomSurfaceOption = {
  id: string;
  kind: RoomSurfaceKind;
  name: string;
  description: string;
  asset: string;
  swatch: string;
};

export type RoomSurfaceSelection = {
  floor: RoomSurfaceOption;
  wall: RoomSurfaceOption;
};

const SURFACE_ROOT = "/game-assets/generated/room-surfaces";
const ROOM_SURFACE_STORAGE_PREFIX = "hearthaven:room-surfaces:v1:";

/** Keep in sync with supabase/migrations/0039_room_surface_allowlist.sql */
export const ROOM_SURFACE_ID_MAX_LENGTH = 48;
export const ROOM_SURFACE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const roomFloorSurfaceOptions: RoomSurfaceOption[] = [
  {
    id: "cream-checker",
    kind: "floor",
    name: "Cream Checker Tile",
    description: "Soft Webkinz-style cream tiles with honey grout.",
    asset: `${SURFACE_ROOT}/floor-cream-checker.png`,
    swatch: "#fbf3df",
  },
  {
    id: "lavender-diamond",
    kind: "floor",
    name: "Lavender Diamond Tile",
    description: "Polished lavender diamonds for premium bedrooms and lofts.",
    asset: `${SURFACE_ROOT}/floor-lavender-diamond.png`,
    swatch: "#eee4f8",
  },
  {
    id: "honey-oak",
    kind: "floor",
    name: "Honey Oak Planks",
    description: "Warm wooden boards with cozy grain and soft shine.",
    asset: `${SURFACE_ROOT}/floor-honey-oak.png`,
    swatch: "#d9a85b",
  },
  {
    id: "blush-mosaic",
    kind: "floor",
    name: "Blush Mosaic",
    description: "Rounded pink, cream, lavender, and garden mosaic tiles.",
    asset: `${SURFACE_ROOT}/floor-blush-mosaic.png`,
    swatch: "#f8dedf",
  },
  {
    id: "garden-stone",
    kind: "floor",
    name: "Garden Stone",
    description: "Soft stepping-stone texture for patios and greenhouse rooms.",
    asset: `${SURFACE_ROOT}/floor-garden-stone.png`,
    swatch: "#dfe8cf",
  },
];

export const roomWallSurfaceOptions: RoomSurfaceOption[] = [
  {
    id: "cream-plaster",
    kind: "wall",
    name: "Cream Plaster",
    description: "Warm paper-grain plaster for a soft starter room.",
    asset: `${SURFACE_ROOT}/wall-cream-plaster.png`,
    swatch: "#fff3df",
  },
  {
    id: "blush-floral",
    kind: "wall",
    name: "Blush Floral Paper",
    description: "Romantic blush wallpaper with tiny garden blooms.",
    asset: `${SURFACE_ROOT}/wall-blush-floral.png`,
    swatch: "#fde8e7",
  },
  {
    id: "lavender-stripe",
    kind: "wall",
    name: "Lavender Stripe Paint",
    description: "Clean lavender stripes with soft cream pinstripes.",
    asset: `${SURFACE_ROOT}/wall-lavender-stripe.png`,
    swatch: "#f3eafd",
  },
  {
    id: "sage-beadboard",
    kind: "wall",
    name: "Sage Beadboard",
    description: "Garden-green beadboard for kitchens, nurseries, and patios.",
    asset: `${SURFACE_ROOT}/wall-sage-beadboard.png`,
    swatch: "#dfead0",
  },
  {
    id: "night-stars",
    kind: "wall",
    name: "Night Star Paint",
    description: "Deep lavender night paint with sleepy moon and star detail.",
    asset: `${SURFACE_ROOT}/wall-night-stars.png`,
    swatch: "#3b315f",
  },
  {
    id: "honey-stucco",
    kind: "wall",
    name: "Honey Stucco Paint",
    description: "Golden stucco texture for sunrooms and party halls.",
    asset: `${SURFACE_ROOT}/wall-honey-stucco.png`,
    swatch: "#fae0a9",
  },
];

export const defaultRoomSurfaceSelection: RoomSurfaceSelection = {
  floor: roomFloorSurfaceOptions[0],
  wall: roomWallSurfaceOptions[0],
};

export const ALLOWED_ROOM_FLOOR_IDS = new Set(roomFloorSurfaceOptions.map((option) => option.id));
export const ALLOWED_ROOM_WALL_IDS = new Set(roomWallSurfaceOptions.map((option) => option.id));

export function normalizeRoomSurfaceId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim().slice(0, ROOM_SURFACE_ID_MAX_LENGTH);
  if (!trimmed) return null;
  if (!ROOM_SURFACE_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function isAllowedRoomSurfaceId(kind: RoomSurfaceKind, id: string): boolean {
  const normalized = normalizeRoomSurfaceId(id);
  if (!normalized) return false;
  return kind === "floor" ? ALLOWED_ROOM_FLOOR_IDS.has(normalized) : ALLOWED_ROOM_WALL_IDS.has(normalized);
}

export function validateRoomSurfaceIdsForSave(floorId: string, wallId: string): { ok: true; floorId: string; wallId: string } | { ok: false; message: string } {
  const floor = normalizeRoomSurfaceId(floorId);
  if (!floor) {
    return { ok: false, message: "Choose a valid floor style from the list." };
  }
  if (!ALLOWED_ROOM_FLOOR_IDS.has(floor)) {
    return { ok: false, message: `Unknown floor style "${floor}".` };
  }

  const wall = normalizeRoomSurfaceId(wallId);
  if (!wall) {
    return { ok: false, message: "Choose a valid wallpaper from the list." };
  }
  if (!ALLOWED_ROOM_WALL_IDS.has(wall)) {
    return { ok: false, message: `Unknown wallpaper "${wall}".` };
  }

  return { ok: true, floorId: floor, wallId: wall };
}

function getRoomSurfaceStorageKey(roomId: string) {
  return `${ROOM_SURFACE_STORAGE_PREFIX}${roomId}`;
}

function byId(options: RoomSurfaceOption[], id: unknown, fallback: RoomSurfaceOption) {
  return options.find((option) => option.id === id) ?? fallback;
}

export function readRoomSurfaces(roomId: string): RoomSurfaceSelection {
  if (typeof window === "undefined") return defaultRoomSurfaceSelection;
  try {
    const raw = window.localStorage.getItem(getRoomSurfaceStorageKey(roomId));
    if (!raw) return defaultRoomSurfaceSelection;
    const parsed = JSON.parse(raw) as Partial<Record<RoomSurfaceKind, string>>;
    return {
      floor: byId(roomFloorSurfaceOptions, parsed.floor, defaultRoomSurfaceSelection.floor),
      wall: byId(roomWallSurfaceOptions, parsed.wall, defaultRoomSurfaceSelection.wall),
    };
  } catch {
    return defaultRoomSurfaceSelection;
  }
}

export function writeRoomSurfaces(roomId: string, selection: RoomSurfaceSelection) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    getRoomSurfaceStorageKey(roomId),
    JSON.stringify({ floor: selection.floor.id, wall: selection.wall.id }),
  );
}

export type ServerRoomSurfaces = {
  floorId: string;
  wallId: string;
};

export function selectionFromServerSurfaces(
  surfaces: ServerRoomSurfaces | null,
): RoomSurfaceSelection {
  if (!surfaces) return defaultRoomSurfaceSelection;
  return {
    floor: byId(roomFloorSurfaceOptions, surfaces.floorId, defaultRoomSurfaceSelection.floor),
    wall: byId(roomWallSurfaceOptions, surfaces.wallId, defaultRoomSurfaceSelection.wall),
  };
}

export function hardenServerRoomSurfaces(raw: {
  floor_id?: unknown;
  wall_id?: unknown;
} | null): ServerRoomSurfaces | null {
  if (!raw) return null;
  const floorId = normalizeRoomSurfaceId(raw.floor_id);
  const wallId = normalizeRoomSurfaceId(raw.wall_id);
  if (!floorId || !wallId) return null;
  if (!isAllowedRoomSurfaceId("floor", floorId) || !isAllowedRoomSurfaceId("wall", wallId)) {
    return null;
  }
  return { floorId, wallId };
}
