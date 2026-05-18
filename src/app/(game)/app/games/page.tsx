import { GamesClient } from "@/app/(game)/app/games/games-client";
import { Suspense } from "react";

export default function GamesPage() {
  return (
    <Suspense fallback={null}>
      <GamesClient />
    </Suspense>
  );
}
