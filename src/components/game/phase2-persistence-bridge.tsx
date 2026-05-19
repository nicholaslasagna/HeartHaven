"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
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
  syncServerPetState,
} from "@/lib/game/phase2-server";
import { hydrateWalletStateFromServer } from "@/lib/game/wallet-store";

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

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      hydratingUntilRef.current = Date.now() + 1800;
      await hydrateWalletStateFromServer();

      const localInventory = readInventoryState();
      const serverInventory = await loadServerInventoryState(localInventory);
      if (!cancelled && serverInventory) {
        replaceInventoryState(serverInventory);
      }

      const localRoster = getCompanionRoster();
      const localVitals = getPetVitals();
      const serverPet = await loadServerPetState(localRoster, localVitals);
      if (!cancelled && serverPet) {
        replaceCompanionRosterState(serverPet.roster);
        replacePetVitalsState(serverPet.vitals);
      }

      hydratingUntilRef.current = Date.now() + 600;
    }

    void hydrate();

    const scheduleInventorySync = () => {
      if (Date.now() < hydratingUntilRef.current) return;
      clearTimer(inventoryTimerRef);
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

    window.addEventListener(INVENTORY_EVENT, scheduleInventorySync);
    window.addEventListener(PET_VITALS_EVENT, schedulePetSync);
    window.addEventListener(COMPANION_ROSTER_EVENT, schedulePetSync);

    return () => {
      cancelled = true;
      clearTimer(inventoryTimerRef);
      clearTimer(petTimerRef);
      window.removeEventListener(INVENTORY_EVENT, scheduleInventorySync);
      window.removeEventListener(PET_VITALS_EVENT, schedulePetSync);
      window.removeEventListener(COMPANION_ROSTER_EVENT, schedulePetSync);
    };
  }, []);

  return null;
}
