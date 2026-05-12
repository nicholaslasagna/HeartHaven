import { Suspense } from "react";
import { RoomClient } from "@/app/(game)/app/room/room-client";

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[420px] place-items-center rounded-lg border border-cream-300 bg-cream-100 text-sm font-extrabold text-ink-700">
          Opening the Moonlit Loft...
        </div>
      }
    >
      <RoomClient />
    </Suspense>
  );
}
