"use client";

export const PROGRESSION_KEY = "hearthaven:player-progression";
export const PROGRESSION_EVENT = "hearthaven:player-progression-changed";

export type PlayerProgression = {
  points: number;
  updatedAt: number;
};

const LEVEL_POINTS = 220;

function freshProgression(): PlayerProgression {
  return { points: 0, updatedAt: Date.now() };
}

function rawRead(): PlayerProgression {
  if (typeof window === "undefined") return freshProgression();
  try {
    const raw = window.localStorage.getItem(PROGRESSION_KEY);
    if (!raw) return freshProgression();
    const parsed = JSON.parse(raw) as Partial<PlayerProgression>;
    return {
      points: Math.max(0, Math.floor(Number(parsed.points ?? 0))),
      updatedAt: Number(parsed.updatedAt ?? Date.now()),
    };
  } catch {
    return freshProgression();
  }
}

function rawWrite(state: PlayerProgression) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROGRESSION_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(PROGRESSION_EVENT, { detail: getPlayerLevelInfo(state) }));
}

export function getCompanionCap(level: number) {
  return Math.max(1, Math.floor(Math.max(1, level) / 10));
}

export function getPlayerLevelInfo(state: PlayerProgression = rawRead()) {
  const level = Math.max(1, Math.floor(state.points / LEVEL_POINTS) + 1);
  const currentLevelBase = (level - 1) * LEVEL_POINTS;
  const nextLevelAt = level * LEVEL_POINTS;
  return {
    points: state.points,
    level,
    currentLevelPoints: state.points - currentLevelBase,
    nextLevelPoints: LEVEL_POINTS,
    nextLevelAt,
    companionCap: getCompanionCap(level),
    updatedAt: state.updatedAt,
  };
}

export function readPlayerProgression() {
  return getPlayerLevelInfo(rawRead());
}

export function creditPlayerPoints(points: number, reason = "activity") {
  if (!Number.isFinite(points) || points <= 0) return readPlayerProgression();
  const current = rawRead();
  const next: PlayerProgression = {
    points: current.points + Math.floor(points),
    updatedAt: Date.now(),
  };
  rawWrite(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hearthaven:player-points-earned", {
      detail: { points: Math.floor(points), reason, progression: getPlayerLevelInfo(next) },
    }));
  }
  return getPlayerLevelInfo(next);
}
