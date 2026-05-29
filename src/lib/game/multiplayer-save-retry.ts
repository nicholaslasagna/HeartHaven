"use client";

import { hardenGardenDecor, hardenRoomPlacements } from "@/lib/game/realtime-hardening";
import type { RoomPlacement } from "@/lib/game/types";

const ROOM_PENDING_KEY = "hearthaven:pending-room-saves:v1";
const GARDEN_PENDING_KEY = "hearthaven:pending-garden-saves:v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingRoomSave = {
  hostCode: string;
  roomId: string;
  placements: RoomPlacement[];
  savedAt: number;
};

export type PendingGardenSave = {
  hostCode: string;
  gardenId: string;
  decor: ReturnType<typeof hardenGardenDecor>;
  savedAt: number;
};

function roomSaveKey(hostCode: string, roomId: string) {
  return `${hostCode}:${roomId}`;
}

function gardenSaveKey(hostCode: string, gardenId: string) {
  return `${hostCode}:${gardenId}`;
}

function readJsonRecord<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, T>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonRecord<T>(key: string, value: Record<string, T>) {
  if (typeof window === "undefined") return;
  if (Object.keys(value).length === 0) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function pruneByAge<T extends { savedAt: number }>(record: Record<string, T>) {
  const now = Date.now();
  const next: Record<string, T> = {};
  for (const [id, entry] of Object.entries(record)) {
    if (now - entry.savedAt <= MAX_AGE_MS) next[id] = entry;
  }
  return next;
}

export function queuePendingRoomSave(entry: PendingRoomSave) {
  const record = pruneByAge(readJsonRecord<PendingRoomSave>(ROOM_PENDING_KEY));
  record[roomSaveKey(entry.hostCode, entry.roomId)] = {
    ...entry,
    placements: hardenRoomPlacements(entry.placements),
    savedAt: Date.now(),
  };
  writeJsonRecord(ROOM_PENDING_KEY, record);
}

export function readPendingRoomSave(hostCode: string, roomId: string): PendingRoomSave | null {
  const record = pruneByAge(readJsonRecord<PendingRoomSave>(ROOM_PENDING_KEY));
  writeJsonRecord(ROOM_PENDING_KEY, record);
  const entry = record[roomSaveKey(hostCode, roomId)];
  if (!entry) return null;
  return { ...entry, placements: hardenRoomPlacements(entry.placements) };
}

export function clearPendingRoomSave(hostCode: string, roomId: string) {
  const record = pruneByAge(readJsonRecord<PendingRoomSave>(ROOM_PENDING_KEY));
  delete record[roomSaveKey(hostCode, roomId)];
  writeJsonRecord(ROOM_PENDING_KEY, record);
}

export function queuePendingGardenSave(entry: PendingGardenSave) {
  const record = pruneByAge(readJsonRecord<PendingGardenSave>(GARDEN_PENDING_KEY));
  record[gardenSaveKey(entry.hostCode, entry.gardenId)] = {
    ...entry,
    decor: hardenGardenDecor(entry.decor),
    savedAt: Date.now(),
  };
  writeJsonRecord(GARDEN_PENDING_KEY, record);
}

export function readPendingGardenSave(hostCode: string, gardenId: string): PendingGardenSave | null {
  const record = pruneByAge(readJsonRecord<PendingGardenSave>(GARDEN_PENDING_KEY));
  writeJsonRecord(GARDEN_PENDING_KEY, record);
  const entry = record[gardenSaveKey(hostCode, gardenId)];
  if (!entry) return null;
  return { ...entry, decor: hardenGardenDecor(entry.decor) };
}

export function clearPendingGardenSave(hostCode: string, gardenId: string) {
  const record = pruneByAge(readJsonRecord<PendingGardenSave>(GARDEN_PENDING_KEY));
  delete record[gardenSaveKey(hostCode, gardenId)];
  writeJsonRecord(GARDEN_PENDING_KEY, record);
}
