"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Coins, Heart, ShoppingBag } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { CurrencyPill } from "@/components/cozy/currency-pill";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Badge } from "@/components/ui/badge";
import { useGameWallet } from "@/lib/game/use-game-wallet";
import { useInventory } from "@/lib/game/use-inventory";
import { getCatalogItemArt, getCatalogItemArtFit } from "@/lib/game/item-art";
import type { CatalogItem, ItemCategory } from "@/lib/game/types";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";
import { getCatalogItemSeason, isItemVisibleForSeason, isSeasonalCatalogItem } from "@/lib/seasonal-events";

const filters: Array<ItemCategory | "all" | "seasonal"> = [
  "all",
  "seasonal",
  "room",
  "furniture",
  "decor",
  "flooring",
  "wall",
  "garden",
  "keepsake",
];

type ShopClientProps = {
  items: CatalogItem[];
};

export function ShopClient({ items }: ShopClientProps) {
  const [activeFilter, setActiveFilter] = useState<ItemCategory | "all" | "seasonal">("all");
  const [notice, setNotice] = useState("Tap an item to buy it for your room or garden.");
  const { activeEvent } = useSeasonalEvent();
  const { wallet, spendCurrency } = useGameWallet();
  const inventory = useInventory();

  const visibleItems = useMemo(
    () =>
      items
        .filter((item) => isItemVisibleForSeason(item, activeEvent))
        .filter((item) => {
          if (activeFilter === "all") return true;
          if (activeFilter === "seasonal") return isSeasonalCatalogItem(item);
          return item.category === activeFilter;
        }),
    [activeEvent, activeFilter, items],
  );

  const ownedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of inventory.view) {
      counts.set(row.catalog.id, (counts.get(row.catalog.id) ?? 0) + row.entry.quantity);
    }
    return counts;
  }, [inventory.view]);

  function buyItem(item: CatalogItem) {
    if (wallet.coins < item.priceCoins || wallet.hearts < item.priceHearts) {
      setNotice(`You need more currency for ${item.name}.`);
      return;
    }

    if (!spendCurrency(item.priceCoins, item.priceHearts)) {
      setNotice(`You need more currency for ${item.name}.`);
      return;
    }

    inventory.addItem(item.id, "purchase", 1);
    const nextCount = (ownedCounts.get(item.id) ?? 0) + 1;
    setNotice(`${item.name} joined your inventory. You own ${nextCount}.`);
  }

  return (
    <div className="grid gap-5">
      <SeasonalEventBanner />
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-honey-700">Shop and inventory</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Starter Market</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Buy starter decor, garden pieces, and keepsakes with the same wallet you earn from mini-games.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CurrencyPill type="coins" value={wallet.coins} />
          <CurrencyPill type="hearts" value={wallet.hearts} />
          <Badge variant="outline"><ShoppingBag className="size-3.5" /> {visibleItems.length} visible</Badge>
        </div>
      </section>

      <CozyCard className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <CozyButton
              key={filter}
              variant={filter === activeFilter ? "default" : "warm"}
              size="sm"
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </CozyButton>
          ))}
        </div>
        <p className="text-sm font-extrabold text-ink-700">
          {activeEvent ? `${activeEvent.shopMessage} ${notice}` : notice}
        </p>
      </CozyCard>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {visibleItems.map((item) => {
            const ownedCount = ownedCounts.get(item.id) ?? 0;
            const seasonalItem = getCatalogItemSeason(item);

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <CozyCard className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <Badge
                      className={seasonalItem ? "border-white/70 bg-white/75 text-ink-900" : undefined}
                      variant={item.rarity === "starter" ? "garden" : "outline"}
                    >
                      {seasonalItem ? seasonalItem.shortName : item.rarity}
                    </Badge>
                    <Badge variant="outline">{item.category}</Badge>
                  </div>
                  <div
                    className="mb-4 grid h-28 place-items-center rounded-lg border border-cream-300 bg-cream-50"
                    style={
                      seasonalItem
                        ? {
                            background: `linear-gradient(135deg, ${seasonalItem.colors.tint}, #fffdf6)`,
                            borderColor: `${seasonalItem.colors.secondary}66`,
                          }
                        : undefined
                    }
                  >
                    <Image
                      alt={`${item.name} preview`}
                      // Always contain-fit so tile thumbnails never blow up
                      // past their tile. The h/w props are the source's
                      // intrinsic size; the className constrains the render.
                      className="block h-full max-h-[110px] w-full max-w-full object-contain p-3 drop-shadow-[0_16px_18px_rgba(91,63,63,0.2)]"
                      height={160}
                      src={getCatalogItemArt(item)}
                      width={220}
                    />
                  </div>
                  <h2 className="font-display text-2xl text-ink-900">{item.name}</h2>
                  <p className="mt-1 min-h-12 text-sm font-semibold leading-6 text-ink-700">{item.description}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex gap-2 text-sm font-extrabold text-ink-700">
                      <span className="inline-flex items-center gap-1"><Coins className="size-4 text-honey-500" /> {item.priceCoins}</span>
                      <span className="inline-flex items-center gap-1"><Heart className="size-4 fill-current text-blush-500" /> {item.priceHearts}</span>
                    </div>
                    <CozyButton size="sm" variant={ownedCount > 0 ? "warm" : "default"} onClick={() => buyItem(item)}>
                      {ownedCount > 0 ? <Check /> : <ShoppingBag />}
                      {ownedCount > 0 ? `Buy more · ${ownedCount}` : "Buy"}
                    </CozyButton>
                  </div>
                </CozyCard>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
