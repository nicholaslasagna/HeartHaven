import Link from "next/link";
import { ArrowRight, BookHeart, Heart, Inbox, Leaf, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { CurrencyPill } from "@/components/cozy/currency-pill";
import { FriendInviteCard } from "@/components/cozy/friend-invite-card";
import { MiniGameCard } from "@/components/cozy/mini-game-card";
import { PetCard } from "@/components/cozy/pet-card";
import { RoomPreview } from "@/components/cozy/room-preview";
import { Badge } from "@/components/ui/badge";
import { activePet, friendInvite, loveNotes, memoryPages, miniGames, playerWallet } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <div className="grid gap-5">
      <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-lg border border-cream-300 bg-cream-50/75 p-6 shadow-sm">
          <Badge variant="garden">
            <Sparkles className="size-3.5" />
            Daily haven
          </Badge>
          <h1 className="mt-4 font-display text-5xl leading-tight text-ink-900">Good evening, Niko.</h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-ink-700">
            Casper watered one moonberry planter while you were away. Your room, garden, shop, inventory, notes, and memory book are ready for the first MVP loop.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <CozyButton asChild>
              <Link href="/app/room">
                Visit room <ArrowRight />
              </Link>
            </CozyButton>
            <CozyButton asChild variant="warm">
              <Link href="/app/partner-garden">Open partner garden</Link>
            </CozyButton>
          </div>
        </div>
        <PetCard {...activePet} />
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        <CozyCard className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-2xl">Wallet</h2>
            <Heart className="size-5 fill-current text-blush-500" />
          </div>
          <div className="flex flex-wrap gap-2">
            <CurrencyPill type="coins" value={playerWallet.coins} />
            <CurrencyPill type="hearts" value={playerWallet.hearts} />
          </div>
        </CozyCard>
        <CozyCard className="p-5">
          <BookHeart className="mb-3 size-6 text-lavender-500" />
          <h2 className="font-display text-2xl">Memory pages</h2>
          <p className="mt-1 text-sm font-semibold text-ink-700">{memoryPages.length} saved drafts</p>
        </CozyCard>
        <CozyCard className="p-5">
          <Inbox className="mb-3 size-6 text-blush-500" />
          <h2 className="font-display text-2xl">Love notes</h2>
          <p className="mt-1 text-sm font-semibold text-ink-700">{loveNotes.length} notes waiting</p>
        </CozyCard>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <RoomPreview />
        <div className="grid gap-5">
          <FriendInviteCard {...friendInvite} />
          <CozyCard className="p-5">
            <div className="flex items-center gap-2">
              <Leaf className="size-5 text-garden-500" />
              <h2 className="font-display text-2xl">Today&apos;s soft loop</h2>
            </div>
            <div className="mt-4 grid gap-2 text-sm font-bold text-ink-700 sm:grid-cols-3">
              <div className="rounded-lg bg-garden-100 p-3">Water garden</div>
              <div className="rounded-lg bg-blush-100 p-3">Feed Casper</div>
              <div className="rounded-lg bg-lavender-100 p-3">Write a note</div>
            </div>
          </CozyCard>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        {miniGames.map((game) => (
          <MiniGameCard key={game.id} {...game} />
        ))}
      </section>
    </div>
  );
}
