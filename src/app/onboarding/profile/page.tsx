import { Logo } from "@/components/brand/logo";
import { ProfileForm } from "@/components/onboarding/profile-form";

export default function ProfileOnboardingPage() {
  return (
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Logo />
        <div className="mt-8 grid gap-6 md:grid-cols-[0.75fr_1.25fr]">
          <section className="pt-4">
            <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Step 1</p>
            <h1 className="mt-3 font-display text-5xl leading-tight text-ink-900">Name your little world.</h1>
            <p className="mt-4 text-base font-semibold leading-7 text-ink-700">
              This creates the player profile and first haven records that future rooms, gardens, wallets, and inventory attach to.
            </p>
          </section>
          <ProfileForm />
        </div>
      </div>
    </main>
  );
}
