"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowLeft, Gamepad2, Map, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { WorldZoneDock } from "@/components/game/world-zone-dock";
import { Button } from "@/components/ui/button";
import { isFriendCodeShape, lookupFriendCode, normalizeFriendCode, recordPlayedWith } from "@/lib/game/social";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";
import { parkGames } from "@/lib/mock-data";

const parkPlots = [
  { id: "park-rose", name: "Welcome Roses", stage: "Blooming", progress: 84, accent: "#F4B5BE", status: "Public" },
  { id: "park-lavender", name: "Lavender Bend", stage: "Growing", progress: 62, accent: "#8E70BD", status: "Public" },
  { id: "park-clover", name: "Clover Hill", stage: "Sprout", progress: 44, accent: "#6E9651", status: "Public" },
];

export function ParkClient({ embedded = false }: { embedded?: boolean } = {}) {
  const searchParams = useSearchParams();
  const visitTargetRaw = searchParams.get("visit");
  const visitTarget = visitTargetRaw ? normalizeFriendCode(visitTargetRaw) : null;
  const isGuestVisit = Boolean(visitTarget);
  const allowedVisitTarget = visitTarget ? lookupFriendCode(visitTarget) : null;
  // Well-formed park-visit codes always allow entry.
  const isVisitAllowed = !visitTarget || Boolean(allowedVisitTarget) || isFriendCodeShape(visitTarget);

  useEffect(() => {
    if (!visitTarget || !isFriendCodeShape(visitTarget)) return;
    recordPlayedWith({
      code: visitTarget,
      displayName: allowedVisitTarget?.displayName ?? "Keeper",
      context: "park-visit",
    });
  }, [visitTarget, allowedVisitTarget?.displayName]);
  const realtime = useGardenRealtime({
    gardenId: isVisitAllowed ? "honeyheart-park" : "friend-only-park-gate",
    gardenName: isVisitAllowed ? "Honeyheart Park" : "Friend-only park",
    invitePath: embedded ? "/app/area" : "/app/park",
    inviteZone: embedded ? "park" : undefined,
  });
  const canEditGarden = !isGuestVisit || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);

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
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">World zone</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Honeyheart Park</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            A larger walkable road zone with a gazebo, swing set, picnic lawn, flower beds, arcade kiosks, and meetup
            paths. It uses the same avatar, companion, camera, chat, and movement layer as the gardens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href={embedded ? "/app/area?zone=garden" : "/app/garden"}><ArrowLeft /> Garden road</Link>
          </Button>
          <Button asChild variant="warm">
            <Link href="/app/games"><Map /> Invite party</Link>
          </Button>
        </div>
      </section>
      <section className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 shadow-sm">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Gamepad2 className="size-5 text-honey-700" />
              <h2 className="font-display text-2xl text-ink-900">Walk-up park games</h2>
            </div>
            <p className="mt-1 text-sm font-bold text-ink-700">
              The same games are clickable from the Phaser park scene and available here for quick launch.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/app/games">Open games hub</Link>
          </Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {parkGames.map((game) => (
            <Link
              className="rounded-lg border border-white/70 bg-white/74 p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-honey-500/50 hover:bg-white"
              href={game.href}
              key={game.id}
            >
              <span className="block font-display text-lg text-ink-900">{game.title}</span>
              <span className="mt-1 block text-xs font-extrabold uppercase tracking-normal text-honey-700">{game.mode}</span>
              <span className="mt-2 block text-xs font-bold leading-5 text-ink-600">{game.description}</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <GardenCanvasLoader
          canEditGarden={canEditGarden}
          onAvatarMove={realtime.sendMove}
          plots={parkPlots}
          remotePlayers={realtime.players}
          variant="park"
        />
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
      <div className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-honey-700" />
        The park is now a public-world district with in-world game portals. Next backend pass can attach room presence,
        friend parties, and moderated public chat to this same scene.
      </div>
    </div>
  );
}
