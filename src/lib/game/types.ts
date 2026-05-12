export type ItemCategory =
  | "flooring"
  | "wall"
  | "decor"
  | "furniture"
  | "garden"
  | "keepsake";

export type PlacementType = "floor" | "wall" | "garden_plot" | "inventory_only";

export type CatalogItem = {
  id: string;
  name: string;
  category: ItemCategory;
  description: string;
  priceCoins: number;
  priceHearts: number;
  rarity: "starter" | "common" | "rare" | "private";
  assetKey: string;
  placementType: PlacementType;
  tags: string[];
};

export type RoomPlacement = {
  id: string;
  catalogItemId: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  zIndex: number;
};

export type PetSpecies = {
  id: string;
  name: string;
  temperament: string;
  favoriteTreat: string;
  colors: string[];
};

export type Wallet = {
  coins: number;
  hearts: number;
};

export type RoomEmote = "heart" | "wave" | "sparkle" | "cozy";

export type RealtimeRoomPlayer = {
  id: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  petName: string;
  emote?: RoomEmote;
  updatedAt: number;
};
