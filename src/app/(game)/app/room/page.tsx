import { Download, Move, Save } from "lucide-react";
import { RoomCanvasLoader } from "@/components/game/room-canvas-loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { starterCatalog, starterPlacements } from "@/lib/catalog";

export default function RoomPage() {
  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Personal room</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Moonlit Loft</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Phaser 3 renders this room with keyboard movement, starter placed items, a player avatar, and Casper.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="warm"><Move /> Place</Button>
          <Button><Save /> Save</Button>
        </div>
      </section>
      <RoomCanvasLoader placements={starterPlacements} />
      <Card className="bg-white/72">
        <CardHeader>
          <CardTitle>Placed items</CardTitle>
          <CardDescription>These match <code>placed_items</code> rows in Phase 2.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {starterPlacements.map((placement) => {
            const item = starterCatalog.find((catalogItem) => catalogItem.id === placement.catalogItemId);
            return (
              <div key={placement.id} className="rounded-lg border border-cream-300 bg-cream-50/70 p-3">
                <div className="font-extrabold text-ink-900">{item?.name}</div>
                <div className="mt-1 text-xs font-bold text-muted-foreground">
                  x {placement.x}, y {placement.y}, z {placement.zIndex}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <div className="rounded-lg border border-lavender-300/40 bg-lavender-100/65 p-4 text-sm font-bold text-ink-700">
        <Download className="mr-2 inline size-4 text-lavender-500" />
        Next step: replace mock placement data with Supabase reads, then write drag/drop saves back to <code>placed_items</code>.
      </div>
    </div>
  );
}
