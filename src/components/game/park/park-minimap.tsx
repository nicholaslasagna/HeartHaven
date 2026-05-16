"use client";

import { useEffect, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import type { ParkPlayMode } from "@/components/game/park/park-control-card";

type Marker = { x: number; y: number };

const PINS: Array<{ x: number; y: number; label: string; tint: string }> = [
  { x: 22, y: 28, label: "Picnic", tint: "#D9A53E" },
  { x: 58, y: 28, label: "Claw", tint: "#D87E8C" },
  { x: 82, y: 18, label: "Sakura", tint: "#8E70BD" },
  { x: 40, y: 62, label: "Fountain", tint: "#5E94B0" },
  { x: 72, y: 68, label: "Cart", tint: "#C77284" },
  { x: 50, y: 82, label: "Squeeze", tint: "#C0A8DC" },
];

/**
 * Right-column minimap: the painted park scaled down, with friendly pins on
 * the landmarks, plus two live markers (keeper + companion) that follow the
 * `hearthaven:park-position` event the Phaser scene dispatches.
 */
export function ParkMinimap() {
  const [mode, setMode] = useState<ParkPlayMode>("keeper");
  const [keeper, setKeeper] = useState<Marker>({ x: 40, y: 58 });
  const [companion, setCompanion] = useState<Marker>({ x: 50, y: 64 });

  useEffect(() => {
    const onPosition = (event: Event) => {
      const detail = (event as CustomEvent<{ keeper?: Marker; companion?: Marker }>).detail;
      if (detail?.keeper) setKeeper(detail.keeper);
      if (detail?.companion) setCompanion(detail.companion);
    };
    const onMode = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: ParkPlayMode }>).detail;
      if (detail?.mode === "keeper" || detail?.mode === "companion") setMode(detail.mode);
    };
    window.addEventListener("hearthaven:park-position", onPosition);
    window.addEventListener("hearthaven:play-mode-changed", onMode);
    return () => {
      window.removeEventListener("hearthaven:park-position", onPosition);
      window.removeEventListener("hearthaven:play-mode-changed", onMode);
    };
  }, []);

  return (
    <section className="hh-card p-4">
      <div className="flex items-center justify-between">
        <p className="hh-eyebrow text-honey-700 flex items-center gap-1">
          <MapIcon className="size-3" /> Larkspur park
        </p>
        <span className="hh-chip text-[10px]">{mode === "companion" ? "Tracking pet" : "Tracking keeper"}</span>
      </div>
      <div className="relative mt-2 h-40 overflow-hidden rounded-md border border-cream-300">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover"
          src="/game-assets/generated/park-bare-map.png"
        />
        <div className="absolute inset-0 bg-cream-50/30" />
        {PINS.map((pin) => (
          <span
            key={pin.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-normal shadow-sm"
            style={{
              left: `${pin.x}%`,
              top: `${pin.y}%`,
              backgroundColor: `${pin.tint}cc`,
              color: "#fff",
            }}
          >
            {pin.label}
          </span>
        ))}
        <span
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 shadow-md transition-all"
          style={{ left: `${keeper.x}%`, top: `${keeper.y}%`, outline: mode === "keeper" ? "2px solid #5E94B0" : "none" }}
          aria-label="Keeper position"
        />
        <span
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-lavender-500 shadow-md transition-all"
          style={{ left: `${companion.x}%`, top: `${companion.y}%`, outline: mode === "companion" ? "2px solid #8E70BD" : "none" }}
          aria-label="Companion position"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-ink-600">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-sky-500" /> Keeper
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-lavender-500" /> Companion
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full border-2 border-dashed border-lavender-300" /> Companion-only
        </span>
      </div>
    </section>
  );
}
