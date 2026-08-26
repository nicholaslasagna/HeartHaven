"use client";

import { MonitorCog } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getPrefsSnapshot,
  getServerPrefsSnapshot,
  savePrefs,
  subscribePrefs,
  type QualityLevel,
} from "@/lib/game/player-prefs";
import { Button } from "@/components/ui/button";

const QUALITY_LABELS: Array<{ value: QualityLevel; label: string; hint: string }> = [
  { value: "low", label: "Smooth", hint: "No shadows, lowest resolution — best on older phones." },
  { value: "medium", label: "Balanced", hint: "Shadows on at half resolution." },
  { value: "high", label: "Pretty", hint: "Full resolution and sharp shadows." },
];

/**
 * Display and motion settings.
 *
 * Sits beside the audio dock rather than inventing a second settings idiom.
 * Audio deliberately stays over there: `cozy-audio` owns volume, and putting
 * a second set of sliders here would be two controls fighting over one value.
 */
export function DisplaySettingsDock() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getServerPrefsSnapshot);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Click-away, matching how the audio dock behaves.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        size="sm"
        title="Graphics quality, motion and on-screen controls"
        variant="secondary"
      >
        <MonitorCog />
        <span className="hidden sm:inline">Display</span>
      </Button>

      {open && (
        <div
          aria-label="Display settings"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-lg border border-cream-300 bg-cream-50 p-3 shadow-[0_18px_40px_-18px_rgba(91,63,63,0.28)]"
          role="dialog"
        >
          <p className="text-[11px] font-extrabold uppercase tracking-normal text-ink-500">Graphics</p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {QUALITY_LABELS.map((option) => (
              <button
                aria-pressed={prefs.quality === option.value}
                className={
                  "rounded-md border px-2 py-1.5 text-[11px] font-extrabold transition-colors " +
                  (prefs.quality === option.value
                    ? "border-blush-400 bg-blush-100 text-ink-900"
                    : "border-cream-300 bg-white/80 text-ink-600 hover:bg-blush-50")
                }
                key={option.value}
                onClick={() => savePrefs({ ...prefs, quality: option.value })}
                title={option.hint}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] font-bold leading-4 text-ink-500">
            {QUALITY_LABELS.find((option) => option.value === prefs.quality)?.hint}
          </p>

          <label className="mt-3 flex items-start gap-2 text-xs font-extrabold text-ink-700">
            <input
              checked={prefs.reducedMotion}
              className="mt-0.5 accent-lavender-500"
              onChange={(event) => savePrefs({ ...prefs, reducedMotion: event.target.checked })}
              type="checkbox"
            />
            <span>
              Reduce motion
              <span className="block text-[11px] font-bold text-ink-500">
                Holds the camera steady and calms flashing effects.
              </span>
            </span>
          </label>

          <label className="mt-2.5 flex items-start gap-2 text-xs font-extrabold text-ink-700">
            <input
              checked={prefs.touchControls}
              className="mt-0.5 accent-lavender-500"
              onChange={(event) => savePrefs({ ...prefs, touchControls: event.target.checked })}
              type="checkbox"
            />
            <span>
              On-screen controls
              <span className="block text-[11px] font-bold text-ink-500">
                Steering pad and buttons. On by default with a touchscreen.
              </span>
            </span>
          </label>

          {/* Honest about when it takes effect: the renderer reads quality
              once, when it builds the scene. */}
          <p className="mt-3 rounded-md bg-cream-100 px-2 py-1.5 text-[11px] font-bold leading-4 text-ink-600">
            Graphics changes apply the next time a game loads.
          </p>
        </div>
      )}
    </div>
  );
}
