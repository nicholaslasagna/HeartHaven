"use client";

import Link from "next/link";
import { ArrowRight, Leaf, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { MiniGameCard } from "@/components/cozy/mini-game-card";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Button } from "@/components/ui/button";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";
import type { gardenPlots, miniGames } from "@/lib/mock-data";

type GardenClientProps = {
  games: typeof miniGames;
  plots: typeof gardenPlots;
};

export function GardenClient({ games, plots }: GardenClientProps) {
  const searchParams = useSearchParams();
  const gardenId = searchParams.get("garden") ?? "caspers-moonberry-beds";
  const realtime = useGardenRealtime({ gardenId, gardenName: "Casper's Moonberry Beds" });

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
          onAvatarMove={realtime.sendMove}
          plots={plots}
          remotePlayers={realtime.players}
          variant="personal"
        />
        <GardenSocialPanel
          connectionState={realtime.connectionState}
          inviteUrl={realtime.inviteUrl}
          messages={realtime.messages}
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
