"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, PackagePlus } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { CurrencyPill } from "@/components/cozy/currency-pill";
import { Badge } from "@/components/ui/badge";
import { useGameWallet } from "@/lib/game/use-game-wallet";
import type { inventoryItems } from "@/lib/mock-data";

type InventoryClientProps = {
  items: typeof inventoryItems;
};

export function InventoryClient({ items }: InventoryClientProps) {
  const [equippedIds, setEquippedIds] = useState(() => items.filter((entry) => entry.equipped).map((entry) => entry.id));
  const [selectedCategory, setSelectedCategory] = useState("all");
  const { wallet } = useGameWallet();

  const categories = ["all", ...Array.from(new Set(items.map((entry) => entry.item.category)))];
  const visibleItems = items.filter((entry) => selectedCategory === "all" || entry.item.category === selectedCategory);

  function toggleEquip(id: string) {
    setEquippedIds((value) => (value.includes(id) ? value.filter((entryId) => entryId !== id) : [...value, id]));
    // TODO: Persist equipped/placed item state to Supabase inventory_items and placed_items.
  }

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-500">Inventory</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Your cozy things</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Filter, equip, and send starter items to the room or garden.
          </p>
        </div>
        <div className="flex gap-2">
          <CurrencyPill type="coins" value={wallet.coins} />
          <CurrencyPill type="hearts" value={wallet.hearts} />
        </div>
      </section>
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
        {visibleItems.map(({ id, item, quantity }) => {
          const equipped = equippedIds.includes(id);

          return (
            <CozyCard key={id} className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <Badge variant={equipped ? "blush" : "outline"}>{equipped ? "Equipped" : item.rarity}</Badge>
                <Badge variant="outline">x{quantity}</Badge>
              </div>
              <div className="grid h-28 place-items-center rounded-lg border border-cream-300 bg-cream-50">
                <PackagePlus className="size-10 text-blush-500" />
              </div>
              <h2 className="mt-4 font-display text-2xl text-ink-900">{item.name}</h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-ink-700">{item.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <CozyButton size="sm" variant={equipped ? "default" : "warm"} onClick={() => toggleEquip(id)}>
                  <CheckCircle2 />
                  {equipped ? "Equipped" : "Equip"}
                </CozyButton>
                <CozyButton asChild size="sm" variant="ghost">
                  <Link href={item.placementType === "garden_plot" ? "/app/garden" : "/app/room"}>Place</Link>
                </CozyButton>
              </div>
            </CozyCard>
          );
        })}
      </div>
    </div>
  );
}
