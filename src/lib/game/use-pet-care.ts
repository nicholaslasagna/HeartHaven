"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PET_VITALS_EVENT,
  getActionCooldownMs,
  getCooldownRemaining,
  getNeediestVital,
  getPetCareProfile,
  getPetMood,
  getPetVitals,
  performPetFood,
  performPetAction,
  type PetCareAction,
  type PetCareResult,
  type PetVitals,
} from "@/lib/game/pet-state";
import type { PetFoodId } from "@/lib/game/pet-foods";

const CARE_ACTIONS: PetCareAction[] = ["feed", "play", "pamper", "rest"];

/**
 * usePetCare — React view of the living companion.
 *
 * Vitals decay in real time, so the hook re-reads once a second: that keeps the
 * vital bars gently drifting and the action cooldowns counting down live. It
 * also re-reads on `hearthaven:pet-vitals-changed` so a care action taken on
 * another panel reflects everywhere instantly.
 */
export function usePetCare() {
  const [vitals, setVitals] = useState<PetVitals | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sync = () => setVitals(getPetVitals());
    sync();

    const tick = window.setInterval(() => {
      setVitals(getPetVitals());
      setNow(Date.now());
    }, 1000);

    window.addEventListener(PET_VITALS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener(PET_VITALS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const care = useCallback((action: PetCareAction): PetCareResult => {
    const result = performPetAction(action);
    if (result.ok) setVitals(result.vitals);
    return result;
  }, []);

  const feedFood = useCallback((foodId: PetFoodId): PetCareResult => {
    const result = performPetFood(foodId);
    if (result.ok) setVitals(result.vitals);
    return result;
  }, []);

  const cooldowns = useMemo(() => {
    // `now` is a dependency so this recomputes every tick.
    void now;
    return CARE_ACTIONS.reduce(
      (acc, action) => {
        const remaining = getCooldownRemaining(action);
        acc[action] = {
          remainingMs: remaining,
          totalMs: getActionCooldownMs(action),
          ready: remaining <= 0,
        };
        return acc;
      },
      {} as Record<PetCareAction, { remainingMs: number; totalMs: number; ready: boolean }>,
    );
  }, [now]);

  const mood = vitals ? getPetMood(vitals) : "content";
  const neediest = vitals ? getNeediestVital(vitals) : "happiness";
  const careProfile = getPetCareProfile();

  return useMemo(
    () => ({ vitals, mood, neediest, cooldowns, care, feedFood, careProfile, ready: vitals !== null }),
    [vitals, mood, neediest, cooldowns, care, feedFood, careProfile],
  );
}
