import type { CatalogItem } from "@/lib/game/types";

export type SeasonalEventId = "halloween" | "christmas" | "new-year" | "july-fourth";

export type SeasonalEvent = {
  id: SeasonalEventId;
  name: string;
  shortName: string;
  dateLabel: string;
  description: string;
  roomMessage: string;
  gardenMessage: string;
  shopMessage: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    tint: string;
  };
  className: string;
};

type EventWindow = {
  id: SeasonalEventId;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
};

export const seasonalEvents: Record<SeasonalEventId, SeasonalEvent> = {
  halloween: {
    id: "halloween",
    name: "Moonlit Halloween",
    shortName: "Halloween",
    dateLabel: "Oct 1 to Nov 2",
    description: "Pumpkins, little bat garlands, moonlit garden lights, and cozy costume-room pieces.",
    roomMessage: "Pumpkin lanterns and tiny bat garlands are glowing in the room.",
    gardenMessage: "The garden path has pumpkin lights, violet moon haze, and extra fireflies.",
    shopMessage: "Limited Halloween decor is in the market while Moonlit Halloween is active.",
    colors: { primary: "#7B4BA3", secondary: "#F5A142", accent: "#2F2540", tint: "#F7E7C7" },
    className: "border-lavender-300/50 bg-lavender-100/70 text-ink-900",
  },
  christmas: {
    id: "christmas",
    name: "Winter Wish Festival",
    shortName: "Christmas",
    dateLabel: "Dec 1 to Dec 26",
    description: "Snowfall, wish trees, soft garlands, cocoa tables, and warm cabin pieces.",
    roomMessage: "Snowflakes, garland lights, and a tiny wish tree have arrived.",
    gardenMessage: "Snow dusts the lantern path while the memory tree glows warm.",
    shopMessage: "Winter Wish furniture and garden pieces are available for the holiday window.",
    colors: { primary: "#C84C5A", secondary: "#3F8B66", accent: "#FAE3A8", tint: "#F4FAF0" },
    className: "border-garden-300/50 bg-garden-100/75 text-ink-900",
  },
  "new-year": {
    id: "new-year",
    name: "Starlit New Year",
    shortName: "New Year",
    dateLabel: "Dec 27 to Jan 7",
    description: "Countdown clocks, star confetti, sky lanterns, and sparkling room party pieces.",
    roomMessage: "Countdown stars and confetti sparkle across the room.",
    gardenMessage: "Sky lanterns drift above the shared garden for the new year.",
    shopMessage: "Starlit New Year party pieces are unlocked through the first week of January.",
    colors: { primary: "#1F5E84", secondary: "#D9A53E", accent: "#C0A8DC", tint: "#EFF7FF" },
    className: "border-sky-300/50 bg-sky-100/75 text-ink-900",
  },
  "july-fourth": {
    id: "july-fourth",
    name: "Starlight Picnic",
    shortName: "4th of July",
    dateLabel: "Jul 1 to Jul 7",
    description: "Picnic blankets, safe sparkler lanterns, berry fountains, and soft firework lights.",
    roomMessage: "Starlight bunting and sparkler lanterns are set up for a summer party.",
    gardenMessage: "Berry sparkler fountains and soft firework lights brighten the garden.",
    shopMessage: "Starlight Picnic items are available for the July celebration week.",
    colors: { primary: "#B94A58", secondary: "#5E94B0", accent: "#FAE3A8", tint: "#FFF7EA" },
    className: "border-blush-300/50 bg-blush-100/70 text-ink-900",
  },
};

const eventWindows: EventWindow[] = [
  { id: "new-year", startMonth: 12, startDay: 27, endMonth: 1, endDay: 7 },
  { id: "christmas", startMonth: 12, startDay: 1, endMonth: 12, endDay: 26 },
  { id: "halloween", startMonth: 10, startDay: 1, endMonth: 11, endDay: 2 },
  { id: "july-fourth", startMonth: 7, startDay: 1, endMonth: 7, endDay: 7 },
];

export function getActiveSeasonalEvent(date = new Date()): SeasonalEvent | null {
  const activeWindow = eventWindows.find((eventWindow) => isDateInWindow(date, eventWindow));
  return activeWindow ? seasonalEvents[activeWindow.id] : null;
}

export function getNextSeasonalEvent(date = new Date()) {
  const today = startOfDay(date);
  const candidates = eventWindows.flatMap((eventWindow) => {
    const thisYear = getStartDate(eventWindow, today.getFullYear());
    const nextYear = getStartDate(eventWindow, today.getFullYear() + 1);
    return [
      { event: seasonalEvents[eventWindow.id], startsAt: thisYear },
      { event: seasonalEvents[eventWindow.id], startsAt: nextYear },
    ];
  });

  return candidates
    .filter((candidate) => candidate.startsAt.getTime() >= today.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
}

export function isSeasonalCatalogItem(item: CatalogItem) {
  return item.tags.includes("seasonal") || item.tags.some((tag) => tag.startsWith("season:"));
}

export function isItemVisibleForSeason(item: CatalogItem, activeEvent: SeasonalEvent | null) {
  if (!isSeasonalCatalogItem(item)) return true;
  return Boolean(activeEvent && item.tags.includes(`season:${activeEvent.id}`));
}

export function getCatalogItemSeason(item: CatalogItem) {
  const tag = item.tags.find((entry) => entry.startsWith("season:"));
  const id = tag?.replace("season:", "") as SeasonalEventId | undefined;
  return id ? seasonalEvents[id] : null;
}

function monthDay(date: Date) {
  return (date.getMonth() + 1) * 100 + date.getDate();
}

function isDateInWindow(date: Date, eventWindow: EventWindow) {
  const current = monthDay(date);
  const start = eventWindow.startMonth * 100 + eventWindow.startDay;
  const end = eventWindow.endMonth * 100 + eventWindow.endDay;

  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function getStartDate(eventWindow: EventWindow, year: number) {
  return new Date(year, eventWindow.startMonth - 1, eventWindow.startDay);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
