import { Suspense } from "react";
import { GardenClient } from "@/app/(game)/app/garden/garden-client";
import { gardenPlots, miniGames } from "@/lib/mock-data";

export default function GardenPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 text-sm font-extrabold text-ink-700">Waking the garden...</div>}>
      <GardenClient games={miniGames} plots={gardenPlots} />
    </Suspense>
  );
}
