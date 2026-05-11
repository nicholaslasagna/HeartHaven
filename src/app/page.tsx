import Link from "next/link";
import { ArrowRight, BookHeart, Gamepad2, HeartHandshake, Leaf, Mail, Sparkles } from "lucide-react";
import { LandingScene } from "@/components/brand/animated-scene";
import { FloatingPetals } from "@/components/brand/floating-petals";
import { PetIllustration, PlantIllustration } from "@/components/brand/illustrations";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: PetIllustration,
    title: "Adopt a companion",
    copy: "Choose a soft animal friend, care for them daily, and bring them into every room and garden.",
  },
  {
    icon: PlantIllustration,
    title: "Grow gardens",
    copy: "Plant, water, harvest, and unlock shared plots that become a quiet ritual with your partner.",
  },
  {
    icon: Mail,
    title: "Send love notes",
    copy: "Write private notes, schedule future letters, and keep meaningful messages in a memory book.",
  },
  {
    icon: Gamepad2,
    title: "Play mini-games",
    copy: "Earn coins and hearts from cozy sessions like Memory Match and Garden Catch.",
  },
];

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-meadow text-foreground">
      <FloatingPetals />
      <SiteHeader />
      <main className="relative z-10">
        <section className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:px-8 lg:py-16">
          <div className="flex flex-col justify-center">
            <Badge variant="blush" className="w-fit">
              <Sparkles className="size-3.5 text-honey-500" />
              a cozy place for two
            </Badge>
            <h1 className="mt-5 max-w-3xl font-display text-5xl leading-tight text-ink-900 sm:text-6xl lg:text-7xl">
              Build a little world with someone you love.
            </h1>
            <p className="mt-5 max-w-xl text-lg font-semibold leading-8 text-ink-700">
              HeartHaven is a browser-based virtual world for adopting companions, decorating rooms,
              growing gardens, visiting friends, and keeping shared memories somewhere warm.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/auth/sign-up">
                  Plant your garden <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="warm">
                <Link href="/app/room">Preview the room</Link>
              </Button>
            </div>
          </div>
          <LandingScene />
        </section>

        <section className="border-y border-cream-300/70 bg-cream-50/70">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:px-6 md:grid-cols-4 lg:px-8">
            {features.map((feature, index) => (
              <div key={feature.title} className="grid grid-cols-[44px_1fr] gap-3">
                <div className="grid size-11 place-items-center rounded-lg bg-white/80 shadow-sm">
                  {index < 2 ? (
                    <feature.icon className="w-9" />
                  ) : (
                    <feature.icon className="size-5 text-blush-500" />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-ink-900">{feature.title}</h2>
                  <p className="mt-1 text-xs font-semibold leading-5 text-ink-500">{feature.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-5 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          <Card className="bg-white/70">
            <CardContent className="p-5">
              <HeartHandshake className="mb-4 size-7 text-blush-500" />
              <h2 className="font-display text-2xl">Partner worlds</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                Link with one trusted partner, grow a shared garden, and unlock private quests together.
              </p>
            </CardContent>
          </Card>
          <Card className="bg-white/70">
            <CardContent className="p-5">
              <Leaf className="mb-4 size-7 text-garden-500" />
              <h2 className="font-display text-2xl">Daily loops</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                Water plants, tend pets, earn rewards, decorate rooms, and keep progress persistent.
              </p>
            </CardContent>
          </Card>
          <Card className="bg-white/70">
            <CardContent className="p-5">
              <BookHeart className="mb-4 size-7 text-lavender-500" />
              <h2 className="font-display text-2xl">Memory book</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                Preserve achievements, love notes, photos, quests, and private milestones in one place.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
