"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { RotateCcw, X } from "lucide-react";
import {
  getRotateHintServerSnapshot,
  getRotateHintSnapshot,
  subscribeRotateHint,
} from "@/lib/game/orientation";
import { TOUCH_BUTTON_BASE } from "@/lib/game/touch-controls";
import { cn } from "@/lib/utils";

const DISMISS_PREFIX = "hearthaven:rotate-hint-dismissed:";

function readDismissed(gameKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISS_PREFIX + gameKey) === "1";
  } catch {
    return false;
  }
}

/**
 * A gentle nudge to turn the phone, on the games that are much better for it.
 *
 * Never blocks play: it sits along the bottom of the world, the game runs
 * underneath, and it disappears on its own the moment the device turns.
 * Dismissing it lasts for the session — long enough not to nag between
 * rounds, short enough that it comes back for a genuinely new visit.
 */
export function RotateHint({ gameKey, label }: { gameKey: string; label: string }) {
  const suggest = useSyncExternalStore(
    subscribeRotateHint,
    getRotateHintSnapshot,
    getRotateHintServerSnapshot,
  );
  const [dismissed, setDismissed] = useState(() => readDismissed(gameKey));

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_PREFIX + gameKey, "1");
    } catch {
      // Private mode: the hint simply returns on the next mount.
    }
  }, [gameKey]);

  if (!suggest || dismissed) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3"
      role="status"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-cream-50/30 bg-ink-900/85 px-3 py-2 text-cream-50 shadow-lg backdrop-blur">
        <RotateCcw aria-hidden className="size-5 shrink-0" />
        <p className="text-[12px] font-black leading-snug">
          Turn your phone sideways — {label} has a lot more room that way.
        </p>
        <button
          aria-label="Dismiss the rotate suggestion"
          className={cn(TOUCH_BUTTON_BASE, "shrink-0 px-0 text-cream-50/80 active:bg-cream-50/20")}
          onClick={dismiss}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
