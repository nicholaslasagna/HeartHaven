"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardCheck,
  Copy,
  DoorOpen,
  Gamepad2,
  HeartHandshake,
  PartyPopper,
  Play,
  RefreshCw,
  Trophy,
  UserCheck,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { partyGames } from "@/lib/mock-data";
import { useServerPartyLobby } from "@/lib/game/use-server-party-lobby";
import { useSocial } from "@/lib/game/use-social";
import type { Friend } from "@/lib/game/social";
import { sendPlaceInviteToFriend } from "@/lib/game/place-invites";
import { cn } from "@/lib/utils";

const partySizes = [2, 4, 6, 8] as const;
const joinCodePattern = /^HH-[A-Z]{5,6}-[0-9]{3,4}$/;

function extractLobbyCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const fromParams =
      url.searchParams.get("join")
      ?? url.searchParams.get("invite")
      ?? url.searchParams.get("party")
      ?? url.searchParams.get("host");
    if (fromParams) return fromParams.trim().toUpperCase();
  } catch {
    // Raw friend codes are the common path.
  }

  return trimmed.toUpperCase();
}

function startErrorCopy(reason: string, maxPlayers?: number, occupied?: number, ready?: number) {
  if (reason === "no-lobby") return "Create a lobby first.";
  if (reason === "no-game") return "Pick a game first.";
  if (reason === "empty") return "Your host seat is still loading.";
  if (reason === "not-ready") return `Waiting for ready: ${ready ?? 0}/${occupied ?? maxPlayers ?? 0} seated players ready.`;
  if (reason === "not-host") return "Only the host can start.";
  return "The party cannot start yet.";
}

function actionErrorCopy(reason: string) {
  if (reason === "offline") return "Online play is not configured for this build.";
  if (reason.toLowerCase().includes("full")) return "That lobby is full.";
  if (reason.toLowerCase().includes("game_sessions_invite_code_key") || reason.toLowerCase().includes("duplicate key")) {
    return "The lobby code collided. Try opening the lobby again.";
  }
  if (reason.toLowerCase().includes("no active lobby")) return "That friend does not have an open lobby right now.";
  if (reason.toLowerCase().includes("invalid")) return "Use a HeartHaven lobby code or invite link.";
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
  const social = useSocial();
  const lobby = party.lobby;
  const [copied, setCopied] = useState<string | null>(null);
  const [invitingFriendCode, setInvitingFriendCode] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [notice, setNotice] = useState<{ kind: "idle" | "ok" | "error"; message: string }>({
    kind: "idle",
    message: "",
  });
  const handledInviteCodeRef = useRef<string | null>(null);

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
    const join = searchParams.get("join") ?? searchParams.get("invite") ?? searchParams.get("party");
    if (!join) return;

    const code = extractLobbyCode(join);
    if (handledInviteCodeRef.current === code) return;
    handledInviteCodeRef.current = code;
    if (!joinCodePattern.test(code)) {
      queueMicrotask(() => {
        setNotice({ kind: "error", message: "That invite link is not a valid HeartHaven lobby code." });
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
      message: result.ok ? `${game.title} picked. Invite friends or ready up to play solo.` : actionErrorCopy(result.reason),
    });
  }

  function copyLobbyLink() {
    const code = lobby?.host_friend_code;
    const inviteCode = lobby?.invite_code || code;
    if (!inviteCode) return;
    const link = `${window.location.origin}/app/games?join=${encodeURIComponent(inviteCode)}`;
    void copyText(link, "party-link");
  }

  async function inviteFriend(friend: Friend) {
    const code = lobby?.invite_code || lobby?.host_friend_code;
    if (!code) {
      setNotice({ kind: "error", message: "Create a lobby before inviting friends." });
      return;
    }

    setInvitingFriendCode(friend.code);
    const result = await sendPlaceInviteToFriend({
      friendCode: friend.code,
      inviteType: "party",
      targetSessionId: lobby.session_id,
      targetUrl: `/app/games?join=${encodeURIComponent(code)}`,
    });
    setInvitingFriendCode(null);
    if (!result.ok) {
      setNotice({ kind: "error", message: actionErrorCopy(result.reason) });
      return;
    }
    setCopied(`friend-${friend.code}`);
    window.setTimeout(() => setCopied((current) => (current === `friend-${friend.code}` ? null : current)), 1800);
    setNotice({ kind: "ok", message: `${friend.displayName} was invited to this lobby.` });
  }

  const friendInvitePanel = lobby && party.isHost ? (
    <div className="mt-3 rounded-lg border border-blush-300/45 bg-blush-100/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-600">
          <UserPlus className="size-3.5" /> Invite friends
        </p>
        <Badge variant="outline">{social.friends.length}</Badge>
      </div>
      {social.friends.length === 0 ? (
        <p className="text-xs font-bold leading-5 text-ink-600">
          Add friends first, then they&apos;ll appear here for one-tap lobby invites.
        </p>
      ) : (
        <div className="grid max-h-48 gap-2 overflow-y-auto pr-1">
          {social.friends.map((friend) => {
            const isInvited = copied === `friend-${friend.code}`;
            const isSending = invitingFriendCode === friend.code;
            return (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-white/70 bg-white/78 px-2.5 py-2"
                key={friend.code}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-ink-900">{friend.displayName}</p>
                  <p className="font-mono text-[11px] font-bold text-ink-500">{friend.code}</p>
                </div>
                <CozyButton
                  onClick={() => void inviteFriend(friend)}
                  size="sm"
                  variant={isInvited ? "warm" : "secondary"}
                  disabled={isSending}
                >
                  {isInvited ? <ClipboardCheck /> : <UserPlus />}
                  {isSending ? "Sending..." : isInvited ? "Invited" : "Invite"}
                </CozyButton>
              </div>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  async function requestToJoin() {
    const code = extractLobbyCode(joinInput);
    if (!joinCodePattern.test(code)) {
      setNotice({ kind: "error", message: "Paste a lobby link, lobby code, or friend code." });
      return;
    }

    // If we're already seated in a lobby, don't fire another join request —
    // the server would either no-op (already seated) or, if the host has
    // already started/closed, raise "no active lobby", which surfaced as
    // the confusing "That friend does not have an open lobby right now."
    // even though the player is plainly in a lobby. Short-circuit with a
    // clear message instead.
    if (party.selfSeated) {
      const sameLobby =
        lobby?.host_friend_code?.toUpperCase() === code.toUpperCase() ||
        lobby?.invite_code?.toUpperCase() === code.toUpperCase();
      setNotice({
        kind: "ok",
        message: sameLobby
          ? "You're already in this lobby."
          : "You're already in a lobby. Leave it first to join another.",
      });
      if (sameLobby) setJoinInput("");
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

  // Surface ready-toggle failures instead of swallowing them with
  // `void party.toggleReady()`. A silent failure here is what made the
  // "ready_changed" constraint bug so hard to spot — the click appeared
  // to do nothing with no error anywhere.
  async function toggleReady() {
    const result = await party.toggleReady();
    if (!result.ok) {
      setNotice({ kind: "error", message: actionErrorCopy(result.reason) });
    }
  }

  return (
    // Mobile-friendly outer wrapper: tighter gap + horizontal breathing
    // room on phones, restored to the desktop layout at sm+. Every
    // section below uses `p-4 sm:p-5` so the inner padding doesn't
    // squeeze the content on narrow viewports.
    <div className="mx-auto grid max-w-6xl gap-4 px-1 sm:gap-5 sm:px-0">
      <section className="rounded-lg border border-blush-300/45 bg-blush-100/55 p-4 shadow-sm sm:p-5">
        <Badge variant="blush">
          <PartyPopper className="size-3.5" />
          Games
        </Badge>
        <h1 className="mt-3 font-display text-2xl leading-tight text-ink-900 sm:text-4xl">
          Pick a game. Invite friends. Ready up.
        </h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-ink-700">
          One simple lobby lives here. Friends can request to join with your HeartHaven friend code, and the host approves
          them before the game starts.
        </p>
      </section>

      <section className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <CozyCard className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Gamepad2 className="size-5 text-lavender-500" />
              <h2 className="font-display text-xl text-ink-900 sm:text-2xl">1. Choose a game</h2>
            </div>
            <Badge variant={party.isHost ? "garden" : "outline"}>{party.isHost ? "Hosting" : "Joined"}</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {partyGames.map((game) => {
              const selected = lobby?.selected_game_href === game.href;
              return (
                <button
                  className={cn(
                    "rounded-lg border p-3 text-left shadow-sm transition active:translate-y-0 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 sm:p-4",
                    selected
                      ? "border-blush-300 bg-blush-100"
                      : "border-cream-300 bg-white/72 hover:border-lavender-300 hover:bg-lavender-100/55",
                  )}
                  disabled={Boolean(lobby && !party.isHost)}
                  key={game.id}
                  onClick={() => void chooseGame(game)}
                  type="button"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-display text-lg text-ink-900 sm:text-xl">{game.title}</span>
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

        <CozyCard className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <HeartHandshake className="size-5 text-blush-500" />
            <h2 className="font-display text-xl text-ink-900 sm:text-2xl">2. Invite or join</h2>
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
              <p className="rounded-md border border-cream-300 bg-white/65 px-3 py-2 text-xs font-extrabold text-ink-600">
                {/* break-all keeps long codes from blowing out the card on narrow screens */}
                Lobby code:{" "}
                <span className="break-all font-mono">{lobby.invite_code || lobby.host_friend_code}</span>
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
                placeholder="Paste lobby invite link or lobby code"
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
          {friendInvitePanel}
        </CozyCard>
      </section>

      <section className="grid gap-4 sm:gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <CozyCard className="p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-honey-700" />
            <h2 className="font-display text-xl text-ink-900 sm:text-2xl">3. Ready up</h2>
          </div>
          <div className="mt-4 rounded-lg border border-honey-500/30 bg-honey-100/65 p-3 text-sm font-bold text-ink-700">
            <span className="block text-xs font-extrabold uppercase tracking-normal text-honey-700">Selected game</span>
            {selectedGame?.title ?? lobby?.selected_game_label ?? "Pick a game first."}
            <span className="mt-2 block text-xs font-extrabold text-ink-600">
              {party.startStatus.ok
                ? "Seated players are ready. Host can start."
                : startErrorCopy(party.startStatus.reason, totalSeats, occupiedCount, readyCount)}
            </span>
          </div>

          {/* Mobile-friendly action row: 2-up grid on phones so every
              button is full-width and easy to tap, restored to the
              flex-wrap layout on sm+ where space is no longer scarce.
              All buttons also get min-h-11 (44px) to meet the iOS/
              Material touch-target guideline. The `[&>*]:w-full
              sm:[&>*]:w-auto` selector forces children to fill the
              grid cell on mobile then return to natural width above. */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*]:w-full sm:[&>*]:w-auto [&>*]:min-h-11">
            {party.selfSeat && (
              // Label = action, not status. See earlier comment for the
              // "Ready"-as-status-indicator bug that caused hosts to be
              // unable to start.
              <Button
                onClick={() => void toggleReady()}
                variant={party.selfSeat.ready ? "secondary" : "default"}
                title={party.selfSeat.ready ? "You're ready — click to unready." : "Mark yourself as ready to play."}
              >
                {party.selfSeat.ready ? <UserMinus /> : <UserCheck />}
                {party.selfSeat.ready ? "Unready" : "Ready up"}
              </Button>
            )}
            <Button disabled={!party.startStatus.ok} onClick={() => void startGame()}>
              <Play /> Start
            </Button>
            {party.isHost && lobby && (
              <Button
                onClick={async () => {
                  if (typeof window !== "undefined") {
                    const ok = window.confirm("Close this lobby? Everyone seated will be kicked back.");
                    if (!ok) return;
                  }
                  const result = await party.closeLobby();
                  if (result.ok) setNotice({ kind: "ok", message: "Lobby closed." });
                  else setNotice({ kind: "error", message: actionErrorCopy(result.reason) });
                }}
                variant="secondary"
              >
                <DoorOpen /> Close lobby
              </Button>
            )}
            {!party.isHost && party.selfSeated && (
              <Button onClick={() => void party.leave()} variant="secondary">
                <DoorOpen /> Leave lobby
              </Button>
            )}
            <Button onClick={() => void party.createLobby(selectedSize)} variant="secondary">
              <RefreshCw /> New lobby
            </Button>
          </div>

          {party.joinRequests.length > 0 && party.isHost && (
            <div className="mt-4 rounded-lg border border-garden-300/40 bg-garden-100/45 p-3">
              <p className="text-xs font-extrabold uppercase tracking-normal text-garden-700">Join requests</p>
              <div className="mt-2 grid gap-2">
                {party.joinRequests.map((request) => (
                  <div className="rounded-md border border-white/70 bg-white/75 p-3" key={request.id}>
                    <p className="font-extrabold text-ink-900">{request.requester_display_name}</p>
                    <p className="font-mono text-xs font-bold text-ink-500 break-all">{request.requester_friend_code}</p>
                    {/* 2-up grid on mobile so each button is full-width
                        + at the 44px tap target; restored to inline flex
                        on sm+ where the card has more room. */}
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:gap-2 [&>*]:min-h-10">
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

        <CozyCard className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UsersRound className="size-5 text-lavender-500" />
              <h2 className="font-display text-xl text-ink-900 sm:text-2xl">Lobby</h2>
            </div>
            <Badge variant="garden">
              {readyCount}/{Math.max(occupiedCount, 1)} ready
            </Badge>
          </div>
          {/* Seat grid is already responsive (1/2/4 columns at base/sm/xl).
              No mobile-only tweak needed — the existing breakpoints flow
              naturally from phone to desktop. */}
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
                {seat && seat.profile_id === party.selfSeat?.profile_id && (
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
