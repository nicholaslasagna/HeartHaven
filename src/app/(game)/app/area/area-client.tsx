"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { DoorOpen, Gamepad2, Leaf, Map as MapIcon } from "lucide-react";
import { GardenClient } from "@/app/(game)/app/garden/garden-client";
import { ParkClient } from "@/app/(game)/app/park/park-client";
import { RoomClient } from "@/app/(game)/app/room/room-client";
import { HavenPulsePanel } from "@/components/game/haven-pulse-panel";
import { getCachedPublicUsername } from "@/lib/game/public-identity";
import type { gardenPlots, miniGames } from "@/lib/mock-data";

type AreaZone = "room" | "garden" | "park";

type AreaClientProps = {
  games: typeof miniGames;
  plots: typeof gardenPlots;
};

const ZONE_TABS: Array<{
  zone: AreaZone;
  label: string;
  hint: string;
  icon: typeof DoorOpen;
}> = [
  { zone: "room", label: "Your room", hint: "Decorate and host friends.", icon: DoorOpen },
  { zone: "garden", label: "Your garden", hint: "Plant, water, walk paths.", icon: Leaf },
  { zone: "park", label: "Park visit", hint: "Meet friends and play.", icon: MapIcon },
];

function normalizeZone(value: string | null): AreaZone {
  if (value === "garden" || value === "park") return value;
  return "room";
}

/**
 * The combined "Your Area" hub. Every keeper is the host of their own world,
 * and the three modes — room, garden, park — share one entry point instead
 * of feeling like three separate tabs. Friends join via the same invite flow
 * inside each mode; switching modes here is the host's view of moving rooms
 * inside their own world.
 */
export function AreaClient({ games, plots }: AreaClientProps) {
  const searchParams = useSearchParams();
  const initialZone = normalizeZone(searchParams.get("zone"));
  const [activeZone, setActiveZone] = useState<AreaZone>(initialZone);
  const [username, setUsername] = useState(getCachedPublicUsername);

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<{ username?: string }>).detail?.username;
      setUsername(next ?? getCachedPublicUsername());
    };
    window.addEventListener("hearthaven:public-username-changed", sync);
    return () => window.removeEventListener("hearthaven:public-username-changed", sync);
  }, []);

  useEffect(() => {
    // Keep the URL in sync as the host switches modes so a link to this view
    // restores the same mode on reload.
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("zone") === activeZone) return;
    url.searchParams.set("zone", activeZone);
    window.history.replaceState({}, "", url.toString());
  }, [activeZone]);

  return (
    <div className="grid gap-5">
      <section className="hh-card relative flex flex-col justify-between gap-4 overflow-hidden p-5 md:flex-row md:items-center">
        <div className="pointer-events-none absolute inset-0 hh-bg-paper opacity-40" aria-hidden />
        <div className="relative">
          <p className="hh-eyebrow text-blush-500">Your hosted world</p>
          <h1 className="hh-display mt-1 text-4xl text-ink-900">@{username}&apos;s haven</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            One place for your room, garden, and the park. Friends visit when you invite them, and they follow you
            wherever you move inside it.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-lavender-300/60 bg-lavender-100/60 px-3 py-1 text-xs font-extrabold text-lavender-500">
            <span aria-hidden>🐾</span>
            Right-click anywhere in the world to play as your companion. Hold to recall.
          </p>
        </div>
        <Link
          className="relative inline-flex items-center gap-2 rounded-md border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-extrabold text-ink-700 transition hover:-translate-y-0.5 hover:border-lavender-300 hover:bg-lavender-100"
          href="/app/games"
        >
          <Gamepad2 className="size-4" /> Open games hub
        </Link>
      </section>

      <section className="rounded-lg border border-cream-300 bg-white/72 p-3 shadow-sm">
        <div role="tablist" className="flex flex-wrap gap-2">
          {ZONE_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.zone === activeZone;
            return (
              <button
                aria-selected={selected}
                className={`min-w-[178px] rounded-lg border px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 ${
                  selected
                    ? "border-blush-300 bg-blush-100 text-ink-900"
                    : "border-cream-300 bg-cream-50 text-ink-700 hover:border-lavender-300 hover:bg-lavender-100/60"
                }`}
                key={tab.zone}
                onClick={() => setActiveZone(tab.zone)}
                role="tab"
                type="button"
              >
                <span className="flex items-center gap-2 text-sm font-black">
                  <Icon className="size-4" /> {tab.label}
                </span>
                <span className="mt-1 block text-xs font-bold">{tab.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <HavenPulsePanel activeZone={activeZone} />

      {activeZone === "room" && <RoomClient embedded />}
      {activeZone === "garden" && <GardenClient embedded games={games} plots={plots} />}
      {activeZone === "park" && <ParkClient embedded />}
    </div>
  );
}
