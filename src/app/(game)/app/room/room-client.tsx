"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, DoorOpen, Move, Plus, Radio, RotateCcw, Save, Sparkles, UserCheck, UsersRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { RoomCanvasLoader } from "@/components/game/room-canvas-loader";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Button } from "@/components/ui/button";
import { recordActivity } from "@/lib/game/activity";
import { marketCatalog, roomBlueprints, starterPlacements } from "@/lib/catalog";
import type { CatalogItem, RoomPlacement } from "@/lib/game/types";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";
import { useRoomRealtime } from "@/lib/game/use-room-realtime";
import { lookupFriendCode } from "@/lib/game/social";
import { isItemVisibleForSeason } from "@/lib/seasonal-events";

const ROOM_STORAGE_PREFIX = "hearthaven:room-placements:v2:";

function getRoomStorageKey(roomId: string) {
  return `${ROOM_STORAGE_PREFIX}${roomId}`;
}

function readPlacements(roomId: string): RoomPlacement[] {
  if (typeof window === "undefined") return starterPlacements;
  try {
    const raw = window.localStorage.getItem(getRoomStorageKey(roomId));
    if (!raw) return starterPlacements;
    const parsed = JSON.parse(raw) as RoomPlacement[];
    return Array.isArray(parsed) ? parsed : starterPlacements;
  } catch {
    return starterPlacements;
  }
}

export function RoomClient() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room") ?? "moonlit-loft";
  const visitTarget = searchParams.get("visit");
  const isHostRoom = !visitTarget;
  const activeRoom = roomBlueprints.find((room) => room.id === roomId) ?? roomBlueprints[0];
  const allowedVisitTarget = visitTarget ? lookupFriendCode(visitTarget) : null;
  const isVisitAllowed = !visitTarget || Boolean(allowedVisitTarget);
  const [placements, setPlacements] = useState<RoomPlacement[]>(starterPlacements);
  const [draftPlacements, setDraftPlacements] = useState<RoomPlacement[]>(starterPlacements);
  const [saveStatus, setSaveStatus] = useState("Blank room ready");
  const [inviteStatus, setInviteStatus] = useState("Invite link ready");
  const placementCounter = useRef(0);
  const realtime = useRoomRealtime({
    roomId: isVisitAllowed ? activeRoom.id : "friend-only-gate",
    roomName: isVisitAllowed ? activeRoom.name : "Friend-only room",
  });
  const canEditRoom = isHostRoom || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);
  const { activeEvent } = useSeasonalEvent();
  const roomDrawerItems = marketCatalog
    .filter((item) => isItemVisibleForSeason(item, activeEvent))
    .filter((item) => item.placementType === "floor" || item.placementType === "wall")
    .slice(0, 12);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const saved = readPlacements(activeRoom.id);
      setPlacements(saved);
      setDraftPlacements(saved);
      setSaveStatus(saved.length === 0 ? "Blank room ready" : "Loaded saved layout");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activeRoom.id]);

  // Spending time in your room advances the "spend time in your room" daily task.
  useEffect(() => {
    recordActivity("room-visited");
  }, []);

  const handlePlacementsChange = useCallback((next: RoomPlacement[]) => {
    setDraftPlacements(next);
    setSaveStatus("Unsaved room changes");
  }, []);

  function saveRoom() {
    if (!canEditRoom) {
      setSaveStatus("Ask the host for decorator access before saving room changes.");
      return;
    }
    window.localStorage.setItem(getRoomStorageKey(activeRoom.id), JSON.stringify(draftPlacements));
    setPlacements(draftPlacements);
    setSaveStatus("Room layout saved locally");
    // TODO: Persist the same placement payload to Supabase placed_items with room ownership checks.
  }

  function resetRoom() {
    if (!canEditRoom) {
      setSaveStatus("Ask the host for decorator access before clearing room items.");
      return;
    }
    window.localStorage.removeItem(getRoomStorageKey(activeRoom.id));
    setDraftPlacements(starterPlacements);
    setPlacements(starterPlacements);
    setSaveStatus("Room cleared to a blank canvas");
  }

  function addRoomItem(item: CatalogItem) {
    if (!canEditRoom) {
      setSaveStatus("Ask the host for decorator access before adding furniture.");
      return;
    }
    placementCounter.current += 1;
    const nextPlacement: RoomPlacement = {
      id: `placement-${item.id}-${draftPlacements.length}-${placementCounter.current}`,
      catalogItemId: item.id,
      x: item.placementType === "wall" ? 330 : 460,
      y: item.placementType === "wall" ? 150 : 340,
      rotation: 0,
      scale: 1,
      zIndex: item.placementType === "wall" ? 0 : 3,
    };
    const next = [...draftPlacements, nextPlacement];
    setDraftPlacements(next);
    setPlacements(next);
    setSaveStatus(`${item.name} added. Drag it in the room, then save layout.`);
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(realtime.inviteUrl);
      setInviteStatus("Invite link copied");
    } catch {
      setInviteStatus(realtime.inviteUrl);
    }
  }

  if (!isVisitAllowed) {
    return (
      <div className="grid gap-5">
        <section className="rounded-lg border border-blush-300/40 bg-blush-100/65 p-6 shadow-sm">
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Friend-only room</p>
          <h1 className="mt-2 font-display text-4xl text-ink-900">Accept an invite first.</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            HeartHaven rooms only open for friends or keepers you have already played with. Ask the host to send a
            friend invite from the Friends page, then come back through the room link.
          </p>
          <Button asChild className="mt-4" variant="warm">
            <Link href="/app/friends">Open Friends</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <SeasonalEventBanner compact />
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Playable room</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">{activeRoom.name}</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            {activeRoom.description} Walk with click-to-move or WASD, drag furniture, choose left/right facing, layer
            objects on the 2.5D depth axis, and invite friends into the same room.
          </p>
          <p className="mt-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">{saveStatus}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="warm"><Move /> Design</Button>
          <Button disabled={!canEditRoom} onClick={saveRoom}><Save /> Save layout</Button>
          <Button disabled={!canEditRoom} onClick={resetRoom} variant="secondary"><RotateCcw /> Reset</Button>
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
        {isHostRoom && (
          <div className="md:col-span-2 rounded-lg border border-lavender-300/40 bg-white/55 p-3">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-600">
              <UserCheck className="size-3.5" /> Approved decorators
            </p>
            {realtime.players.length === 0 ? (
              <p className="mt-2 text-xs font-bold text-ink-600">
                Invite a friend first, then approve only the visitors who can decorate this room.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {realtime.players
                  .filter((player) => Boolean(player.friendCode))
                  .map((player) => {
                    const approved = Boolean(player.friendCode && realtime.approvedDecoratorCodes.includes(player.friendCode));
                    return (
                      <Button
                        key={`${player.id}-${player.friendCode}`}
                        onClick={() => player.friendCode && realtime.toggleDecoratorPermission(player.friendCode)}
                        size="sm"
                        variant={approved ? "default" : "secondary"}
                      >
                        @{player.displayName}: {approved ? "Remove" : "Allow"}
                      </Button>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </section>
      <section className="rounded-lg border border-cream-300 bg-white/72 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">Room wings</p>
            <p className="text-sm font-bold text-ink-700">Every room opens blank. Add furniture from the drawer, save the layout, then expand into another wing.</p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/app/shop"><Plus /> Buy rooms</Link>
          </Button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {roomBlueprints.map((room) => (
            <Link
              className={`min-w-[188px] rounded-lg border px-3 py-2 shadow-sm transition hover:-translate-y-0.5 ${
                room.id === activeRoom.id
                  ? "border-blush-300 bg-blush-100 text-ink-900"
                  : "border-cream-300 bg-cream-50 text-ink-700 hover:border-lavender-300 hover:bg-lavender-100/60"
              }`}
              href={room.href}
              key={room.id}
            >
              <span className="flex items-center gap-2 text-sm font-black"><DoorOpen className="size-4" /> {room.name}</span>
              <span className="mt-1 block text-xs font-bold">{room.capacity} friends | blank shell</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-cream-300 bg-white/72 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">Room decor drawer</p>
            <p className="text-sm font-bold text-ink-700">Add items here, then drag and face them left or right directly in the room viewport.</p>
          </div>
          <span className="rounded-full bg-cream-100 px-3 py-1 text-xs font-black text-ink-700">{roomDrawerItems.length} ready</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {roomDrawerItems.map((item) => (
            <button
              className="min-w-[154px] rounded-lg border border-cream-300 bg-cream-50 px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blush-300 hover:bg-blush-100/70"
              disabled={!canEditRoom}
              key={item.id}
              onClick={() => addRoomItem(item)}
              type="button"
            >
              <span className="block text-sm font-black text-ink-900">{item.name}</span>
              <span className="mt-0.5 block text-xs font-bold text-ink-600">{item.category} | {item.placementType}</span>
            </button>
          ))}
        </div>
      </section>
      <RoomCanvasLoader
        canEditRoom={canEditRoom}
        onAvatarMove={realtime.sendMove}
        onPlacementsChange={handlePlacementsChange}
        onRoomEmote={realtime.sendEmote}
        placements={placements}
        remotePlayers={realtime.players}
        roomName={activeRoom.name}
        roomTheme={activeRoom.theme}
      />
      {!canEditRoom && (
        <p className="rounded-md border border-honey-500/30 bg-honey-100/60 px-3 py-2 text-xs font-extrabold text-honey-700">
          You&apos;re a guest in this room. Walk around, send emotes, and chat. The host can approve your username for
          decorator access if they want you to move furniture.
        </p>
      )}
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-lavender-500" />
        Avatar movement and emotes now broadcast through Supabase Realtime when env vars are present. Furniture edits
        still save locally first, with Supabase placed item persistence kept as the next backend step.
      </div>
    </div>
  );
}
