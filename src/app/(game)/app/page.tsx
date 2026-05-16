import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BookHeart, Compass, Gamepad2, Heart, Inbox, Leaf, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { FriendInviteCard } from "@/components/cozy/friend-invite-card";
import { KeeperCustomizerCard } from "@/components/cozy/keeper-customizer-card";
import { MiniGameCard } from "@/components/cozy/mini-game-card";
import { PetCarePanel } from "@/components/cozy/pet-care-panel";
import { RoomPreview } from "@/components/cozy/room-preview";
import { AchievementsPanel } from "@/components/game/achievements-panel";
import { CasperWishPanel } from "@/components/game/casper-wish-panel";
import { DailyLoopPanel } from "@/components/game/daily-loop-panel";
import { DashboardWalletCard } from "@/components/game/dashboard-wallet-card";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Badge } from "@/components/ui/badge";
import { friendInvite, loveNotes, memoryPages, miniGames } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <div className="grid gap-5">
      <SeasonalEventBanner compact />

      <section className="relative overflow-hidden rounded-lg border border-cream-300 bg-ink-900 shadow-xl shadow-blush-200/30">
        <Image
          src="/game-assets/generated/hearthaven-world-poster.png"
          alt="HeartHaven world with cottages, lantern paths, pets, gardens, and arcade games"
          width={1680}
          height={920}
          priority
          className="h-[430px] w-full object-cover sm:h-[500px] lg:h-[560px]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-900/76 via-ink-900/24 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-900/68 to-transparent" />
        <div className="absolute left-5 top-5 flex flex-wrap gap-2">
          <Badge className="border-white/30 bg-white/18 text-white shadow-sm backdrop-blur">
            <Compass className="size-3.5" />
            Living world
          </Badge>
          <Badge className="border-white/30 bg-white/18 text-white shadow-sm backdrop-blur">
            <Sparkles className="size-3.5" />
            Walk, decorate, invite, play
          </Badge>
        </div>
        <div className="absolute inset-y-0 left-0 flex max-w-2xl flex-col justify-end p-5 sm:p-8 lg:p-10">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-cream-100">HeartHaven is awake</p>
          <h1 className="mt-3 font-display text-5xl leading-[0.95] text-white drop-shadow-sm sm:text-6xl lg:text-7xl">
            Step into the garden village.
          </h1>
          <p className="mt-4 max-w-xl text-base font-bold leading-7 text-cream-100 sm:text-lg">
            Follow the lantern roads, decorate rooms and parks, care for Casper, host party games, and build a shared
            place that feels like a love letter you can walk around inside.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap">
            <CozyButton asChild>
              <Link href="/app/area?zone=garden">
                Enter garden <Leaf />
              </Link>
            </CozyButton>
            <CozyButton asChild variant="warm">
              <Link href="/app/area?zone=park">
                Go to park <Compass />
              </Link>
            </CozyButton>
            <CozyButton asChild variant="warm">
              <Link href="/app/games">
                Open games <Gamepad2 />
              </Link>
            </CozyButton>
          </div>
        </div>
      </section>

      {/* Hero + the living companion */}
      <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-lg border border-cream-300 bg-cream-50/75 p-6 shadow-sm">
          <Badge variant="garden">
            <Sparkles className="size-3.5" />
            Daily haven
          </Badge>
          <h1 className="mt-4 font-display text-5xl leading-tight text-ink-900">Good to see you, Keeper.</h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-ink-700">
            Your companion&apos;s vitals drifted a little while you were away — claim today&apos;s gift, run your daily
            tasks, customize your keeper, and tend to your friend. Your room, gardens, and games are all warmed up.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <CozyButton asChild>
              <Link href="/app/pet">
                Open studio <Heart />
              </Link>
            </CozyButton>
            <CozyButton asChild variant="warm">
              <Link href="/app/area?zone=room">
                Visit room <ArrowRight />
              </Link>
            </CozyButton>
            <CozyButton asChild variant="warm">
              <Link href="/app/games">Start games</Link>
            </CozyButton>
          </div>
        </div>
        <PetCarePanel compact />
      </section>

      {/* Wallet + keepsakes glance */}
      <section className="grid gap-5 md:grid-cols-3">
        <DashboardWalletCard />
        <Link href="/app/memory-book" className="contents">
          <CozyCard className="p-5 transition-transform hover:-translate-y-0.5">
            <BookHeart className="mb-3 size-6 text-lavender-500" />
            <h2 className="font-display text-2xl">Memory pages</h2>
            <p className="mt-1 text-sm font-semibold text-ink-700">{memoryPages.length} saved drafts</p>
          </CozyCard>
        </Link>
        <Link href="/app/mailbox" className="contents">
          <CozyCard className="p-5 transition-transform hover:-translate-y-0.5">
            <Inbox className="mb-3 size-6 text-blush-500" />
            <h2 className="font-display text-2xl">Love notes</h2>
            <p className="mt-1 text-sm font-semibold text-ink-700">{loveNotes.length} notes waiting</p>
          </CozyCard>
        </Link>
      </section>

      {/* The come-back-tomorrow engine: daily gift, tasks, streak + milestones */}
      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <DailyLoopPanel />
        <div className="grid gap-5">
          <CasperWishPanel compact />
          <AchievementsPanel limit={4} />
        </div>
      </section>

      {/* Room + social */}
      <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <RoomPreview />
        <div className="grid gap-5">
          <FriendInviteCard {...friendInvite} />
          <KeeperCustomizerCard />
        </div>
      </section>

      {/* Mini-games */}
      <section className="grid gap-5 md:grid-cols-2">
        {miniGames.map((game) => (
          <MiniGameCard key={game.id} {...game} />
        ))}
      </section>
    </div>
  );
}
