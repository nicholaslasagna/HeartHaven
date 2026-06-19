"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DISCOVERIES_EVENT,
  getZoneDiscoveries,
  listFound,
  listHidden,
  readDiscoveriesState,
  type DiscoveryItem,
  type DiscoveryZone,
} from "@/lib/game/discoveries-store";

export type DiscoveryRow =
  | (DiscoveryItem & { status: "found"; foundAt: string })
  | (DiscoveryItem & { status: "hidden"; foundAt?: undefined });

/**
 * React-friendly view of the discoveries for a single zone. Re-renders any
 * time the store dispatches `DISCOVERIES_EVENT`, so the side panel and the
 * minimap stay in lockstep with what the player just sniffed up.
 */
export function useDiscoveries(zone: DiscoveryZone) {
  const [state, setState] = useState(readDiscoveriesState);

  useEffect(() => {
    const sync = () => setState(readDiscoveriesState());
    window.addEventListener(DISCOVERIES_EVENT, sync);
    window.addEventListener("storage", sync);
    const dailyCheck = window.setInterval(sync, 30_000);
    return () => {
      window.clearInterval(dailyCheck);
      window.removeEventListener(DISCOVERIES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return useMemo(() => {
    const dailyItems = getZoneDiscoveries(zone, state.dayKey);
    const foundRows: DiscoveryRow[] = listFound(zone, state).map((entry) => {
      const definition = dailyItems.find((item) => item.id === entry.id);
      // Defensive: an unknown id slipped in somehow — keep it visible.
      if (!definition) {
        return {
          id: entry.id,
          name: "Unknown find",
          emoji: "❔",
          hint: "Found before the catalog was loaded.",
          x: 50,
          y: 50,
          tag: "shared" as const,
          status: "found" as const,
          foundAt: entry.foundAt,
        };
      }
      return { ...definition, status: "found" as const, foundAt: entry.foundAt };
    });
    const hiddenRows: DiscoveryRow[] = listHidden(zone, state).map((item) => ({
      ...item,
      status: "hidden" as const,
    }));
    return {
      zone,
      total: dailyItems.length,
      foundCount: foundRows.length,
      hiddenCount: hiddenRows.length,
      found: foundRows,
      hidden: hiddenRows,
      all: [...foundRows, ...hiddenRows],
    };
  }, [state, zone]);
}
