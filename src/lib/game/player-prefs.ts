/**
 * Client-side player preferences: quality, motion and control style.
 *
 * Pure except for a guarded localStorage read, so it can be unit-checked and
 * safely imported from a server-rendered module. Every getter has to survive
 * three hostile cases: no `window` at all (SSR), a browser that throws on
 * storage access (private mode, blocked site data), and a stored value that
 * is missing, stale or garbage. A preference read must never be the thing
 * that stops a game from starting.
 */

export type QualityLevel = "low" | "medium" | "high";

export type PlayerPrefs = {
  quality: QualityLevel;
  /** Cut camera shake, screen flashes and heavy particle work. */
  reducedMotion: boolean;
  /** Show on-screen driving controls even on a device with a keyboard. */
  touchControls: boolean;
};

/* Volume deliberately does NOT live here. `cozy-audio` already owns master,
   music and SFX levels, persists them, and has a dock UI driving them. A
   second `masterVolume` in this module would be a rival source of truth for
   the same setting, and the two would drift apart the moment either side
   wrote without telling the other. */

const STORAGE_KEY = "hearthaven:player-prefs";

export const DEFAULT_PREFS: PlayerPrefs = {
  quality: "high",
  reducedMotion: false,
  touchControls: false,
};

/** Rendering knobs a quality level implies. */
export const QUALITY_SETTINGS: Record<QualityLevel, {
  shadows: boolean;
  maxPixelRatio: number;
  shadowMapSize: number;
  /** Multiplier on particle counts and other per-frame extras. */
  effects: number;
}> = {
  low:    { shadows: false, maxPixelRatio: 1,   shadowMapSize: 512,  effects: 0.35 },
  medium: { shadows: true,  maxPixelRatio: 1.5, shadowMapSize: 1024, effects: 0.7 },
  high:   { shadows: true,  maxPixelRatio: 2,   shadowMapSize: 2048, effects: 1 },
};

/** Coerce anything at all into a valid preference set. */
export function normalizePrefs(raw: unknown): PlayerPrefs {
  const value = (raw ?? {}) as Partial<Record<keyof PlayerPrefs, unknown>>;
  const quality = value.quality;
  return {
    quality: quality === "low" || quality === "medium" || quality === "high" ? quality : DEFAULT_PREFS.quality,
    reducedMotion: typeof value.reducedMotion === "boolean" ? value.reducedMotion : DEFAULT_PREFS.reducedMotion,
    touchControls: typeof value.touchControls === "boolean" ? value.touchControls : DEFAULT_PREFS.touchControls,
  };
}

/**
 * Sensible defaults for THIS device, before the player has chosen anything.
 *
 * A phone gets touch controls and a lower quality tier automatically, because
 * a first run that is unplayable or a slideshow is a first run people do not
 * come back from. The OS accessibility setting for reduced motion is honoured
 * as a default rather than ignored.
 */
export function deviceDefaults(): PlayerPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;

  let coarsePointer = false;
  let prefersReducedMotion = false;
  try {
    coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // matchMedia is missing in some embedded webviews; defaults stand.
  }

  // A rough proxy for "will this device struggle": core count and memory are
  // the only signals available without rendering a frame first.
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 4 : 4;
  const lowPower = coarsePointer || cores <= 4;

  return {
    quality: lowPower ? (cores <= 2 ? "low" : "medium") : "high",
    reducedMotion: prefersReducedMotion,
    touchControls: coarsePointer,
  };
}

export function loadPrefs(): PlayerPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Nothing saved yet: fit the device rather than assuming a desktop.
    if (!stored) return deviceDefaults();
    return normalizePrefs(JSON.parse(stored));
  } catch {
    return deviceDefaults();
  }
}

/* ------------------------------------------------------------------ */
/* Observable store                                                    */
/* ------------------------------------------------------------------ */

/**
 * Cached snapshot, and why it has to be cached.
 *
 * `useSyncExternalStore` compares snapshots by REFERENCE. Parsing
 * localStorage on every call would hand React a new object each time, it
 * would conclude the store changed, re-render, ask again, and spin forever.
 * So the parsed value is held and only replaced when something actually
 * writes.
 */
let cached: PlayerPrefs | null = null;
const listeners = new Set<() => void>();

/** Stable snapshot for `useSyncExternalStore`. */
export function getPrefsSnapshot(): PlayerPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  cached ??= loadPrefs();
  return cached;
}

/** Server snapshot: identical every time, so hydration matches. */
export function getServerPrefsSnapshot(): PlayerPrefs {
  return DEFAULT_PREFS;
}

export function subscribePrefs(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function savePrefs(prefs: PlayerPrefs) {
  // Update the snapshot first so any listener that reads synchronously
  // during notification sees the new value rather than the old one.
  cached = normalizePrefs(prefs);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
    } catch {
      // Storage blocked. The session still honours the choice in memory.
    }
  }
  for (const listener of listeners) listener();
}

/** Full steering lock at this many pixels from where the thumb landed. */
export const TOUCH_STEER_SPAN = 90;

/**
 * Drag distance to a steer value.
 *
 * Dragging RIGHT must turn the kart right on screen. Positive steer is a
 * LEFT turn in the simulation — the chase camera puts world +X on the left —
 * so this negates for exactly the same reason the keyboard mapping does. The
 * two input paths have to agree, and getting one backwards is invisible
 * until somebody plays it, so both are pinned by checks.
 */
export function padSteer(dragPixels: number, span = TOUCH_STEER_SPAN) {
  const ratio = dragPixels / span;
  const clamped = ratio < -1 ? -1 : ratio > 1 ? 1 : ratio;
  // `|| 0` normalises the negative zero that -(0) produces. Harmless in
  // arithmetic, but it is a value that gets summed with keyboard steer and
  // compared against zero, and a signed zero there is just a trap.
  return -clamped || 0;
}

export const TOUCH_STICK_SPAN = 64;

/**
 * Drag offset to a movement vector, for the twin-axis stick the platformer
 * uses (the kart only ever needed one axis).
 *
 * Clamped to the unit DISC, not the unit square: normalising a diagonal keeps
 * a thumb pushed corner-ways from travelling ~1.41x faster than one pushed
 * straight, which is the classic way a touch stick outruns the keyboard.
 * Screen down is +y, and the runner reads +z as away from camera, so y maps
 * to z untouched.
 */
export function padVector(dragX: number, dragY: number, span = TOUCH_STICK_SPAN) {
  const x = dragX / span;
  const z = dragY / span;
  const length = Math.hypot(x, z);
  if (length <= 1) return { x: x || 0, z: z || 0 };
  return { x: x / length || 0, z: z / length || 0 };
}

export const TOUCH_WALK_DEADZONE = 12;
export const TOUCH_WALK_RUN_SPAN = 58;

/**
 * Horizontal drag to a platformer's walk input.
 *
 * One thumb gives both direction and pace: past the deadzone you walk, and
 * further out you run. That keeps the run button off the screen entirely,
 * which matters on a phone where the jump button is the one that has to be
 * big and easy to hit.
 *
 * The deadzone is what stops a thumb resting on the pad from creeping the
 * runner sideways — without it a still thumb reads as a tiny drag and the
 * character never quite stands still.
 */
export function padWalk(
  dragPixels: number,
  deadzone = TOUCH_WALK_DEADZONE,
  runSpan = TOUCH_WALK_RUN_SPAN,
): { moveX: number; run: boolean } {
  if (!Number.isFinite(dragPixels) || Math.abs(dragPixels) < deadzone) {
    return { moveX: 0, run: false };
  }
  return {
    moveX: dragPixels < 0 ? -1 : 1,
    run: Math.abs(dragPixels) >= runSpan,
  };
}
