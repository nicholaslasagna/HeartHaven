import { Logo } from "@/components/brand/logo";
import { PetPicker } from "@/components/onboarding/pet-picker";

export default function AdoptPetPage() {
  return (
    <main className="min-h-screen bg-meadow px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Logo />
        <div className="mt-8 grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
          <section className="pt-4">
            <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Step 2</p>
            <h1 className="mt-3 font-display text-5xl leading-tight text-ink-900">Adopt your first companion.</h1>
            <p className="mt-4 text-base font-semibold leading-7 text-ink-700">
              Pets start as simple persistent records, then become animated sprites in the Phaser room renderer.
            </p>
          </section>
          <PetPicker />
        </div>
      </div>
    </main>
  );
}
