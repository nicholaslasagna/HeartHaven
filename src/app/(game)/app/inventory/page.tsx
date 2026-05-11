import { InventoryClient } from "@/app/(game)/app/inventory/inventory-client";
import { inventoryItems, playerWallet } from "@/lib/mock-data";

export default function InventoryPage() {
  return <InventoryClient items={inventoryItems} coins={playerWallet.coins} hearts={playerWallet.hearts} />;
}
