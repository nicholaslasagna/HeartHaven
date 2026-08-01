import { Suspense } from "react";
import { HavenTrailsClient } from "@/app/(game)/app/trails/trails-client";

export default function HavenTrailsPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[420px] place-items-center rounded-lg border border-garden-300 bg-garden-100 text-sm font-extrabold text-ink-700">Opening Haven Trails...</div>}>
      <HavenTrailsClient />
    </Suspense>
  );
}
