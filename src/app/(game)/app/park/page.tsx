import { Suspense } from "react";
import { ParkClient } from "@/app/(game)/app/park/park-client";

export default function ParkPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border border-garden-300/50 bg-garden-100/65 p-5 text-sm font-extrabold text-ink-700">Opening Honeyheart Park...</div>}>
      <ParkClient />
    </Suspense>
  );
}
