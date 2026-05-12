"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveSeasonalEvent, getNextSeasonalEvent } from "@/lib/seasonal-events";

export function useSeasonalEvent() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  return useMemo(() => {
    const currentDate = now ?? new Date();
    return {
      activeEvent: getActiveSeasonalEvent(currentDate),
      nextEvent: getNextSeasonalEvent(currentDate),
    };
  }, [now]);
}
