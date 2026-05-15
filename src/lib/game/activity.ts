/**
 * activity — the in-app event bus that connects "things the player did" to the
 * engagement systems (daily tasks + achievements).
 *
 * Anything meaningful the player does calls `recordActivity(type, value?)`.
 * That single call:
 *   1. advances any matching daily task (auto-paying tasks that complete),
 *   2. advances any matching achievement metric (auto-paying badges that unlock),
 *   3. credits a "tasks-completed" / streak tick where relevant,
 *   4. dispatches `hearthaven:activity` so mounted hooks can show a toast / refresh.
 *
 * Keeping the orchestration here means the daily-loop and achievements modules
 * never import each other — `activity.ts` is the only place they meet.
 */

import { applyActivityToDailyTasks } from "@/lib/game/daily-loop";
import { applyActivityToDailyWish, type DailyWish } from "@/lib/game/daily-wish";
import { applyActivityToAchievements, type AchievementDef } from "@/lib/game/achievements";

export type ActivityType =
  | "game-played"
  | "game-won"
  | "coins-earned"
  | "coins-spent"
  | "hearts-earned"
  | "pet-fed"
  | "pet-played"
  | "pet-pampered"
  | "pet-rested"
  | "garden-watered"
  | "room-visited"
  | "note-written"
  | "task-completed"
  | "daily-streak";

export const ACTIVITY_EVENT = "hearthaven:activity";

export type ActivityDetail = {
  type: ActivityType;
  value: number;
  meta?: Record<string, unknown>;
  /** Achievement badges that unlocked as a direct result of this activity. */
  unlockedAchievements: AchievementDef[];
  /** Number of daily tasks that completed as a direct result of this activity. */
  completedTaskCount: number;
  /** Casper's daily wish if this activity completed it. */
  completedWish: DailyWish | null;
};

/**
 * Record something the player did. `value` defaults to 1; for cumulative
 * activities ("coins-earned") pass the amount.
 */
export function recordActivity(
  type: ActivityType,
  value = 1,
  meta?: Record<string, unknown>,
): ActivityDetail {
  // 1. Daily tasks — returns ids of tasks that just completed.
  const completedTaskIds = applyActivityToDailyTasks(type, value);

  // 1b. Casper's daily wish — a pet-flavored single daily nudge.
  const completedWish = applyActivityToDailyWish(type, value);

  // 2. Achievement metrics for the activity itself.
  const unlocked = applyActivityToAchievements(type, value);

  // 3. Each freshly-completed daily task is itself a "tasks-completed" tick.
  if (completedTaskIds.length > 0) {
    unlocked.push(...applyActivityToAchievements("task-completed", completedTaskIds.length));
  }

  const detail: ActivityDetail = {
    type,
    value,
    meta,
    unlockedAchievements: unlocked,
    completedTaskCount: completedTaskIds.length,
    completedWish,
  };

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail }));
  }
  return detail;
}
