"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardCheck,
  Copy,
  Gamepad2,
  HeartHandshake,
  PartyPopper,
  Play,
  RefreshCw,
  Trophy,
  UserCheck,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { partyGames } from "@/lib/mock-data";
import { useServerPartyLobby } from "@/lib/game/use-server-party-lobby";
import { cn } from "@/lib/utils";

const partySizes = [2, 4, 6, 8] as const;
const friendCodePattern = /^HH-[A-Z]{4,6}-[0-9]{2,4}$/;

function extractLobbyCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const fromParams = url.searchParams.get("join") ?? url.searchParams.get("party") ?? url.searchParams.get("host");
    if (fromParams) return fromParams.trim().toUpperCase();
  } catch {
    // Raw friend codes are the common path.
  }

  return trimmed.toUpperCase();
}

function startErrorCopy(reason: string, maxPlayers?: number, occupied?: number, ready?: number) {
  if (reason === "no-lobby") return "Create a lobby first.";
  if (reason === "no-game") return "Pick a game first.";
  if (reason === "not-full") return `Waiting for players: ${occupied ?? 0}/${maxPlayers ?? 0} seats filled.`;
  if (reason === "not-ready") return `Waiting for ready: ${ready ?? 0}/${maxPlayers ?? 0} players ready.`;
  if (reason === "not-host") return "Only the host can start.";
  return "The party cannot start yet.";
}

function actionErrorCopy(reason: string) {
  if (reason === "offline") return "Online play is not configured for this build.";
  if (reason.toLowerCase().includes("full")) return "That lobby is full.";
  if (reason.toLowerCase().includes("no active lobby")) return "That friend does not have an open lobby right now.";
  if (reason.toLowerCase().includes("invalid")) return "Use a HeartHaven friend code like HH-ABCD-123.";
  return reason || "That action could not finish.";
}

function canonicalPartyGameKey(game: (typeof partyGames)[number]) {
  if (game.href === "/app/rock-paper-scissors") return "rock-paper-scissors";
  if (game.href === "/app/bowling") return "bowling";
  return game.id.replace(/-party$/, "");
}

export function GamesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedSize, setSelectedSize] = useState<(typeof partySizes)[number]>(4);
  const party = useServerPartyLobby(selectedSize);
  const lobby = party.lobby;
  const [copied, setCopied] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [notice, setNotice] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({
    kind: "idle",
    message: "",
  });

  const readyCount = lobby?.seats.filter((seat) => seat.ready).length ?? 0;
  const occupiedCount = lobby?.seats.length ?? 0;
  const totalSeats = lobby?.max_players ?? selectedSize;
  const selectedGame = partyGames.find((game) => game.href === lobby?.selected_game_href);
  const seatSlots = useMemo(
    () =>
      Array.from({ length: totalSeats }, (_, index) => ({
        index,
        seat: lobby?.seats.find((candidate) => candidate.seat_index === index) ?? null,
      })),
    [lobby?.seats, totalSeats],
  );

  useEffect(() => {
    if (!party.ready) return;
    const join = searchParams.get("join") ?? searchParams.get("party");
    if (!join) return;

    const code = extractLobbyCode(join);
    if (!friendCodePattern.test(code)) {
      queueMicrotask(() => {
        setNotice({ kind: "error", message: "That invite link is not a valid HeartHaven friend code." });
      });
      router.replace("/app/games", { scroll: false });
      return;
    }

    void party.requestJoin(code).then((result) => {
      setNotice({
        kind: result.ok ? "ok" : "error",
        message: result.ok
          ? result.value.requestId
            ? "Request sent. The host can approve you from this lobby."
            : "You are already in that lobby."
          : actionErrorCopy(result.reason),
      });
      router.replace("/app/games", { scroll: false });
    });
  }, [party, party.ready, router, searchParams]);

  async function copyText(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
    } catch {
      setCopied(null);
    }
  }

  async function createLobby() {
    const result = await party.createLobby(selectedSize);
    setNotice({
      kind: result.ok ? "ok" : "error",
      message: result.ok ? `Lobby opened for ${selectedSize} players.` : actionErrorCopy(result.reason),
    });
  }

  async function chooseGame(game: (typeof partyGames)[number]) {
    if (!lobby) {
      const created = await party.createLobby(selectedSize);
      if (!created.ok) {
        setNotice({ kind: "error", message: actionErrorCopy(created.reason) });
        return;
      }
    }

    const result = await party.selectGame({
      key: canonicalPartyGameKey(game),
      href: game.href,
      label: game.title,
    });
    setNotice({
      kind: result.ok ? "ok" : "error",
      message: result.ok ? `${game.title} picked. Fill the seats and ready up.` : actionErrorCopy(result.reason),
    });
  }

  function copyLobbyLink() {
    const code = lobby?.host_friend_code;
    if (!code) return;
    const link = `${window.location.origin}/app/games?join=${encodeURIComponent(code)}`;
    void copyText(link, "party-link");
  }

  async function requestToJoin() {
    const code = extractLobbyCode(joinInput);
    if (!friendCodePattern.test(code)) {
      setNotice({ kind: "error", message: "Paste a friend's lobby link or friend code like HH-ABCD-123." });
      return;
    }

    const result = await party.requestJoin(code);
    setNotice({
      kind: result.ok ? "ok" : "error",
      message: result.ok
        ? result.value.requestId
          ? "Request sent. The host will see it here."
          : "You are already in that lobby."
        : actionErrorCopy(result.reason),
    });
    if (result.ok) setJoinInput("");
  }

  async function startGame() {
    const result = await party.start();
    if (!result.ok) {
      setNotice({ kind: "error", message: actionErrorCopy(result.reason) });
      return;
    }
    setNotice({ kind: "ok", message: "Starting game..." });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <section className="rounded-lg border border-blush-300/45 bg-blush-100/55 p-5 shadow-sm">
        <Badge variant="blush">
          <PartyPopper className="size-3.5" />
          Games
        </Badge>
        <h1 className="mt-3 font-display text-4xl leading-tight text-ink-900">Pick a game. Invite friends. Ready up.</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-ink-700">
          One simple lobby lives here. Friends can request to join with your HeartHaven friend code, and the host approves
          them before the game starts.
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <CozyCard className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Gamepad2 className="size-5 text-lavender-500" />
              <h2 className="font-display text-2xl text-ink-900">1. Choose a game</h2>
            </div>
            <Badge variant={party.isHost ? "garden" : "outline"}>{party.isHost ? "Hosting" : "Joined"}</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {partyGames.map((game) => {
              const selected = lobby?.selected_game_href === game.href;
              return (
                <button
                  className={cn(
                    "rounded-lg border p-4 text-left shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60",
                    selected
                      ? "border-blush-300 bg-blush-100"
                      : "border-cream-300 bg-white/72 hover:border-lavender-300 hover:bg-lavender-100/55",
                  )}
                  disabled={Boolean(lobby && !party.isHost)}
                  key={game.id}
                  onClick={() => void chooseGame(game)}
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
          {lobby && !party.isHost && (
            <p className="mt-3 rounded-md border border-cream-300 bg-cream-50 px-3 py-2 text-xs font-extrabold text-ink-600">
              The host picks the game. You can ready up once you are seated.
            </p>
          )}
        </CozyCard>

        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <HeartHandshake className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">2. Invite or join</h2>
          </div>
          {!lobby && (
            <div className="mt-4 rounded-lg border border-honey-500/35 bg-honey-100/60 p-3">
              <p className="text-xs font-extrabold uppercase tracking-normal text-honey-700">Lobby size</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {partySizes.map((size) => (
                  <button
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-extrabold transition",
                      selectedSize === size
                        ? "bg-lavender-500 text-white"
                        : "bg-white text-ink-700 ring-1 ring-cream-300 hover:bg-lavender-100",
                    )}
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    type="button"
                  >
                    {size}
                  </button>
                ))}
              </div>
              <CozyButton className="mt-3 w-full" onClick={() => void createLobby()} variant="warm">
                <PartyPopper /> Create lobby
              </CozyButton>
            </div>
          )}

          {lobby && party.isHost && (
            <div className="mt-4 grid gap-2">
              <Button onClick={copyLobbyLink} variant="secondary">
                {copied === "party-link" ? <ClipboardCheck /> : <Copy />}
                {copied === "party-link" ? "Copied" : "Copy lobby invite"}
              </Button>
              <CozyButton asChild variant="warm">
                <Link href="/app/friends" scroll={false}>
                  <UserPlus /> Invite from Friends
                </Link>
              </CozyButton>
              <p className="rounded-md border border-cream-300 bg-white/65 px-3 py-2 text-xs font-extrabold text-ink-600">
                Lobby code: <span className="font-mono">{lobby.host_friend_code}</span>
              </p>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-lavender-300/40 bg-lavender-100/55 p-3">
            <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">Request to join</p>
            <div className="mt-2 grid gap-2">
              <input
                value={joinInput}
                onChange={(event) => {
                  setJoinInput(event.target.value);
                  if (notice.kind !== "idle") setNotice({ kind: "idle", message: "" });
                }}
                placeholder="Paste invite link or friend code"
                className="min-w-0 rounded-md border border-cream-300 bg-white p-2.5 text-sm font-bold text-ink-900 placeholder:font-normal focus:border-lavender-300 focus:outline-none"
              />
              <CozyButton onClick={() => void requestToJoin()}>
                <UsersRound /> Request join
              </CozyButton>
            </div>
          </div>

          {notice.message && (
            <p
              className={cn(
                "mt-3 rounded-md px-3 py-2 text-xs font-extrabold",
                notice.kind === "error" ? "bg-blush-100 text-blush-700" : "bg-garden-100 text-garden-800",
              )}
            >
              {notice.message}
            </p>
          )}
        </CozyCard>
      </section>

      <section className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-honey-700" />
            <h2 className="font-display text-2xl text-ink-900">3. Ready up</h2>
          </div>
          <div className="mt-4 rounded-lg border border-honey-500/30 bg-honey-100/65 p-3 text-sm font-bold text-ink-700">
            <span className="block text-xs font-extrabold uppercase tracking-normal text-honey-700">Selected game</span>
            {selectedGame?.title ?? lobby?.selected_game_label ?? "Pick a game first."}
            <span className="mt-2 block text-xs font-extrabold text-ink-600">
              {party.startStatus.ok
                ? "Everyone is ready. Host can start."
                : startErrorCopy(party.startStatus.reason, totalSeats, occupiedCount, readyCount)}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {party.selfSeat && (
              <Button onClick={() => void party.toggleReady()} variant={party.selfSeat.ready ? "warm" : "default"}>
                <UserCheck /> {party.selfSeat.ready ? "Ready" : "I'm ready"}
              </Button>
            )}
            <Button disabled={!party.startStatus.ok} onClick={() => void startGame()}>
              <Play /> Start
            </Button>
            <Button onClick={() => void party.createLobby(selectedSize)} variant="secondary">
              <RefreshCw /> New lobby
            </Button>
          </div>

          {party.joinRequests.length > 0 && party.isHost && (
            <div className="mt-4 rounded-lg border border-garden-300/40 bg-garden-100/45 p-3">
              <p className="text-xs font-extrabold uppercase tracking-normal text-garden-700">Join requests</p>
              <div className="mt-2 grid gap-2">
                {party.joinRequests.map((request) => (
                  <div className="rounded-md border border-white/70 bg-white/75 p-2" key={request.id}>
                    <p className="font-extrabold text-ink-900">{request.requester_display_name}</p>
                    <p className="font-mono text-xs font-bold text-ink-500">{request.requester_friend_code}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void party.approveRequest(request.id)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void party.denyRequest(request.id)}>
                        Deny
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CozyCard>

        <CozyCard className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UsersRound className="size-5 text-lavender-500" />
              <h2 className="font-display text-2xl text-ink-900">Lobby</h2>
            </div>
            <Badge variant="garden">
              {readyCount}/{totalSeats} ready
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {seatSlots.map(({ index, seat }) => (
              <div
                className={cn(
                  "rounded-lg border p-3 shadow-sm",
                  seat ? "border-lavender-300/45 bg-white/82" : "border-cream-300 bg-white/58",
                )}
                key={seat?.profile_id ?? `open-${index}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-ink-900">{seat?.display_name ?? "Open seat"}</p>
                    <p className="text-xs font-bold text-ink-500">
                      {index === 0 ? "Host seat" : seat ? `Seat ${index + 1}` : "Waiting"}
                    </p>
                  </div>
                  <Badge variant={seat?.ready ? "garden" : seat ? "outline" : "blush"}>
                    {seat?.ready ? "Ready" : seat ? "Joined" : "Open"}
                  </Badge>
                </div>
                {seat && seat.profile_id !== party.selfSeat?.profile_id && party.isHost && (
                  <button
                    className="mt-3 inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/70 px-2.5 py-1 text-xs font-extrabold text-ink-600 hover:bg-blush-100"
                    onClick={() => void party.kick(seat.profile_id)}
                    type="button"
                  >
                    <X className="size-3.5" /> Remove
                  </button>
                )}
                {seat?.profile_id === party.selfSeat?.profile_id && (
                  <p className="mt-3 text-xs font-extrabold text-garden-700">This is you.</p>
                )}
              </div>
            ))}
          </div>
        </CozyCard>
      </section>
    </div>
  );
}
