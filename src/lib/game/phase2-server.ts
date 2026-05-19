"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { CompanionRecord, CompanionRosterState } from "@/lib/game/companion-roster";
import type { InventoryEntry, InventoryState } from "@/lib/game/inventory-store";
import type { PetVitals } from "@/lib/game/pet-state";
import type { GameReward, RewardLedgerEntry, StoredRewardState } from "@/lib/game/rewards";
import type { Wallet } from "@/lib/game/types";

type ServerRewardRow = {
  id: string;
  game_key: string;
  score: number;
  coins: number;
  hearts: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ServerInventoryRow = {
  id: string;
  catalog_item_id: string;
  quantity: number;
  equipped?: boolean | null;
  source?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ServerPetRow = {
  id: string;
  client_pet_id?: string | null;
  species: string;
  name: string;
  tone: string;
  accessory?: string | null;
  active: boolean;
  happiness: number;
  hunger: number;
  fullness?: number | null;
  energy?: number | null;
  cleanliness?: number | null;
  last_action_at?: Partial<Record<"feed" | "play" | "pamper" | "rest", number>> | null;
  nap_until?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Phase2UserContext = {
  supabase: ReturnType<typeof getSupabaseBrowserClient>;
  userId: string;
};

function maybeWarn(scope: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[HeartHaven phase2] ${scope}`, error);
  }
}

async function getPhase2Context(): Promise<Phase2UserContext | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return null;
    return { supabase, userId: user.id };
  } catch (error) {
    maybeWarn("Supabase client unavailable", error);
    return null;
  }
}

function normalizeInventorySource(source: string | null | undefined): InventoryEntry["source"] {
  if (
    source === "starter" ||
    source === "seasonal-seed" ||
    source === "purchase" ||
    source === "gift-received" ||
    source === "daily-drop"
  ) {
    return source;
  }
  return "starter";
}

function rewardRowToLedger(row: ServerRewardRow): RewardLedgerEntry {
  const label = typeof row.metadata?.label === "string" ? row.metadata.label : row.game_key;
  return {
    id: row.id,
    gameId: row.game_key,
    label,
    score: Number(row.score ?? 0),
    coins: Number(row.coins ?? 0),
    hearts: Number(row.hearts ?? 0),
    awardedAt: row.created_at,
  };
}

export async function loadServerWalletState(localFallback: StoredRewardState): Promise<StoredRewardState | null> {
  const context = await getPhase2Context();
  if (!context) return null;

  const { supabase, userId } = context;
  try {
    const { data: walletRow, error: walletError } = await supabase
      .from("wallets")
      .select("coins, hearts")
      .eq("profile_id", userId)
      .maybeSingle();

    if (walletError) throw walletError;

    let wallet: Wallet = walletRow
      ? { coins: Number(walletRow.coins ?? 0), hearts: Number(walletRow.hearts ?? 0) }
      : localFallback.wallet;

    if (!walletRow) {
      const { data: inserted, error: insertError } = await supabase
        .from("wallets")
        .upsert({ profile_id: userId, coins: wallet.coins, hearts: wallet.hearts }, { onConflict: "profile_id" })
        .select("coins, hearts")
        .maybeSingle();
      if (!insertError && inserted) {
        wallet = { coins: Number(inserted.coins ?? wallet.coins), hearts: Number(inserted.hearts ?? wallet.hearts) };
      }
    }

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("game_reward_events")
      .select("id, game_key, score, coins, hearts, metadata, created_at")
      .eq("profile_id", userId)
      .order("created_at", { ascending: false })
      .limit(14);

    if (ledgerError) throw ledgerError;

    return {
      wallet,
      ledger: ((ledgerRows ?? []) as ServerRewardRow[]).map(rewardRowToLedger),
    };
  } catch (error) {
    maybeWarn("wallet hydrate failed", error);
    return null;
  }
}

export async function persistWalletCredit(reward: GameReward): Promise<StoredRewardState | null> {
  const context = await getPhase2Context();
  if (!context) return null;

  try {
    const { data, error } = await context.supabase.rpc("phase2_credit_wallet", {
      p_game_key: reward.gameId,
      p_label: reward.label,
      p_score: reward.score,
      p_coins: reward.coins,
      p_hearts: reward.hearts,
      p_metadata: { label: reward.label },
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return loadServerWalletState({
      wallet: { coins: Number(row.coins ?? 0), hearts: Number(row.hearts ?? 0) },
      ledger: [],
    });
  } catch (error) {
    maybeWarn("wallet credit failed", error);
    return null;
  }
}

export async function persistWalletSpend(
  coins: number,
  hearts: number,
  reason = "spend",
): Promise<{ ok: boolean; state: StoredRewardState | null }> {
  const context = await getPhase2Context();
  if (!context) return { ok: true, state: null };

  try {
    const { data, error } = await context.supabase.rpc("phase2_spend_wallet", {
      p_coins: coins,
      p_hearts: hearts,
      p_reason: reason,
      p_metadata: { reason },
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    const state = await loadServerWalletState({
      wallet: {
        coins: Number(row?.coins ?? 0),
        hearts: Number(row?.hearts ?? 0),
      },
      ledger: [],
    });
    return { ok: Boolean(row?.ok), state };
  } catch (error) {
    maybeWarn("wallet spend failed", error);
    return { ok: true, state: null };
  }
}

export async function loadServerInventoryState(localFallback: InventoryState): Promise<InventoryState | null> {
  const context = await getPhase2Context();
  if (!context) return null;

  try {
    const { data, error } = await context.supabase
      .from("inventory_items")
      .select("id, catalog_item_id, quantity, equipped, source, created_at, updated_at")
      .eq("owner_id", context.userId)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const rows = (data ?? []) as ServerInventoryRow[];
    if (rows.length === 0 && localFallback.items.length > 0) {
      await syncServerInventoryState(localFallback);
      return localFallback;
    }

    return {
      items: rows.map((row) => ({
        id: row.id,
        catalogItemId: row.catalog_item_id,
        quantity: Number(row.quantity ?? 0),
        equipped: Boolean(row.equipped),
        acquiredAt: row.created_at ?? row.updated_at ?? new Date().toISOString(),
        source: normalizeInventorySource(row.source),
      })),
      giftsReceived: localFallback.giftsReceived,
      giftsSent: localFallback.giftsSent,
    };
  } catch (error) {
    maybeWarn("inventory hydrate failed", error);
    return null;
  }
}

export async function syncServerInventoryState(state: InventoryState): Promise<InventoryState | null> {
  const context = await getPhase2Context();
  if (!context) return null;

  try {
    const payload = state.items.map((item) => ({
      catalog_item_id: item.catalogItemId,
      quantity: item.quantity,
      equipped: item.equipped,
      source: item.source,
    }));
    const { data, error } = await context.supabase.rpc("phase2_sync_inventory", { p_items: payload });
    if (error) throw error;
    const rows = (data ?? []) as ServerInventoryRow[];
    return {
      ...state,
      items: rows.map((row) => ({
        id: row.id,
        catalogItemId: row.catalog_item_id,
        quantity: Number(row.quantity ?? 0),
        equipped: Boolean(row.equipped),
        acquiredAt: row.updated_at ?? new Date().toISOString(),
        source: normalizeInventorySource(row.source),
      })),
    };
  } catch (error) {
    maybeWarn("inventory sync failed", error);
    return null;
  }
}

function vitalsToServerPayload(vitals: PetVitals) {
  return {
    happiness: Math.round(vitals.happiness),
    fullness: Math.round(vitals.fullness),
    energy: Math.round(vitals.energy),
    cleanliness: Math.round(vitals.cleanliness),
    hunger: Math.max(0, Math.min(100, 100 - Math.round(vitals.fullness))),
    last_action_at: vitals.lastActionAt,
    nap_until: vitals.napUntil ? new Date(vitals.napUntil).toISOString() : null,
  };
}

function petRowToVitals(row: ServerPetRow): PetVitals {
  const lastAction = row.last_action_at ?? {};
  return {
    happiness: Number(row.happiness ?? 86),
    fullness: Number(row.fullness ?? Math.max(0, 100 - Number(row.hunger ?? 20))),
    energy: Number(row.energy ?? 80),
    cleanliness: Number(row.cleanliness ?? 80),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    lastActionAt: {
      feed: Number(lastAction.feed ?? 0),
      play: Number(lastAction.play ?? 0),
      pamper: Number(lastAction.pamper ?? 0),
      rest: Number(lastAction.rest ?? 0),
    },
    napUntil: row.nap_until ? new Date(row.nap_until).getTime() : undefined,
  };
}

export async function loadServerPetState(
  localRoster: CompanionRosterState,
  localVitals: PetVitals,
): Promise<{ roster: CompanionRosterState; vitals: PetVitals } | null> {
  const context = await getPhase2Context();
  if (!context) return null;

  try {
    const { data, error } = await context.supabase
      .from("pets")
      .select("id, client_pet_id, species, name, tone, accessory, active, happiness, hunger, fullness, energy, cleanliness, last_action_at, nap_until, created_at, updated_at")
      .eq("owner_id", context.userId)
      .order("active", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) throw error;
    const rows = (data ?? []) as ServerPetRow[];

    if (rows.length === 0) {
      await syncServerPetState(localRoster, localVitals);
      return { roster: localRoster, vitals: localVitals };
    }

    const companions = rows.map((row): CompanionRecord => ({
      id: row.client_pet_id ?? row.id,
      name: row.name,
      speciesId: row.species as CompanionRecord["speciesId"],
      toneId: row.tone as CompanionRecord["toneId"],
      accessory: (row.accessory ?? "none") as CompanionRecord["accessory"],
      adoptedAt: row.created_at ?? new Date().toISOString(),
      active: Boolean(row.active),
    }));
    const active = companions.find((companion) => companion.active) ?? companions[0];
    const activeRow = rows.find((row) => (row.client_pet_id ?? row.id) === active.id) ?? rows[0];

    return {
      roster: {
        activeId: active.id,
        companions: companions.map((companion) => ({ ...companion, active: companion.id === active.id })),
      },
      vitals: petRowToVitals(activeRow),
    };
  } catch (error) {
    maybeWarn("pet hydrate failed", error);
    return null;
  }
}

export async function syncServerPetState(roster: CompanionRosterState, vitals: PetVitals): Promise<void> {
  const context = await getPhase2Context();
  if (!context) return;

  try {
    const vitalPayload = vitalsToServerPayload(vitals);
    const rows = roster.companions.slice(0, 24).map((companion) => ({
      owner_id: context.userId,
      client_pet_id: companion.id,
      species: companion.speciesId,
      name: companion.name,
      tone: companion.toneId,
      accessory: companion.accessory,
      active: companion.id === roster.activeId,
      happiness: companion.id === roster.activeId ? vitalPayload.happiness : 86,
      hunger: companion.id === roster.activeId ? vitalPayload.hunger : 20,
      fullness: companion.id === roster.activeId ? vitalPayload.fullness : 80,
      energy: companion.id === roster.activeId ? vitalPayload.energy : 80,
      cleanliness: companion.id === roster.activeId ? vitalPayload.cleanliness : 80,
      last_action_at: companion.id === roster.activeId ? vitalPayload.last_action_at : undefined,
      nap_until: companion.id === roster.activeId ? vitalPayload.nap_until : null,
    }));

    const { error } = await context.supabase
      .from("pets")
      .upsert(rows, { onConflict: "owner_id,client_pet_id" });
    if (error) throw error;
  } catch (error) {
    maybeWarn("pet sync failed", error);
  }
}
