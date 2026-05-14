"use client";

import Link from "next/link";
import { Copy, Gamepad2, HeartHandshake, Link2, PartyPopper, RadioTower, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { partyGames, partySeats } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const partySizes = [2, 4, 6, 8] as const;

export function GamesClient() {
  const [partySize, setPartySize] = useState<(typeof partySizes)[number]>(4);
  const [copied, setCopied] = useState(false);
  const [copiedGameId, setCopiedGameId] = useState<string | null>(null);
  const inviteCode = "HH-PARTY-GLOW";
  const visibleSeats = useMemo(() => partySeats.slice(0, Math.min(partySize, partySeats.length)), [partySize]);

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
      <section className="rounded-lg border border-blush-300/50 bg-blush-100/60 p-5 shadow-sm">
        <Badge variant="blush">
          <PartyPopper className="size-3.5" />
          Game parties
        </Badge>
        <h1 className="mt-3 font-display text-4xl text-ink-900">HeartHaven Games</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-ink-700">
          Every playable game lives in this one hub for easy party flow. Copy a room invite, launch a game, and keep the
          party seats visible while Supabase Realtime turns local seats into online lobbies.
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <HeartHandshake className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">Couple party lobby</h2>
          </div>
          <p className="mt-2 text-sm font-bold leading-6 text-ink-700">
            Invite another couple, fill party seats, then launch a game from the same lobby.
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
                    partySize === size ? "bg-blush-500 text-white" : "bg-white text-ink-700 ring-1 ring-cream-300 hover:bg-blush-100",
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
              <div
                className="rounded-lg border border-cream-300 bg-white/76 p-3 shadow-sm"
                key={seat.id}
              >
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

      <section className="grid gap-5 md:grid-cols-2">
        {partyGames.map((game) => (
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

      <div className="rounded-lg border border-sky-500/25 bg-sky-100/65 p-4 text-sm font-bold text-ink-700">
        <RadioTower className="mr-2 inline size-4 text-sky-500" />
        Party state is local for the MVP. The lobby data shape is ready for Supabase Realtime presence, game sessions,
        host controls, ready checks, and room-party invites.
      </div>
    </div>
  );
}
