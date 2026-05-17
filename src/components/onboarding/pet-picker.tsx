import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { adoptPetAction } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { petSpecies } from "@/lib/catalog";

export function PetPicker() {
  return (
    <Card className="bg-white/78">
      <CardHeader>
        <CardTitle>Adopt your first companion</CardTitle>
        <CardDescription>Pick a starter friend. The adoption record becomes a persistent pet in Phase 2.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" action={adoptPetAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            {petSpecies.map((pet, index) => (
              <label key={pet.id} className="cursor-pointer rounded-lg border border-cream-300 bg-cream-50/80 p-4 transition hover:border-blush-300 hover:bg-blush-100/40">
                <input className="sr-only" type="radio" name="species" value={pet.id} defaultChecked={pet.id === "kitten"} />
                <div className="grid grid-cols-[96px_1fr] items-center gap-3">
                  <div className="relative grid h-24 place-items-center rounded-lg bg-white/70">
                    <div className="absolute bottom-3 h-4 w-16 rounded-full bg-ink-900/15 blur-[1px]" />
                    <Image
                      alt=""
                      className="relative h-24 w-auto object-contain drop-shadow-[0_10px_16px_rgba(91,63,63,0.18)]"
                      height={288}
                      src={`/game-assets/generated/pet-art-preview-${pet.id}.png`}
                      width={256}
                    />
                  </div>
                  <div>
                    <div className="font-display text-xl">{pet.name}</div>
                    <div className="text-sm font-bold text-ink-700">{pet.temperament}</div>
                    <div className="mt-1 text-xs font-bold text-muted-foreground">{pet.favoriteTreat}</div>
                  </div>
                </div>
              </label>
            ))}
          </div>
          <label className="grid gap-2 text-sm font-extrabold text-ink-700">
            Companion name
            <Input name="petName" placeholder="Casper" defaultValue="Casper" />
          </label>
          <Button className="justify-self-start">
            Enter HeartHaven <ArrowRight />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
