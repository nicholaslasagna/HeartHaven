/**
 * achievements — milestone badges, the Webkinz "trophy room" loop.
 *
 * A fixed catalogue of milestones, each tied to one cumulative metric. The
 * activity bus feeds metric progress; when a metric crosses a badge's threshold
 * the badge unlocks and pays a one-time coins/hearts reward.
 *
 * Storage: `hearthaven:achievements` in localStorage. Mutations dispatch
 * `hearthaven:achievements-changed` so mounted `useAchievements()` views refresh.
 *
 * TODO: mirror into a Supabase `achievements` table keyed by user id so badges
 * follow the player across devices — this shape maps 1:1.
 */

import { creditWallet } from "@/lib/game/wallet-store";
import type { ActivityType } from "@/lib/game/activity";

export const ACHIEVEMENTS_KEY = "hearthaven:achievements";
export const ACHIEVEMENTS_EVENT = "hearthaven:achievements-changed";

export type AchievementMetric =
  | "games-played"
  | "games-won"
  | "coins-earned"
  | "hearts-earned"
  | "pet-care-actions"
  | "tasks-completed"
  | "daily-streak";

export type AchievementDef = {
  id: string;
  name: string;
  description: string;
  /** lucide icon name, resolved in the UI layer. */
  icon: string;
  metric: AchievementMetric;
  threshold: number;
  rewardCoins: number;
  rewardHearts: number;
};

export type AchievementState = {
  /** Cumulative value per metric. `daily-streak` is a high-water mark, not a sum. */
  progress: Record<AchievementMetric, number>;
  unlocked: string[];
  unlockedAt: Record<string, string>;
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first-steps",      name: "First Steps",        description: "Play your very first mini-game.",            icon: "Sparkles",  metric: "games-played",     threshold: 1,    rewardCoins: 40,  rewardHearts: 1 },
  { id: "regular-player",   name: "Regular at the Park", description: "Play 15 mini-games.",                       icon: "Gamepad2",  metric: "games-played",     threshold: 15,   rewardCoins: 120, rewardHearts: 2 },
  { id: "game-night",       name: "Game-Night Legend",  description: "Play 50 mini-games.",                        icon: "Award",     metric: "games-played",     threshold: 50,   rewardCoins: 300, rewardHearts: 5 },
  { id: "first-win",        name: "Winner's Glow",      description: "Win your first party game.",                 icon: "Trophy",    metric: "games-won",        threshold: 1,    rewardCoins: 60,  rewardHearts: 2 },
  { id: "champion",         name: "Moonberry Champion", description: "Win 10 party games.",                        icon: "Medal",     metric: "games-won",        threshold: 10,   rewardCoins: 220, rewardHearts: 4 },
  { id: "coin-collector",   name: "Coin Collector",     description: "Earn 1,000 coins from games & tasks.",       icon: "Coins",     metric: "coins-earned",     threshold: 1000, rewardCoins: 150, rewardHearts: 2 },
  { id: "coin-tycoon",      name: "Honeyheart Tycoon",  description: "Earn 5,000 coins in total.",                 icon: "PiggyBank", metric: "coins-earned",     threshold: 5000, rewardCoins: 500, rewardHearts: 8 },
  { id: "heartfelt",        name: "Heartfelt",          description: "Gather 50 hearts.",                          icon: "Heart",     metric: "hearts-earned",    threshold: 50,   rewardCoins: 120, rewardHearts: 3 },
  { id: "caretaker",        name: "Gentle Caretaker",   description: "Care for your companion 10 times.",          icon: "PawPrint",  metric: "pet-care-actions", threshold: 10,   rewardCoins: 90,  rewardHearts: 3 },
  { id: "devoted",          name: "Devoted Keeper",     description: "Care for your companion 50 times.",          icon: "HandHeart", metric: "pet-care-actions", threshold: 50, rewardCoins: 260, rewardHearts: 6 },
  { id: "list-checker",     name: "List Checker",       description: "Complete 10 daily tasks.",                   icon: "ListChecks", metric: "tasks-completed", threshold: 10,   rewardCoins: 130, rewardHearts: 3 },
  { id: "week-streak",      name: "A Week of Warmth",   description: "Reach a 7-day login streak.",                icon: "Flame",     metric: "daily-streak",     threshold: 7,    rewardCoins: 200, rewardHearts: 5 },
  { id: "month-streak",     name: "A Month of Mornings",description: "Reach a 30-day login streak.",               icon: "Calendar",  metric: "daily-streak",     threshold: 30,   rewardCoins: 700, rewardHearts: 12 },
];

/** Activity-bus events mapped to the metric they advance. */
const METRIC_FOR_ACTIVITY: Partial<Record<ActivityType, AchievementMetric>> = {
  "game-played": "games-played",
  "game-won": "games-won",
  "coins-earned": "coins-earned",
  "hearts-earned": "hearts-earned",
  "pet-fed": "pet-care-actions",
  "pet-played": "pet-care-actions",
  "pet-pampered": "pet-care-actions",
  "pet-rested": "pet-care-actions",
  "task-completed": "tasks-completed",
  "daily-streak": "daily-streak",
};

function emptyProgress(): Record<AchievementMetric, number> {
  return {
    "games-played": 0,
    "games-won": 0,
    "coins-earned": 0,
    "hearts-earned": 0,
    "pet-care-actions": 0,
    "tasks-completed": 0,
    "daily-streak": 0,
  };
}

function freshState(): AchievementState {
  return { progress: emptyProgress(), unlocked: [], unlockedAt: {} };
}

export function readAchievementState(): AchievementState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<AchievementState>;
    return {
      progress: { ...emptyProgress(), ...(parsed.progress ?? {}) },
      unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked : [],
      unlockedAt: parsed.unlockedAt ?? {},
    };
  } catch {
    return freshState();
  }
}

function writeAchievementState(state: AchievementState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(ACHIEVEMENTS_EVENT, { detail: state }));
}

/**
 * Feed an activity into the achievement metrics, unlocking + paying any badge
 * that crosses its threshold. Returns the defs that JUST unlocked (for toasts).
 */
export function applyActivityToAchievements(type: ActivityType, value = 1): AchievementDef[] {
  const metric = METRIC_FOR_ACTIVITY[type];
  if (!metric) return [];

  const state = readAchievementState();
  // `daily-streak` is a high-water mark (the current streak), everything else sums.
  const nextValue = metric === "daily-streak"
    ? Math.max(state.progress[metric], value)
    : state.progress[metric] + value;
  if (nextValue === state.progress[metric]) return [];

  const progress = { ...state.progress, [metric]: nextValue };
  const newlyUnlocked: AchievementDef[] = [];
  const unlocked = [...state.unlocked];
  const unlockedAt = { ...state.unlockedAt };

  for (const def of ACHIEVEMENTS) {
    if (def.metric !== metric) continue;
    if (unlocked.includes(def.id)) continue;
    if (progress[metric] >= def.threshold) {
      unlocked.push(def.id);
      unlockedAt[def.id] = new Date().toISOString();
      newlyUnlocked.push(def);
      creditWallet({
        gameId: "achievement",
        label: `Achievement · ${def.name}`,
        score: def.threshold,
        coins: def.rewardCoins,
        hearts: def.rewardHearts,
      });
    }
  }

  writeAchievementState({ progress, unlocked, unlockedAt });
  return newlyUnlocked;
}

/** A UI-friendly view: every badge with its current progress + unlocked flag. */
export function getAchievementProgress(state: AchievementState = readAchievementState()) {
  return ACHIEVEMENTS.map((def) => {
    const current = state.progress[def.metric] ?? 0;
    const unlocked = state.unlocked.includes(def.id);
    return {
      def,
      current: Math.min(current, def.threshold),
      unlocked,
      unlockedAt: state.unlockedAt[def.id] ?? null,
      ratio: Math.min(1, current / def.threshold),
    };
  });
}
