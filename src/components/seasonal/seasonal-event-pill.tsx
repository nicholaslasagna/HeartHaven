"use client";

import { Sparkles } from "lucide-react";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";
import { cn } from "@/lib/utils";

type SeasonalEventPillProps = {
  className?: string;
};

export function SeasonalEventPill({ className }: SeasonalEventPillProps) {
  const { activeEvent, nextEvent } = useSeasonalEvent();
  const event = activeEvent ?? nextEvent?.event;

  if (!event) return null;

  return (
    <a
      className={cn(
        "inline-flex min-w-fit items-center gap-2 rounded-full border px-3 py-2 text-xs font-extrabold text-ink-800 shadow-sm transition hover:-translate-y-0.5",
        activeEvent ? event.className : "border-cream-300 bg-white/70",
        className,
      )}
      href="/app/shop"
      title={activeEvent ? event.shopMessage : `${event.shortName} starts ${event.dateLabel}`}
    >
      <Sparkles className="size-3.5" />
      <span>{activeEvent ? event.shortName : `Next: ${event.shortName}`}</span>
    </a>
  );
}
