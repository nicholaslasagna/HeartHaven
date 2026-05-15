"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SAFETY_EVENT,
  blockKeeper,
  clearQuarantine,
  isBlocked,
  isLocallyQuarantined,
  quarantineRemainingMs,
  readSafetyState,
  submitReport,
  unblockKeeper,
  type SafetyState,
} from "@/lib/game/safety";

/**
 * useSafety — React view of block list + report log + quarantine state. Pings
 * once a second while quarantined so the cooldown can count down live.
 */
export function useSafety() {
  const [state, setState] = useState<SafetyState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sync = () => setState(readSafetyState());
    sync();
    window.addEventListener(SAFETY_EVENT, sync);
    window.addEventListener("storage", sync);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener(SAFETY_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.clearInterval(tick);
    };
  }, []);

  const quarantined = state ? isLocallyQuarantined(state) : false;
  const quarantineRemaining = state ? quarantineRemainingMs(state) : 0;
  // `now` is a dep so the countdown re-renders.
  void now;

  return useMemo(
    () => ({
      state,
      ready: state !== null,
      blocks: state?.blocks ?? [],
      reports: state?.reports ?? [],
      quarantined,
      quarantineRemainingMs: quarantineRemaining,
      blockKeeper,
      unblockKeeper,
      isBlocked,
      submitReport,
      clearQuarantine,
    }),
    [state, quarantined, quarantineRemaining],
  );
}
