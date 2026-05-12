import { ShopClient } from "@/app/(game)/app/shop/shop-client";
import { marketCatalog } from "@/lib/catalog";

export default function ShopPage() {
  return <ShopClient items={marketCatalog} />;
}
