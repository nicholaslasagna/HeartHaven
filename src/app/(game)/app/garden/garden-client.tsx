"use client";

import Link from "next/link";
import { ArrowRight, Leaf, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { MiniGameCard } from "@/components/cozy/mini-game-card";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Button } from "@/components/ui/button";
import { lookupFriendCode } from "@/lib/game/social";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";
import type { gardenPlots, miniGames } from "@/lib/mock-data";

type GardenClientProps = {
  games: typeof miniGames;
  plots: typeof gardenPlots;
};

export function GardenClient({ games, plots }: GardenClientProps) {
  const searchParams = useSearchParams();
  const gardenId = searchParams.get("garden") ?? "caspers-moonberry-beds";
  const visitTarget = searchParams.get("visit");
  const isGuestVisit = Boolean(visitTarget);
  const allowedVisitTarget = visitTarget ? lookupFriendCode(visitTarget) : null;
  const isVisitAllowed = !visitTarget || Boolean(allowedVisitTarget);
  const realtime = useGardenRealtime({
    gardenId: isVisitAllowed ? gardenId : "friend-only-gate",
    gardenName: isVisitAllowed ? "Casper's Moonberry Beds" : "Friend-only garden",
  });
  const canEditGarden = !isGuestVisit || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);

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
      <SeasonalEventBanner compact />
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
          <Link href="/app/park">
            Honeyheart Park <ArrowRight />
          </Link>
        </Button>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <GardenCanvasLoader
          canEditGarden={canEditGarden}
          onAvatarMove={realtime.sendMove}
          plots={plots}
          remotePlayers={realtime.players}
          variant="personal"
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
      <div className="rounded-lg border border-garden-300/40 bg-garden-100/70 p-4 text-sm font-bold text-ink-700">
        <Leaf className="mr-2 inline size-4 text-garden-700" />
        Garden visits and chat use Supabase Realtime when env vars are present; local demo mode keeps the full garden
        playable while backend setup is incomplete.
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
