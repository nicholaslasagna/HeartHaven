import { Leaf } from "lucide-react";
import { GardenPlot } from "@/components/cozy/garden-plot";
import { MiniGameCard } from "@/components/cozy/mini-game-card";
import { CozyCard } from "@/components/cozy/cozy-card";
import { gardenPlots, miniGames } from "@/lib/mock-data";

export default function GardenPage() {
  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm">
        <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">My garden</p>
        <h1 className="mt-1 font-display text-4xl text-ink-900">Casper&apos;s Moonberry Beds</h1>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-garden-700">
          A simple garden loop with mock plot state, ready to connect to Supabase garden and harvest rows.
        </p>
      </section>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {gardenPlots.map((plot) => (
          <GardenPlot key={plot.id} {...plot} />
        ))}
      </div>
      <CozyCard className="p-5">
        <div className="flex items-center gap-2">
          <Leaf className="size-5 text-garden-500" />
          <h2 className="font-display text-2xl">Garden rewards</h2>
        </div>
        <p className="mt-2 text-sm font-semibold leading-6 text-ink-700">
          Phase 4 mini-games will reward seeds, coins, and hearts that feed directly into this garden loop.
        </p>
      </CozyCard>
      <div className="grid gap-5 md:grid-cols-2">
        {miniGames.map((game) => (
          <MiniGameCard key={game.id} {...game} />
        ))}
      </div>
    </div>
  );
}
