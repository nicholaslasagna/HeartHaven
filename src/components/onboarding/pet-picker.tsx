import { ArrowRight } from "lucide-react";
import { PetIllustration } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { petSpecies } from "@/lib/catalog";

const petTypes = ["fox", "bunny", "bear", "duck"] as const;
const tones = ["cream", "mint", "honey", "sky"] as const;

export function PetPicker() {
  return (
    <Card className="bg-white/78">
      <CardHeader>
        <CardTitle>Adopt your first companion</CardTitle>
        <CardDescription>Pick a starter friend. The adoption record becomes a persistent pet in Phase 2.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" action="/app">
          <div className="grid gap-3 sm:grid-cols-2">
            {petSpecies.map((pet, index) => (
              <label key={pet.id} className="cursor-pointer rounded-lg border border-cream-300 bg-cream-50/80 p-4 transition hover:border-blush-300 hover:bg-blush-100/40">
                <input className="sr-only" type="radio" name="species" value={pet.id} defaultChecked={index === 0} />
                <div className="grid grid-cols-[96px_1fr] items-center gap-3">
                  <PetIllustration type={petTypes[index]} tone={tones[index]} />
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
            <Input name="petName" placeholder="Clover" defaultValue="Clover" />
          </label>
          <Button className="justify-self-start">
            Enter HeartHaven <ArrowRight />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
