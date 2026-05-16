"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DoorOpen, Move, PackagePlus, Plus, RotateCcw, Save, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { RoomCanvasLoader } from "@/components/game/room-canvas-loader";
import { RoomSocialPanel } from "@/components/game/room-social-panel";
import { WorldZoneDock } from "@/components/game/world-zone-dock";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Button } from "@/components/ui/button";
import { recordActivity } from "@/lib/game/activity";
import { getStarterPlacementsForRoom, roomBlueprints, starterPlacements } from "@/lib/catalog";
import type { CatalogItem, RoomPlacement } from "@/lib/game/types";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";
import { useRoomRealtime } from "@/lib/game/use-room-realtime";
import { useInventory } from "@/lib/game/use-inventory";
import { isFriendCodeShape, lookupFriendCode, normalizeFriendCode, recordPlayedWith } from "@/lib/game/social";
import { isItemVisibleForSeason } from "@/lib/seasonal-events";

const ROOM_STORAGE_PREFIX = "hearthaven:room-placements:v2:";

function getRoomStorageKey(roomId: string) {
  return `${ROOM_STORAGE_PREFIX}${roomId}`;
}

function readPlacements(roomId: string): RoomPlacement[] {
  // Each blueprint has a curated, "move-in ready" layout — no room ever opens
  // as an empty shell. The first time a room is visited, that cozy default is
  // what loads. After the host saves, the saved layout takes over.
  const cozyDefault = getStarterPlacementsForRoom(roomId);
  if (typeof window === "undefined") return cozyDefault;
  try {
    const raw = window.localStorage.getItem(getRoomStorageKey(roomId));
    if (!raw) return cozyDefault;
    const parsed = JSON.parse(raw) as RoomPlacement[];
    return Array.isArray(parsed) ? parsed : cozyDefault;
  } catch {
    return cozyDefault;
  }
}

export function RoomClient({ embedded = false }: { embedded?: boolean } = {}) {
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room") ?? "moonlit-loft";
  const visitTargetRaw = searchParams.get("visit");
  const visitTarget = visitTargetRaw ? normalizeFriendCode(visitTargetRaw) : null;
  const isHostRoom = !visitTarget;
  const activeRoom = roomBlueprints.find((room) => room.id === roomId) ?? roomBlueprints[0];
  const allowedVisitTarget = visitTarget ? lookupFriendCode(visitTarget) : null;
  // A visit link is honored as long as the code is well-formed. The host's
  // realtime presence still gates who actually sees the room — but we don't
  // bounce a guest at the doorstep just because we haven't met yet. The
  // visit itself counts as the meeting.
  const isVisitAllowed = !visitTarget || Boolean(allowedVisitTarget) || isFriendCodeShape(visitTarget);

  // Record the host in the played-with set as soon as the guest arrives, so
  // their friend-code resolves locally from then on.
  useEffect(() => {
    if (!visitTarget) return;
    if (!isFriendCodeShape(visitTarget)) return;
    recordPlayedWith({
      code: visitTarget,
      displayName: allowedVisitTarget?.displayName ?? "Keeper",
      context: `room-visit:${roomId}`,
    });
  }, [visitTarget, allowedVisitTarget?.displayName, roomId]);
  const [placements, setPlacements] = useState<RoomPlacement[]>(starterPlacements);
  const [draftPlacements, setDraftPlacements] = useState<RoomPlacement[]>(starterPlacements);
  const [saveStatus, setSaveStatus] = useState("Move-in ready");
  const placementCounter = useRef(0);
  const realtime = useRoomRealtime({
    roomId: isVisitAllowed ? activeRoom.id : "friend-only-gate",
    roomName: isVisitAllowed ? activeRoom.name : "Friend-only room",
  });
  const canEditRoom = isHostRoom || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);
  const { activeEvent } = useSeasonalEvent();
  const inventory = useInventory();
  const roomDrawerItems = inventory.view
    .filter((row) => isItemVisibleForSeason(row.catalog, activeEvent))
    .filter((row) => row.catalog.placementType === "floor" || row.catalog.placementType === "wall")
    .slice(0, 18);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const saved = readPlacements(activeRoom.id);
      setPlacements(saved);
      setDraftPlacements(saved);
      const hasSavedLayout = typeof window !== "undefined"
        && Boolean(window.localStorage.getItem(getRoomStorageKey(activeRoom.id)));
      setSaveStatus(hasSavedLayout ? "Loaded saved layout" : "Move-in ready layout");
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
    const cozyDefault = getStarterPlacementsForRoom(activeRoom.id);
    setDraftPlacements(cozyDefault);
    setPlacements(cozyDefault);
    setSaveStatus("Room restored to its move-in layout");
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
      {!embedded && <SeasonalEventBanner compact />}
      {!embedded && <WorldZoneDock active="room" />}
      <section className="hh-card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute inset-0 hh-bg-paper opacity-40" aria-hidden />
        <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="hh-eyebrow text-blush-500">Playable room</p>
            <h1 className="hh-display mt-1 text-4xl text-ink-900">{activeRoom.name}</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
              {activeRoom.description} Walk with click-to-move or WASD, drag furniture freely on both axes, choose
              left/right facing, layer objects on the 2.5D depth axis, and invite friends into the same hosted world.
            </p>
            <p className="mt-2 hh-eyebrow text-garden-700">{saveStatus}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="warm"><Move /> Design</Button>
            <Button disabled={!canEditRoom} onClick={saveRoom}><Save /> Save layout</Button>
            <Button disabled={!canEditRoom} onClick={resetRoom} variant="secondary"><RotateCcw /> Reset</Button>
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-cream-300 bg-white/72 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">Room wings</p>
            <p className="text-sm font-bold text-ink-700">Every room opens move-in ready. Rearrange it from the drawer, save the layout, then expand into another wing.</p>
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
              href={embedded ? `/app/area?zone=room&room=${room.id}` : room.href}
              key={room.id}
            >
              <span className="flex items-center gap-2 text-sm font-black"><DoorOpen className="size-4" /> {room.name}</span>
              <span className="mt-1 block text-xs font-bold">{room.capacity} friends | move-in ready</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="grid content-start gap-4 xl:sticky xl:top-4">
          <section className="rounded-lg border border-cream-300 bg-white/76 p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
                  <PackagePlus className="size-3.5" /> Room dock
                </p>
                <p className="mt-1 text-sm font-bold leading-5 text-ink-700">
                  Add furniture from here, then drag it inside the room. This stays in the game viewport.
                </p>
              </div>
              <span className="rounded-full bg-cream-100 px-2.5 py-1 text-xs font-black text-ink-700">{roomDrawerItems.length}</span>
            </div>
            <div className="grid max-h-[460px] gap-2 overflow-y-auto pr-1">
              {roomDrawerItems.length === 0 && (
                <div className="rounded-lg border border-cream-300 bg-cream-50 px-3 py-3 text-sm font-bold text-ink-600">
                  Your placeable inventory is empty. Buy room items in the shop or open daily gifts to stock this drawer.
                </div>
              )}
              {roomDrawerItems.map((row) => (
                <button
                  className="rounded-lg border border-cream-300 bg-cream-50 px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blush-300 hover:bg-blush-100/70 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canEditRoom}
                  key={row.entry.id}
                  onClick={() => addRoomItem(row.catalog)}
                  type="button"
                >
                  <span className="block text-sm font-black text-ink-900">{row.catalog.name}</span>
                  <span className="mt-0.5 block text-xs font-bold text-ink-600">
                    {row.catalog.category} | {row.catalog.placementType} | owned x{row.entry.quantity}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <RoomSocialPanel
            approvedDecoratorCodes={realtime.approvedDecoratorCodes}
            canManagePlacement={isHostRoom}
            connectionState={realtime.connectionState}
            inviteUrl={realtime.inviteUrl}
            messages={realtime.messages}
            onToggleDecorator={realtime.toggleDecoratorPermission}
            players={realtime.players}
            roomCode={realtime.roomCode}
            sendChat={realtime.sendChat}
            status={realtime.status}
          />
        </aside>
        <div className="grid content-start gap-3">
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
        </div>
      </section>
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-lavender-500" />
        Avatar movement and emotes sync during online visits. Furniture edits stay tied to the room layout so the space
        feels consistent every time you return.
      </div>
    </div>
  );
}
