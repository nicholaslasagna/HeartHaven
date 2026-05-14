"use client";

import Link from "next/link";
import { ArrowLeft, Map, Sparkles } from "lucide-react";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { Button } from "@/components/ui/button";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";

const parkPlots = [
  { id: "park-rose", name: "Welcome Roses", stage: "Blooming", progress: 84, accent: "#F4B5BE", status: "Public" },
  { id: "park-lavender", name: "Lavender Bend", stage: "Growing", progress: 62, accent: "#8E70BD", status: "Public" },
  { id: "park-clover", name: "Clover Hill", stage: "Sprout", progress: 44, accent: "#6E9651", status: "Public" },
];

export function ParkClient() {
  const realtime = useGardenRealtime({
    gardenId: "honeyheart-park",
    gardenName: "Honeyheart Park",
    invitePath: "/app/park",
  });

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">World zone</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Honeyheart Park</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            A larger walkable road zone with a gazebo, swing set, picnic lawn, flower beds, and meetup paths. It uses the
            same avatar, companion, camera, and movement layer as the gardens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/app/garden"><ArrowLeft /> Garden road</Link>
          </Button>
          <Button asChild variant="warm">
            <Link href="/app/games"><Map /> Invite party</Link>
          </Button>
        </div>
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <GardenCanvasLoader
          onAvatarMove={realtime.sendMove}
          plots={parkPlots}
          remotePlayers={realtime.players}
          variant="park"
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
      <div className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-honey-700" />
        The park is a first public-world district. Next backend pass can attach room presence, friend parties, and
        moderated public chat to this same scene.
      </div>
    </div>
  );
}
