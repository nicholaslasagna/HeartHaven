"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import {
  ACHIEVEMENTS_EVENT,
  applyMergedAchievementState,
  readAchievementState,
  type AchievementState,
} from "@/lib/game/achievements";
import {
  applyMergedDailyProgress,
  DAILY_LOOP_EVENT,
  getDailyState,
} from "@/lib/game/daily-loop";
import type { KeeperProgress } from "@/lib/game/keeper-progress";
import {
  COMPANION_ROSTER_EVENT,
  getCompanionRoster,
  replaceCompanionRosterState,
} from "@/lib/game/companion-roster";
import {
  INVENTORY_EVENT,
  readInventoryState,
  replaceInventoryState,
} from "@/lib/game/inventory-store";
import {
  PET_VITALS_EVENT,
  getPetVitals,
  replacePetVitalsState,
} from "@/lib/game/pet-state";
import {
  loadServerInventoryState,
  loadServerPetState,
  syncServerInventoryState,
  syncServerKeeperProgress,
  syncServerPetState,
} from "@/lib/game/phase2-server";
import { hydrateWalletStateFromServer } from "@/lib/game/wallet-store";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ensureUserLocalScope } from "@/lib/game/user-local-scope";

/** This device's progress, in the shape the merge expects. */
function readLocalKeeperProgress(): KeeperProgress {
  const badges = readAchievementState();
  const daily = getDailyState();
  return {
    metrics: badges.progress,
    unlocked: badges.unlocked,
    unlockedAt: badges.unlockedAt,
    streak: daily.streak,
    giftClaimedDate: daily.giftClaimedDate,
  };
}

function clearTimer(ref: MutableRefObject<number | null>) {
  if (ref.current !== null) {
    window.clearTimeout(ref.current);
    ref.current = null;
  }
}

/**
 * Phase2PersistenceBridge
 *
 * Mounts once in the signed-in game shell. Existing stores stay local-first
 * for speed/offline play, while this bridge hydrates from Supabase and
 * debounces durable writes for inventory and pets. Wallet credit/spend writes
 * through from wallet-store directly because those operations need RPC
 * semantics.
 */
export function Phase2PersistenceBridge() {
  const hydratingUntilRef = useRef(0);
  const inventoryTimerRef = useRef<number | null>(null);
  const petTimerRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastHydratedUserId: string | null | undefined = undefined;

    async function hydrate() {
      hydratingUntilRef.current = Date.now() + 1800;
      if (isSupabaseConfigured()) {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        ensureUserLocalScope(user?.id);
        lastHydratedUserId = user?.id ?? null;
      }

      await hydrateWalletStateFromServer();

      const localInventory = readInventoryState();
      const serverInventory = await loadServerInventoryState(localInventory);
      if (!cancelled && serverInventory) {
        replaceInventoryState(serverInventory);
      }

      const localRoster = getCompanionRoster();
      const localVitals = getPetVitals();
      const rosterSnapshot = JSON.stringify(localRoster);
      const serverPet = await loadServerPetState(localRoster, localVitals);
      if (!cancelled && serverPet) {
        const currentRoster = getCompanionRoster();
        const selectionChangedDuringHydrate = JSON.stringify(currentRoster) !== rosterSnapshot;
        if (selectionChangedDuringHydrate) {
          await syncServerPetState(currentRoster, getPetVitals());
        } else {
          replaceCompanionRosterState(serverPet.roster);
          for (const [companionId, companionVitals] of Object.entries(serverPet.vitalsByCompanion)) {
            replacePetVitalsState(companionVitals, companionId);
          }
          replacePetVitalsState(serverPet.vitals, serverPet.roster.activeId);
        }
      }

      /* Achievement metrics, badges and the daily streak. One call: the
         server merges this device with whatever was earned elsewhere and
         hands back the combined result, so there is nothing to load first.
         The badges it returns were already paid for on the device that
         earned them, which is why this applies them without paying again. */
      const mergedProgress = await syncServerKeeperProgress(readLocalKeeperProgress());
      if (!cancelled && mergedProgress) {
        applyMergedAchievementState({
          progress: mergedProgress.metrics as AchievementState["progress"],
          unlocked: mergedProgress.unlocked,
          unlockedAt: mergedProgress.unlockedAt,
        });
        applyMergedDailyProgress(mergedProgress);
      }

      hydratingUntilRef.current = Date.now() + 600;
    }

    void hydrate();

    const scheduleInventorySync = () => {
      if (Date.now() < hydratingUntilRef.current) return;
      clearTimer(inventoryTimerRef);
      clearTimer(progressTimerRef);
      inventoryTimerRef.current = window.setTimeout(() => {
        void syncServerInventoryState(readInventoryState()).then((serverState) => {
          if (serverState) {
            hydratingUntilRef.current = Date.now() + 500;
            replaceInventoryState(serverState);
          }
        });
      }, 900);
    };

    const schedulePetSync = () => {
      if (Date.now() < hydratingUntilRef.current) return;
      clearTimer(petTimerRef);
      petTimerRef.current = window.setTimeout(() => {
        void syncServerPetState(getCompanionRoster(), getPetVitals());
      }, 1000);
    };

    const scheduleProgressSync = () => {
      if (Date.now() < hydratingUntilRef.current) return;
      clearTimer(progressTimerRef);
      progressTimerRef.current = window.setTimeout(() => {
        void syncServerKeeperProgress(readLocalKeeperProgress()).then((merged) => {
          if (!merged) return;
          hydratingUntilRef.current = Date.now() + 500;
          applyMergedAchievementState({
            progress: merged.metrics as AchievementState["progress"],
            unlocked: merged.unlocked,
            unlockedAt: merged.unlockedAt,
          });
          applyMergedDailyProgress(merged);
        });
      }, 1200);
    };

    window.addEventListener(INVENTORY_EVENT, scheduleInventorySync);
    window.addEventListener(ACHIEVEMENTS_EVENT, scheduleProgressSync);
    window.addEventListener(DAILY_LOOP_EVENT, scheduleProgressSync);
    window.addEventListener(PET_VITALS_EVENT, schedulePetSync);
    window.addEventListener(COMPANION_ROSTER_EVENT, schedulePetSync);

    // Subscribe to auth changes so we re-hydrate when a different
    // account signs in without a full page reload. Without this, the
    // localStorage-clear in `ensureUserLocalScope` only ran on the
    // initial mount — switching accounts mid-session (sign out → sign
    // in as someone else, or freshly signing up after browsing as a
    // different user) would leak the previous account's local data
    // into the new account's first server sync. We compare by id so
    // mere token refreshes (SIGNED_IN with same user) don't trigger
    // a full rehydrate.
    let authUnsubscribe: (() => void) | null = null;
    if (isSupabaseConfigured()) {
      const supabase = getSupabaseBrowserClient();
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        const nextUserId = session?.user?.id ?? null;
        if (nextUserId === lastHydratedUserId) return;
        void hydrate();
      });
      authUnsubscribe = () => {
        data.subscription.unsubscribe();
      };
    }

    return () => {
      cancelled = true;
      clearTimer(inventoryTimerRef);
      clearTimer(petTimerRef);
      window.removeEventListener(INVENTORY_EVENT, scheduleInventorySync);
      window.removeEventListener(ACHIEVEMENTS_EVENT, scheduleProgressSync);
      window.removeEventListener(DAILY_LOOP_EVENT, scheduleProgressSync);
      window.removeEventListener(PET_VITALS_EVENT, schedulePetSync);
      window.removeEventListener(COMPANION_ROSTER_EVENT, schedulePetSync);
      authUnsubscribe?.();
    };
  }, []);

  return null;
}
