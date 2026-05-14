"use client";

import Link from "next/link";
import {
  Copy,
  Crown,
  Gamepad2,
  HeartHandshake,
  Link2,
  Map,
  PartyPopper,
  RadioTower,
  Shirt,
  Sparkles,
  Trophy,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parkGames, partyGames, partySeats } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const partySizes = [2, 4, 6, 8] as const;
const gameFilters = ["All", "Solo", "Couples", "Party", "Park"] as const;
type GameFilter = (typeof gameFilters)[number];

function filterGame(game: { mode: string; title: string }, filter: GameFilter) {
  const haystack = `${game.mode} ${game.title}`.toLowerCase();
  if (filter === "All") return true;
  if (filter === "Solo") return haystack.includes("solo") || haystack.includes("runway");
  if (filter === "Couples") return haystack.includes("couple") || haystack.includes("teams");
  if (filter === "Party") return haystack.includes("party") || haystack.includes("guest") || haystack.includes("team");
  return true;
}

export function GamesClient() {
  const [partySize, setPartySize] = useState<(typeof partySizes)[number]>(4);
  const [activeFilter, setActiveFilter] = useState<GameFilter>("All");
  const [copied, setCopied] = useState(false);
  const [copiedGameId, setCopiedGameId] = useState<string | null>(null);
  const inviteCode = "HH-PARTY-GLOW";
  const visibleSeats = useMemo(() => partySeats.slice(0, Math.min(partySize, partySeats.length)), [partySize]);
  const visibleGames = useMemo(() => {
    const source = activeFilter === "Park" ? parkGames : partyGames;
    return activeFilter === "Park" ? source : source.filter((game) => filterGame(game, activeFilter));
  }, [activeFilter]);
  const featuredGame = parkGames.find((game) => game.id === "park-fashion-show") ?? parkGames[0];

  function copyInvite() {
    setCopied(true);
    navigator.clipboard?.writeText(inviteCode).catch(() => setCopied(false));
    setTimeout(() => setCopied(false), 1200);
  }

  function copyGameInvite(gameId: string, href: string) {
    const origin = window.location.origin;
    const link = `${origin}${href}?party=${inviteCode}`;
    setCopiedGameId(gameId);
    navigator.clipboard?.writeText(link).catch(() => setCopiedGameId(null));
    setTimeout(() => setCopiedGameId(null), 1200);
  }

  return (
    <div className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <div className="relative overflow-hidden rounded-lg border border-blush-300/50 bg-blush-100/60 p-6 shadow-sm">
          <div className="absolute right-8 top-8 grid size-24 place-items-center rounded-full bg-white/38 text-blush-500 blur-[1px]" />
          <Badge variant="blush">
            <PartyPopper className="size-3.5" />
            Quiet arcade
          </Badge>
          <h1 className="mt-3 font-display text-5xl leading-tight text-ink-900">HeartHaven Games</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-ink-700">
            One launch hub for the park arcade, couple games, party seats, invite links, and wallet rewards. The next
            Supabase pass can attach these same cards to live lobbies and session records.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {gameFilters.map((filter) => (
              <button
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-extrabold transition-colors",
                  activeFilter === filter
                    ? "bg-blush-500 text-white shadow-sm"
                    : "bg-white/78 text-ink-700 ring-1 ring-cream-300 hover:bg-blush-100",
                )}
                key={filter}
                onClick={() => setActiveFilter(filter)}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <CozyCard className="overflow-hidden p-0">
          <div className="bg-gradient-to-br from-lavender-100 via-blush-100 to-honey-100 p-5">
            <div className="flex items-center justify-between gap-3">
              <Badge variant="garden">
                <Crown className="size-3.5" />
                Featured
              </Badge>
              <Shirt className="size-6 text-lavender-500" />
            </div>
            <h2 className="mt-4 font-display text-3xl text-ink-900">{featuredGame.title}</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-ink-700">{featuredGame.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <CozyButton asChild size="sm">
                <Link href={featuredGame.href}>Play stage</Link>
              </CozyButton>
              <Button onClick={() => copyGameInvite(featuredGame.id, featuredGame.href)} size="sm" variant="secondary">
                <Link2 /> {copiedGameId === featuredGame.id ? "Copied" : "Invite"}
              </Button>
            </div>
          </div>
          <div className="border-t border-cream-300 bg-white/74 p-4 text-xs font-extrabold text-ink-600">
            Park games are also clickable from Honeyheart Park&apos;s walkable scene.
          </div>
        </CozyCard>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <HeartHandshake className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">Party lobby</h2>
          </div>
          <p className="mt-2 text-sm font-bold leading-6 text-ink-700">
            Invite a partner, another couple, or a friend group, then launch a turn-based or arcade game from this page.
          </p>
          <div className="mt-4 rounded-lg border border-cream-300 bg-cream-50 p-3">
            <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Invite code</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="font-mono text-lg font-black text-ink-900">{inviteCode}</span>
              <Button onClick={copyInvite} size="sm" variant="warm">
                <Copy /> {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Party size</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {partySizes.map((size) => (
                <button
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-extrabold transition-colors",
                    partySize === size ? "bg-lavender-500 text-white" : "bg-white text-ink-700 ring-1 ring-cream-300 hover:bg-lavender-100",
                  )}
                  key={size}
                  onClick={() => setPartySize(size)}
                  type="button"
                >
                  {size} seats
                </button>
              ))}
            </div>
          </div>
        </CozyCard>

        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <UsersRound className="size-5 text-lavender-500" />
            <h2 className="font-display text-2xl text-ink-900">Seats</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {visibleSeats.map((seat) => (
              <div className="rounded-lg border border-cream-300 bg-white/76 p-3 shadow-sm" key={seat.id}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-ink-900">{seat.name}</p>
                    <p className="text-xs font-bold text-ink-500">{seat.role} - Team {seat.team}</p>
                  </div>
                  <Badge variant={seat.ready ? "garden" : "outline"}>{seat.ready ? "Ready" : "Open"}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CozyCard>
      </section>

      <section className="rounded-lg border border-garden-300/50 bg-garden-100/62 p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Map className="size-5 text-garden-700" />
              <h2 className="font-display text-2xl text-ink-900">Honeyheart Park arcade</h2>
            </div>
            <p className="mt-1 text-sm font-bold text-ink-700">
              These games also appear as walk-up kiosks in the park world.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/app/park">Walk to park</Link>
          </Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {parkGames.map((game) => (
            <Link
              className="rounded-lg border border-white/70 bg-white/70 p-3 text-sm font-bold text-ink-700 shadow-sm transition hover:-translate-y-0.5 hover:border-garden-300 hover:bg-white"
              href={game.href}
              key={game.id}
            >
              <span className="block font-display text-lg text-ink-900">{game.title}</span>
              <span className="mt-1 block text-xs uppercase tracking-normal text-garden-700">{game.mode}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        {visibleGames.map((game) => (
          <CozyCard className="p-5" key={game.id}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="grid size-11 place-items-center rounded-lg bg-lavender-100 text-lavender-500">
                <Gamepad2 className="size-5" />
              </div>
              <Badge variant="outline">{game.mode}</Badge>
            </div>
            <h2 className="font-display text-2xl text-ink-900">{game.title}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-ink-700">{game.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <CozyButton asChild size="sm" variant="warm">
                <Link href={game.href}>Play</Link>
              </CozyButton>
              <Button onClick={() => copyGameInvite(game.id, game.href)} size="sm" variant="secondary">
                <Link2 /> {copiedGameId === game.id ? "Copied" : "Invite"}
              </Button>
            </div>
          </CozyCard>
        ))}
      </section>

      <section className="grid gap-5 md:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 text-sm font-bold text-ink-700">
          <Trophy className="mr-2 inline size-4 text-honey-700" />
          Turn-based games now keep their own local turn switching and wallet reward loop, while arcade games use score,
          timer, or judging rules.
        </div>
        <div className="rounded-lg border border-sky-500/25 bg-sky-100/65 p-4 text-sm font-bold text-ink-700">
          <RadioTower className="mr-2 inline size-4 text-sky-500" />
          Party state is local for the MVP. The data shape is ready for Supabase Realtime presence, game sessions, host
          controls, ready checks, and room-party invites.
          <Sparkles className="ml-2 inline size-4 text-honey-700" />
        </div>
      </section>
    </div>
  );
}
