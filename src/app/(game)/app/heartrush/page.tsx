import { Suspense } from "react";
import { HeartRushClient } from "@/app/(game)/app/heartrush/heartrush-client";

export default function HeartRushPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[360px] place-items-center rounded-lg border border-sky-300/50 bg-sky-100/70 text-sm font-extrabold text-ink-700">
          Opening the HeartRush course...
        </div>
      }
    >
      <HeartRushClient />
    </Suspense>
  );
}
