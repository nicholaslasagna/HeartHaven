import { PetClient } from "@/app/(game)/app/pet/pet-client";

export const metadata = {
  title: "Companion · HeartHaven",
  description: "Feed, play, pamper, and rest your HeartHaven companion to keep their vitals up.",
};

export default function PetPage() {
  return <PetClient />;
}
