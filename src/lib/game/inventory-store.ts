/**
 * inventory-store — owned items, gifting between friends, reselling for coins,
 * and the random daily-drop hook.
 *
 * Storage: `hearthaven:inventory-state`. Mutations dispatch
 * `hearthaven:inventory-changed`.
 *
 * Supabase mapping (when persistence flips on):
 *   InventoryEntry     →  inventory_items
 *   OutgoingGift       →  gifts                   (status: pending/delivered)
 *   ReceivedGift       →  gifts                   (filtered by recipient_id)
 *   sellItem coin grant→  game_reward_events       (source = "inventory-sell")
 */

import { marketCatalog, seasonalCatalog, starterCatalog } from "@/lib/catalog";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { creditWallet } from "@/lib/game/wallet-store";
import type { CatalogItem } from "@/lib/game/types";
import type { FriendCode } from "@/lib/game/social";

export const INVENTORY_STATE_KEY = "hearthaven:inventory-state";
export const INVENTORY_EVENT = "hearthaven:inventory-changed";

export type InventoryEntry = {
  id: string;
  catalogItemId: string;
  quantity: number;
  equipped: boolean;
  acquiredAt: string;
  /** How the item entered the keeper's inventory — useful for the audit trail. */
  source: "starter" | "seasonal-seed" | "purchase" | "gift-received" | "daily-drop";
};

export type OutgoingGift = {
  id: string;
  toCode: FriendCode;
  toDisplayName: string;
  catalogItemId: string;
  quantity: number;
  sentAt: string;
  status: "pending" | "delivered" | "declined";
};

export type ReceivedGift = {
  id: string;
  fromCode: FriendCode;
  fromDisplayName: string;
  catalogItemId: string;
  quantity: number;
  receivedAt: string;
  claimed: boolean;
};

export type InventoryState = {
  items: InventoryEntry[];
  giftsSent: OutgoingGift[];
  giftsReceived: ReceivedGift[];
};

/** The fraction of the original purchase price the seller gets back. */
export const RESELL_RATIO = 0.5;

/* ----------------------------------------------------------------
   Seed + storage helpers
   ---------------------------------------------------------------- */

function catalogLookup(): Map<string, CatalogItem> {
  const all = [...marketCatalog, ...starterCatalog, ...seasonalCatalog];
  return new Map(all.map((item) => [item.id, item]));
}

/** Build the starter inventory the way `mock-data.inventoryItems` did, but
 *  with explicit `source` + `acquiredAt` so the store is the source of truth. */
function freshState(): InventoryState {
  const seed = [...starterCatalog, ...seasonalCatalog];
  const items: InventoryEntry[] = seed.map((item, index) => ({
    id: `inventory-${item.id}-${index}`,
    catalogItemId: item.id,
    quantity: item.tags.includes("seasonal") ? 1 : index < 4 ? 1 : 3,
    equipped: index < 2,
    acquiredAt: new Date().toISOString(),
    source: item.tags.includes("seasonal") ? "seasonal-seed" : "starter",
  }));
  return { items, giftsSent: [], giftsReceived: [] };
}

export function readInventoryState(): InventoryState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(INVENTORY_STATE_KEY);
    if (!raw) {
      const seed = freshState();
      writeState(seed);
      return seed;
    }
    const parsed = JSON.parse(raw) as Partial<InventoryState>;
    const parsedItems = Array.isArray(parsed.items) ? (parsed.items as InventoryEntry[]) : [];
    if (parsedItems.length === 0) {
      const seed = freshState();
      writeState(seed);
      return seed;
    }
    return {
      items: parsedItems,
      giftsSent: Array.isArray(parsed.giftsSent) ? (parsed.giftsSent as OutgoingGift[]) : [],
      giftsReceived: Array.isArray(parsed.giftsReceived) ? (parsed.giftsReceived as ReceivedGift[]) : [],
    };
  } catch {
    return freshState();
  }
}

function writeState(state: InventoryState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INVENTORY_STATE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(INVENTORY_EVENT, { detail: state }));
}

export function replaceInventoryState(state: InventoryState) {
  writeState(state);
}

/* ----------------------------------------------------------------
   Pure derivers
   ---------------------------------------------------------------- */

/** Look up a catalog row for an inventory entry. */
export function resolveCatalogItem(catalogItemId: string): CatalogItem | undefined {
  return catalogLookup().get(catalogItemId);
}

/** A view-friendly join of inventory + catalog metadata. */
export function getInventoryView(state: InventoryState = readInventoryState()) {
  const catalog = catalogLookup();
  return state.items
    .map((entry) => ({ entry, catalog: catalog.get(entry.catalogItemId) }))
    .filter((row): row is { entry: InventoryEntry; catalog: CatalogItem } => Boolean(row.catalog));
}

/** Half of an item's original coin price (rounded down), the resale value. */
export function getResellValue(catalogItem: CatalogItem): { coins: number; hearts: number } {
  return {
    coins: Math.max(1, Math.floor(catalogItem.priceCoins * RESELL_RATIO)),
    hearts: Math.max(0, Math.floor(catalogItem.priceHearts * RESELL_RATIO)),
  };
}

/* ----------------------------------------------------------------
   Mutations
   ---------------------------------------------------------------- */

/** Drop an item into the inventory (used by gifts received + daily drops). */
export function addItem(catalogItemId: string, source: InventoryEntry["source"], quantity = 1): InventoryState {
  const state = readInventoryState();
  const existingIndex = state.items.findIndex((entry) => entry.catalogItemId === catalogItemId);
  let nextItems: InventoryEntry[];
  if (existingIndex >= 0) {
    nextItems = state.items.map((entry, index) =>
      index === existingIndex ? { ...entry, quantity: entry.quantity + quantity } : entry,
    );
  } else {
    nextItems = [
      ...state.items,
      {
        id: `inventory-${catalogItemId}-${Date.now()}`,
        catalogItemId,
        quantity,
        equipped: false,
        acquiredAt: new Date().toISOString(),
        source,
      },
    ];
  }
  const next = { ...state, items: nextItems };
  writeState(next);
  // Fire-and-forget the server mirror so the keeper's inventory stays
  // in sync across devices. Failure is non-fatal — local state is the
  // authoritative copy until the next hydrate.
  mirrorAddItem(catalogItemId, source, quantity);
  return next;
}

/** Toggle whether an item is equipped (no inventory delta, just UI state). */
export function toggleEquipped(entryId: string) {
  const state = readInventoryState();
  const target = state.items.find((entry) => entry.id === entryId);
  writeState({
    ...state,
    items: state.items.map((entry) => (entry.id === entryId ? { ...entry, equipped: !entry.equipped } : entry)),
  });
  if (target) mirrorToggleEquipped(target.catalogItemId);
}

/**
 * Sell one unit of an inventory entry. Refunds half the catalog price into the
 * wallet via the shared `creditWallet` helper so the ledger stays one source
 * of truth. Returns the refund actually granted, or null if the item couldn't
 * be sold (entry missing or already at zero).
 */
export function sellItem(entryId: string):
  | { ok: true; refund: { coins: number; hearts: number } }
  | { ok: false; reason: "not-found" | "empty" } {
  const state = readInventoryState();
  const entry = state.items.find((row) => row.id === entryId);
  if (!entry) return { ok: false, reason: "not-found" };
  if (entry.quantity <= 0) return { ok: false, reason: "empty" };
  const catalog = catalogLookup().get(entry.catalogItemId);
  if (!catalog) return { ok: false, reason: "not-found" };

  const refund = getResellValue(catalog);
  const nextEntry = { ...entry, quantity: entry.quantity - 1, equipped: entry.quantity - 1 > 0 ? entry.equipped : false };
  const nextItems = nextEntry.quantity > 0
    ? state.items.map((row) => (row.id === entryId ? nextEntry : row))
    : state.items.filter((row) => row.id !== entryId);

  writeState({ ...state, items: nextItems });
  // Mirror the post-sell quantity to the server (0 = delete the row).
  mirrorSetQuantity(entry.catalogItemId, nextEntry.quantity);
  creditWallet({
    gameId: "inventory-sell",
    label: `Sold · ${catalog.name}`,
    score: 0,
    coins: refund.coins,
    hearts: refund.hearts,
  });
  return { ok: true, refund };
}

/**
 * Send one unit of an inventory item to a friend. Atomically deducts from the
 * sender's inventory and records an outgoing-gift entry. The recipient's
 * inventory is updated when the realtime channel delivers the gift, OR locally
 * if the recipient is the same device (single-device demo flow).
 */
export function giftItem(input: {
  entryId: string;
  toCode: FriendCode;
  toDisplayName: string;
  selfCode: FriendCode;
  selfDisplayName: string;
}):
  | { ok: true; gift: OutgoingGift }
  | { ok: false; reason: "not-found" | "empty" | "self" } {
  if (input.toCode === input.selfCode) return { ok: false, reason: "self" };

  const state = readInventoryState();
  const entry = state.items.find((row) => row.id === input.entryId);
  if (!entry) return { ok: false, reason: "not-found" };
  if (entry.quantity <= 0) return { ok: false, reason: "empty" };

  const nextEntry = { ...entry, quantity: entry.quantity - 1, equipped: entry.quantity - 1 > 0 ? entry.equipped : false };
  const nextItems = nextEntry.quantity > 0
    ? state.items.map((row) => (row.id === input.entryId ? nextEntry : row))
    : state.items.filter((row) => row.id !== input.entryId);

  const gift: OutgoingGift = {
    id: `gift-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    toCode: input.toCode,
    toDisplayName: input.toDisplayName,
    catalogItemId: entry.catalogItemId,
    quantity: 1,
    sentAt: new Date().toISOString(),
    status: "pending",
  };

  writeState({
    ...state,
    items: nextItems,
    giftsSent: [gift, ...state.giftsSent].slice(0, 80),
  });

  // Tell the realtime / receiving side: the channel passes this to the
  // friend's device, which then calls `acceptIncomingGift` over there.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("hearthaven:gift-sent", {
        detail: {
          gift,
          fromCode: input.selfCode,
          fromDisplayName: input.selfDisplayName,
        },
      }),
    );
  }

  return { ok: true, gift };
}

/**
 * Accept an incoming gift — moves a catalog item into inventory, removes the
 * received-gift inbox row, and refunds nothing (no charge to the recipient).
 */
export function claimReceivedGift(giftId: string):
  | { ok: true; entry: InventoryEntry }
  | { ok: false; reason: "not-found" } {
  const state = readInventoryState();
  const gift = state.giftsReceived.find((row) => row.id === giftId);
  if (!gift) return { ok: false, reason: "not-found" };

  addItem(gift.catalogItemId, "gift-received", gift.quantity);
  const after = readInventoryState();
  writeState({
    ...after,
    giftsReceived: after.giftsReceived.map((row) => (row.id === giftId ? { ...row, claimed: true } : row)),
  });
  const updatedEntry = after.items.find((row) => row.catalogItemId === gift.catalogItemId)!;
  return { ok: true, entry: updatedEntry };
}

/** Push a received-gift row (called by realtime delivery or local demo flow). */
export function receiveIncomingGift(input: Omit<ReceivedGift, "id" | "claimed">) {
  const state = readInventoryState();
  const gift: ReceivedGift = {
    ...input,
    id: `gift-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    claimed: false,
  };
  writeState({ ...state, giftsReceived: [gift, ...state.giftsReceived].slice(0, 80) });
}

/* ----------------------------------------------------------------
   Daily random drop
   ---------------------------------------------------------------- */

/**
 * Pick a random catalog item suitable as a daily login gift. Avoids private/
 * Phase-7 content, prefers common items, biases toward the player not already
 * owning a stack of it.
 */
export function pickDailyDropCatalogId(): string {
  const state = readInventoryState();
  const ownedCounts = new Map<string, number>();
  for (const entry of state.items) ownedCounts.set(entry.catalogItemId, entry.quantity);

  const pool = marketCatalog.filter((item) => item.rarity !== "private");
  // Weight items lower the more you already own; give brand-new items a leg up.
  const weighted: { id: string; weight: number }[] = pool.map((item) => {
    const owned = ownedCounts.get(item.id) ?? 0;
    const rarityBoost = item.rarity === "rare" ? 0.7 : item.rarity === "common" ? 1.2 : 1.0;
    return { id: item.id, weight: rarityBoost / (owned + 1) };
  });
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const row of weighted) {
    roll -= row.weight;
    if (roll <= 0) return row.id;
  }
  return weighted[0]?.id ?? "cozy-rug";
}

/** Convenience: drop a random daily item into inventory and return the catalog row. */
export function awardDailyDrop(): CatalogItem | null {
  const id = pickDailyDropCatalogId();
  const catalog = catalogLookup().get(id);
  if (!catalog) return null;
  addItem(id, "daily-drop", 1);
  return catalog;
}

// ------------------------------------------------------------------------
// Supabase mirror (migration 0030 RPCs)
// ------------------------------------------------------------------------
//
// All mutations write to localStorage FIRST for instant UI, then
// fire-and-forget the server mirror. On reconnect / sign-in we pull
// server state and replace local. This keeps offline-only mode working
// AND makes the keeper's inventory cross-device.
//
// We deliberately don't await the RPC from inside the mutation
// functions — UI shouldn't pause on a network round-trip for items the
// user already paid for. If the mirror fails the worst case is the
// inventory is out-of-sync until the next hydrate (sign-in, focus, or
// explicit refresh).

function mirrorAddItem(catalogItemId: string, source: InventoryEntry["source"], quantity: number) {
  if (!isSupabaseConfigured()) return;
  void (async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.rpc("add_inventory_item", {
        p_catalog_item_id: catalogItemId,
        p_source: source,
        p_quantity: quantity,
      });
    } catch {
      /* swallowed — local write already landed */
    }
  })();
}

function mirrorSetQuantity(catalogItemId: string, quantity: number) {
  if (!isSupabaseConfigured()) return;
  void (async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.rpc("set_inventory_quantity", {
        p_catalog_item_id: catalogItemId,
        p_quantity: quantity,
      });
    } catch {
      /* swallowed */
    }
  })();
}

function mirrorToggleEquipped(catalogItemId: string) {
  if (!isSupabaseConfigured()) return;
  void (async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.rpc("toggle_inventory_equipped", { p_catalog_item_id: catalogItemId });
    } catch {
      /* swallowed */
    }
  })();
}

/**
 * Pull the keeper's inventory from the server and replace local state.
 * Called on app boot (when authenticated) so a fresh device sees the
 * keeper's existing items. Safe to call repeatedly — replaces local
 * with server, which is the authoritative copy.
 *
 * Bails out if Supabase isn't configured OR the server returns nothing
 * (keeper hasn't bought / earned anything yet) — in that case the
 * local starter inventory stays in place.
 */
export async function hydrateInventoryFromServer(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc("get_my_inventory");
    if (error || !Array.isArray(data) || data.length === 0) return;
    const items: InventoryEntry[] = data
      .map((row) => {
        const r = row as {
          catalog_item_id?: string;
          quantity?: number;
          equipped?: boolean;
          source?: string;
          acquired_at?: string;
        };
        if (typeof r.catalog_item_id !== "string") return null;
        const quantity = Math.max(0, Math.floor(Number(r.quantity ?? 0)));
        if (quantity <= 0) return null;
        return {
          id: `inventory-${r.catalog_item_id}`,
          catalogItemId: r.catalog_item_id,
          quantity,
          equipped: Boolean(r.equipped),
          acquiredAt:
            typeof r.acquired_at === "string" && r.acquired_at.length > 0
              ? r.acquired_at
              : new Date().toISOString(),
          source: (typeof r.source === "string" ? r.source : "unknown") as InventoryEntry["source"],
        };
      })
      .filter((entry): entry is InventoryEntry => entry !== null);
    const current = readInventoryState();
    // Replace items wholesale; preserve gifts (those are routed
    // separately through the friend-graph + Supabase gifts table, not
    // this RPC).
    replaceInventoryState({ ...current, items });
  } catch {
    /* swallowed — offline-tolerant */
  }
}
