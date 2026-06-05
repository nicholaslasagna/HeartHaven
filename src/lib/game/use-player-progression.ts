"use client";

import { useEffect, useState } from "react";
import { getPlayerLevelInfo, PROGRESSION_EVENT, readPlayerProgression } from "@/lib/game/progression-store";

export function usePlayerProgression() {
  const [progression, setProgression] = useState(() => getPlayerLevelInfo({ points: 0, updatedAt: 0 }));

  useEffect(() => {
    const sync = () => setProgression(readPlayerProgression());
    sync();
    window.addEventListener(PROGRESSION_EVENT, sync);
    window.addEventListener("hearthaven:player-points-earned", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PROGRESSION_EVENT, sync);
      window.removeEventListener("hearthaven:player-points-earned", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return progression;
}
