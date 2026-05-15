import { Suspense } from "react";
import { FriendsClient } from "@/app/(game)/app/friends/friends-client";

export const metadata = {
  title: "Friends · HeartHaven",
  description: "Your private circle: friend code, invite inbox, played-with, gifts, blocks, and reports.",
};

export default function FriendsPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[280px] place-items-center rounded-lg border border-cream-300 bg-cream-100 text-sm font-extrabold text-ink-700">
          Opening your friends list...
        </div>
      }
    >
      <FriendsClient />
    </Suspense>
  );
}
