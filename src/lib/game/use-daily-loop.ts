"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIVITY_EVENT, recordActivity } from "@/lib/game/activity";
import {
  DAILY_LOOP_EVENT,
  claimDailyGift,
  getDailyState,
  isDailyGiftAvailable,
  previewDailyGift,
  type DailyGiftResult,
  type DailyState,
} from "@/lib/game/daily-loop";

/**
 * useDailyLoop — React view of the daily gift + daily tasks + login streak.
 *
 * Re-reads on `hearthaven:daily-loop-changed` (gift claimed, task completed) and
 * on `hearthaven:activity` (any task progress). On mount it feeds the current
 * streak into the activity bus so the streak achievements ("A Week of Warmth")
 * can catch up even if the player didn't claim a gift this session.
 */
export function useDailyLoop() {
  const [state, setState] = useState<DailyState | null>(null);
  const streakSeeded = useRef(false);

  useEffect(() => {
    const sync = () => {
      const next = getDailyState();
      setState(next);
      // High-water-mark the streak achievement metric exactly once on load.
      if (!streakSeeded.current) {
        streakSeeded.current = true;
        if (next.streak > 0) recordActivity("daily-streak", next.streak);
      }
    };
    sync();

    window.addEventListener(DAILY_LOOP_EVENT, sync);
    window.addEventListener(ACTIVITY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DAILY_LOOP_EVENT, sync);
      window.removeEventListener(ACTIVITY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const claimGift = useCallback((): DailyGiftResult | null => {
    const result = claimDailyGift();
    if (result) {
      setState(getDailyState());
      // A longer streak can unlock streak achievements.
      recordActivity("daily-streak", result.streak);
    }
    return result;
  }, []);

  const giftAvailable = state ? isDailyGiftAvailable(state) : false;
  // Preview the reward for the streak position this claim would land on.
  const giftPreview = previewDailyGift((state?.streak ?? 0) + (giftAvailable ? 1 : 0));

  const tasks = useMemo(() => state?.tasks ?? [], [state]);
  const completedCount = tasks.filter((task) => task.complete).length;

  return useMemo(
    () => ({
      state,
      tasks,
      streak: state?.streak ?? 0,
      giftAvailable,
      giftPreview,
      claimGift,
      completedCount,
      totalTasks: tasks.length,
      ready: state !== null,
    }),
    [state, tasks, giftAvailable, giftPreview, claimGift, completedCount],
  );
}
