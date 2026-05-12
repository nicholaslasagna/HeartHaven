"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Coins, Heart, PackagePlus, ShoppingBag } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { CurrencyPill } from "@/components/cozy/currency-pill";
import { Badge } from "@/components/ui/badge";
import { useGameWallet } from "@/lib/game/use-game-wallet";
import type { CatalogItem, ItemCategory } from "@/lib/game/types";

const filters: Array<ItemCategory | "all"> = ["all", "room", "furniture", "decor", "flooring", "wall", "garden", "keepsake"];

type ShopClientProps = {
  items: CatalogItem[];
};

export function ShopClient({ items }: ShopClientProps) {
  const [activeFilter, setActiveFilter] = useState<ItemCategory | "all">("all");
  const [owned, setOwned] = useState<string[]>([]);
  const [notice, setNotice] = useState("Tap an item to buy it for your room or garden.");
  const { wallet, spendCurrency } = useGameWallet();

  const visibleItems = useMemo(
    () => items.filter((item) => activeFilter === "all" || item.category === activeFilter),
    [activeFilter, items],
  );

  function buyItem(item: CatalogItem) {
    if (owned.includes(item.id)) {
      setNotice(`${item.name} is already tucked into your inventory.`);
      return;
    }

    if (wallet.coins < item.priceCoins || wallet.hearts < item.priceHearts) {
      setNotice(`You need more currency for ${item.name}.`);
      return;
    }

    if (!spendCurrency(item.priceCoins, item.priceHearts)) {
      setNotice(`You need more currency for ${item.name}.`);
      return;
    }

    setOwned((value) => [...value, item.id]);
    setNotice(`${item.name} joined your inventory.`);
    // TODO: Persist purchases to Supabase inventory_items and wallet transaction tables.
  }

  return (
    <div className="grid gap-5">
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
          <Badge variant="outline"><ShoppingBag className="size-3.5" /> {items.length} items</Badge>
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
        <p className="text-sm font-extrabold text-ink-700">{notice}</p>
      </CozyCard>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {visibleItems.map((item) => {
            const isOwned = owned.includes(item.id);

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
                    <Badge variant={item.rarity === "starter" ? "garden" : "outline"}>{item.rarity}</Badge>
                    <Badge variant="outline">{item.category}</Badge>
                  </div>
                  <div className="mb-4 grid h-28 place-items-center rounded-lg border border-cream-300 bg-cream-50">
                    <PackagePlus className="size-10 text-blush-500" />
                  </div>
                  <h2 className="font-display text-2xl text-ink-900">{item.name}</h2>
                  <p className="mt-1 min-h-12 text-sm font-semibold leading-6 text-ink-700">{item.description}</p>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex gap-2 text-sm font-extrabold text-ink-700">
                      <span className="inline-flex items-center gap-1"><Coins className="size-4 text-honey-500" /> {item.priceCoins}</span>
                      <span className="inline-flex items-center gap-1"><Heart className="size-4 fill-current text-blush-500" /> {item.priceHearts}</span>
                    </div>
                    <CozyButton size="sm" variant={isOwned ? "warm" : "default"} onClick={() => buyItem(item)}>
                      {isOwned ? <Check /> : <ShoppingBag />}
                      {isOwned ? "Owned" : "Buy"}
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
