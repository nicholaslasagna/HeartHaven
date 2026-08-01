"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Compass, Gamepad2, Heart, Leaf, Sparkles } from "lucide-react";
import { HavenTrailsLoader, type HavenTrailsCompanion } from "@/components/game/haven-trails-loader";
import { WorldZoneDock } from "@/components/game/world-zone-dock";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { getActiveCompanion, COMPANION_ROSTER_EVENT, type CompanionRecord } from "@/lib/game/companion-roster";
import { getKeeperCharacterPreset, readKeeperCustomization } from "@/lib/game/avatar-customization";
import { companionArtAsset } from "@/lib/game/companion-art";
import { getCachedPublicUsername } from "@/lib/game/public-identity";

const DISCOVERY_KEY = "hearthaven:trails-discoveries";
const TRAIL_DISCOVERY_COUNT = 3;

function readDiscoveries() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISCOVERY_KEY) ?? "null") as {
      dayKey?: string;
      found?: unknown;
    } | null;
    const today = new Date();
    const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (parsed?.dayKey !== dayKey) return [];
    return Array.isArray(parsed.found)
      ? parsed.found.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function HavenTrailsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const visitTarget = searchParams.get("visit");
  const [companion, setCompanion] = useState<CompanionRecord | null>(() => getActiveCompanion() ?? null);
  const [username, setUsername] = useState(() => getCachedPublicUsername());
  const [discoveries, setDiscoveries] = useState<string[]>(readDiscoveries);
  const [status, setStatus] = useState("Walk the lantern roads. Your companion may find a new scent — press Q when it glows.");

  useEffect(() => {
    const sync = () => setCompanion(getActiveCompanion() ?? null);
    window.addEventListener(COMPANION_ROSTER_EVENT, sync);
    return () => window.removeEventListener(COMPANION_ROSTER_EVENT, sync);
  }, []);

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<{ username?: string }>).detail?.username;
      setUsername(next ?? getCachedPublicUsername());
    };
    window.addEventListener("hearthaven:public-username-changed", sync);
    return () => window.removeEventListener("hearthaven:public-username-changed", sync);
  }, []);

  const active = companion ?? {
    id: "companion-casper",
    name: "Casper",
    speciesId: "kitten",
    toneId: "cream",
    accessory: "moonberry-bow",
    adoptedAt: "",
    active: true,
  } satisfies CompanionRecord;
  const keeper = getKeeperCharacterPreset(readKeeperCustomization().characterId);
  const companionPayload = useMemo<HavenTrailsCompanion>(() => ({
    name: active.name,
    speciesId: active.speciesId,
    toneId: active.toneId,
    image: companionArtAsset(active.speciesId),
  }), [active.name, active.speciesId, active.toneId]);

  const onEvent = useCallback((event: {
    type: "landmark" | "discovery" | "portal";
    id: string;
    label: string;
    copy?: string;
    href?: string;
  }) => {
    if (event.type === "portal" && event.href) {
      const target = new URL(event.href, window.location.origin);
      if (visitTarget) target.searchParams.set("visit", visitTarget);
      router.push(`${target.pathname}${target.search}`, { scroll: false });
      return;
    }
    if (event.type === "discovery") {
      setStatus(`${event.label}: ${event.copy ?? "A little trail keepsake for your journal."}`);
      setDiscoveries((current) => {
        if (current.includes(event.id)) return current;
        const next = [...current, event.id];
        const today = new Date();
        const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        window.localStorage.setItem(DISCOVERY_KEY, JSON.stringify({ dayKey, found: next }));
        return next;
      });
    }
  }, [router, visitTarget]);

  return (
    <div className="grid gap-5">
      <WorldZoneDock active="trails" />
      <section className="relative overflow-hidden rounded-lg border border-garden-300/60 bg-[#e8efd9] p-5 shadow-sm md:p-7">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-lavender-100/45" aria-hidden />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <Badge variant="garden"><Compass className="size-3.5" /> Living exploration</Badge>
            <h1 className="mt-3 font-display text-4xl text-ink-900 md:text-5xl">Haven Trails</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-ink-700">
              A connected lantern-road map for small discoveries, companion walks, and easy doors into the rest of HeartHaven.
              Your keeper and {active.name} travel together.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
            <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1.5"><Sparkles className="mr-1 inline size-3.5 text-honey-700" /> {discoveries.length}/{TRAIL_DISCOVERY_COUNT} finds today</span>
            <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1.5"><Heart className="mr-1 inline size-3.5 text-blush-500" /> Companion walk</span>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <CozyCard className="overflow-hidden p-2 sm:p-3">
          <HavenTrailsLoader
            key={`${active.speciesId}:${keeper.id}`}
            companion={companionPayload}
            discovered={discoveries}
            keeper={{ name: username, image: keeper.image }}
            onEvent={onEvent}
            onStatus={setStatus}
          />
          <div className="border-t border-cream-300/70 px-3 pb-1 pt-3 text-sm font-bold text-ink-700">{status}</div>
        </CozyCard>

        <aside className="grid content-start gap-4">
          <CozyCard className="p-4">
            <p className="hh-eyebrow text-blush-500">Walking together</p>
            <h2 className="mt-1 font-display text-2xl text-ink-900">{active.name}</h2>
            <p className="mt-1 text-sm font-bold text-ink-700">Your active companion follows your keeper across every trail.</p>
            <div className="mt-4 grid gap-2">
              <CozyButton asChild variant="warm"><Link href="/app/pet">Care for {active.name} <Heart /></Link></CozyButton>
              <CozyButton asChild variant="secondary"><Link href="/app/games">Play a game <Gamepad2 /></Link></CozyButton>
            </div>
          </CozyCard>
          <CozyCard className="border-lavender-300/60 bg-lavender-100/45 p-4">
            <p className="hh-eyebrow text-lavender-500">Trail doors</p>
            <p className="mt-1 text-sm font-bold leading-6 text-ink-700">Walk to a glowing sign, press E to explore landmarks, and press Q when your companion catches a scent.</p>
            <div className="mt-3 grid gap-2 text-xs font-extrabold text-ink-700">
              <span><Leaf className="mr-1 inline size-3.5 text-garden-700" /> Moonberry Garden</span>
              <span><Compass className="mr-1 inline size-3.5 text-lavender-500" /> Honeyheart Park</span>
              <span><Gamepad2 className="mr-1 inline size-3.5 text-blush-500" /> Arcade Meadow</span>
              <span><Sparkles className="mr-1 inline size-3.5 text-honey-700" /> Lantern Leap</span>
            </div>
          </CozyCard>
        </aside>
      </section>
    </div>
  );
}
