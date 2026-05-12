"use client";

import { CalendarDays, Gift, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { Badge } from "@/components/ui/badge";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";
import { cn } from "@/lib/utils";

type SeasonalEventBannerProps = {
  className?: string;
  compact?: boolean;
  showInactive?: boolean;
};

export function SeasonalEventBanner({ className, compact = false, showInactive = true }: SeasonalEventBannerProps) {
  const { activeEvent, nextEvent } = useSeasonalEvent();

  if (!activeEvent && !showInactive) return null;

  const event = activeEvent ?? nextEvent?.event;
  if (!event) return null;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-lg border p-4 shadow-sm",
        activeEvent ? event.className : "border-cream-300 bg-white/65 text-ink-900",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background: `radial-gradient(circle at 12% 20%, ${event.colors.accent}55, transparent 22%), radial-gradient(circle at 88% 18%, ${event.colors.secondary}44, transparent 20%), linear-gradient(135deg, ${event.colors.tint}cc, transparent)`,
        }}
      />
      <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-white/60 bg-white/70 text-ink-900" variant="outline">
              <Sparkles className="size-3.5" />
              {activeEvent ? "Season active" : "Next seasonal event"}
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-normal text-ink-700">
              <CalendarDays className="size-3.5" />
              {event.dateLabel}
            </span>
          </div>
          <h2 className={cn("mt-2 font-display text-ink-900", compact ? "text-2xl" : "text-3xl")}>{event.name}</h2>
          <p className="mt-1 max-w-3xl text-sm font-bold leading-6 text-ink-700">
            {activeEvent ? event.description : `${event.shortName} seasonal decor will appear automatically when the date window opens.`}
          </p>
        </div>
        <CozyButton asChild size="sm" variant={activeEvent ? "default" : "warm"}>
          <a href="/app/shop">
            <Gift /> {activeEvent ? "Shop event items" : "Preview market"}
          </a>
        </CozyButton>
      </div>
    </section>
  );
}
