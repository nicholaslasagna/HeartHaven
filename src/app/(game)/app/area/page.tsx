import { Suspense } from "react";
import { AreaClient } from "@/app/(game)/app/area/area-client";
import { gardenPlots, miniGames } from "@/lib/mock-data";

export default function AreaPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[420px] place-items-center rounded-lg border border-cream-300 bg-cream-100 text-sm font-extrabold text-ink-700">
          Opening your area...
        </div>
      }
    >
      <AreaClient games={miniGames} plots={gardenPlots} />
    </Suspense>
  );
}
