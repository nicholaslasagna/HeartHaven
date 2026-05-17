export type PetFoodId =
  | "moonberry-biscuit"
  | "honey-oat-bites"
  | "garden-crisp"
  | "starlight-soup"
  | "salmon-moon-bites";

export type PetFoodAnimation = "sparkle-bite" | "happy-crunch" | "fresh-leaves" | "sleepy-steam" | "purr-heart";

type PetFoodVitalKey = "happiness" | "fullness" | "energy" | "cleanliness";

export type PetFood = {
  id: PetFoodId;
  name: string;
  shortName: string;
  description: string;
  imageSrc: string;
  deltas: Partial<Record<PetFoodVitalKey, number>>;
  animation: PetFoodAnimation;
};

export const PET_FOODS: PetFood[] = [
  {
    id: "moonberry-biscuit",
    name: "Moonberry Biscuit",
    shortName: "Moonberry",
    description: "A cozy starter snack that fills them up and lifts their mood.",
    imageSrc: "/game-assets/generated/pet-foods/moonberry-biscuit.png",
    deltas: { fullness: 34, happiness: 10 },
    animation: "sparkle-bite",
  },
  {
    id: "honey-oat-bites",
    name: "Honey Oat Bites",
    shortName: "Honey Oats",
    description: "A warm treat for a bigger fullness boost and a little energy.",
    imageSrc: "/game-assets/generated/pet-foods/honey-oat-bites.png",
    deltas: { fullness: 42, energy: 8 },
    animation: "happy-crunch",
  },
  {
    id: "garden-crisp",
    name: "Garden Crisp",
    shortName: "Garden Crisp",
    description: "Fresh greens that help fullness and freshness together.",
    imageSrc: "/game-assets/generated/pet-foods/garden-crisp.png",
    deltas: { fullness: 24, cleanliness: 14, happiness: 4 },
    animation: "fresh-leaves",
  },
  {
    id: "starlight-soup",
    name: "Starlight Soup",
    shortName: "Star Soup",
    description: "A gentle evening bowl that restores energy while feeding them.",
    imageSrc: "/game-assets/generated/pet-foods/starlight-soup.png",
    deltas: { fullness: 28, energy: 18 },
    animation: "sleepy-steam",
  },
  {
    id: "salmon-moon-bites",
    name: "Salmon Moon Bites",
    shortName: "Salmon Bites",
    description: "A premium favorite with a stronger happiness boost.",
    imageSrc: "/game-assets/generated/pet-foods/salmon-moon-bites.png",
    deltas: { fullness: 30, happiness: 18 },
    animation: "purr-heart",
  },
];

export function getPetFood(id: PetFoodId | string | null | undefined): PetFood {
  return PET_FOODS.find((food) => food.id === id) ?? PET_FOODS[0];
}

export function formatPetFoodEffects(food: PetFood) {
  const labels: Record<PetFoodVitalKey, string> = {
    happiness: "joy",
    fullness: "fed",
    energy: "rest",
    cleanliness: "fresh",
  };
  return Object.entries(food.deltas)
    .filter(([, value]) => typeof value === "number" && value !== 0)
    .map(([key, value]) => `${value > 0 ? "+" : ""}${value} ${labels[key as PetFoodVitalKey]}`)
    .join(" · ");
}
