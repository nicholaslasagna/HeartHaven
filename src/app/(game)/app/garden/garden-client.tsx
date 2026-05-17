"use client";

import Link from "next/link";
import { ArrowRight, Leaf, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { MiniGameCard } from "@/components/cozy/mini-game-card";
import { readGardenDecor, writeGardenDecor, type GardenDecorPlacement } from "@/components/game/garden-canvas";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { CompanionMiniCard } from "@/components/game/park/companion-mini-card";
import { ParkControlCard } from "@/components/game/park/park-control-card";
import { WorldZoneDock } from "@/components/game/world-zone-dock";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Button } from "@/components/ui/button";
import { getActiveCompanion } from "@/lib/game/companion-roster";
import { getCachedPublicUsername } from "@/lib/game/public-identity";
import { getSocialState, isFriendCodeShape, lookupFriendCode, normalizeFriendCode, recordPlayedWith } from "@/lib/game/social";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";
import type { gardenPlots, miniGames } from "@/lib/mock-data";

type GardenClientProps = {
  games: typeof miniGames;
  plots: typeof gardenPlots;
  embedded?: boolean;
};

function changedDecorIds(previous: GardenDecorPlacement[], next: GardenDecorPlacement[]) {
  const previousById = new Map(previous.map((decoration) => [decoration.id, JSON.stringify(decoration)]));
  return next
    .filter((decoration) => previousById.get(decoration.id) !== JSON.stringify(decoration))
    .map((decoration) => decoration.id);
}

export function GardenClient({ games, plots, embedded = false }: GardenClientProps) {
  const searchParams = useSearchParams();
  const gardenId = searchParams.get("garden") ?? "caspers-moonberry-beds";
  const visitTargetRaw = searchParams.get("visit");
  const visitTarget = visitTargetRaw ? normalizeFriendCode(visitTargetRaw) : null;
  const isGuestVisit = Boolean(visitTarget);
  const allowedVisitTarget = visitTarget ? lookupFriendCode(visitTarget) : null;
  // Well-formed visit codes always allow entry. The presence of the URL
  // is itself the invite — the host gives it out, the guest follows it.
  const isVisitAllowed = !visitTarget || Boolean(allowedVisitTarget) || isFriendCodeShape(visitTarget);

  useEffect(() => {
    if (!visitTarget || !isFriendCodeShape(visitTarget)) return;
    recordPlayedWith({
      code: visitTarget,
      displayName: allowedVisitTarget?.displayName ?? "Keeper",
      context: `garden-visit:${gardenId}`,
    });
  }, [visitTarget, allowedVisitTarget?.displayName, gardenId]);
  const [selfFriendCode, setSelfFriendCode] = useState(() =>
    typeof window === "undefined" ? "" : getSocialState().selfCode,
  );
  useEffect(() => {
    const sync = () => setSelfFriendCode(getSocialState().selfCode);
    window.addEventListener("hearthaven:friend-code-regenerated", sync);
    return () => window.removeEventListener("hearthaven:friend-code-regenerated", sync);
  }, []);
  const channelHostCode = visitTarget ?? selfFriendCode;
  const realtime = useGardenRealtime({
    hostFriendCode: channelHostCode,
    gardenId: isVisitAllowed ? gardenId : "friend-only-gate",
    gardenName: isVisitAllowed ? "Casper's Moonberry Beds" : "Friend-only garden",
    invitePath: embedded ? "/app/area" : "/app/garden",
    inviteZone: embedded ? "garden" : undefined,
  });
  const canEditGarden = !isGuestVisit || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);
  const realtimeDecor = realtime.decor as GardenDecorPlacement[] | null;
  const [decor, setDecor] = useState<GardenDecorPlacement[]>(() => readGardenDecor("personal"));
  const [pendingDecorIds, setPendingDecorIds] = useState<string[]>([]);
  const [decorSaveStatus, setDecorSaveStatus] = useState("Garden decor ready");
  const latestPersistedDecorRef = useRef<GardenDecorPlacement[]>(decor);
  const saveRealtimeDecor = realtime.saveDecor;
  const [playerName, setPlayerName] = useState(getCachedPublicUsername);
  const [companionName, setCompanionName] = useState(() => getActiveCompanion()?.name ?? "Casper");

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

  // Mirror server-canonical decor (from `useGardenRealtime`) into local
  // state so the canvas + drawer see one truth. The realtime hook is the
  // external subscription source — set-state-in-effect is the documented
  // pattern for this case.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (realtimeDecor) {
      setDecor(realtimeDecor);
      latestPersistedDecorRef.current = realtimeDecor;
      writeGardenDecor("personal", realtimeDecor);
      setDecorSaveStatus(
        realtime.decorVersion > 0 ? `Garden decor synced · v${realtime.decorVersion}` : "Garden decor synced",
      );
      return;
    }

    if (realtime.decorLoading) {
      setDecorSaveStatus("Loading garden decor...");
      return;
    }

    const localDecor = readGardenDecor("personal");
    setDecor(localDecor);
    latestPersistedDecorRef.current = localDecor;
    setDecorSaveStatus("Garden decor loaded locally");
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
    writeGardenDecor("personal", next);
    setDecorSaveStatus("Saving garden decor...");

    const result = await saveRealtimeDecor(next);
    setPendingDecorIds([]);

    if (result.ok) {
      latestPersistedDecorRef.current = next;
      setDecorSaveStatus(`Garden decor saved · v${result.version}`);
      return;
    }

    if (result.reason === "network") {
      latestPersistedDecorRef.current = next;
      setDecorSaveStatus("Garden decor saved locally. Online sync will retry when the garden reconnects.");
      return;
    }

    const fallback = result.reason === "conflict" ? (realtimeDecor ?? previous) : previous;
    latestPersistedDecorRef.current = fallback;
    setDecor(fallback);
    writeGardenDecor("personal", fallback);
    setDecorSaveStatus(
      result.reason === "conflict"
        ? "Someone else updated this — try again."
        : result.reason === "unauthorized"
          ? "You don't have permission to edit this garden."
          : (result.message ?? "Garden decor could not be saved."),
    );
  }, [canEditGarden, realtimeDecor, saveRealtimeDecor]);

  if (!isVisitAllowed) {
    return (
      <div className="grid gap-5">
        <section className="rounded-lg border border-blush-300/40 bg-blush-100/65 p-6 shadow-sm">
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Friend-only garden</p>
          <h1 className="mt-2 font-display text-4xl text-ink-900">Accept an invite first.</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Garden visits only open for friends or keepers you have already played with. Ask the host to send a friend
            invite from the Friends page, then come back through the garden link.
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
      {!embedded && <SeasonalEventBanner compact />}
      {!embedded && <WorldZoneDock active="garden" />}
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">My garden</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Casper&apos;s Moonberry Beds</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-garden-700">
            A scrollable playable garden: walk with WASD or click-to-move, chat with visitors, water plots, decorate
            with garden objects from the in-game drawer, then follow the road into Honeyheart Park.
          </p>
        </div>
        <Button asChild variant="warm">
          <Link href={embedded ? "/app/area?zone=park" : "/app/park"}>
            Honeyheart Park <ArrowRight />
          </Link>
        </Button>
      </section>
      <section className="grid min-w-0 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
        <div className="grid gap-4 sm:grid-cols-2 xl:flex xl:flex-col">
          <ParkControlCard playerName={playerName} companionName={companionName} />
          <CompanionMiniCard />
          <section className="hh-card border-lavender-300/40 p-4 sm:col-span-2 xl:col-span-1">
            <p className="hh-eyebrow text-lavender-500">Garden actions</p>
            <ul className="mt-2 grid gap-1.5 text-xs font-bold text-ink-700">
              <li className="flex items-center justify-between rounded-md bg-lavender-100/60 px-2 py-1">
                <span>Sniff hidden patches</span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">Q</span>
              </li>
              <li className="flex items-center justify-between rounded-md bg-garden-100/70 px-2 py-1">
                <span>Drag decor from drawer</span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">Mouse</span>
              </li>
              <li className="flex items-center justify-between rounded-md bg-honey-100/70 px-2 py-1">
                <span>Flip selected decor</span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">R</span>
              </li>
              <li className="flex items-center justify-between rounded-md bg-blush-100/70 px-2 py-1">
                <span>Remove selected decor</span>
                <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-black">Delete</span>
              </li>
            </ul>
          </section>
        </div>
        <div className="grid min-w-0 gap-3 overflow-hidden">
          <GardenCanvasLoader
            canEditGarden={canEditGarden}
            decor={decor}
            onAvatarMove={realtime.sendMove}
            onDecorChange={handleDecorChange}
            pendingDecorIds={pendingDecorIds}
            plots={plots}
            remotePlayers={realtime.players}
            variant="personal"
          />
          <p className="rounded-md border border-garden-300/40 bg-white/70 px-3 py-2 text-xs font-extrabold text-garden-800">
            {decorSaveStatus}
          </p>
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
      <div className="rounded-lg border border-garden-300/40 bg-garden-100/70 p-4 text-sm font-bold text-ink-700">
        <Leaf className="mr-2 inline size-4 text-garden-700" />
        Garden visits and chat use online play when available. Solo mode keeps the full garden playable at any time.
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {games.map((game) => (
          <MiniGameCard key={game.id} {...game} />
        ))}
      </div>
      <div className="rounded-lg border border-blush-300/40 bg-blush-100/60 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-blush-500" />
        Garden decor, plot care, chat, and visitor movement are now in the same game viewport flow.
      </div>
    </div>
  );
}
