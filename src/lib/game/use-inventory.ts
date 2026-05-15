"use client";

import { useEffect, useMemo, useState } from "react";
import {
  INVENTORY_EVENT,
  addItem,
  claimReceivedGift,
  getInventoryView,
  getResellValue,
  giftItem,
  readInventoryState,
  receiveIncomingGift,
  resolveCatalogItem,
  sellItem,
  toggleEquipped,
  type InventoryState,
} from "@/lib/game/inventory-store";
import { getSocialState } from "@/lib/game/social";
import { isBlocked } from "@/lib/game/safety";

/**
 * useInventory — React view of the keeper's owned items, gifts sent, and
 * gifts waiting to be claimed.
 */
export function useInventory() {
  const [state, setState] = useState<InventoryState | null>(null);

  useEffect(() => {
    const sync = () => setState(readInventoryState());
    const acceptRealtimeGift = (event: Event) => {
      const detail = (event as CustomEvent<{
        gift?: { id: string; toCode: string; catalogItemId: string; quantity: number };
        fromCode?: string;
        fromDisplayName?: string;
      }>).detail;
      if (!detail?.gift || !detail.fromCode || !detail.fromDisplayName) return;
      const social = getSocialState();
      if (detail.gift.toCode !== social.selfCode) return;
      if (isBlocked(detail.fromCode)) return;
      receiveIncomingGift({
        fromCode: detail.fromCode,
        fromDisplayName: detail.fromDisplayName,
        catalogItemId: detail.gift.catalogItemId,
        quantity: detail.gift.quantity,
        receivedAt: new Date().toISOString(),
      });
    };
    sync();
    window.addEventListener(INVENTORY_EVENT, sync);
    window.addEventListener("hearthaven:gift-sent", acceptRealtimeGift);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(INVENTORY_EVENT, sync);
      window.removeEventListener("hearthaven:gift-sent", acceptRealtimeGift);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const view = useMemo(() => (state ? getInventoryView(state) : []), [state]);
  const giftsReceived = useMemo(
    () => state?.giftsReceived.filter((gift) => !gift.claimed) ?? [],
    [state],
  );
  const giftsSent = useMemo(() => state?.giftsSent ?? [], [state]);

  return useMemo(
    () => ({
      state,
      ready: state !== null,
      view,
      giftsReceived,
      giftsSent,
      sellItem,
      giftItem,
      claimReceivedGift,
      addItem,
      toggleEquipped,
      receiveIncomingGift,
      resolveCatalogItem,
      getResellValue,
    }),
    [state, view, giftsReceived, giftsSent],
  );
}
