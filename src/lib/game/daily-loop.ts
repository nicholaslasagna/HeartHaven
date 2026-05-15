/**
 * daily-loop — the "reasons to come back tomorrow" engine.
 *
 * This is the Webkinz "Today's Activities + daily KinzCash" loop, modernized:
 *
 *   • Daily gift   — claimable once per calendar day; the reward escalates with
 *                    a consecutive-day login streak (and resets if you skip a day).
 *   • Daily tasks  — three tasks, regenerated each calendar day from a fixed pool
 *                    with a date-seeded shuffle (so they're stable through the day
 *                    but fresh tomorrow). Each task auto-pays its reward the moment
 *                    its goal is met — progress is driven by the activity bus.
 *
 * Storage: `hearthaven:daily-loop` in localStorage. Every mutation dispatches
 * `hearthaven:daily-loop-changed` so mounted `useDailyLoop()` views refresh.
 *
 * TODO: move `giftClaimedDate` + `streak` to a Supabase `user_streaks` row with a
 * server-verified date so the streak can't be clock-spoofed; keep this shape.
 */

import { creditWallet } from "@/lib/game/wallet-store";
import { awardDailyDrop } from "@/lib/game/inventory-store";
import type { CatalogItem } from "@/lib/game/types";
import type { ActivityType } from "@/lib/game/activity";

export const DAILY_LOOP_KEY = "hearthaven:daily-loop";
export const DAILY_LOOP_EVENT = "hearthaven:daily-loop-changed";

export type DailyTaskType =
  | "play-game"
  | "win-game"
  | "earn-coins"
  | "pet-care"
  | "play-with-pet"
  | "garden-water"
  | "room-visit";

export type DailyTask = {
  id: string;
  type: DailyTaskType;
  label: string;
  /** lucide icon name, resolved in the UI layer. */
  icon: string;
  goal: number;
  progress: number;
  rewardCoins: number;
  rewardHearts: number;
  complete: boolean;
};

export type DailyState = {
  /** YYYY-MM-DD the current task set belongs to. */
  date: string;
  tasks: DailyTask[];
  /** Last calendar day the daily gift was claimed (YYYY-MM-DD), or null. */
  giftClaimedDate: string | null;
  /** Consecutive-day login streak, advanced when the gift is claimed. */
  streak: number;
};

export type DailyGiftResult = {
  coins: number;
  hearts: number;
  streak: number;
  /** True when this claim extended a streak rather than starting fresh. */
  continued: boolean;
  /** A random catalog item dropped into inventory as part of the gift. */
  item: CatalogItem | null;
};

type TaskTemplate = Omit<DailyTask, "id" | "progress" | "complete">;

/** The pool the day's three tasks are drawn from. */
const TASK_TEMPLATES: TaskTemplate[] = [
  { type: "play-game",     label: "Play any mini-game",            icon: "Gamepad2",     goal: 1, rewardCoins: 40,  rewardHearts: 1 },
  { type: "play-game",     label: "Play three mini-games",         icon: "Gamepad2",     goal: 3, rewardCoins: 90,  rewardHearts: 2 },
  { type: "win-game",      label: "Win a party game",              icon: "Trophy",       goal: 1, rewardCoins: 70,  rewardHearts: 2 },
  { type: "earn-coins",    label: "Earn 150 coins from games",     icon: "Coins",        goal: 150, rewardCoins: 50, rewardHearts: 1 },
  { type: "pet-care",      label: "Care for your companion twice", icon: "Heart",        goal: 2, rewardCoins: 45,  rewardHearts: 2 },
  { type: "play-with-pet", label: "Play with your companion",      icon: "Sparkles",     goal: 1, rewardCoins: 35,  rewardHearts: 1 },
  { type: "garden-water",  label: "Water a garden plot",           icon: "Leaf",         goal: 1, rewardCoins: 35,  rewardHearts: 1 },
  { type: "room-visit",    label: "Spend time in your room",       icon: "Home",         goal: 1, rewardCoins: 30,  rewardHearts: 1 },
];

/** Which activity-bus events advance which task type. */
const TASK_ACTIVITY_MAP: Record<DailyTaskType, ActivityType[]> = {
  "play-game": ["game-played"],
  "win-game": ["game-won"],
  "earn-coins": ["coins-earned"],
  "pet-care": ["pet-fed", "pet-played", "pet-pampered", "pet-rested"],
  "play-with-pet": ["pet-played"],
  "garden-water": ["garden-watered"],
  "room-visit": ["room-visited"],
};

function todayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

/** Tiny deterministic PRNG so each calendar day picks a stable task set. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 48271) + 1) >>> 0;
    const j = h % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateTasks(dateKey: string): DailyTask[] {
  // Pick one of each distinct type first (so the three feel varied), then fill.
  const shuffled = seededShuffle(TASK_TEMPLATES, dateKey);
  const picked: TaskTemplate[] = [];
  const usedTypes = new Set<DailyTaskType>();
  for (const template of shuffled) {
    if (picked.length >= 3) break;
    if (usedTypes.has(template.type)) continue;
    usedTypes.add(template.type);
    picked.push(template);
  }
  return picked.map((template, index) => ({
    ...template,
    id: `${dateKey}-task-${index}`,
    progress: 0,
    complete: false,
  }));
}

function freshState(): DailyState {
  const date = todayKey();
  return { date, tasks: generateTasks(date), giftClaimedDate: null, streak: 0 };
}

function rawRead(): DailyState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(DAILY_LOOP_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<DailyState>;
    return {
      date: typeof parsed.date === "string" ? parsed.date : todayKey(),
      tasks: Array.isArray(parsed.tasks) ? (parsed.tasks as DailyTask[]) : generateTasks(todayKey()),
      giftClaimedDate: typeof parsed.giftClaimedDate === "string" ? parsed.giftClaimedDate : null,
      streak: Number.isFinite(parsed.streak) ? Number(parsed.streak) : 0,
    };
  } catch {
    return freshState();
  }
}

function rawWrite(state: DailyState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DAILY_LOOP_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(DAILY_LOOP_EVENT, { detail: state }));
}

/**
 * Read the daily state, rolling the task set over to a new day if the calendar
 * date changed. The gift/streak fields survive the rollover untouched.
 */
export function getDailyState(): DailyState {
  const state = rawRead();
  const today = todayKey();
  if (state.date !== today) {
    const rolled: DailyState = { ...state, date: today, tasks: generateTasks(today) };
    rawWrite(rolled);
    return rolled;
  }
  return state;
}

/** Streak-scaled daily gift: base 50 coins +15/streak day (capped), hearts every 3rd day. */
export function previewDailyGift(streak: number): { coins: number; hearts: number } {
  const day = Math.max(1, streak);
  return {
    coins: Math.min(50 + (day - 1) * 15, 170),
    hearts: day % 3 === 0 ? 3 : 1,
  };
}

export function isDailyGiftAvailable(state: DailyState = getDailyState()): boolean {
  return state.giftClaimedDate !== todayKey();
}

/**
 * Claim today's gift. Advances the streak if yesterday's gift was claimed,
 * otherwise restarts the streak at 1. Credits the wallet and returns the reward,
 * or null if the gift was already claimed today.
 */
export function claimDailyGift(): DailyGiftResult | null {
  const state = getDailyState();
  const today = todayKey();
  if (state.giftClaimedDate === today) return null;

  const continued = state.giftClaimedDate === yesterdayKey();
  const streak = continued ? state.streak + 1 : 1;
  const reward = previewDailyGift(streak);

  rawWrite({ ...state, giftClaimedDate: today, streak });
  creditWallet({
    gameId: "daily-gift",
    label: `Daily gift · day ${streak}`,
    score: streak,
    coins: reward.coins,
    hearts: reward.hearts,
  });
  // Every daily gift includes a surprise — a single catalog item drops into
  // the keeper's inventory. Streaks bias toward rarer items via the inventory
  // store's weighting.
  const item = awardDailyDrop();
  return { ...reward, streak, continued, item };
}

/**
 * Advance any daily task whose type is fed by this activity. Returns SNAPSHOTS
 * of the tasks that JUST completed (so the activity bus can tick the
 * "tasks-completed" achievement metric AND a toast layer can name the win).
 * Completed tasks auto-pay their reward into the wallet.
 */
export function applyActivityToDailyTasks(type: ActivityType, value = 1): DailyTask[] {
  const state = getDailyState();
  const justCompleted: DailyTask[] = [];
  let changed = false;

  const tasks = state.tasks.map((task) => {
    if (task.complete) return task;
    const feeds = TASK_ACTIVITY_MAP[task.type] ?? [];
    if (!feeds.includes(type)) return task;

    changed = true;
    const progress = Math.min(task.goal, task.progress + value);
    const complete = progress >= task.goal;
    const nextTask = { ...task, progress, complete };
    if (complete) {
      justCompleted.push(nextTask);
      creditWallet({
        gameId: "daily-task",
        label: `Daily task · ${task.label}`,
        score: task.goal,
        coins: task.rewardCoins,
        hearts: task.rewardHearts,
      });
    }
    return nextTask;
  });

  if (changed) rawWrite({ ...state, tasks });
  return justCompleted;
}
