import { Suspense } from "react";
import { LanternLeapClient } from "@/app/(game)/app/lantern-leap/lantern-leap-client";

export default function LanternLeapPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[360px] place-items-center rounded-lg border border-lavender-300/50 bg-lavender-100/70 text-sm font-extrabold text-ink-700">
          Opening Lantern Leap...
        </div>
      }
    >
      <LanternLeapClient />
    </Suspense>
  );
}
