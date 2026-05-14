import Link from "next/link";
import { ArrowRight, BookHeart, Heart, Inbox, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { FriendInviteCard } from "@/components/cozy/friend-invite-card";
import { KeeperCustomizerCard } from "@/components/cozy/keeper-customizer-card";
import { MiniGameCard } from "@/components/cozy/mini-game-card";
import { PetCarePanel } from "@/components/cozy/pet-care-panel";
import { RoomPreview } from "@/components/cozy/room-preview";
import { AchievementsPanel } from "@/components/game/achievements-panel";
import { DailyLoopPanel } from "@/components/game/daily-loop-panel";
import { DashboardWalletCard } from "@/components/game/dashboard-wallet-card";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Badge } from "@/components/ui/badge";
import { friendInvite, loveNotes, memoryPages, miniGames } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <div className="grid gap-5">
      <SeasonalEventBanner compact />

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
            tasks, and tend to your friend. Your room, gardens, and games are all warmed up.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <CozyButton asChild>
              <Link href="/app/pet">
                Tend to companion <Heart />
              </Link>
            </CozyButton>
            <CozyButton asChild variant="warm">
              <Link href="/app/room">
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
        <AchievementsPanel limit={6} />
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
