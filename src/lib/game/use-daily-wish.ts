"use client";

import { useEffect, useState } from "react";
import { DAILY_WISH_EVENT, getDailyWish, type DailyWish } from "@/lib/game/daily-wish";

export function useDailyWish() {
  const [wish, setWish] = useState<DailyWish>(() => getDailyWish());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setWish(getDailyWish());
      setReady(true);
    }, 0);

    function sync(event?: Event) {
      const detail = (event as CustomEvent<DailyWish> | undefined)?.detail;
      setWish(detail ?? getDailyWish());
    }

    window.addEventListener(DAILY_WISH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener(DAILY_WISH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return {
    wish,
    ready,
    ratio: Math.min(1, wish.progress / wish.goal),
  };
}
