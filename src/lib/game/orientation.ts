"use client";

/**
 * When to suggest turning the phone.
 *
 * The 3D games and the pool table are wide — 16:9 and 48:29. Held upright on
 * a phone that leaves a letterbox a couple of hundred pixels tall, which is
 * playable but not what the game looks like. Turning the device roughly
 * triples the play area.
 *
 * The rule is deliberately narrow, because a prompt that appears when it is
 * not needed is worse than no prompt:
 *
 *   * Only on a touch device. A narrow desktop window is someone's choice.
 *   * Only in portrait, and only when the viewport is genuinely small. A
 *     tablet held upright still gives a usable picture, so it is left alone.
 *   * Never a blocker. It sits over a corner of the world and can be
 *     dismissed, and it goes away by itself the moment the device turns.
 */
export const ROTATE_HINT_MAX_WIDTH = 720;

export type ViewportShape = {
  portrait: boolean;
  coarsePointer: boolean;
  width: number;
};

export function shouldSuggestRotate(shape: ViewportShape): boolean {
  if (!shape.coarsePointer) return false;
  if (!shape.portrait) return false;
  if (!Number.isFinite(shape.width) || shape.width <= 0) return false;
  return shape.width <= ROTATE_HINT_MAX_WIDTH;
}

function readShape(): ViewportShape {
  if (typeof window === "undefined") {
    return { portrait: false, coarsePointer: false, width: 0 };
  }
  let portrait = false;
  let coarsePointer = false;
  try {
    portrait = window.matchMedia("(orientation: portrait)").matches;
    coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    // matchMedia is missing in some embedded webviews; no hint is the safe
    // outcome — a missing hint costs a smaller picture, a wrong one nags.
  }
  return { portrait, coarsePointer, width: window.innerWidth };
}

/* Cached so useSyncExternalStore compares a stable value; a boolean is
   compared by value, so only the read has to be cheap and consistent. */
let cached: boolean | null = null;

export function getRotateHintSnapshot(): boolean {
  if (cached === null) cached = shouldSuggestRotate(readShape());
  return cached;
}

export function getRotateHintServerSnapshot(): boolean {
  return false;
}

export function subscribeRotateHint(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const sync = () => {
    const next = shouldSuggestRotate(readShape());
    if (next === cached) return;
    cached = next;
    listener();
  };
  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", sync);
  return () => {
    window.removeEventListener("resize", sync);
    window.removeEventListener("orientationchange", sync);
  };
}
