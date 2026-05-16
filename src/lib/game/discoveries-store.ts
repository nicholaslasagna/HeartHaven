"use client";

/**
 * discoveries-store — every world zone has a set of hidden items that only
 * a companion can find. The "Sniff" action (Q while playing as the companion
 * on a glow patch) reveals an item, and the result is logged here so the
 * Discoveries side-panel reflects what's been found vs still hidden across
 * sessions.
 *
 * Coordinates are normalized 0–100 (percent of the visible park / garden
 * scene), so the same data fits both the painted scene and the minimap.
 *
 * Storage: `hearthaven:discoveries-state` in localStorage. Mutations dispatch
 * `hearthaven:discoveries-changed` so React hooks can sync.
 */

export const DISCOVERIES_STATE_KEY = "hearthaven:discoveries-state";
export const DISCOVERIES_EVENT = "hearthaven:discoveries-changed";

/** Zones with their own hidden-items list. Extend as new scenes ship. */
export type DiscoveryZone = "park" | "garden";

export type DiscoveryItem = {
  id: string;
  /** Short label shown in the Discoveries panel and the reveal toast. */
  name: string;
  /** Single emoji used for the icon — keeps the panel light without art. */
  emoji: string;
  /** One-liner shown under the name once found. */
  hint: string;
  /** Normalized 0–100 position inside the scene. */
  x: number;
  y: number;
  /**
   * "companion" = only sniffable by the pet (the most common kind).
   * "shared"    = either character can interact with this spot.
   */
  tag: "companion" | "shared";
};

export type FoundDiscovery = {
  id: string;
  foundAt: string;
};

export type DiscoveriesState = Record<DiscoveryZone, FoundDiscovery[]>;

/**
 * The canonical "where is the hidden stuff" list per zone. Keep these
 * positions in sync with the glow patches drawn on the painted scene so
 * the keeper's intuition matches the panel hints.
 */
export const ZONE_DISCOVERIES: Record<DiscoveryZone, DiscoveryItem[]> = {
  park: [
    {
      id: "park-acorn-pile",
      name: "Acorn pile",
      emoji: "🌰",
      hint: "A neat stack of acorns at the foot of the swings.",
      x: 24,
      y: 78,
      tag: "companion",
    },
    {
      id: "park-iridescent-feather",
      name: "Iridescent feather",
      emoji: "🪶",
      hint: "Caught at the cave entrance — only a small nose found it.",
      x: 52,
      y: 82,
      tag: "companion",
    },
    {
      id: "park-strawberry-patch",
      name: "Wild strawberries",
      emoji: "🍓",
      hint: "Tucked along the picnic path, ready for a friend.",
      x: 80,
      y: 84,
      tag: "shared",
    },
    {
      id: "park-firefly-jar",
      name: "Glass firefly jar",
      emoji: "✨",
      hint: "Left near the lantern arch — gentle blue glow inside.",
      x: 88,
      y: 22,
      tag: "companion",
    },
  ],
  garden: [
    {
      id: "garden-moonberry-clutch",
      name: "Moonberry clutch",
      emoji: "🫐",
      hint: "A handful of berries the bees missed.",
      x: 32,
      y: 70,
      tag: "companion",
    },
    {
      id: "garden-pressed-flower",
      name: "Pressed flower",
      emoji: "🌸",
      hint: "Tucked into a notebook page beside the bed.",
      x: 64,
      y: 76,
      tag: "shared",
    },
    {
      id: "garden-tin-soldier",
      name: "Tin soldier",
      emoji: "🧸",
      hint: "Standing guard between two ferns.",
      x: 76,
      y: 60,
      tag: "companion",
    },
  ],
};

function freshState(): DiscoveriesState {
  return { park: [], garden: [] };
}

function rawRead(): DiscoveriesState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(DISCOVERIES_STATE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<DiscoveriesState>;
    return {
      park: Array.isArray(parsed.park) ? (parsed.park as FoundDiscovery[]) : [],
      garden: Array.isArray(parsed.garden) ? (parsed.garden as FoundDiscovery[]) : [],
    };
  } catch {
    return freshState();
  }
}

function rawWrite(state: DiscoveriesState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISCOVERIES_STATE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(DISCOVERIES_EVENT, { detail: state }));
}

export function readDiscoveriesState(): DiscoveriesState {
  return rawRead();
}

export function isItemFound(zone: DiscoveryZone, itemId: string, state: DiscoveriesState = rawRead()): boolean {
  return state[zone].some((entry) => entry.id === itemId);
}

export function listFound(zone: DiscoveryZone, state: DiscoveriesState = rawRead()): FoundDiscovery[] {
  return state[zone];
}

export function listHidden(zone: DiscoveryZone, state: DiscoveriesState = rawRead()): DiscoveryItem[] {
  const foundIds = new Set(state[zone].map((entry) => entry.id));
  return ZONE_DISCOVERIES[zone].filter((item) => !foundIds.has(item.id));
}

/**
 * Mark an item as found. Returns the discovery record on first find, or
 * `null` if the item was already discovered (so callers don't double-toast).
 */
export function markDiscoveryFound(zone: DiscoveryZone, itemId: string): FoundDiscovery | null {
  const state = rawRead();
  if (state[zone].some((entry) => entry.id === itemId)) return null;
  const item = ZONE_DISCOVERIES[zone].find((entry) => entry.id === itemId);
  if (!item) return null;
  const found: FoundDiscovery = { id: itemId, foundAt: new Date().toISOString() };
  const next: DiscoveriesState = { ...state, [zone]: [found, ...state[zone]] };
  rawWrite(next);
  return found;
}

/**
 * Reset all discoveries for a zone — handy for testing or for a
 * "find everything again" seasonal event.
 */
export function resetDiscoveries(zone: DiscoveryZone) {
  const state = rawRead();
  rawWrite({ ...state, [zone]: [] });
}

/**
 * Given a normalized 0–100 position, return the nearest hidden item within
 * `radius` percent units, or `null` if nothing's in reach. This is what the
 * Sniff ability uses to decide if pressing Q on a glow patch reveals
 * anything.
 */
export function nearestHidden(
  zone: DiscoveryZone,
  position: { x: number; y: number },
  radius = 8,
): DiscoveryItem | null {
  const hidden = listHidden(zone);
  let best: { item: DiscoveryItem; dist: number } | null = null;
  for (const item of hidden) {
    const dx = item.x - position.x;
    const dy = item.y - position.y;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) continue;
    if (!best || dist < best.dist) best = { item, dist };
  }
  return best?.item ?? null;
}
