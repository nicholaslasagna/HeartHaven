import { creditWallet } from "@/lib/game/wallet-store";
import type { ActivityType } from "@/lib/game/activity";

export const DAILY_WISH_KEY = "hearthaven:daily-wish";
export const DAILY_WISH_EVENT = "hearthaven:daily-wish-changed";

export type DailyWishKind =
  | "breakfast"
  | "playtime"
  | "freshen-up"
  | "garden-help"
  | "room-check"
  | "arcade-date"
  | "restful-night";

export type DailyWish = {
  id: string;
  date: string;
  kind: DailyWishKind;
  label: string;
  copy: string;
  icon: string;
  actionHref: string;
  actionLabel: string;
  activityTypes: ActivityType[];
  goal: number;
  progress: number;
  rewardCoins: number;
  rewardHearts: number;
  complete: boolean;
};

type DailyWishTemplate = Omit<DailyWish, "id" | "date" | "progress" | "complete">;

const WISH_POOL: DailyWishTemplate[] = [
  {
    kind: "breakfast",
    label: "Casper wants breakfast",
    copy: "A tiny moonberry bowl would make the morning feel cared for.",
    icon: "PawPrint",
    actionHref: "/app/pet",
    actionLabel: "Feed Casper",
    activityTypes: ["pet-fed"],
    goal: 1,
    rewardCoins: 55,
    rewardHearts: 2,
  },
  {
    kind: "playtime",
    label: "Casper wants playtime",
    copy: "A quick companion play session keeps the whole haven brighter.",
    icon: "Sparkles",
    actionHref: "/app/pet",
    actionLabel: "Play together",
    activityTypes: ["pet-played"],
    goal: 1,
    rewardCoins: 45,
    rewardHearts: 2,
  },
  {
    kind: "freshen-up",
    label: "Casper wants a spa minute",
    copy: "A soft brush, a little sparkle, and the day feels new again.",
    icon: "Heart",
    actionHref: "/app/pet",
    actionLabel: "Pamper Casper",
    activityTypes: ["pet-pampered"],
    goal: 1,
    rewardCoins: 50,
    rewardHearts: 2,
  },
  {
    kind: "garden-help",
    label: "Casper wants garden help",
    copy: "Water one plot so the moonberries have something sweet to remember.",
    icon: "Leaf",
    actionHref: "/app/garden",
    actionLabel: "Water a plot",
    activityTypes: ["garden-watered"],
    goal: 1,
    rewardCoins: 60,
    rewardHearts: 2,
  },
  {
    kind: "room-check",
    label: "Casper wants a room visit",
    copy: "Stop by your room so it still feels lived-in and loved.",
    icon: "Home",
    actionHref: "/app/room",
    actionLabel: "Visit room",
    activityTypes: ["room-visited"],
    goal: 1,
    rewardCoins: 40,
    rewardHearts: 1,
  },
  {
    kind: "arcade-date",
    label: "Casper wants an arcade round",
    copy: "Play any game, win or lose. The fun is the little ritual.",
    icon: "Gamepad2",
    actionHref: "/app/games",
    actionLabel: "Choose a game",
    activityTypes: ["game-played"],
    goal: 1,
    rewardCoins: 65,
    rewardHearts: 2,
  },
  {
    kind: "restful-night",
    label: "Casper wants a nap plan",
    copy: "Let your companion rest so tonight feels peaceful.",
    icon: "Moon",
    actionHref: "/app/pet",
    actionLabel: "Rest together",
    activityTypes: ["pet-rested"],
    goal: 1,
    rewardCoins: 45,
    rewardHearts: 2,
  },
];

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hashDate(date: string) {
  let hash = 0;
  for (let index = 0; index < date.length; index += 1) {
    hash = (hash * 31 + date.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function freshWish(date = todayKey()): DailyWish {
  const template = WISH_POOL[hashDate(date) % WISH_POOL.length];
  return {
    ...template,
    id: `${date}-${template.kind}`,
    date,
    progress: 0,
    complete: false,
  };
}

function rawRead(): DailyWish {
  if (typeof window === "undefined") return freshWish();
  try {
    const raw = window.localStorage.getItem(DAILY_WISH_KEY);
    if (!raw) return freshWish();
    const parsed = JSON.parse(raw) as Partial<DailyWish>;
    const date = typeof parsed.date === "string" ? parsed.date : todayKey();
    const template = WISH_POOL.find((entry) => entry.kind === parsed.kind) ?? WISH_POOL[0];
    return {
      ...template,
      id: typeof parsed.id === "string" ? parsed.id : `${date}-${template.kind}`,
      date,
      progress: Math.max(0, Number(parsed.progress ?? 0)),
      complete: Boolean(parsed.complete),
    };
  } catch {
    return freshWish();
  }
}

function rawWrite(wish: DailyWish) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DAILY_WISH_KEY, JSON.stringify(wish));
  window.dispatchEvent(new CustomEvent(DAILY_WISH_EVENT, { detail: wish }));
}

export function getDailyWish(): DailyWish {
  const wish = rawRead();
  const today = todayKey();
  if (wish.date !== today) {
    const fresh = freshWish(today);
    rawWrite(fresh);
    return fresh;
  }
  return wish;
}

export function applyActivityToDailyWish(type: ActivityType, value = 1): DailyWish | null {
  const wish = getDailyWish();
  if (wish.complete || !wish.activityTypes.includes(type)) return null;

  const progress = Math.min(wish.goal, wish.progress + value);
  const complete = progress >= wish.goal;
  const next = { ...wish, progress, complete };
  rawWrite(next);

  if (complete) {
    creditWallet({
      gameId: "casper-daily-wish",
      label: `Casper's wish · ${wish.label}`,
      score: wish.goal,
      coins: wish.rewardCoins,
      hearts: wish.rewardHearts,
    });
  }

  return complete ? next : null;
}
