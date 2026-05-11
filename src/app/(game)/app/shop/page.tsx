import { ShopClient } from "@/app/(game)/app/shop/shop-client";
import { starterCatalog } from "@/lib/catalog";

export default function ShopPage() {
  return <ShopClient items={starterCatalog} />;
}
