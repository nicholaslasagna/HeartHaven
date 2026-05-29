export const MEMORY_MATCH_PAIR_IDS = [
  "heart",
  "petal",
  "lantern",
  "tree",
  "casper",
  "moon",
  "note",
  "garden",
] as const;

export type MemoryMatchPairId = (typeof MEMORY_MATCH_PAIR_IDS)[number];

export const MEMORY_MATCH_PAIR_DATA: Record<
  MemoryMatchPairId,
  { label: string; color: number }
> = {
  heart: { label: "Heart", color: 0xd87e8c },
  petal: { label: "Petal", color: 0xf6cfd2 },
  lantern: { label: "Lantern", color: 0xd9a53e },
  tree: { label: "Tree", color: 0x6e9651 },
  casper: { label: "Casper", color: 0xfffcf3 },
  moon: { label: "Moon", color: 0xc0a8dc },
  note: { label: "Note", color: 0xead9b5 },
  garden: { label: "Garden", color: 0xa9c58a },
};

export const MEMORY_MATCH_BOARD_SIZE = 16;
