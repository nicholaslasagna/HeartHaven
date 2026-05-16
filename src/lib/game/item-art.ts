import type { CatalogItem } from "@/lib/game/types";

const furnitureRoot = "/game-assets/generated/furniture";
const worldRoot = "/game-assets/generated/world";

const catalogArtById: Record<string, string> = {
  "cozy-rug-blush": `${furnitureRoot}/rug.png`,
  "window-garden-arch": `${furnitureRoot}/window.png`,
  "lamp-honey-lantern": `${furnitureRoot}/lantern.png`,
  "chair-lavender-cushion": `${furnitureRoot}/armchair.png`,
  "bed-cream-canopy": `${furnitureRoot}/pet-bed.png`,
  "table-honey-tea": `${furnitureRoot}/tea-table.png`,
  "shelf-memory-oak": `${furnitureRoot}/bookshelf.png`,
  "plant-sweetfern-pot": `${furnitureRoot}/monstera.png`,
  "planter-moonberry": `${worldRoot}/flower-cart.png`,
  "casper-moonberry-plush": "/game-assets/generated/casper.png",
  "sofa-blush-cloud": `${furnitureRoot}/armchair.png`,
  "fireplace-honey-stone": `${furnitureRoot}/lantern.png`,
  "piano-lavender-upright": `${furnitureRoot}/bookshelf.png`,
  "game-table-garden": `${furnitureRoot}/tea-table.png`,
  "pet-bed-moonberry": `${furnitureRoot}/pet-bed.png`,
  "wardrobe-keeper-oak": `${furnitureRoot}/bookshelf.png`,
  "fountain-lantern-patio": `${worldRoot}/fountain.png`,
  "dance-rug-party-star": `${furnitureRoot}/rug.png`,
  "note-paper-cream": "/game-assets/generated/casper-card.png",
  "room-sunbeam-kitchen": "/game-assets/generated/cozy-room-bg.png",
  "room-lavender-library": "/game-assets/generated/cozy-room-bg.png",
  "room-garden-patio": "/game-assets/generated/garden-bare-map.png",
  "room-cloud-observatory": "/game-assets/generated/hearthaven-world-poster.png",
  "pumpkin-porch-lantern": `${furnitureRoot}/lantern.png`,
  "moonlight-bat-garland": `${furnitureRoot}/window.png`,
  "casper-boo-bed": `${furnitureRoot}/pet-bed.png`,
  "room-midnight-masquerade": "/game-assets/generated/cozy-room-bg.png",
  "winter-wish-tree": `${worldRoot}/sakura-tree.png`,
  "snowflake-window-garland": `${furnitureRoot}/window.png`,
  "peppermint-cocoa-table": `${furnitureRoot}/tea-table.png`,
  "room-cozy-carol-lodge": "/game-assets/generated/cozy-room-bg.png",
  "midnight-countdown-clock": `${furnitureRoot}/window.png`,
  "confetti-star-rug": `${furnitureRoot}/rug.png`,
  "sparkling-toast-table": `${furnitureRoot}/tea-table.png`,
  "room-sky-lantern-countdown": "/game-assets/generated/hearthaven-world-poster.png",
  "starlight-picnic-blanket": `${worldRoot}/picnic-table.png`,
  "firework-lantern-arch": `${worldRoot}/rose-arch.png`,
  "berry-sparkler-fountain": `${worldRoot}/fountain.png`,
  "room-summer-firework-patio": "/game-assets/generated/park-bare-map.png",
};

const categoryFallbackArt: Record<CatalogItem["category"], string> = {
  decor: `${furnitureRoot}/lantern.png`,
  flooring: `${furnitureRoot}/rug.png`,
  furniture: `${furnitureRoot}/armchair.png`,
  garden: `${worldRoot}/flower-cart.png`,
  keepsake: "/game-assets/generated/casper-card.png",
  room: "/game-assets/generated/cozy-room-bg.png",
  wall: `${furnitureRoot}/window.png`,
};

export function getCatalogItemArt(item: CatalogItem) {
  return catalogArtById[item.id] ?? categoryFallbackArt[item.category];
}

export function getCatalogItemArtFit(item: CatalogItem): "cover" | "contain" {
  // Every catalog tile now uses `object-contain` so the source PNG never
  // gets up-scaled past its natural pixel size. The previous "cover" path
  // for room items zoomed shop thumbnails enormously when their source
  // was a small icon. Containing keeps every tile uniform.
  void item;
  return "contain";
}

export function getGardenDecorArt(kind: string) {
  const art: Record<string, string> = {
    arcadeKiosk: `${worldRoot}/claw-machine.png`,
    bbq: `${worldRoot}/bbq.png`,
    bowlingKiosk: `${worldRoot}/bowling-shop.png`,
    fashionStage: `${worldRoot}/theater-stage.png`,
    flowerStand: `${worldRoot}/flower-cart.png`,
    fountain: `${worldRoot}/fountain.png`,
    gazebo: `${worldRoot}/gazebo.png`,
    greenhouse: `${worldRoot}/conservatory.png`,
    lanternArch: `${worldRoot}/rose-arch.png`,
    memoryTree: `${worldRoot}/sakura-tree.png`,
    picnic: `${worldRoot}/picnic-table.png`,
    swing: `${worldRoot}/swings.png`,
  };
  return art[kind] ?? `${worldRoot}/flower-cart.png`;
}
