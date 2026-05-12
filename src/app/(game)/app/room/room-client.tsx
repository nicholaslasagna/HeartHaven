"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Move, Radio, RotateCcw, Save, Sparkles, UsersRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { RoomCanvasLoader } from "@/components/game/room-canvas-loader";
import { Button } from "@/components/ui/button";
import { starterPlacements } from "@/lib/catalog";
import type { RoomPlacement } from "@/lib/game/types";
import { useRoomRealtime } from "@/lib/game/use-room-realtime";

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
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room") ?? "moonlit-loft";
  const [placements, setPlacements] = useState<RoomPlacement[]>(starterPlacements);
  const [draftPlacements, setDraftPlacements] = useState<RoomPlacement[]>(starterPlacements);
  const [saveStatus, setSaveStatus] = useState("Loaded starter layout");
  const [inviteStatus, setInviteStatus] = useState("Invite link ready");
  const realtime = useRoomRealtime({ roomId, roomName: "Moonlit Loft" });

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

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(realtime.inviteUrl);
      setInviteStatus("Invite link copied");
    } catch {
      setInviteStatus(realtime.inviteUrl);
    }
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
        <div className="flex flex-wrap gap-2">
          <Button variant="warm"><Move /> Design</Button>
          <Button onClick={saveRoom}><Save /> Save layout</Button>
          <Button onClick={resetRoom} variant="secondary"><RotateCcw /> Reset</Button>
        </div>
      </section>
      <section className="grid gap-3 rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <p className="flex items-center gap-2 text-sm font-black text-ink-900">
            <Radio className="size-4 text-lavender-500" /> Multiplayer room {realtime.roomCode}
          </p>
          <p className="mt-1 text-xs font-extrabold uppercase tracking-normal text-ink-500">{realtime.status}</p>
          <p className="mt-2 text-sm font-bold text-ink-700">
            {realtime.players.length === 0
              ? "Invite someone to see their avatar move live in this room."
              : `${realtime.players.length} friend${realtime.players.length === 1 ? "" : "s"} visiting now.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-white/70 bg-white/75 px-3 py-2 text-xs font-black uppercase tracking-normal text-ink-700">
            <UsersRound className="mr-1 inline size-3.5" /> {realtime.connectionState}
          </div>
          <Button onClick={copyInvite} variant="warm">
            <Copy /> Copy invite
          </Button>
        </div>
        <p className="md:col-span-2 rounded-md bg-white/65 px-3 py-2 text-xs font-bold text-ink-700">{inviteStatus}</p>
      </section>
      <RoomCanvasLoader
        onAvatarMove={realtime.sendMove}
        onPlacementsChange={handlePlacementsChange}
        onRoomEmote={realtime.sendEmote}
        placements={placements}
        remotePlayers={realtime.players}
      />
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-lavender-500" />
        Avatar movement and emotes now broadcast through Supabase Realtime when env vars are present. Furniture edits
        still save locally first, with Supabase placed item persistence kept as the next backend step.
      </div>
    </div>
  );
}
