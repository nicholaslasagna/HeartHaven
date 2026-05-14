export type ItemCategory =
  | "flooring"
  | "wall"
  | "decor"
  | "furniture"
  | "garden"
  | "room"
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

export type FacingDirection = "left" | "right";

/**
 * RealtimeRoomPlayer is the full presence payload broadcast over Supabase
 * Realtime. It carries every customization slot so a remote player renders
 * with their actual keeper outfit + palette and their actual pet species +
 * fur tone — not a default placeholder. `facing` lets remote sprites mirror
 * the direction they last moved.
 *
 * Customization fields are typed as plain strings (not the client-only
 * union types from avatar-customization.ts) so this module stays free of the
 * "use client" boundary; the canvases normalize them on receipt.
 */
export type RealtimeRoomPlayer = {
  id: string;
  displayName: string;
  /** Hex palette color — kept for back-compat and aura tint. */
  color: string;
  /** Keeper customization. */
  bodyId: string;
  skinId: string;
  hairStyleId: string;
  hairColorId: string;
  paletteId: string;
  outfitId: string;
  /** Pet customization. */
  petName: string;
  petSpeciesId: string;
  petToneId: string;
  petAccessory: string;
  /** Last movement direction, for sprite mirroring. */
  facing: FacingDirection;
  x: number;
  y: number;
  emote?: RoomEmote;
  updatedAt: number;
};

export type RoomBlueprint = {
  id: string;
  name: string;
  description: string;
  priceCoins: number;
  priceHearts: number;
  theme: "loft" | "kitchen" | "library" | "patio" | "lodge" | "observatory";
  capacity: number;
  tags: string[];
  href: string;
};
