"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { Coins, DoorOpen, Maximize2, Move, PackagePlus, Plus, RotateCcw, Save, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { CompanionMiniCard } from "@/components/game/park/companion-mini-card";
import { RoomCanvasLoader } from "@/components/game/room-canvas-loader";
import { RoomSocialPanel } from "@/components/game/room-social-panel";
import { WorldZoneDock } from "@/components/game/world-zone-dock";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Button } from "@/components/ui/button";
import { recordActivity } from "@/lib/game/activity";
import { getStarterPlacementsForRoom, roomBlueprints, starterCatalog, starterPlacements } from "@/lib/catalog";
import type { CatalogItem, RoomPlacement } from "@/lib/game/types";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";
import { useRoomRealtime } from "@/lib/game/use-room-realtime";
import { useInventory } from "@/lib/game/use-inventory";
import { useGameWallet } from "@/lib/game/use-game-wallet";
import { getCatalogItemArt, getCatalogItemArtFit } from "@/lib/game/item-art";
import { getSocialState, isFriendCodeShape, lookupFriendCode, normalizeFriendCode, recordPlayedWith } from "@/lib/game/social";
import { PROGRESSION_EVENT, readPlayerProgression } from "@/lib/game/progression-store";
import {
  defaultRoomSurfaceSelection,
  readRoomSurfaces,
  roomFloorSurfaceOptions,
  roomWallSurfaceOptions,
  selectionFromServerSurfaces,
  writeRoomSurfaces,
  type RoomSurfaceOption,
  type RoomSurfaceSelection,
} from "@/lib/game/room-surfaces";
import { isItemVisibleForSeason } from "@/lib/seasonal-events";
import {
  clearPendingRoomSave,
  queuePendingRoomSave,
  readPendingRoomSave,
} from "@/lib/game/multiplayer-save-retry";

const ROOM_STORAGE_PREFIX = "hearthaven:room-placements:v2:";
const HOST_PLACEMENT_SAVE_DEBOUNCE_MS = 500;
const ROOM_EXPANSION_STORAGE_PREFIX = "hearthaven:room-expansions:v1:";
const ROOM_CANVAS_WIDTH = 960;
const ROOM_CANVAS_HEIGHT = 600;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getRoomStorageKey(roomId: string) {
  return `${ROOM_STORAGE_PREFIX}${roomId}`;
}

function getRoomExpansionStorageKey(roomId: string) {
  return `${ROOM_EXPANSION_STORAGE_PREFIX}${roomId}`;
}

function readRoomExpansions(roomId: string) {
  if (typeof window === "undefined") return 0;
  const parsed = Number(window.localStorage.getItem(getRoomExpansionStorageKey(roomId)) ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function writeRoomExpansions(roomId: string, expansions: number) {
  window.localStorage.setItem(getRoomExpansionStorageKey(roomId), String(Math.max(0, Math.floor(expansions))));
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

function writePlacementsBackup(roomId: string, placements: RoomPlacement[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getRoomStorageKey(roomId), JSON.stringify(placements));
}

function changedPlacementIds(previous: RoomPlacement[], next: RoomPlacement[]) {
  const previousById = new Map(previous.map((placement) => [placement.id, JSON.stringify(placement)]));
  return next
    .filter((placement) => previousById.get(placement.id) !== JSON.stringify(placement))
    .map((placement) => placement.id);
}

function roomDrawerPlacementLabel(item: CatalogItem) {
  if (item.placementType === "floor") return "Floor item";
  if (item.placementType === "wall") return "Wall item";
  if (item.placementType === "garden_plot") return "Garden item";
  return "Inventory item";
}

export function RoomClient({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
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
  const [savingPlacementIds, setSavingPlacementIds] = useState<string[]>([]);
  const [roomExpansions, setRoomExpansions] = useState(0);
  const [progression, setProgression] = useState(() => readPlayerProgression());
  const [roomSurfaces, setRoomSurfaces] = useState<RoomSurfaceSelection>(defaultRoomSurfaceSelection);
  const placementCounter = useRef(0);
  const roomDropRef = useRef<HTMLDivElement | null>(null);
  const latestPersistedPlacementsRef = useRef<RoomPlacement[]>(starterPlacements);
  const lastCommittedVersionRef = useRef(0);
  const hasPendingLocalEditRef = useRef(false);
  const placementCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPlacementsRef = useRef<RoomPlacement[] | null>(null);
  const { wallet, spendCurrency } = useGameWallet();
  // Resolve the channel-owning host friend code up-front so the realtime hook
  // never has to fall back to the room id. When a guest follows a ?visit=
  // link we honour their target host; otherwise we are the host so we key on
  // our own code. Without this, an early render with empty `localFriendCode`
  // could let the hook fall through to `room:<roomId>` while the visitor sits
  // on `room:<hostCode>`, and the two never meet on the same channel.
  const [selfFriendCode, setSelfFriendCode] = useState(() =>
    typeof window === "undefined" ? "" : getSocialState().selfCode,
  );
  useEffect(() => {
    const sync = () => setSelfFriendCode(getSocialState().selfCode);
    window.addEventListener("hearthaven:friend-code-regenerated", sync);
    return () => window.removeEventListener("hearthaven:friend-code-regenerated", sync);
  }, []);
  const channelHostCode = visitTarget ?? selfFriendCode;
  const realtime = useRoomRealtime({
    hostFriendCode: channelHostCode,
    roomId: isVisitAllowed ? activeRoom.id : "friend-only-gate",
    roomName: isVisitAllowed ? activeRoom.name : "Friend-only room",
  });
  const realtimePlacements = realtime.placements;
  const saveRealtimePlacements = realtime.savePlacements;
  const canEditRoom = isHostRoom || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);
  const { activeEvent } = useSeasonalEvent();
  const inventory = useInventory();
  const inventoryRoomRows = inventory.view
    .filter((row) => isItemVisibleForSeason(row.catalog, activeEvent))
    .filter((row) => row.catalog.placementType === "floor" || row.catalog.placementType === "wall")
    .slice(0, 18);
  const starterRoomRows = starterCatalog
    .filter((catalog) => catalog.placementType === "floor" || catalog.placementType === "wall")
    .slice(0, 18)
    .map((catalog, index) => ({
      catalog,
      entry: {
        id: `starter-drawer-${catalog.id}-${index}`,
        catalogItemId: catalog.id,
        quantity: 1,
        equipped: false,
        acquiredAt: "",
        source: "starter" as const,
      },
    }));
  const roomDrawerItems = inventoryRoomRows.length > 0 ? inventoryRoomRows : starterRoomRows;
  const activeRoomIndex = roomBlueprints.findIndex((room) => room.id === activeRoom.id);
  const roomById = useCallback((id?: string) => roomBlueprints.find((room) => room.id === id), []);
  const roomHref = useCallback(
    (room: { id: string; href: string }) => embedded ? `/app/area?zone=room&room=${room.id}${visitTarget ? `&visit=${encodeURIComponent(visitTarget)}` : ""}` : `${room.href}${visitTarget ? `&visit=${encodeURIComponent(visitTarget)}` : ""}`,
    [embedded, visitTarget],
  );
  const adjacentRooms = useMemo(() => {
    const fallbackLeft = roomBlueprints[(activeRoomIndex - 1 + roomBlueprints.length) % roomBlueprints.length];
    const fallbackRight = roomBlueprints[(activeRoomIndex + 1) % roomBlueprints.length];
    const left = roomById(activeRoom.connectedRoomIds?.left) ?? fallbackLeft;
    const right = roomById(activeRoom.connectedRoomIds?.right) ?? fallbackRight;
    return {
      left: { name: left.name, href: roomHref(left) },
      right: { name: right.name, href: roomHref(right) },
    };
  }, [activeRoom.connectedRoomIds?.left, activeRoom.connectedRoomIds?.right, activeRoomIndex, roomById, roomHref]);

  const baseRoomWidth = activeRoom.worldWidth ?? ROOM_CANVAS_WIDTH;
  const baseRoomHeight = activeRoom.worldHeight ?? ROOM_CANVAS_HEIGHT;
  const maxExpansionsBySize = Math.max(0, Math.floor((baseRoomWidth * 1.6 - baseRoomWidth) / 160));
  const maxExpansionsByLevel = Math.floor(progression.level / 3);
  const maxAffordableExpansionSlots = Math.min(maxExpansionsBySize, maxExpansionsByLevel);
  const effectiveExpansions = Math.min(roomExpansions, maxExpansionsBySize);
  const expandedWorldWidth = Math.min(Math.round(baseRoomWidth * 1.6), baseRoomWidth + effectiveExpansions * 160);
  const nextExpansionCost = 200 * (roomExpansions + 1) * (roomExpansions + 1);
  const canBuyExpansion = isHostRoom && roomExpansions < maxAffordableExpansionSlots && wallet.coins >= nextExpansionCost;
  const nextExpansionLevel = Math.max(3, (roomExpansions + 1) * 3);

  // Sync room-scoped local prefs (expansions, surfaces) from localStorage
  // whenever the active room changes. These are external-storage reads, so
  // the `set-state-in-effect` rule's stated allowed pattern — "subscribe
  // for updates from some external system, calling setState in a callback
  // function when external state changes" — applies. Disabling for this
  // specific line.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoomExpansions(readRoomExpansions(activeRoom.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoomSurfaces(readRoomSurfaces(activeRoom.id));
  }, [activeRoom.id]);

  useEffect(() => {
    if (realtime.surfacesLoading) return;
    const next = selectionFromServerSurfaces(realtime.surfaces);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoomSurfaces(next);
    writeRoomSurfaces(activeRoom.id, next);
  }, [activeRoom.id, realtime.surfaces, realtime.surfacesLoading]);

  // Mirror server-canonical placements (from `useRoomRealtime`) into the
  // local saved+draft state so the canvas + drawer see one truth. Same
  // external-subscription pattern justification as above — the realtime
  // hook IS the external system whose updates we're synchronising into
  // React state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (realtimePlacements) {
      const incomingVersion = realtime.placementsVersion;
      const previousCommitted = lastCommittedVersionRef.current;

      // Don't clobber in-progress edits when a guest saves mid-session.
      // If the server moved ahead while we were editing, apply their version.
      if (hasPendingLocalEditRef.current) {
        if (incomingVersion > previousCommitted) {
          hasPendingLocalEditRef.current = false;
          if (placementCommitTimerRef.current) {
            clearTimeout(placementCommitTimerRef.current);
            placementCommitTimerRef.current = null;
          }
          lastCommittedVersionRef.current = incomingVersion;
          setPlacements(realtimePlacements);
          setDraftPlacements(realtimePlacements);
          latestPersistedPlacementsRef.current = realtimePlacements;
          if (isHostRoom) writePlacementsBackup(activeRoom.id, realtimePlacements);
          setSaveStatus("Someone else updated this room — reloaded their version. Re-apply your changes.");
        }
        return;
      }

      lastCommittedVersionRef.current = Math.max(previousCommitted, incomingVersion);
      setPlacements(realtimePlacements);
      setDraftPlacements(realtimePlacements);
      latestPersistedPlacementsRef.current = realtimePlacements;
      if (isHostRoom) writePlacementsBackup(activeRoom.id, realtimePlacements);
      setSaveStatus(
        incomingVersion > 0
          ? `Synced room layout · v${incomingVersion}`
          : "Synced room layout",
      );
      return;
    }

    if (realtime.placementsLoading) {
      setSaveStatus("Loading saved room layout...");
      return;
    }

    const saved = isHostRoom ? readPlacements(activeRoom.id) : getStarterPlacementsForRoom(activeRoom.id);
    setPlacements(saved);
    setDraftPlacements(saved);
    latestPersistedPlacementsRef.current = saved;
    const hasSavedLayout = isHostRoom && typeof window !== "undefined"
      && Boolean(window.localStorage.getItem(getRoomStorageKey(activeRoom.id)));
    setSaveStatus(
      isHostRoom
        ? hasSavedLayout ? "Loaded local room layout" : "Move-in ready layout"
        : "Viewing host room layout",
    );
  }, [activeRoom.id, isHostRoom, realtimePlacements, realtime.placementsLoading, realtime.placementsVersion]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const syncProgression = () => setProgression(readPlayerProgression());
    syncProgression();
    window.addEventListener(PROGRESSION_EVENT, syncProgression);
    window.addEventListener("hearthaven:player-points-earned", syncProgression);
    return () => {
      window.removeEventListener(PROGRESSION_EVENT, syncProgression);
      window.removeEventListener("hearthaven:player-points-earned", syncProgression);
    };
  }, []);

  // Spending time in your room advances the "spend time in your room" daily task.
  useEffect(() => {
    recordActivity("room-visited");
  }, []);

  const commitRoomPlacements = useCallback(async (next: RoomPlacement[], source: "host-save" | "guest-commit" | "reset") => {
    if (!canEditRoom) {
      setSaveStatus("You don't have permission to edit this room.");
      return;
    }

    const previous = latestPersistedPlacementsRef.current;
    const pendingIds = changedPlacementIds(previous, next);
    setSavingPlacementIds(pendingIds);
    setDraftPlacements(next);
    setPlacements(next);
    if (isHostRoom) writePlacementsBackup(activeRoom.id, next);
    setSaveStatus(source === "guest-commit" ? "Saving decorator change..." : "Saving room layout...");
    pendingPlacementsRef.current = null;

    const result = await saveRealtimePlacements(next);
    setSavingPlacementIds([]);

    if (result.ok) {
      hasPendingLocalEditRef.current = false;
      latestPersistedPlacementsRef.current = next;
      lastCommittedVersionRef.current = result.version;
      clearPendingRoomSave(channelHostCode, activeRoom.id);
      setSaveStatus(`Room layout saved · v${result.version}`);
      return;
    }

    if (result.reason === "network") {
      hasPendingLocalEditRef.current = true;
      pendingPlacementsRef.current = next;
      latestPersistedPlacementsRef.current = next;
      queuePendingRoomSave({
        hostCode: channelHostCode,
        roomId: activeRoom.id,
        placements: next,
        savedAt: Date.now(),
      });
      setSaveStatus("Room layout saved locally. Retrying online sync when the room reconnects...");
      return;
    }

    hasPendingLocalEditRef.current = false;
    const fallback = result.reason === "conflict"
      ? (realtimePlacements ?? previous)
      : previous;
    latestPersistedPlacementsRef.current = fallback;
    setPlacements(fallback);
    setDraftPlacements(fallback);
    if (isHostRoom) writePlacementsBackup(activeRoom.id, fallback);

    if (result.reason === "conflict") {
      if (result.serverVersion) lastCommittedVersionRef.current = result.serverVersion;
      setSaveStatus("Someone else updated this room — reloaded their version. Re-apply your changes.");
      return;
    }

    if (result.reason === "unauthorized") {
      setSaveStatus("You don't have permission to edit this room.");
      return;
    }

    setSaveStatus(result.message ?? "Room layout could not be saved.");
  }, [activeRoom.id, canEditRoom, channelHostCode, realtimePlacements, saveRealtimePlacements]);

  const scheduleHostPlacementSave = useCallback((next: RoomPlacement[]) => {
    pendingPlacementsRef.current = next;
    if (placementCommitTimerRef.current) clearTimeout(placementCommitTimerRef.current);
    placementCommitTimerRef.current = setTimeout(() => {
      placementCommitTimerRef.current = null;
      const pending = pendingPlacementsRef.current;
      if (!pending) return;
      void commitRoomPlacements(pending, "host-save");
    }, HOST_PLACEMENT_SAVE_DEBOUNCE_MS);
  }, [commitRoomPlacements]);

  const handlePlacementsChange = useCallback((next: RoomPlacement[]) => {
    hasPendingLocalEditRef.current = true;
    setDraftPlacements(next);
    setPlacements(next);
    if (!canEditRoom) return;

    if (isHostRoom) {
      setSaveStatus("Saving room layout...");
      scheduleHostPlacementSave(next);
      return;
    }

    setSaveStatus("Saving decorator change...");
    void commitRoomPlacements(next, "guest-commit");
  }, [canEditRoom, commitRoomPlacements, isHostRoom, scheduleHostPlacementSave]);

  // Flush any layout that failed to reach the server once realtime reconnects.
  useEffect(() => {
    if (realtime.connectionState !== "connected" || !canEditRoom) return;

    const pending = readPendingRoomSave(channelHostCode, activeRoom.id);
    if (!pending) return;

    queueMicrotask(() => {
      void commitRoomPlacements(pending.placements, isHostRoom ? "host-save" : "guest-commit");
    });
  }, [activeRoom.id, canEditRoom, channelHostCode, commitRoomPlacements, isHostRoom, realtime.connectionState]);

  useEffect(() => {
    return () => {
      if (placementCommitTimerRef.current) clearTimeout(placementCommitTimerRef.current);
    };
  }, []);

  const handleRoomNavigate = useCallback(
    (href: string) => {
      router.push(href, { scroll: false });
    },
    [router],
  );

  function saveRoom() {
    if (placementCommitTimerRef.current) {
      clearTimeout(placementCommitTimerRef.current);
      placementCommitTimerRef.current = null;
    }
    void commitRoomPlacements(draftPlacements, "host-save");
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
    void commitRoomPlacements(cozyDefault, "reset");
  }

  function buyRoomExpansion() {
    if (!isHostRoom) {
      setSaveStatus("Only the room host can buy permanent room expansions.");
      return;
    }
    if (roomExpansions >= maxExpansionsBySize) {
      setSaveStatus(`${activeRoom.name} is already at its max expansion size.`);
      return;
    }
    if (roomExpansions >= maxExpansionsByLevel) {
      setSaveStatus(`Reach level ${nextExpansionLevel} before buying the next room expansion.`);
      return;
    }
    if (!spendCurrency(nextExpansionCost, 0)) {
      setSaveStatus(`You need ${nextExpansionCost} coins for the next expansion.`);
      return;
    }
    const next = roomExpansions + 1;
    writeRoomExpansions(activeRoom.id, next);
    setRoomExpansions(next);
    setSaveStatus(`${activeRoom.name} expanded by 160px. New width: ${baseRoomWidth + next * 160}px.`);
  }

  function chooseRoomSurface(kind: "floor" | "wall", option: RoomSurfaceOption) {
    if (!canEditRoom) {
      setSaveStatus("Ask the host for decorator access before repainting this room.");
      return;
    }
    const next = {
      ...roomSurfaces,
      [kind]: option,
    };
    setRoomSurfaces(next);
    writeRoomSurfaces(activeRoom.id, next);
    setSaveStatus(`Saving ${kind} surface...`);
    void realtime.saveSurfaces(next.floor.id, next.wall.id).then((result) => {
      if (result.ok) {
        setSaveStatus(kind === "floor" ? `Floor changed to ${option.name} · v${result.version}` : `Walls changed to ${option.name} · v${result.version}`);
        return;
      }
      setSaveStatus(result.message ?? "Surface could not be saved online.");
    });
  }

  function dropPointForItem(item: CatalogItem, event: DragEvent<HTMLDivElement>) {
    const canvas = roomDropRef.current?.querySelector("canvas");
    const rect = canvas?.getBoundingClientRect() ?? roomDropRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    const x = ((event.clientX - rect.left) / rect.width) * ROOM_CANVAS_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * ROOM_CANVAS_HEIGHT;

    if (item.placementType === "wall") {
      return {
        x: clamp(x, 180, 780),
        y: clamp(y, 112, 230),
      };
    }

    return {
      x: clamp(x, 130, 830),
      y: clamp(y, 250, 520),
    };
  }

  function addRoomItem(item: CatalogItem, point?: { x: number; y: number }) {
    if (!canEditRoom) {
      setSaveStatus("Ask the host for decorator access before adding furniture.");
      return;
    }
    placementCounter.current += 1;
    const nextPlacement: RoomPlacement = {
      id: `placement-${item.id}-${draftPlacements.length}-${placementCounter.current}`,
      catalogItemId: item.id,
      x: Math.round(point?.x ?? (item.placementType === "wall" ? 330 : 460)),
      y: Math.round(point?.y ?? (item.placementType === "wall" ? 150 : 340)),
      rotation: 0,
      scale: 1,
      zIndex: item.placementType === "wall" ? 0 : 3,
    };
    const next = [...draftPlacements, nextPlacement];
    handlePlacementsChange(next);
    setSaveStatus(`${item.name} added. Drag it in the room — layout syncs automatically.`);
  }

  function handleDrawerDragStart(event: DragEvent<HTMLButtonElement>, item: CatalogItem) {
    if (!canEditRoom) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/hearthaven-room-item", item.id);
    event.dataTransfer.setData("text/plain", item.id);
    setSaveStatus(`Dragging ${item.name}. Drop it onto the room canvas.`);
  }

  function handleRoomDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!canEditRoom) {
      setSaveStatus("Ask the host for decorator access before adding furniture.");
      return;
    }
    const itemId =
      event.dataTransfer.getData("application/hearthaven-room-item") || event.dataTransfer.getData("text/plain");
    const row = roomDrawerItems.find((entry) => entry.catalog.id === itemId);
    if (!row) return;
    addRoomItem(row.catalog, dropPointForItem(row.catalog, event));
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
    <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-5 overflow-hidden">
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
            <Button disabled={!canBuyExpansion} onClick={buyRoomExpansion} variant="secondary">
              <Maximize2 /> Expand · <Coins className="size-4" /> {nextExpansionCost}
            </Button>
            <Button disabled={!canEditRoom} onClick={saveRoom}><Save /> Save layout</Button>
            <Button disabled={!canEditRoom} onClick={resetRoom} variant="secondary"><RotateCcw /> Reset</Button>
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-honey-300/50 bg-honey-100/55 p-4 text-sm font-bold text-ink-700 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Room expansion: {roomExpansions} bought · {expandedWorldWidth}px wide.
            {" "}One 160px expansion unlocks every 3 levels, up to 1.6x the blueprint width.
          </span>
          <span className="rounded-full bg-white/78 px-3 py-1 text-xs font-black text-honey-800">
            Level {progression.level} · max now {maxAffordableExpansionSlots}/{maxExpansionsBySize}
          </span>
        </div>
      </section>
      <section className="rounded-lg border border-cream-300 bg-white/72 p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">Room wings</p>
            <p className="text-sm font-bold text-ink-700">Every room opens move-in ready. Rearrange from the drawer — layout syncs live for visitors — then expand into another wing.</p>
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
              href={roomHref(room)}
              key={room.id}
              scroll={false}
            >
              <span className="flex items-center gap-2 text-sm font-black"><DoorOpen className="size-4" /> {room.name}</span>
              <span className="mt-1 block text-xs font-bold">
                {room.worldWidth && room.worldWidth > 960 ? "Scrolling " : ""}fits {room.capacity} friends · move-in ready
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-4 overflow-hidden xl:grid-cols-[minmax(0,980px)_minmax(300px,360px)] xl:items-start xl:justify-center">
        <div
          className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-hidden"
          onDragOver={(event) => {
            if (!canEditRoom) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={handleRoomDrop}
          ref={roomDropRef}
        >
          <div className="relative mx-auto min-w-0 w-full max-w-[980px] overflow-visible">
            {canEditRoom && (
              <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full border border-white/70 bg-white/82 px-3 py-1 text-xs font-black text-ink-700 shadow-sm backdrop-blur">
                Drop furniture here
              </div>
            )}
            <RoomCanvasLoader
              canEditRoom={canEditRoom}
              onAvatarMove={realtime.sendMove}
              onPlacementsChange={handlePlacementsChange}
              onRoomNavigate={handleRoomNavigate}
              onRoomEmote={realtime.sendEmote}
              pendingPlacementIds={savingPlacementIds}
              placements={placements}
              remotePlayers={realtime.players}
              roomName={activeRoom.name}
              roomPortals={adjacentRooms}
              roomSurfaces={roomSurfaces}
              roomTheme={activeRoom.theme}
              worldWidth={expandedWorldWidth}
              worldHeight={baseRoomHeight}
            />
          </div>
          {!canEditRoom && (
            <p className="rounded-md border border-honey-500/30 bg-honey-100/60 px-3 py-2 text-xs font-extrabold text-honey-700">
              You&apos;re a guest in this room. Walk around, send emotes, and chat. The host can approve your username for
              decorator access if they want you to move furniture.
            </p>
          )}
        </div>

        <aside className="grid min-w-0 content-start gap-4 xl:max-h-[820px] xl:overflow-y-auto xl:pr-1">
          <CompanionMiniCard />
          <section className="order-3 rounded-lg border border-cream-300 bg-white/76 p-4 shadow-sm">
            <div className="mb-3">
              <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">Paint and tile</p>
              <p className="mt-1 text-sm font-bold leading-5 text-ink-700">
                Swap wallpaper and flooring instantly. These textures tile across expanded rooms.
              </p>
            </div>
            <div className="grid gap-3">
              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-ink-500">Walls</p>
                <div className="grid grid-cols-2 gap-2">
                  {roomWallSurfaceOptions.map((option) => (
                    <button
                      aria-pressed={roomSurfaces.wall.id === option.id}
                      className={`group overflow-hidden rounded-xl border bg-cream-50 text-left shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 ${
                        roomSurfaces.wall.id === option.id ? "border-lavender-300 ring-2 ring-lavender-200" : "border-cream-300"
                      }`}
                      disabled={!canEditRoom}
                      key={option.id}
                      onClick={() => chooseRoomSurface("wall", option)}
                      type="button"
                    >
                      <Image
                        alt={`${option.name} wall texture`}
                        className="h-14 w-full object-cover"
                        height={96}
                        src={option.asset}
                        width={160}
                      />
                      <span className="block px-2 py-1.5 text-xs font-black leading-tight text-ink-800">{option.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-ink-500">Floors</p>
                <div className="grid grid-cols-2 gap-2">
                  {roomFloorSurfaceOptions.map((option) => (
                    <button
                      aria-pressed={roomSurfaces.floor.id === option.id}
                      className={`group overflow-hidden rounded-xl border bg-cream-50 text-left shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 ${
                        roomSurfaces.floor.id === option.id ? "border-honey-300 ring-2 ring-honey-200" : "border-cream-300"
                      }`}
                      disabled={!canEditRoom}
                      key={option.id}
                      onClick={() => chooseRoomSurface("floor", option)}
                      type="button"
                    >
                      <Image
                        alt={`${option.name} floor texture`}
                        className="h-14 w-full object-cover"
                        height={96}
                        src={option.asset}
                        width={160}
                      />
                      <span className="block px-2 py-1.5 text-xs font-black leading-tight text-ink-800">{option.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <section className="order-2 rounded-lg border border-cream-300 bg-white/76 p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
                  <PackagePlus className="size-3.5" /> Room dock
                </p>
                <p className="mt-1 text-sm font-bold leading-5 text-ink-700">
                  Drag item cards onto the room, or tap one to place it near the center.
                </p>
              </div>
              <span className="rounded-full bg-cream-100 px-2.5 py-1 text-xs font-black text-ink-700">{roomDrawerItems.length}</span>
            </div>
            <div className="grid max-h-[520px] grid-cols-1 gap-2 overflow-y-auto pr-1">
              {roomDrawerItems.length === 0 && (
                <div className="rounded-lg border border-cream-300 bg-cream-50 px-3 py-3 text-sm font-bold text-ink-600">
                  Your placeable inventory is empty. Buy room items in the shop or open daily gifts to stock this drawer.
                </div>
              )}
              {inventory.ready && inventoryRoomRows.length === 0 && roomDrawerItems.length > 0 && (
                <div className="rounded-2xl border border-honey-300/60 bg-honey-100/70 px-3 py-2 text-xs font-extrabold leading-5 text-honey-700">
                  Starter crate shown so you can decorate right away. Purchased and gifted items appear here too.
                </div>
              )}
              {roomDrawerItems.map((row) => (
                <button
                  className="grid min-h-[116px] min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3 overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blush-300 hover:bg-blush-100/70 disabled:cursor-not-allowed disabled:opacity-50"
                  draggable={canEditRoom}
                  disabled={!canEditRoom}
                  key={row.entry.id}
                  onClick={() => addRoomItem(row.catalog)}
                  onDragStart={(event) => handleDrawerDragStart(event, row.catalog)}
                  type="button"
                >
                  <span className="relative grid h-24 w-[88px] place-items-center overflow-hidden rounded-xl border border-white/80 bg-white/78 shadow-inner">
                    <Image
                      alt={`${row.catalog.name} icon`}
                      className={`h-full w-full ${getCatalogItemArtFit(row.catalog) === "cover" ? "object-cover" : "object-contain p-2"} drop-shadow-[0_10px_14px_rgba(91,63,63,0.18)]`}
                      height={112}
                      src={getCatalogItemArt(row.catalog)}
                      width={112}
                    />
                    <span className="absolute bottom-1 right-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-black text-ink-700">
                      x{row.entry.quantity}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col justify-center self-stretch overflow-hidden">
                    <span className="line-clamp-2 text-sm font-black leading-tight text-ink-900">{row.catalog.name}</span>
                    <span className="mt-1 block truncate text-[11px] font-black uppercase tracking-normal text-ink-500">
                      {row.catalog.category} · {roomDrawerPlacementLabel(row.catalog)}
                    </span>
                    <span className="mt-1 line-clamp-2 text-xs font-semibold leading-4 text-ink-600">
                      {row.catalog.description}
                    </span>
                    <span className="mt-2 inline-flex w-fit rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-black uppercase tracking-normal text-blush-500">
                      drag to place
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <aside className="order-4 grid min-w-0 content-start gap-4">
            <RoomSocialPanel
              approvedDecoratorCodes={realtime.approvedDecoratorCodes}
              canManagePlacement={isHostRoom}
              connectionState={realtime.connectionState}
              inviteUrl={realtime.inviteUrl}
              messages={realtime.messages}
              onToggleDecorator={realtime.toggleDecoratorPermission}
              players={realtime.players}
              roomCode={realtime.roomCode}
              roomId={activeRoom.id}
              sendChat={realtime.sendChat}
              status={realtime.status}
            />
          </aside>
        </aside>
      </section>
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-lavender-500" />
        Avatar movement and emotes sync during online visits. Furniture edits stay tied to the room layout so the space
        feels consistent every time you return.
      </div>
    </div>
  );
}
