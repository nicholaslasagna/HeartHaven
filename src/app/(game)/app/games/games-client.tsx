"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardCheck,
  Copy,
  Gamepad2,
  HeartHandshake,
  Link2,
  PartyPopper,
  Play,
  RefreshCw,
  Trophy,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { partyGames } from "@/lib/mock-data";
import { usePartyLobby } from "@/lib/game/use-party-lobby";
import { useSocial } from "@/lib/game/use-social";
import { cn } from "@/lib/utils";

const partySizes = [2, 4, 6, 8] as const;

function joinErrorCopy(reason: string) {
  if (reason === "not-friends") return "Add the host as a friend first, then use their game invite.";
  if (reason === "full") return "That party is full.";
  if (reason === "self") return "You're already hosting that party.";
  if (reason === "wrong-recipient") return "That invite link was created for a different friend.";
  if (reason === "needs-link") return "Paste the full game invite link from your friend.";
  return "That game invite could not be read.";
}

export function GamesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const social = useSocial();
  const party = usePartyLobby(4);
  const lobby = party.lobby;
  const [copied, setCopied] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [joinNotice, setJoinNotice] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({ kind: "idle", message: "" });
  const [inviteNotice, setInviteNotice] = useState<{ kind: "idle" | "ok" | "error"; message: string; link?: string }>({
    kind: "idle",
    message: "",
  });

  const currentSeat = lobby?.seats.find((seat) => seat.code === social.selfCode && seat.status !== "invited");
  const isHost = Boolean(lobby && lobby.hostCode === social.selfCode);
  const readyCount = lobby?.seats.filter((seat) => (seat.status === "host" || seat.status === "occupied") && seat.ready).length ?? 0;
  const occupiedCount = lobby?.seats.filter((seat) => seat.status === "host" || seat.status === "occupied").length ?? 0;
  const startStatus = party.startStatus;

  useEffect(() => {
    if (!party.ready || !social.ready) return;
    const inviteCode = searchParams.get("invite");
    if (!inviteCode) return;
    const friend = social.friends.find((entry) => entry.code === inviteCode);
    if (!friend) {
      queueMicrotask(() => {
        setInviteNotice({ kind: "error", message: "That keeper is not on your friends list yet. Add them on Friends first." });
      });
      router.replace("/app/games");
      return;
    }
    const result = party.inviteFriend(friend);
    if (!result.ok && result.reason !== "already-in-lobby") {
      queueMicrotask(() => {
        setInviteNotice({ kind: "error", message: result.reason === "full" ? "This lobby is full." : "Only the host can invite friends." });
      });
      router.replace("/app/games");
      return;
    }
    const link = party.buildLink(friend);
    queueMicrotask(() => {
      setInviteNotice({
        kind: "ok",
        message: result.ok
          ? `${friend.displayName} has a seat. Invite link copied.`
          : `${friend.displayName} already has a seat. Invite link copied again.`,
        link,
      });
    });
    void copyText(link, `friend-${friend.code}`);
    router.replace("/app/games");
  }, [party, party.ready, router, searchParams, social.friends, social.ready]);

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

  function copyLobbyLink() {
    if (!lobby) return;
    const link = party.buildLink();
    void copyText(link, "party-link");
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

  function copyJoinRequest() {
    void copyText("Can I join your HeartHaven game? Send me a game invite link from the Games lobby.", "join-request");
    setJoinNotice({ kind: "ok", message: "Request copied. Send it to a friend and they can invite you." });
  }

  function startErrorCopy(reason: string) {
    if (reason === "no-game") return "Choose a party game first.";
    if (reason === "need-player") return "At least one friend needs to join before the host can start.";
    if (reason === "pending-invites") return "Wait for invited friends to join, or remove their pending seat.";
    if (reason === "not-ready") return "Everyone in the lobby needs to mark ready first.";
    if (reason === "not-host") return "Only the host can start the party game.";
    return "The party cannot start yet.";
  }

  function chooseGame(game: { href: string; title: string }) {
    const result = party.selectGame(game);
    if (result.ok) {
      setInviteNotice({ kind: "ok", message: `${game.title} is selected. Everyone can ready up now.` });
    } else {
      setInviteNotice({ kind: "error", message: "Only the host can choose the party game." });
    }
  }

  function startGame() {
    const result = party.startGame();
    if (!result.ok) {
      setJoinNotice({ kind: "error", message: startErrorCopy(result.reason) });
      return;
    }
    setJoinNotice({ kind: "ok", message: `Starting ${result.lobby.gameTitle ?? "party game"}...` });
    router.push(result.href);
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <section className="rounded-lg border border-blush-300/45 bg-blush-100/55 p-5 shadow-sm">
        <Badge variant="blush">
          <PartyPopper className="size-3.5" />
          Games
        </Badge>
        <h1 className="mt-3 font-display text-4xl leading-tight text-ink-900">Pick, invite, ready, play.</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-ink-700">
          Friends are handled in one place: the Friends page. From there, tap Play on a friend to put them in this
          lobby. Guests paste the invite link here and mark ready.
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <CozyCard className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gamepad2 className="size-5 text-lavender-500" />
              <h2 className="font-display text-2xl text-ink-900">1. Choose a game</h2>
            </div>
            {!isHost && (
              <Button onClick={() => party.resetLobby(lobby?.size ?? 4)} size="sm" variant="secondary">
                <RefreshCw /> Host my own game
              </Button>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {partyGames.map((game) => {
              const selected = lobby?.gameHref === game.href;
              return (
                <button
                  className={cn(
                    "rounded-lg border p-4 text-left shadow-sm transition hover:-translate-y-0.5",
                    selected
                      ? "border-blush-300 bg-blush-100"
                      : "border-cream-300 bg-white/72 hover:border-lavender-300 hover:bg-lavender-100/55",
                  )}
                  disabled={!isHost}
                  key={game.id}
                  onClick={() => chooseGame({ href: game.href, title: game.title })}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-display text-xl text-ink-900">{game.title}</span>
                    <Badge variant={selected ? "blush" : "outline"}>{selected ? "Picked" : game.mode}</Badge>
                  </span>
                  <span className="mt-2 block text-sm font-bold leading-5 text-ink-700">{game.description}</span>
                </button>
              );
            })}
          </div>
          {!isHost && (
            <p className="mt-3 rounded-md border border-cream-300 bg-cream-50 px-3 py-2 text-xs font-extrabold text-ink-600">
              The host picks the game. You can still join, chat, and ready up.
            </p>
          )}
        </CozyCard>

        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <HeartHandshake className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">2. Invite or join</h2>
          </div>
          <div className="mt-4 grid gap-2">
            <CozyButton asChild variant="warm">
              <Link href="/app/friends">
                <UserPlus /> Open Friends
              </Link>
            </CozyButton>
            <Button disabled={!lobby} onClick={copyLobbyLink} variant="secondary">
              {copied === "party-link" ? <ClipboardCheck /> : <Link2 />}
              {copied === "party-link" ? "Copied invite" : "Copy invite link"}
            </Button>
            <Button onClick={copyJoinRequest} variant="secondary">
              {copied === "join-request" ? <ClipboardCheck /> : <Copy />}
              Request to join
            </Button>
          </div>
          <div className="mt-4 rounded-lg border border-lavender-300/40 bg-lavender-100/55 p-3">
            <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">Join a friend</p>
            <div className="mt-2 grid gap-2">
              <input
                value={joinInput}
                onChange={(event) => {
                  setJoinInput(event.target.value);
                  if (joinNotice.kind !== "idle") setJoinNotice({ kind: "idle", message: "" });
                }}
                placeholder="Paste game invite link"
                className="min-w-0 rounded-md border border-cream-300 bg-white p-2.5 text-sm font-bold text-ink-900 placeholder:font-normal focus:border-lavender-300 focus:outline-none"
              />
              <CozyButton onClick={handleJoinParty}>
                <UsersRound /> Join game
              </CozyButton>
            </div>
          </div>
          {(joinNotice.message || inviteNotice.message) && (
            <p
              className={cn(
                "mt-3 rounded-md px-3 py-2 text-xs font-extrabold",
                joinNotice.kind === "error" || inviteNotice.kind === "error"
                  ? "bg-blush-100 text-blush-700"
                  : "bg-garden-100 text-garden-800",
              )}
            >
              {joinNotice.message || inviteNotice.message}
            </p>
          )}
          {inviteNotice.link && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-lavender-300/40 bg-white/70 p-2">
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
      </section>

      <section className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-honey-700" />
            <h2 className="font-display text-2xl text-ink-900">3. Ready up</h2>
          </div>
          <div className="mt-4 rounded-lg border border-honey-500/30 bg-honey-100/65 p-3 text-sm font-bold text-ink-700">
            <span className="block text-xs font-extrabold uppercase tracking-normal text-honey-700">Selected game</span>
            {lobby?.gameTitle ?? "Pick a game first."}
            <span className="mt-2 block text-xs font-extrabold text-ink-600">
              {startStatus.canStart ? "Everyone is ready. Host can start." : startErrorCopy(startStatus.reason)}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {currentSeat && (
              <Button onClick={party.toggleReady} variant={currentSeat.ready ? "warm" : "default"}>
                <Trophy /> {currentSeat.ready ? "Ready" : "I'm ready"}
              </Button>
            )}
            <Button disabled={!isHost || !startStatus.canStart} onClick={startGame}>
              <Play /> Start
            </Button>
            <Button onClick={() => party.resetLobby(lobby?.size ?? 4)} variant="secondary">
              <RefreshCw /> New lobby
            </Button>
          </div>
          <div className="mt-4">
            <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Seats</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {partySizes.map((size) => (
                <button
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-extrabold transition",
                    lobby?.size === size
                      ? "bg-lavender-500 text-white"
                      : "bg-white text-ink-700 ring-1 ring-cream-300 hover:bg-lavender-100",
                  )}
                  disabled={!isHost}
                  key={size}
                  onClick={() => party.resize(size)}
                  type="button"
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </CozyCard>

        <CozyCard className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UsersRound className="size-5 text-lavender-500" />
              <h2 className="font-display text-2xl text-ink-900">Lobby</h2>
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
                      <p className="text-xs font-bold text-ink-500">{seat.role}</p>
                    </div>
                    <Badge variant={seat.ready ? "garden" : seat.status === "invited" ? "blush" : "outline"}>
                      {seat.status === "open" ? "Open" : seat.status === "invited" ? "Invited" : seat.ready ? "Ready" : "Joined"}
                    </Badge>
                  </div>
                  {seat.status === "invited" && isHost && (
                    <button
                      className="mt-3 inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/70 px-2.5 py-1 text-xs font-extrabold text-ink-600 hover:bg-blush-100"
                      onClick={() => party.removeSeat(seat.id)}
                      type="button"
                    >
                      <X className="size-3.5" /> Remove
                    </button>
                  )}
                  {isOwnSeat && <p className="mt-3 text-xs font-extrabold text-garden-700">This is you.</p>}
                </div>
              );
            })}
          </div>
        </CozyCard>
      </section>
    </div>
  );
}
