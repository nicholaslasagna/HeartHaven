import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BookHeart, Gamepad2, HeartHandshake, Leaf, Mail, Sparkles } from "lucide-react";
import { FloatingPetals } from "@/components/brand/floating-petals";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const features = [
  {
    image: "/game-assets/generated/pet-art-preview-fox.png",
    title: "Adopt a companion",
    copy: "Choose a soft animal friend, care for them daily, and bring them into every room and garden.",
  },
  {
    image: "/game-assets/generated/garden-bare-map.png",
    title: "Grow gardens",
    copy: "Plant, water, harvest, and unlock shared plots that become a quiet ritual with your partner.",
  },
  {
    icon: Mail,
    image: "/game-assets/generated/casper-card.png",
    title: "Send love notes",
    copy: "Write private notes, schedule future letters, and keep meaningful messages in a memory book.",
  },
  {
    icon: Gamepad2,
    image: "/game-assets/generated/world/claw-machine.png",
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
        <section className="relative min-h-[calc(100svh-76px)] overflow-hidden border-b border-cream-300/70">
          <Image
            alt="HeartHaven village with gardens, paths, pets, rooms, and game kiosks"
            className="absolute inset-0 h-full w-full object-cover"
            height={920}
            priority
            src="/game-assets/generated/hearthaven-world-poster.png"
            width={1680}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-ink-900/78 via-ink-900/32 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-paper via-paper/42 to-transparent" />
          <div className="relative mx-auto flex min-h-[calc(100svh-76px)] max-w-7xl flex-col justify-end px-4 pb-20 pt-16 sm:px-6 lg:px-8">
            <Badge className="w-fit border-white/35 bg-white/18 text-white shadow-sm backdrop-blur">
              <Sparkles className="size-3.5 text-honey-200" />
              a playable cozy world for two
            </Badge>
            <h1 className="mt-5 max-w-3xl text-balance font-display text-5xl leading-[0.96] text-white drop-shadow-sm sm:text-6xl lg:text-7xl">
              Build a little world with someone you love.
            </h1>
            <p className="mt-5 max-w-2xl text-base font-extrabold leading-7 text-cream-100 sm:text-xl sm:leading-8">
              Adopt companions, decorate rooms by dragging real objects into place, walk garden paths, host friends,
              play party games, and keep shared memories somewhere warm.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/auth/sign-up">
                  Plant your garden <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="warm">
                <Link href="/app/area">Enter the world</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-y border-cream-300/70 bg-cream-50/84">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-7 sm:px-6 md:grid-cols-4 lg:px-8">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className="grid grid-cols-[76px_1fr] gap-3 rounded-2xl border border-white/75 bg-white/62 p-3 shadow-sm"
              >
                <div className="relative grid size-[76px] place-items-center overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-inner">
                  <Image
                    alt={`${feature.title} icon`}
                    className={`h-full w-full ${index === 1 ? "object-cover" : "object-contain p-2"} drop-shadow-[0_10px_14px_rgba(91,63,63,0.18)]`}
                    height={96}
                    src={feature.image}
                    width={96}
                  />
                </div>
                <div>
                  <h2 className="font-display text-xl text-ink-900">{feature.title}</h2>
                  <p className="mt-1 text-xs font-semibold leading-5 text-ink-500">{feature.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-5 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          <div className="rounded-3xl border border-cream-300 bg-white/70 p-5 shadow-[0_18px_40px_-26px_rgba(91,63,63,0.55)]">
              <HeartHandshake className="mb-4 size-7 text-blush-500" />
              <h2 className="font-display text-2xl">Partner worlds</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                Link with one trusted partner, grow a shared garden, and unlock private quests together.
              </p>
          </div>
          <div className="rounded-3xl border border-cream-300 bg-white/70 p-5 shadow-[0_18px_40px_-26px_rgba(91,63,63,0.55)]">
              <Leaf className="mb-4 size-7 text-garden-500" />
              <h2 className="font-display text-2xl">Daily loops</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                Water plants, tend pets, earn rewards, decorate rooms, and keep progress persistent.
              </p>
          </div>
          <div className="rounded-3xl border border-cream-300 bg-white/70 p-5 shadow-[0_18px_40px_-26px_rgba(91,63,63,0.55)]">
              <BookHeart className="mb-4 size-7 text-lavender-500" />
              <h2 className="font-display text-2xl">Memory book</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
                Preserve achievements, love notes, photos, quests, and private milestones in one place.
              </p>
          </div>
        </section>
      </main>
    </div>
  );
}
