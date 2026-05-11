import { Leaf, Sparkles } from "lucide-react";
import { MiniGameCard } from "@/components/cozy/mini-game-card";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { gardenPlots, miniGames } from "@/lib/mock-data";

export default function GardenPage() {
  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 shadow-sm">
        <p className="text-sm font-extrabold uppercase tracking-normal text-garden-700">My garden</p>
        <h1 className="mt-1 font-display text-4xl text-ink-900">Moonberry Meadow</h1>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-garden-700">
          A living Phaser garden with animated plants, water effects, lanterns, butterflies, and clickable plot care.
        </p>
      </section>
      <GardenCanvasLoader plots={gardenPlots} variant="personal" />
      <div className="rounded-lg border border-garden-300/40 bg-garden-100/70 p-4 text-sm font-bold text-ink-700">
        <Leaf className="mr-2 inline size-4 text-garden-700" />
        Garden care is interactive in Phaser now. Supabase persistence can attach to the click care events and plot
        growth state when Phase 2 begins.
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {miniGames.map((game) => (
          <MiniGameCard key={game.id} {...game} />
        ))}
      </div>
      <div className="rounded-lg border border-blush-300/40 bg-blush-100/60 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-blush-500" />
        Petal Catch is the first playable mini-game and feeds the garden reward loop.
      </div>
    </div>
  );
}
