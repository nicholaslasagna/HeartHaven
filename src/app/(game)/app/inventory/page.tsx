import { InventoryClient } from "@/app/(game)/app/inventory/inventory-client";
import { inventoryItems } from "@/lib/mock-data";

export default function InventoryPage() {
  return <InventoryClient items={inventoryItems} />;
}
