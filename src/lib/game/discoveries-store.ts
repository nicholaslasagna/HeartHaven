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

export type DiscoveriesState = Record<DiscoveryZone, FoundDiscovery[]> & { dayKey: string };

export function getDiscoveryDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The canonical "where is the hidden stuff" list per zone. Keep these
 * positions in sync with the glow patches drawn on the painted scene so
 * the keeper's intuition matches the panel hints.
 */
const DISCOVERY_CATALOG: Record<DiscoveryZone, Omit<DiscoveryItem, "x" | "y">[]> = {
  park: [
    {
      id: "park-acorn-pile",
      name: "Acorn pile",
      emoji: "🌰",
      hint: "A neat stack of acorns hidden beneath the park leaves.",
      tag: "companion",
    },
    {
      id: "park-iridescent-feather",
      name: "Iridescent feather",
      emoji: "🪶",
      hint: "A feather with a soft rainbow shine along its edge.",
      tag: "companion",
    },
    {
      id: "park-strawberry-patch",
      name: "Wild strawberries",
      emoji: "🍓",
      hint: "A tiny handful of berries hidden in the grass.",
      tag: "shared",
    },
    {
      id: "park-firefly-jar",
      name: "Glass firefly jar",
      emoji: "✨",
      hint: "A gentle blue glow flickers inside the little jar.",
      tag: "companion",
    },
    {
      id: "park-clover-token",
      name: "Clover token",
      emoji: "🍀",
      hint: "A lucky clover pressed into a honey-gold token.",
      tag: "companion",
    },
    {
      id: "park-ribbon-button",
      name: "Ribbon button",
      emoji: "🎀",
      hint: "A blush button with a tiny lavender ribbon.",
      tag: "shared",
    },
    {
      id: "park-moon-marble",
      name: "Moon marble",
      emoji: "🔮",
      hint: "A glass marble with a moonlit swirl inside.",
      tag: "companion",
    },
    {
      id: "park-pinecone-charm",
      name: "Pinecone charm",
      emoji: "🌲",
      hint: "A tiny woodland charm warmed by the sun.",
      tag: "companion",
    },
  ],
  garden: [
    {
      id: "garden-moonberry-clutch",
      name: "Moonberry clutch",
      emoji: "🫐",
      hint: "A handful of moonberries the bees missed.",
      tag: "companion",
    },
    {
      id: "garden-pressed-flower",
      name: "Pressed flower",
      emoji: "🌸",
      hint: "A soft flower pressed flat for a keepsake page.",
      tag: "shared",
    },
    {
      id: "garden-tin-soldier",
      name: "Tin soldier",
      emoji: "🧸",
      hint: "A tiny garden guardian with a polished hat.",
      tag: "companion",
    },
    {
      id: "garden-honey-bell",
      name: "Honey bell",
      emoji: "🔔",
      hint: "A miniature bell that smells faintly of clover honey.",
      tag: "companion",
    },
    {
      id: "garden-seed-letter",
      name: "Seed letter",
      emoji: "💌",
      hint: "A folded note with three mystery seeds tucked inside.",
      tag: "shared",
    },
    {
      id: "garden-tiny-key",
      name: "Tiny garden key",
      emoji: "🗝️",
      hint: "A heart-shaped key no bigger than a berry leaf.",
      tag: "companion",
    },
    {
      id: "garden-lavender-ribbon",
      name: "Lavender ribbon",
      emoji: "💜",
      hint: "A silky ribbon carrying the scent of garden lavender.",
      tag: "companion",
    },
  ],
};

// Hand-tuned open-ground locations. Daily randomization only chooses from
// these points, so a sniff target never lands in the stream or dense border.
const DISCOVERY_POSITION_POOLS: Record<DiscoveryZone, Array<{ x: number; y: number }>> = {
  park: [
    { x: 15, y: 40 }, { x: 24, y: 55 }, { x: 33, y: 25 }, { x: 36, y: 42 },
    { x: 40, y: 84 }, { x: 44, y: 62 }, { x: 56, y: 55 }, { x: 68, y: 58 },
    { x: 70, y: 82 }, { x: 82, y: 50 }, { x: 88, y: 72 }, { x: 91, y: 35 },
  ],
  garden: [
    { x: 12, y: 72 }, { x: 15, y: 48 }, { x: 24, y: 68 }, { x: 27, y: 82 },
    { x: 32, y: 40 }, { x: 38, y: 72 }, { x: 46, y: 54 }, { x: 62, y: 62 },
    { x: 68, y: 82 }, { x: 72, y: 44 }, { x: 82, y: 68 }, { x: 88, y: 36 },
  ],
};

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle<T>(values: readonly T[], seedText: string): T[] {
  let seed = hashSeed(seedText) || 1;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4_294_967_296;
  };
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

/** Stable for one local calendar day, then reshuffled to new open areas. */
export function getZoneDiscoveries(zone: DiscoveryZone, dayKey = getDiscoveryDayKey()): DiscoveryItem[] {
  const positions = seededShuffle(DISCOVERY_POSITION_POOLS[zone], `${dayKey}:${zone}:positions`);
  const catalog = seededShuffle(DISCOVERY_CATALOG[zone], `${dayKey}:${zone}:catalog`);
  return catalog.map((item, index) => ({ ...item, ...positions[index % positions.length] }));
}

/** Compatibility snapshot; new code should call getZoneDiscoveries(). */
export const ZONE_DISCOVERIES: Record<DiscoveryZone, DiscoveryItem[]> = {
  park: getZoneDiscoveries("park"),
  garden: getZoneDiscoveries("garden"),
};

function freshState(): DiscoveriesState {
  return { dayKey: getDiscoveryDayKey(), park: [], garden: [] };
}

function rawRead(): DiscoveriesState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(DISCOVERIES_STATE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<DiscoveriesState>;
    const currentDay = getDiscoveryDayKey();
    if (parsed.dayKey !== currentDay) {
      const reset = freshState();
      window.localStorage.setItem(DISCOVERIES_STATE_KEY, JSON.stringify(reset));
      return reset;
    }
    return {
      dayKey: currentDay,
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
  return getZoneDiscoveries(zone, state.dayKey).filter((item) => !foundIds.has(item.id));
}

/**
 * Mark an item as found. Returns the discovery record on first find, or
 * `null` if the item was already discovered (so callers don't double-toast).
 */
export function markDiscoveryFound(zone: DiscoveryZone, itemId: string): FoundDiscovery | null {
  const state = rawRead();
  if (state[zone].some((entry) => entry.id === itemId)) return null;
  const item = getZoneDiscoveries(zone, state.dayKey).find((entry) => entry.id === itemId);
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
