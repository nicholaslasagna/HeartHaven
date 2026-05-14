"use client";

import { useEffect, useMemo, useState } from "react";
import { ACTIVITY_EVENT } from "@/lib/game/activity";
import {
  ACHIEVEMENTS_EVENT,
  getAchievementProgress,
  readAchievementState,
  type AchievementState,
} from "@/lib/game/achievements";

/**
 * useAchievements — React view of the milestone-badge catalogue.
 *
 * Re-reads on `hearthaven:achievements-changed` (a badge unlocked) and on
 * `hearthaven:activity` (metric progress moved). Returns the full badge list
 * with per-badge progress so the UI can render locked + unlocked together.
 */
export function useAchievements() {
  const [state, setState] = useState<AchievementState | null>(null);

  useEffect(() => {
    const sync = () => setState(readAchievementState());
    sync();

    window.addEventListener(ACHIEVEMENTS_EVENT, sync);
    window.addEventListener(ACTIVITY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ACHIEVEMENTS_EVENT, sync);
      window.removeEventListener(ACTIVITY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const badges = useMemo(
    () => (state ? getAchievementProgress(state) : []),
    [state],
  );

  const unlockedCount = badges.filter((badge) => badge.unlocked).length;

  return useMemo(
    () => ({
      badges,
      unlockedCount,
      totalCount: badges.length,
      ready: state !== null,
    }),
    [badges, unlockedCount, state],
  );
}
