"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Gamepad2, Map as MapIcon, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { readGardenDecor, writeGardenDecor, type GardenDecorPlacement } from "@/components/game/garden-canvas";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { CompanionMiniCard } from "@/components/game/park/companion-mini-card";
import { ParkControlCard } from "@/components/game/park/park-control-card";
import { ParkCoOpNudge } from "@/components/game/park/park-coop-nudge";
import { ParkDiscoveries } from "@/components/game/park/park-discoveries";
import { ParkHud } from "@/components/game/park/park-hud";
import { ParkMinimap } from "@/components/game/park/park-minimap";
import { WorldZoneDock } from "@/components/game/world-zone-dock";
import { Button } from "@/components/ui/button";
import { getActiveCompanion } from "@/lib/game/companion-roster";
import { getCachedPublicUsername } from "@/lib/game/public-identity";
import { getSocialState, isFriendCodeShape, lookupFriendCode, normalizeFriendCode, recordPlayedWith } from "@/lib/game/social";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";
import { parkGames } from "@/lib/mock-data";

const parkPlots = [
  { id: "park-rose", name: "Welcome Roses", stage: "Blooming", progress: 84, accent: "#F4B5BE", status: "Public" },
  { id: "park-lavender", name: "Lavender Bend", stage: "Growing", progress: 62, accent: "#8E70BD", status: "Public" },
  { id: "park-clover", name: "Clover Hill", stage: "Sprout", progress: 44, accent: "#6E9651", status: "Public" },
];

function changedDecorIds(previous: GardenDecorPlacement[], next: GardenDecorPlacement[]) {
  const previousById = new Map(previous.map((decoration) => [decoration.id, JSON.stringify(decoration)]));
  return next
    .filter((decoration) => previousById.get(decoration.id) !== JSON.stringify(decoration))
    .map((decoration) => decoration.id);
}

export function ParkClient({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const visitTargetRaw = searchParams.get("visit");
  const visitTarget = visitTargetRaw ? normalizeFriendCode(visitTargetRaw) : null;
  const isGuestVisit = Boolean(visitTarget);
  const allowedVisitTarget = visitTarget ? lookupFriendCode(visitTarget) : null;
  const isVisitAllowed = !visitTarget || Boolean(allowedVisitTarget) || isFriendCodeShape(visitTarget);

  const [playerName, setPlayerName] = useState(getCachedPublicUsername);
  const [companionName, setCompanionName] = useState(() => getActiveCompanion()?.name ?? "Casper");
  const [selfFriendCode, setSelfFriendCode] = useState(() =>
    typeof window === "undefined" ? "" : getSocialState().selfCode,
  );

  useEffect(() => {
    if (!visitTarget || !isFriendCodeShape(visitTarget)) return;
    recordPlayedWith({
      code: visitTarget,
      displayName: allowedVisitTarget?.displayName ?? "Keeper",
      context: "park-visit",
    });
  }, [visitTarget, allowedVisitTarget?.displayName]);

  useEffect(() => {
    const sync = () => setSelfFriendCode(getSocialState().selfCode);
    window.addEventListener("hearthaven:friend-code-regenerated", sync);
    return () => window.removeEventListener("hearthaven:friend-code-regenerated", sync);
  }, []);

  useEffect(() => {
    const syncUsername = () => setPlayerName(getCachedPublicUsername());
    const syncCompanion = () => setCompanionName(getActiveCompanion()?.name ?? "Casper");
    window.addEventListener("hearthaven:public-username-changed", syncUsername);
    window.addEventListener("hearthaven:companion-roster-changed", syncCompanion);
    return () => {
      window.removeEventListener("hearthaven:public-username-changed", syncUsername);
      window.removeEventListener("hearthaven:companion-roster-changed", syncCompanion);
    };
  }, []);

  const channelHostCode = visitTarget ?? selfFriendCode;
  const realtime = useGardenRealtime({
    hostFriendCode: channelHostCode,
    gardenId: isVisitAllowed ? "honeyheart-park" : "friend-only-park-gate",
    gardenName: isVisitAllowed ? "Honeyheart Park" : "Friend-only park",
    invitePath: embedded ? "/app/area" : "/app/park",
    inviteZone: embedded ? "park" : undefined,
  });
  const canEditGarden = !isGuestVisit || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);
  const realtimeDecor = realtime.decor as GardenDecorPlacement[] | null;
  const [decor, setDecor] = useState<GardenDecorPlacement[]>(() => readGardenDecor("park"));
  const [pendingDecorIds, setPendingDecorIds] = useState<string[]>([]);
  const [decorSaveStatus, setDecorSaveStatus] = useState("Park decor ready");
  const latestPersistedDecorRef = useRef<GardenDecorPlacement[]>(decor);
  const saveRealtimeDecor = realtime.saveDecor;

  // Mirror server-canonical decor for the park (variant="park"). Same
  // external-subscription justification as the room + garden clients.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (realtimeDecor) {
      setDecor(realtimeDecor);
      latestPersistedDecorRef.current = realtimeDecor;
      writeGardenDecor("park", realtimeDecor);
      setDecorSaveStatus(realtime.decorVersion > 0 ? `Park decor synced · v${realtime.decorVersion}` : "Park decor synced");
      return;
    }

    if (realtime.decorLoading) {
      setDecorSaveStatus("Loading park decor...");
      return;
    }

    const localDecor = readGardenDecor("park");
    setDecor(localDecor);
    latestPersistedDecorRef.current = localDecor;
    setDecorSaveStatus("Park decor loaded locally");
  }, [realtime.decorLoading, realtime.decorVersion, realtimeDecor]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDecorChange = useCallback(async (next: GardenDecorPlacement[]) => {
    if (!canEditGarden) {
      setDecorSaveStatus("You don't have permission to edit this garden.");
      return;
    }

    const previous = latestPersistedDecorRef.current;
    setPendingDecorIds(changedDecorIds(previous, next));
    setDecor(next);
    writeGardenDecor("park", next);
    setDecorSaveStatus("Saving park decor...");

    const result = await saveRealtimeDecor(next);
    setPendingDecorIds([]);

    if (result.ok) {
      latestPersistedDecorRef.current = next;
      setDecorSaveStatus(`Park decor saved · v${result.version}`);
      return;
    }

    if (result.reason === "network") {
      latestPersistedDecorRef.current = next;
      setDecorSaveStatus("Park decor saved locally. Online sync will retry when the park reconnects.");
      return;
    }

    const fallback = result.reason === "conflict" ? (realtimeDecor ?? previous) : previous;
    latestPersistedDecorRef.current = fallback;
    setDecor(fallback);
    writeGardenDecor("park", fallback);
    setDecorSaveStatus(
      result.reason === "conflict"
        ? "Someone else updated this — try again."
        : result.reason === "unauthorized"
          ? "You don't have permission to edit this garden."
          : (result.message ?? "Park decor could not be saved."),
    );
  }, [canEditGarden, realtimeDecor, saveRealtimeDecor]);

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href, { scroll: false });
    },
    [router],
  );

  if (!isVisitAllowed) {
    return (
      <div className="grid gap-5">
        <section className="rounded-lg border border-blush-300/40 bg-blush-100/65 p-6 shadow-sm">
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Friend-only park visit</p>
          <h1 className="mt-2 font-display text-4xl text-ink-900">Accept an invite first.</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Park lobbies only open for friends or keepers you have already played with. Add the host first, then return
            through the park invite.
          </p>
          <Button asChild className="mt-4" variant="warm">
            <Link href="/app/friends">Open Friends</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {!embedded && <WorldZoneDock active="park" />}

      {/* Hero banner — painted-paper card with the new design tokens */}
      <section className="hh-card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute inset-0 hh-bg-meadow opacity-50" aria-hidden />
        <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="hh-eyebrow text-garden-700">World · the park</p>
            <h1 className="hh-display mt-1 text-4xl text-ink-900">Honeyheart Park</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
              Twelve walkable plots, a fountain, a swing set, and three companion-only shortcuts. Right-click anywhere
              to swap who you control — your companion is faster and can sniff up rare drops.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              {/* Always go through the seamless container — the standalone
                  /app/garden route redirects here anyway. */}
              <Link href="/app/area?zone=garden">
                <ArrowLeft /> Garden road
              </Link>
            </Button>
            <Button asChild variant="warm">
              <Link href="/app/games">
                <MapIcon /> Invite party
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Three-column hub: left sidebar · canvas · right sidebar
          Below xl the columns stack so the canvas keeps a full-width row.
          The side columns are intentionally narrower than the design mock
          (220 + 260 vs 260 + 300) so the center canvas keeps painted-scene
          breathing room on 1440px viewports. */}
      <section className="grid min-w-0 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_260px]">
        <div className="grid gap-4 sm:grid-cols-2 xl:flex xl:flex-col">
          <ParkControlCard playerName={playerName} companionName={companionName} />
          <CompanionMiniCard />
          <section className="hh-card border-lavender-300/40 p-4 sm:col-span-2 xl:col-span-1">
            <p className="hh-eyebrow text-lavender-500">Companion abilities</p>
            <ul className="mt-2 grid gap-1.5 text-xs font-bold text-ink-700">
              <li className="flex items-center justify-between rounded-md bg-lavender-100/60 px-2 py-1">
                <span>Sniff hidden items</span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">Q</span>
              </li>
              <li className="flex items-center justify-between rounded-md bg-lavender-100/60 px-2 py-1">
                <span>Squeeze through gaps</span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">E</span>
              </li>
              <li className="flex items-center justify-between rounded-md bg-honey-100/70 px-2 py-1">
                <span>Dig fresh dirt</span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">F</span>
              </li>
              <li className="flex items-center justify-between rounded-md bg-blush-100/70 px-2 py-1">
                <span>Recall to keeper</span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">Hold R-click</span>
              </li>
            </ul>
          </section>
        </div>

        <div className="grid min-w-0 gap-3">
          <div className="relative min-w-0 overflow-hidden rounded-lg border border-cream-300 bg-cream-50 shadow-sm">
            <GardenCanvasLoader
              canEditGarden={canEditGarden}
              decor={decor}
              onAvatarMove={realtime.sendMove}
              onDecorChange={handleDecorChange}
              onNavigate={handleNavigate}
              pendingDecorIds={pendingDecorIds}
              plots={parkPlots}
              remotePlayers={realtime.players}
              variant="park"
            />
            <ParkHud playerName={playerName} companionName={companionName} />
          </div>
          <p className="rounded-md border border-honey-300/40 bg-white/70 px-3 py-2 text-xs font-extrabold text-honey-800">
            {decorSaveStatus}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:flex xl:flex-col">
          <ParkMinimap />
          <ParkDiscoveries />
          <ParkCoOpNudge />
        </div>
      </section>

      {/* Walk-up games strip */}
      <section className="hh-card relative overflow-hidden p-4">
        <div className="pointer-events-none absolute inset-0 hh-bg-paper opacity-40" aria-hidden />
        <div className="relative flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <Gamepad2 className="mt-1 size-5 text-honey-700" />
            <div>
              <p className="hh-eyebrow text-honey-700">Walk-up park games</p>
              <h2 className="hh-display text-2xl text-ink-900">Same games, faster door</h2>
              <p className="mt-1 max-w-xl text-sm font-bold text-ink-700">
                These also live as kiosks inside the painted park scene above. Tap to jump straight in.
              </p>
            </div>
          </div>
          <Button asChild variant="secondary">
            <Link href="/app/games">Open games hub</Link>
          </Button>
        </div>
        <div className="relative mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
          {parkGames.map((game) => (
            <Link
              className="rounded-lg border border-white/70 bg-white/70 p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:border-honey-500/40 hover:bg-white"
              href={game.href}
              key={game.id}
            >
              <span className="block font-display text-base text-ink-900">{game.title}</span>
              <span className="mt-1 block text-[10px] font-extrabold uppercase tracking-normal text-honey-700">{game.mode}</span>
              <span className="mt-1 block text-[11px] font-bold leading-4 text-ink-600">{game.description}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Friends + chat strip — kept intact, restyled to the new tokens */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="hh-card relative overflow-hidden p-4 text-sm font-bold leading-5 text-ink-700">
          <div className="pointer-events-none absolute inset-0 hh-bg-paper opacity-30" aria-hidden />
          <div className="relative flex items-start gap-3">
            <Sparkles className="mt-1 size-4 text-honey-700" />
            <p>
              The park is a public-world district with in-world game portals, companion-only paths, and shared
              discoveries. Right-click to play as your companion, then sniff the glow patches.
            </p>
          </div>
        </div>
        <GardenSocialPanel
          canManagePlacement={!isGuestVisit}
          approvedDecoratorCodes={realtime.approvedDecoratorCodes}
          connectionState={realtime.connectionState}
          inviteUrl={realtime.inviteUrl}
          messages={realtime.messages}
          onToggleDecorator={realtime.toggleDecoratorPermission}
          players={realtime.players}
          roomCode={realtime.gardenCode}
          sendChat={realtime.sendChat}
          status={realtime.status}
        />
      </section>
    </div>
  );
}
