import type { PetSpeciesId } from "@/lib/game/avatar-customization";

/**
 * Generated companion art used by lightweight React and Phaser surfaces.
 * Keep this mapping in one place so a selected companion never falls back to
 * a hard-coded Casper image just because a game has its own renderer.
 */
export const COMPANION_ART_BY_SPECIES: Record<string, string> = {
  fox: "/game-assets/generated/pets/fox.png",
  bunny: "/game-assets/generated/pets/bunny.png",
  bear: "/game-assets/generated/pets/bear.png",
  duck: "/game-assets/generated/pets/duck.png",
  kitten: "/game-assets/generated/pets/kitten.png",
  puppy: "/game-assets/generated/pets/puppy.png",
  calico: "/game-assets/generated/pets/calico.png",
  lamb: "/game-assets/generated/pets/lamb.png",
  panda: "/game-assets/generated/pets/panda.png",
  dragon: "/game-assets/generated/pets/dragon.png",
  "super-snails": "/game-assets/generated/pets/super-snails.png",
};

/** Pose-specific atlases for canvases that need authored companion motion. */
export type CompanionMotionFrame = "idle" | "runA" | "runB" | "jump" | "sit" | "sleep";

export type CompanionMotionAtlas = {
  src: string;
  frameCount: number;
  frames: Record<CompanionMotionFrame, number>;
};

export const COMPANION_MOTION_ATLAS_BY_SPECIES: Record<string, CompanionMotionAtlas> = {
  // Five authored cells: idle, two distinct running poses, seated, resting.
  kitten: {
    src: "/game-assets/generated/pets/kitten-motion-atlas-v1.png",
    frameCount: 5,
    frames: { idle: 0, runA: 1, runB: 2, jump: 1, sit: 3, sleep: 4 },
  },
};

export function companionArtAsset(speciesId: PetSpeciesId | string | null | undefined) {
  return COMPANION_ART_BY_SPECIES[speciesId ?? ""] ?? COMPANION_ART_BY_SPECIES.kitten;
}

export function companionMotionAtlas(speciesId: PetSpeciesId | string | null | undefined) {
  return COMPANION_MOTION_ATLAS_BY_SPECIES[speciesId ?? ""] ?? null;
}
