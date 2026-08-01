export type TrailDiscovery = {
  id: string;
  label: string;
  copy: string;
  x: number;
  y: number;
};

const TRAIL_DISCOVERY_CATALOG: Array<Omit<TrailDiscovery, "x" | "y">> = [
  { id: "trail-moonlit-button", label: "Moonlit button", copy: "A tiny button from an old keeper coat catches the light." },
  { id: "trail-honey-token", label: "Honey token", copy: "A warm little token hums when your companion nudges it." },
  { id: "trail-lavender-charm", label: "Lavender charm", copy: "The charm smells like a garden after a soft rain." },
  { id: "trail-firefly-thread", label: "Firefly thread", copy: "A glowing thread points toward tonight's kindest path." },
  { id: "trail-rose-seal", label: "Rose seal", copy: "Someone pressed a rose into wax here long ago." },
  { id: "trail-sugar-pebble", label: "Sugar pebble", copy: "It sparkles like a crumb from the arcade meadow." },
  { id: "trail-little-key", label: "Little key", copy: "A key with no lock yet — keep it safe." },
];

// These points are authored on the lantern-road centerlines so a daily find
// remains reachable instead of landing in scenery or water.
const TRAIL_DISCOVERY_POSITIONS = [
  { x: 310, y: 675 },
  { x: 710, y: 610 },
  { x: 1080, y: 555 },
  { x: 1550, y: 350 },
  { x: 1180, y: 755 },
  { x: 1700, y: 915 },
  { x: 465, y: 410 },
];

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffle<T>(values: readonly T[], seedText: string) {
  let seed = hashSeed(seedText) || 1;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4_294_967_296;
  };
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

export function getTrailDiscoveryDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Returns three stable, daily-rotating keepsakes on authored walkable points. */
export function getDailyTrailDiscoveries(dayKey = getTrailDiscoveryDayKey()): TrailDiscovery[] {
  const catalog = shuffle(TRAIL_DISCOVERY_CATALOG, `${dayKey}:trail-catalog`).slice(0, 3);
  const positions = shuffle(TRAIL_DISCOVERY_POSITIONS, `${dayKey}:trail-positions`).slice(0, 3);
  return catalog.map((item, index) => ({ ...item, ...positions[index] }));
}

