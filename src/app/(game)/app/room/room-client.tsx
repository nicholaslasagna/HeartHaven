"use client";

import { useCallback, useEffect, useState } from "react";
import { Move, RotateCcw, Save, Sparkles } from "lucide-react";
import { RoomCanvasLoader } from "@/components/game/room-canvas-loader";
import { Button } from "@/components/ui/button";
import { starterPlacements } from "@/lib/catalog";
import type { RoomPlacement } from "@/lib/game/types";

const ROOM_STORAGE_KEY = "hearthaven:moonlit-loft-placements";

function readPlacements(): RoomPlacement[] {
  if (typeof window === "undefined") return starterPlacements;
  try {
    const raw = window.localStorage.getItem(ROOM_STORAGE_KEY);
    if (!raw) return starterPlacements;
    const parsed = JSON.parse(raw) as RoomPlacement[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : starterPlacements;
  } catch {
    return starterPlacements;
  }
}

export function RoomClient() {
  const [placements, setPlacements] = useState<RoomPlacement[]>(starterPlacements);
  const [draftPlacements, setDraftPlacements] = useState<RoomPlacement[]>(starterPlacements);
  const [saveStatus, setSaveStatus] = useState("Loaded starter layout");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const saved = readPlacements();
      setPlacements(saved);
      setDraftPlacements(saved);
      setSaveStatus(saved === starterPlacements ? "Loaded starter layout" : "Loaded saved layout");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const handlePlacementsChange = useCallback((next: RoomPlacement[]) => {
    setDraftPlacements(next);
    setSaveStatus("Unsaved room changes");
  }, []);

  function saveRoom() {
    window.localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(draftPlacements));
    setPlacements(draftPlacements);
    setSaveStatus("Room layout saved locally");
    // TODO: Persist the same placement payload to Supabase placed_items with room ownership checks.
  }

  function resetRoom() {
    window.localStorage.removeItem(ROOM_STORAGE_KEY);
    setDraftPlacements(starterPlacements);
    setPlacements(starterPlacements);
    setSaveStatus("Starter layout restored");
  }

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Playable room</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Moonlit Loft</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            A 2.5D room with click-to-move, WASD movement, Casper behaviors, draggable furniture, hover outlines,
            rotation, local save/load, and cozy object reactions.
          </p>
          <p className="mt-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">{saveStatus}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="warm"><Move /> Design</Button>
          <Button onClick={saveRoom}><Save /> Save layout</Button>
          <Button onClick={resetRoom} variant="secondary"><RotateCcw /> Reset</Button>
        </div>
      </section>
      <RoomCanvasLoader onPlacementsChange={handlePlacementsChange} placements={placements} />
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-lavender-500" />
        Placement edits now save locally and reload on refresh. Supabase room sessions and persistent placed items are
        ready to replace local storage when backend persistence is connected.
      </div>
    </div>
  );
}
