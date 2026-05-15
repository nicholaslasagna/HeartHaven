"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Coins, Gift, PackagePlus } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { CurrencyPill } from "@/components/cozy/currency-pill";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Badge } from "@/components/ui/badge";
import { useGameWallet } from "@/lib/game/use-game-wallet";
import { useInventory } from "@/lib/game/use-inventory";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";
import { getCatalogItemSeason, isItemVisibleForSeason, isSeasonalCatalogItem } from "@/lib/seasonal-events";

/**
 * InventoryClient — reads the live inventory store (so daily-drop items show
 * up immediately, gifts you've claimed appear, and selling deducts quantity).
 *
 * The "Sell" button refunds half the original coin price into the wallet via
 * the shared wallet store; the activity bus picks it up as a `coins-spent`-
 * adjacent event because the credit flows through `creditWallet`.
 */
export function InventoryClient() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const { activeEvent } = useSeasonalEvent();
  const { wallet } = useGameWallet();
  const inventory = useInventory();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const rows = inventory.view.filter((row) => isItemVisibleForSeason(row.catalog, activeEvent));
  const categories = ["all", "seasonal", ...Array.from(new Set(rows.map((row) => row.catalog.category)))];
  const visible = rows.filter((row) => {
    if (selectedCategory === "all") return true;
    if (selectedCategory === "seasonal") return isSeasonalCatalogItem(row.catalog);
    return row.catalog.category === selectedCategory;
  });

  function handleSell(entryId: string, name: string) {
    const result = inventory.sellItem(entryId);
    if (result.ok) {
      setStatusMessage(`Sold one ${name} for +${result.refund.coins} coins.`);
    } else if (result.reason === "empty") {
      setStatusMessage("Nothing left to sell.");
    } else {
      setStatusMessage("Couldn't sell that item.");
    }
    window.setTimeout(() => setStatusMessage(null), 2400);
  }

  return (
    <div className="grid gap-5">
      <SeasonalEventBanner compact />
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-500">Inventory</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Your cozy things</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Equip items to your keeper, send them to your room or garden, gift them to a friend, or sell them back for
            coins.
          </p>
        </div>
        <div className="flex gap-2">
          <CurrencyPill type="coins" value={wallet.coins} />
          <CurrencyPill type="hearts" value={wallet.hearts} />
        </div>
      </section>

      {statusMessage && (
        <div className="rounded-md border border-garden-300/50 bg-garden-100/70 px-4 py-2 text-sm font-extrabold text-garden-700">
          {statusMessage}
        </div>
      )}

      <CozyCard className="flex flex-wrap gap-2 p-4">
        {categories.map((category) => (
          <CozyButton
            key={category}
            size="sm"
            variant={selectedCategory === category ? "default" : "warm"}
            onClick={() => setSelectedCategory(category)}
          >
            {category}
          </CozyButton>
        ))}
      </CozyCard>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {visible.length === 0 && (
          <CozyCard className="p-5 md:col-span-2 xl:col-span-3">
            <p className="text-sm font-bold text-ink-500">No items in this category yet — claim a daily gift, accept a gifted item, or pick something up in the shop.</p>
          </CozyCard>
        )}
        {visible.map((row) => {
          const refund = inventory.getResellValue(row.catalog);
          const seasonalItem = getCatalogItemSeason(row.catalog);
          return (
            <CozyCard key={row.entry.id} className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <Badge
                  className={seasonalItem ? "border-white/70 bg-white/75 text-ink-900" : undefined}
                  variant={row.entry.equipped ? "blush" : "outline"}
                >
                  {row.entry.equipped ? "Equipped" : seasonalItem ? seasonalItem.shortName : row.catalog.rarity}
                </Badge>
                <Badge variant="outline">x{row.entry.quantity}</Badge>
              </div>
              <div
                className="grid h-28 place-items-center rounded-lg border border-cream-300 bg-cream-50"
                style={
                  seasonalItem
                    ? {
                        background: `linear-gradient(135deg, ${seasonalItem.colors.tint}, #fffdf6)`,
                        borderColor: `${seasonalItem.colors.secondary}66`,
                      }
                    : undefined
                }
              >
                <PackagePlus className="size-10 text-blush-500" />
              </div>
              <h2 className="mt-4 font-display text-2xl text-ink-900">{row.catalog.name}</h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-ink-700">{row.catalog.description}</p>
              {row.entry.source === "gift-received" && (
                <p className="mt-1 text-xs font-extrabold text-lavender-500">From a friend</p>
              )}
              {row.entry.source === "daily-drop" && (
                <p className="mt-1 text-xs font-extrabold text-honey-700">Daily-gift surprise</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <CozyButton size="sm" variant={row.entry.equipped ? "default" : "warm"} onClick={() => inventory.toggleEquipped(row.entry.id)}>
                  <CheckCircle2 />
                  {row.entry.equipped ? "Equipped" : "Equip"}
                </CozyButton>
                <CozyButton asChild size="sm" variant="ghost">
                  <Link href={row.catalog.placementType === "garden_plot" ? "/app/area?zone=garden" : "/app/area?zone=room"}>
                    Place
                  </Link>
                </CozyButton>
                <CozyButton asChild size="sm" variant="ghost">
                  <Link href="/app/friends">
                    <Gift /> Gift
                  </Link>
                </CozyButton>
                <CozyButton
                  size="sm"
                  variant="warm"
                  onClick={() => handleSell(row.entry.id, row.catalog.name)}
                  disabled={row.entry.equipped}
                  title={row.entry.equipped ? "Unequip before selling" : `Sell one for +${refund.coins} coins`}
                >
                  <Coins />
                  Sell · +{refund.coins}
                </CozyButton>
              </div>
            </CozyCard>
          );
        })}
      </div>
    </div>
  );
}
