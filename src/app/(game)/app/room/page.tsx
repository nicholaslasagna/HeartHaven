import { Move, Save, Sparkles } from "lucide-react";
import { RoomCanvasLoader } from "@/components/game/room-canvas-loader";
import { Button } from "@/components/ui/button";
import { starterPlacements } from "@/lib/catalog";

export default function RoomPage() {
  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Playable room</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Moonlit Loft</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            A 2.5D room with click-to-move, WASD movement, companion behaviors, draggable furniture, hover outlines,
            rotation, and cozy object reactions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="warm"><Move /> Design</Button>
          <Button><Save /> Save draft</Button>
        </div>
      </section>
      <RoomCanvasLoader placements={starterPlacements} />
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        <Sparkles className="mr-2 inline size-4 text-lavender-500" />
        Placement edits are local for this MVP. Supabase persistence and multiplayer room sessions are marked in the
        Phaser scene where they should attach.
      </div>
    </div>
  );
}
