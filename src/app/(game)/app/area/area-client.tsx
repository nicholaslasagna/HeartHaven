"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { DoorOpen, Gamepad2, Leaf, Map as MapIcon } from "lucide-react";
import { GardenClient } from "@/app/(game)/app/garden/garden-client";
import { ParkClient } from "@/app/(game)/app/park/park-client";
import { RoomClient } from "@/app/(game)/app/room/room-client";
import { BringPartyButton } from "@/components/game/bring-party-button";
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
  image: string;
}> = [
  { zone: "room", label: "Your room", hint: "Decorate and host friends.", icon: DoorOpen, image: "/game-assets/generated/cozy-room-bg.png" },
  { zone: "garden", label: "Your garden", hint: "Plant, water, walk paths.", icon: Leaf, image: "/game-assets/generated/garden-bare-map.png" },
  { zone: "park", label: "Park visit", hint: "Meet friends and play.", icon: MapIcon, image: "/game-assets/generated/park-bare-map.png" },
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeZone = normalizeZone(searchParams.get("zone"));
  const [username, setUsername] = useState(getCachedPublicUsername);

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<{ username?: string }>).detail?.username;
      setUsername(next ?? getCachedPublicUsername());
    };
    window.addEventListener("hearthaven:public-username-changed", sync);
    return () => window.removeEventListener("hearthaven:public-username-changed", sync);
  }, []);

  function navigateZone(zone: AreaZone) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("zone", zone);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

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
        <div className="relative flex flex-col items-end gap-2">
          <BringPartyButton
            label={
              activeZone === "garden"
                ? "your garden"
                : activeZone === "park"
                  ? "the park"
                  : "your room"
            }
            path={`/app/area?zone=${activeZone}`}
          />
          <Link
            className="inline-flex items-center gap-2 rounded-md border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-extrabold text-ink-700 transition hover:-translate-y-0.5 hover:border-lavender-300 hover:bg-lavender-100"
            href="/app/games"
          >
            <Gamepad2 className="size-4" /> Open games hub
          </Link>
        </div>
      </section>

      <section className="rounded-3xl border border-cream-300 bg-white/72 p-3 shadow-sm">
        <div role="tablist" className="grid gap-3 md:grid-cols-3">
          {ZONE_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.zone === activeZone;
            return (
              <button
                aria-selected={selected}
                className={`grid grid-cols-[88px_1fr] gap-3 rounded-2xl border p-2 text-left shadow-sm transition hover:-translate-y-0.5 ${
                  selected
                    ? "border-blush-300 bg-blush-100 text-ink-900"
                    : "border-cream-300 bg-cream-50 text-ink-700 hover:border-lavender-300 hover:bg-lavender-100/60"
                }`}
                key={tab.zone}
                onClick={() => navigateZone(tab.zone)}
                role="tab"
                type="button"
              >
                <span className="relative grid h-20 place-items-center overflow-hidden rounded-xl border border-white/80 bg-white/80 shadow-inner">
                  <Image alt={`${tab.label} preview`} className="h-full w-full object-cover" height={120} src={tab.image} width={160} />
                </span>
                <span className="self-center">
                  <span className="flex items-center gap-2 text-sm font-black">
                    <Icon className="size-4" /> {tab.label}
                  </span>
                  <span className="mt-1 block text-xs font-bold">{tab.hint}</span>
                </span>
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
