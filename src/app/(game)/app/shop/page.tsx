import { ShopClient } from "@/app/(game)/app/shop/shop-client";
import { starterCatalog } from "@/lib/catalog";
import { playerWallet } from "@/lib/mock-data";

export default function ShopPage() {
  return <ShopClient items={starterCatalog} startingCoins={playerWallet.coins} startingHearts={playerWallet.hearts} />;
}
