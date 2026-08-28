export const MEMORY_MATCH_PAIR_IDS = [
  "heart",
  "petal",
  "lantern",
  "tree",
  "casper",
  "moon",
  "note",
  "garden",
  "basket",
  "teatable",
  "armchair",
  "petbed",
] as const;

export type MemoryMatchPairId = (typeof MEMORY_MATCH_PAIR_IDS)[number];

/**
 * Everything that defines a card: its name, its colour, and its art.
 *
 * The art used to live in a lookup inside the canvas that fell back to the
 * heart when a pair was missing — so adding a pair and forgetting its art
 * silently produced two cards that looked identical, which makes the board
 * unwinnable. Keeping all of it here means a pair is defined once, and the
 * check asserts every pair has its own distinct frame.
 */
export type MemoryMatchCardArt = {
  texture: "minigame-props" | "cozy-furniture-sprites" | "casper-sprite";
  frame: number;
  width: number;
  height: number;
  y: number;
};

export const MEMORY_MATCH_PAIR_DATA: Record<
  MemoryMatchPairId,
  { label: string; color: number; art: MemoryMatchCardArt }
> = {
  heart:    { label: "Heart",     color: 0xd87e8c, art: { texture: "minigame-props",         frame: 3, width: 68, height: 86, y: -12 } },
  petal:    { label: "Petal",     color: 0xf6cfd2, art: { texture: "minigame-props",         frame: 4, width: 68, height: 86, y: -12 } },
  lantern:  { label: "Lantern",   color: 0xd9a53e, art: { texture: "minigame-props",         frame: 6, width: 74, height: 92, y: -14 } },
  tree:     { label: "Tree",      color: 0x6e9651, art: { texture: "cozy-furniture-sprites", frame: 7, width: 86, height: 92, y: -14 } },
  casper:   { label: "Casper",    color: 0xfffcf3, art: { texture: "casper-sprite",          frame: 0, width: 56, height: 56, y: -12 } },
  moon:     { label: "Moon",      color: 0xc0a8dc, art: { texture: "cozy-furniture-sprites", frame: 4, width: 82, height: 92, y: -14 } },
  note:     { label: "Note",      color: 0xead9b5, art: { texture: "cozy-furniture-sprites", frame: 6, width: 80, height: 86, y: -14 } },
  garden:   { label: "Garden",    color: 0xa9c58a, art: { texture: "minigame-props",         frame: 7, width: 78, height: 90, y: -14 } },
  basket:   { label: "Basket",    color: 0xdfa27c, art: { texture: "minigame-props",         frame: 2, width: 84, height: 82, y: -12 } },
  teatable: { label: "Tea Table", color: 0xb5764a, art: { texture: "cozy-furniture-sprites", frame: 3, width: 88, height: 84, y: -12 } },
  armchair: { label: "Armchair",  color: 0x8f7bc4, art: { texture: "cozy-furniture-sprites", frame: 1, width: 78, height: 88, y: -13 } },
  petbed:   { label: "Pet Bed",   color: 0xf0c0b0, art: { texture: "cozy-furniture-sprites", frame: 2, width: 86, height: 84, y: -12 } },
};

/**
 * Cards on the table: two of every pair.
 *
 * The server builds the same deck in memory_match_shuffled_board(), and
 * parseMemoryMatchState refuses a board shorter than this. All three have to
 * agree — a client and server that disagreed on a board size is exactly how
 * multiplayer Pool came to reject every shot.
 */
export const MEMORY_MATCH_BOARD_SIZE = MEMORY_MATCH_PAIR_IDS.length * 2;
