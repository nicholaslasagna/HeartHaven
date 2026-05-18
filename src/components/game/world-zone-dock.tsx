"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Gamepad2, Home, Leaf, Map } from "lucide-react";

const zones = [
  { href: "/app/area?zone=room", match: "room", label: "Room", icon: Home, copy: "Decorate and host friends" },
  { href: "/app/area?zone=garden", match: "garden", label: "Garden", icon: Leaf, copy: "Walk paths and care for plots" },
  { href: "/app/area?zone=park", match: "park", label: "Park", icon: Map, copy: "Meet up and launch games" },
  { href: "/app/games", match: "games", label: "Games", icon: Gamepad2, copy: "Party games and rewards" },
];

export function WorldZoneDock({ active }: { active: "room" | "garden" | "park" | "games" }) {
  const searchParams = useSearchParams();
  const visitTarget = searchParams.get("visit");
  const currentRoom = searchParams.get("room");
  const zoneHrefs = useMemo(() => {
    const areaHref = (zone: "room" | "garden" | "park") => {
      const params = new URLSearchParams({ zone });
      if (zone === "room" && currentRoom) params.set("room", currentRoom);
      if (visitTarget) params.set("visit", visitTarget);
      return `/app/area?${params.toString()}`;
    };
    return {
      room: areaHref("room"),
      garden: areaHref("garden"),
      park: areaHref("park"),
      games: "/app/games",
    };
  }, [currentRoom, visitTarget]);

  return (
    <section className="rounded-lg border border-cream-300 bg-white/68 p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">Your area</p>
          <p className="text-sm font-bold text-ink-700">Room, garden, park — all one hosted world. Friends follow your invite wherever you move.</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {zones.map((zone) => {
            const Icon = zone.icon;
            const selected = zone.match === active;
            return (
              <Link
                className={`min-w-[138px] rounded-lg border px-3 py-2 shadow-sm transition hover:-translate-y-0.5 ${
                  selected
                    ? "border-blush-300 bg-blush-100 text-ink-900"
                    : "border-cream-300 bg-cream-50 text-ink-700 hover:border-lavender-300 hover:bg-lavender-100/60"
                }`}
                href={zoneHrefs[zone.match as keyof typeof zoneHrefs] ?? zone.href}
                key={zone.href}
                scroll={false}
              >
                <span className="flex items-center gap-2 text-sm font-black"><Icon className="size-4" /> {zone.label}</span>
                <span className="mt-1 block text-xs font-bold">{zone.copy}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
