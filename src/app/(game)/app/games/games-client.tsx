"use client";

import Link from "next/link";
import {
  ClipboardCheck,
  Copy,
  Crown,
  Gamepad2,
  HeartHandshake,
  Link2,
  Map,
  PartyPopper,
  RadioTower,
  RefreshCw,
  Send,
  Shirt,
  Sparkles,
  Trophy,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parkGames, partyGames } from "@/lib/mock-data";
import { usePartyLobby } from "@/lib/game/use-party-lobby";
import { useSocial } from "@/lib/game/use-social";
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

function joinErrorCopy(reason: string) {
  if (reason === "not-friends") return "Party invites are friend-only. Accept the host as a friend first, then use their party link.";
  if (reason === "full") return "That party is full.";
  if (reason === "self") return "You're already hosting that party.";
  if (reason === "wrong-recipient") return "That invite link was created for a different friend.";
  if (reason === "needs-link") return "That code is not on this device yet. Paste the full party invite link so HeartHaven can verify the host.";
  return "That party invite could not be read.";
}

export function GamesClient() {
  const social = useSocial();
  const party = usePartyLobby(4);
  const lobby = party.lobby;
  const [activeFilter, setActiveFilter] = useState<GameFilter>("All");
  const [copied, setCopied] = useState<string | null>(null);
  const [copiedGameId, setCopiedGameId] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [joinNotice, setJoinNotice] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({ kind: "idle", message: "" });
  const [inviteNotice, setInviteNotice] = useState<{ kind: "idle" | "ok" | "error"; message: string; link?: string }>({
    kind: "idle",
    message: "",
  });

  const visibleGames = useMemo(() => {
    const source = activeFilter === "Park" ? parkGames : partyGames;
    return activeFilter === "Park" ? source : source.filter((game) => filterGame(game, activeFilter));
  }, [activeFilter]);
  const featuredGame = parkGames.find((game) => game.id === "park-fashion-show") ?? parkGames[0];
  const occupiedCodes = useMemo(
    () => new Set((lobby?.seats ?? []).map((seat) => seat.code).filter(Boolean)),
    [lobby?.seats],
  );
  const inviteableFriends = useMemo(
    () => social.friends.filter((friend) => !occupiedCodes.has(friend.code)),
    [social.friends, occupiedCodes],
  );
  const currentSeat = lobby?.seats.find((seat) => seat.code === social.selfCode && seat.status !== "invited");
  const isHost = Boolean(lobby && lobby.hostCode === social.selfCode);
  const readyCount = lobby?.seats.filter((seat) => (seat.status === "host" || seat.status === "occupied") && seat.ready).length ?? 0;
  const occupiedCount = lobby?.seats.filter((seat) => seat.status === "host" || seat.status === "occupied").length ?? 0;

  useEffect(() => {
    if (!party.ready || !social.ready) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("join") ?? params.get("party");
    if (!token) return;
    const result = party.join(window.location.href);
    queueMicrotask(() => {
      if (result.ok) {
        setJoinNotice({ kind: "ok", message: `Joined ${result.lobby.hostDisplayName}'s party.` });
      } else {
        setJoinNotice({ kind: "error", message: joinErrorCopy(result.reason) });
      }
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("join");
    url.searchParams.delete("party");
    window.history.replaceState({}, "", url.toString());
  }, [party, party.ready, social.ready]);

  async function copyText(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
    } catch {
      setCopied(null);
    }
  }

  function copyLobbyCode() {
    if (!lobby) return;
    void copyText(lobby.code, "party-code");
  }

  function copyLobbyLink() {
    if (!lobby) return;
    const link = party.buildLink();
    void copyText(link, "party-link");
  }

  function copyGameInvite(gameId: string, href: string, title: string) {
    const link = party.buildLink(undefined, { href, title });
    setCopiedGameId(gameId);
    navigator.clipboard?.writeText(link).catch(() => setCopiedGameId(null));
    window.setTimeout(() => setCopiedGameId(null), 1400);
  }

  function handleJoinParty() {
    const result = party.join(joinInput);
    if (result.ok) {
      setJoinNotice({ kind: "ok", message: `Joined ${result.lobby.hostDisplayName}'s party.` });
      setJoinInput("");
      if (result.launchedHref) {
        setJoinNotice({ kind: "ok", message: `Joined party. Launch ${result.lobby.gameTitle ?? "the selected game"} when ready.` });
      }
    } else {
      setJoinNotice({ kind: "error", message: joinErrorCopy(result.reason) });
    }
  }

  function inviteFriend(friend: (typeof social.friends)[number]) {
    const result = party.inviteFriend(friend);
    if (!result.ok) {
      const message =
        result.reason === "already-in-lobby" ? `${friend.displayName} already has a seat.`
        : result.reason === "full" ? "This party is full. Increase the party size or remove an invite first."
        : result.reason === "not-host" ? "Only the party host can invite friends into seats."
        : "You can't invite yourself.";
      setInviteNotice({ kind: "error", message });
      return;
    }
    const link = party.buildLink(friend);
    setInviteNotice({
      kind: "ok",
      message: `${friend.displayName} now has an invited seat. Send them this private link.`,
      link,
    });
    void copyText(link, `friend-${friend.code}`);
  }

  return (
    <div className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <div className="relative overflow-hidden rounded-lg border border-blush-300/50 bg-blush-100/60 p-6 shadow-sm">
          <div className="absolute right-8 top-8 grid size-24 place-items-center rounded-full bg-white/38 text-blush-500 blur-[1px]" />
          <Badge variant="blush">
            <PartyPopper className="size-3.5" />
            Friend-only arcade
          </Badge>
          <h1 className="mt-3 font-display text-5xl leading-tight text-ink-900">HeartHaven Games</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-ink-700">
            Host a real party lobby, invite friends into named seats, paste a party invite to join, then launch turn-based
            games or park arcade rounds from one place.
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
              <Button onClick={() => copyGameInvite(featuredGame.id, featuredGame.href, featuredGame.title)} size="sm" variant="secondary">
                <Link2 /> {copiedGameId === featuredGame.id ? "Copied" : "Invite"}
              </Button>
            </div>
          </div>
          <div className="border-t border-cream-300 bg-white/74 p-4 text-xs font-extrabold text-ink-600">
            Game invite links carry the selected game plus your party host info.
          </div>
        </CozyCard>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <HeartHandshake className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">Party lobby</h2>
          </div>
          <p className="mt-2 text-sm font-bold leading-6 text-ink-700">
            Your lobby only uses your username and actual invited friends. No filler guests, no fake ready names.
          </p>

          <div className="mt-4 rounded-lg border border-cream-300 bg-cream-50 p-3">
            <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Party code</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-white px-3 py-2 font-mono text-lg font-black text-ink-900">
                {lobby?.code ?? "Creating..."}
              </span>
              <Button disabled={!lobby} onClick={copyLobbyCode} size="sm" variant="warm">
                {copied === "party-code" ? <ClipboardCheck /> : <Copy />} {copied === "party-code" ? "Copied" : "Code"}
              </Button>
              <Button disabled={!lobby} onClick={copyLobbyLink} size="sm" variant="secondary">
                {copied === "party-link" ? <ClipboardCheck /> : <Link2 />} {copied === "party-link" ? "Copied" : "Invite link"}
              </Button>
            </div>
            <p className="mt-2 text-xs font-bold text-ink-600">
              Share the full invite link for friend-only verification. The short code works after the lobby exists on this device.
            </p>
          </div>

          <div className="mt-4">
            <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Party size</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {partySizes.map((size) => (
                <button
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-extrabold transition-colors",
                    lobby?.size === size ? "bg-lavender-500 text-white" : "bg-white text-ink-700 ring-1 ring-cream-300 hover:bg-lavender-100",
                  )}
                  key={size}
                  disabled={!isHost}
                  onClick={() => party.resize(size)}
                  type="button"
                >
                  {size} seats
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-lavender-300/40 bg-lavender-100/55 p-3">
            <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">Join a party</p>
            <div className="mt-2 flex gap-2">
              <input
                value={joinInput}
                onChange={(event) => {
                  setJoinInput(event.target.value);
                  if (joinNotice.kind !== "idle") setJoinNotice({ kind: "idle", message: "" });
                }}
                placeholder="Paste party link or HH-GAME-ABCD"
                className="min-w-0 flex-1 rounded-md border border-cream-300 bg-white p-2.5 text-sm font-bold text-ink-900 placeholder:font-normal focus:border-lavender-300 focus:outline-none"
              />
              <CozyButton size="sm" onClick={handleJoinParty}>
                <UsersRound /> Join
              </CozyButton>
            </div>
            {joinNotice.message && (
              <p className={cn("mt-2 text-xs font-extrabold", joinNotice.kind === "error" ? "text-blush-700" : "text-garden-700")}>
                {joinNotice.message}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => party.resetLobby(lobby?.size ?? 4)} size="sm" variant="secondary">
              <RefreshCw /> New lobby
            </Button>
            {currentSeat && (
              <Button onClick={party.toggleReady} size="sm" variant={currentSeat.ready ? "warm" : "default"}>
                <Trophy /> {currentSeat.ready ? "Ready" : "Mark ready"}
              </Button>
            )}
          </div>
        </CozyCard>

        <CozyCard className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UsersRound className="size-5 text-lavender-500" />
              <h2 className="font-display text-2xl text-ink-900">Seats</h2>
            </div>
            <Badge variant="garden">{readyCount}/{Math.max(occupiedCount, 1)} ready</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(lobby?.seats ?? []).map((seat) => {
              const isOwnSeat = seat.code === social.selfCode && seat.status !== "invited";
              return (
                <div
                  className={cn(
                    "rounded-lg border p-3 shadow-sm",
                    seat.status === "open" ? "border-cream-300 bg-white/58" : "border-lavender-300/45 bg-white/82",
                  )}
                  key={seat.id}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-extrabold text-ink-900">{seat.displayName}</p>
                      <p className="text-xs font-bold text-ink-500">
                        {seat.role} - Team {seat.team}
                      </p>
                      {seat.code && <p className="mt-1 font-mono text-[11px] font-bold text-ink-500">{seat.code}</p>}
                    </div>
                    <Badge
                      variant={seat.ready ? "garden" : seat.status === "invited" ? "blush" : "outline"}
                    >
                      {seat.status === "open" ? "Open" : seat.status === "invited" ? "Invited" : seat.ready ? "Ready" : "Joined"}
                    </Badge>
                  </div>
                  {seat.status === "invited" && isHost && (
                    <button
                      className="mt-3 inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/70 px-2.5 py-1 text-xs font-extrabold text-ink-600 hover:bg-blush-100"
                      onClick={() => party.removeSeat(seat.id)}
                      type="button"
                    >
                      <X className="size-3.5" /> Remove invite
                    </button>
                  )}
                  {isOwnSeat && <p className="mt-3 text-xs font-extrabold text-garden-700">This is you.</p>}
                </div>
              );
            })}
          </div>
        </CozyCard>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <UserPlus className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">Invite friends</h2>
          </div>
          <p className="mt-1 text-xs font-bold text-ink-500">
            Only friends can be invited to party seats. They receive a private link that joins this lobby.
          </p>
          {social.friends.length === 0 ? (
            <div className="mt-3 rounded-lg border border-cream-300 bg-cream-50 p-3 text-sm font-bold text-ink-700">
              Add friends first, then party invites appear here.
              <CozyButton asChild className="mt-3" size="sm" variant="warm">
                <Link href="/app/friends">Open friends</Link>
              </CozyButton>
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              {(inviteableFriends.length > 0 ? inviteableFriends : social.friends).map((friend) => {
                const alreadySeated = occupiedCodes.has(friend.code);
                return (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-cream-300 bg-white/70 px-3 py-2" key={friend.code}>
                    <div>
                      <p className="text-sm font-extrabold text-ink-900">{friend.displayName}</p>
                      <p className="font-mono text-xs text-ink-500">{friend.code}</p>
                    </div>
                    <CozyButton disabled={alreadySeated || !isHost} size="sm" onClick={() => inviteFriend(friend)}>
                      <Send /> {alreadySeated ? "Seated" : "Invite"}
                    </CozyButton>
                  </div>
                );
              })}
            </div>
          )}
          {inviteNotice.message && (
            <p className={cn("mt-3 text-xs font-extrabold", inviteNotice.kind === "error" ? "text-blush-700" : "text-garden-700")}>
              {inviteNotice.message}
            </p>
          )}
          {!isHost && (
            <p className="mt-3 text-xs font-extrabold text-ink-500">
              You&apos;re a guest in this party. Only the host can invite more friends or change the seat count.
            </p>
          )}
          {inviteNotice.link && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-lavender-300/40 bg-lavender-100/60 p-2">
              <Link2 className="size-4 shrink-0 text-lavender-500" />
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-700">{inviteNotice.link}</code>
              <button
                className="rounded-full border border-cream-300 bg-white/80 px-2.5 py-1 text-xs font-extrabold text-ink-700 hover:bg-white"
                onClick={() => copyText(inviteNotice.link!, "last-friend-link")}
                type="button"
              >
                {copied === "last-friend-link" ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </CozyCard>

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
              <Link href="/app/area?zone=park">Walk to park</Link>
            </Button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {parkGames.slice(0, 4).map((game) => (
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
                <Link href={lobby ? `${game.href}?party=${encodeURIComponent(lobby.code)}` : game.href}>Play</Link>
              </CozyButton>
              <Button onClick={() => copyGameInvite(game.id, game.href, game.title)} size="sm" variant="secondary">
                <Link2 /> {copiedGameId === game.id ? "Copied" : "Invite"}
              </Button>
            </div>
          </CozyCard>
        ))}
      </section>

      <section className="grid gap-5 md:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-honey-500/30 bg-honey-100/70 p-4 text-sm font-bold text-ink-700">
          <Trophy className="mr-2 inline size-4 text-honey-700" />
          Turn-based games keep their own local turn switching and wallet reward loop. Party links now carry the lobby
          code into each game route.
        </div>
        <div className="rounded-lg border border-sky-500/25 bg-sky-100/65 p-4 text-sm font-bold text-ink-700">
          <RadioTower className="mr-2 inline size-4 text-sky-500" />
          This MVP party model is local-first with real friend seats and join links. Supabase Realtime can replace the
          storage layer for cross-device live seats without changing the UI contract.
          <Sparkles className="ml-2 inline size-4 text-honey-700" />
        </div>
      </section>
    </div>
  );
}
