"use client";

import { getCachedPublicUsername } from "@/lib/game/public-identity";
import {
  getSocialState,
  isFriendCodeShape,
  normalizeFriendCode,
  recordPlayedWith,
  type Friend,
  type FriendCode,
} from "@/lib/game/social";

export const PARTY_LOBBY_KEY = "hearthaven:party-lobby-state";
export const PARTY_LOBBY_EVENT = "hearthaven:party-lobby-changed";

export type PartySeatStatus = "host" | "occupied" | "invited" | "open";

export type PartySeat = {
  id: string;
  index: number;
  status: PartySeatStatus;
  code?: FriendCode;
  displayName: string;
  role: "Host" | "Guest" | "Invited" | "Open";
  team: "Blush" | "Lavender" | "Garden" | "Honey";
  ready: boolean;
  invitedAt?: string;
  joinedAt?: string;
};

export type PartyLobby = {
  id: string;
  code: string;
  hostCode: FriendCode;
  hostDisplayName: string;
  size: 2 | 4 | 6 | 8;
  createdAt: string;
  gameHref?: string;
  gameTitle?: string;
  seats: PartySeat[];
};

export type PartyInvitePayload = {
  code: string;
  hostCode: FriendCode;
  hostDisplayName: string;
  size: 2 | 4 | 6 | 8;
  invitedCode?: FriendCode;
  invitedDisplayName?: string;
  gameHref?: string;
  gameTitle?: string;
  sentAt: string;
};

const PARTY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TEAMS: PartySeat["team"][] = ["Blush", "Lavender", "Garden", "Honey"];

function randomChars(count: number) {
  let value = "";
  for (let i = 0; i < count; i += 1) {
    value += PARTY_CODE_ALPHABET.charAt(Math.floor(Math.random() * PARTY_CODE_ALPHABET.length));
  }
  return value;
}

export function generatePartyCode() {
  return `HH-GAME-${randomChars(4)}`;
}

export function normalizePartyCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
}

export function isPartyCodeShape(value: string) {
  return /^HH-GAME-[A-Z0-9]{4}$/.test(normalizePartyCode(value));
}

function teamForIndex(index: number): PartySeat["team"] {
  return TEAMS[index % TEAMS.length];
}

function nowIso() {
  return new Date().toISOString();
}

function base64UrlEncode(value: string): string {
  if (typeof window === "undefined") return "";
  return window
    .btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  if (typeof window === "undefined") return "";
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (value.length % 4)) % 4);
  try {
    return decodeURIComponent(escape(window.atob(padded)));
  } catch {
    return "";
  }
}

function createHostSeat(index = 0): PartySeat {
  const social = getSocialState();
  const displayName = getCachedPublicUsername();
  return {
    id: `seat-host-${social.selfCode}`,
    index,
    status: "host",
    code: social.selfCode,
    displayName,
    role: "Host",
    team: teamForIndex(index),
    ready: true,
    joinedAt: nowIso(),
  };
}

function createOpenSeat(index: number): PartySeat {
  return {
    id: `seat-open-${index}`,
    index,
    status: "open",
    displayName: "Open seat",
    role: "Open",
    team: teamForIndex(index),
    ready: false,
  };
}

function sanitizeSize(value: number): PartyLobby["size"] {
  if (value <= 2) return 2;
  if (value <= 4) return 4;
  if (value <= 6) return 6;
  return 8;
}

function normalizeSeat(seat: Partial<PartySeat>, index: number): PartySeat {
  if (seat.status === "host" || seat.status === "occupied" || seat.status === "invited") {
    return {
      id: typeof seat.id === "string" ? seat.id : `seat-${seat.code ?? index}`,
      index,
      status: seat.status,
      code: typeof seat.code === "string" ? normalizeFriendCode(seat.code) : undefined,
      displayName: typeof seat.displayName === "string" && seat.displayName.trim() ? seat.displayName.trim() : "Keeper",
      role: seat.status === "host" ? "Host" : seat.status === "invited" ? "Invited" : "Guest",
      team: seat.team ?? teamForIndex(index),
      ready: Boolean(seat.ready),
      invitedAt: typeof seat.invitedAt === "string" ? seat.invitedAt : undefined,
      joinedAt: typeof seat.joinedAt === "string" ? seat.joinedAt : undefined,
    };
  }
  return createOpenSeat(index);
}

function normalizeLobby(lobby: Partial<PartyLobby> | null | undefined): PartyLobby | null {
  if (!lobby?.code || !isPartyCodeShape(lobby.code)) return null;
  const size = sanitizeSize(Number(lobby.size ?? 4));
  const hostCode = typeof lobby.hostCode === "string" ? normalizeFriendCode(lobby.hostCode) : getSocialState().selfCode;
  const seats = Array.isArray(lobby.seats) ? lobby.seats.map((seat, index) => normalizeSeat(seat, index)) : [];
  const trimmed = seats.slice(0, size);
  for (let index = trimmed.length; index < size; index += 1) trimmed.push(createOpenSeat(index));
  return {
    id: typeof lobby.id === "string" ? lobby.id : `party-${lobby.code}`,
    code: normalizePartyCode(lobby.code),
    hostCode,
    hostDisplayName: typeof lobby.hostDisplayName === "string" && lobby.hostDisplayName.trim()
      ? lobby.hostDisplayName.trim()
      : "Host",
    size,
    createdAt: typeof lobby.createdAt === "string" ? lobby.createdAt : nowIso(),
    gameHref: typeof lobby.gameHref === "string" ? lobby.gameHref : undefined,
    gameTitle: typeof lobby.gameTitle === "string" ? lobby.gameTitle : undefined,
    seats: trimmed.map((seat, index) => ({ ...seat, index, team: teamForIndex(index) })),
  };
}

export function createPartyLobby(size: PartyLobby["size"] = 4): PartyLobby {
  const hostSeat = createHostSeat(0);
  const lobby: PartyLobby = {
    id: `party-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    code: generatePartyCode(),
    hostCode: hostSeat.code!,
    hostDisplayName: hostSeat.displayName,
    size,
    createdAt: nowIso(),
    seats: [hostSeat, ...Array.from({ length: size - 1 }, (_, index) => createOpenSeat(index + 1))],
  };
  writePartyLobby(lobby);
  return lobby;
}

export function readPartyLobby(): PartyLobby | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PARTY_LOBBY_KEY);
    if (!raw) return null;
    return normalizeLobby(JSON.parse(raw) as Partial<PartyLobby>);
  } catch {
    return null;
  }
}

export function writePartyLobby(lobby: PartyLobby) {
  if (typeof window === "undefined") return;
  const normalized = normalizeLobby(lobby);
  if (!normalized) return;
  window.localStorage.setItem(PARTY_LOBBY_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(PARTY_LOBBY_EVENT, { detail: normalized }));
}

export function ensurePartyLobby(size: PartyLobby["size"] = 4): PartyLobby {
  const current = readPartyLobby();
  if (current) return current;
  return createPartyLobby(size);
}

export function setPartySize(size: PartyLobby["size"]) {
  const lobby = ensurePartyLobby(size);
  const selfCode = getSocialState().selfCode;
  if (lobby.hostCode !== selfCode) return lobby;
  const nextSize = sanitizeSize(size);
  const activeSeats = lobby.seats.filter((seat) => seat.status !== "open");
  const nextSeats = activeSeats.slice(0, nextSize);
  for (let index = nextSeats.length; index < nextSize; index += 1) nextSeats.push(createOpenSeat(index));
  const next: PartyLobby = {
    ...lobby,
    size: nextSize,
    seats: nextSeats.map((seat, index) => ({ ...seat, index, team: teamForIndex(index) })),
  };
  writePartyLobby(next);
  return next;
}

export function inviteFriendToParty(friend: Friend):
  | { ok: true; lobby: PartyLobby; seat: PartySeat }
  | { ok: false; reason: "self" | "already-in-lobby" | "full" | "not-host" } {
  const lobby = ensurePartyLobby();
  const code = normalizeFriendCode(friend.code);
  const selfCode = getSocialState().selfCode;
  if (lobby.hostCode !== selfCode) return { ok: false, reason: "not-host" };
  if (code === selfCode) return { ok: false, reason: "self" };
  const existing = lobby.seats.find((seat) => seat.code === code && seat.status !== "open");
  if (existing) return { ok: false, reason: "already-in-lobby" };
  const openIndex = lobby.seats.findIndex((seat) => seat.status === "open");
  if (openIndex < 0) return { ok: false, reason: "full" };

  const seat: PartySeat = {
    id: `seat-invite-${code}`,
    index: openIndex,
    status: "invited",
    code,
    displayName: friend.displayName,
    role: "Invited",
    team: teamForIndex(openIndex),
    ready: false,
    invitedAt: nowIso(),
  };
  const seats = lobby.seats.map((entry, index) => (index === openIndex ? seat : entry));
  const next = { ...lobby, seats };
  writePartyLobby(next);
  return { ok: true, lobby: next, seat };
}

export function removePartySeat(seatId: string) {
  const lobby = readPartyLobby();
  if (!lobby) return null;
  const selfCode = getSocialState().selfCode;
  if (lobby.hostCode !== selfCode) return lobby;
  const seats = lobby.seats.map((seat) => {
    if (seat.id !== seatId) return seat;
    if (seat.status === "host" && seat.code === selfCode) return seat;
    return createOpenSeat(seat.index);
  });
  const next = { ...lobby, seats };
  writePartyLobby(next);
  return next;
}

export function togglePartyReady() {
  const lobby = readPartyLobby();
  if (!lobby) return null;
  const social = getSocialState();
  const seats = lobby.seats.map((seat) =>
    seat.code === social.selfCode && seat.status !== "invited" && seat.status !== "open"
      ? { ...seat, ready: !seat.ready }
      : seat,
  );
  const next = { ...lobby, seats };
  writePartyLobby(next);
  return next;
}

export function buildPartyInviteToken(
  lobby: PartyLobby,
  invitedFriend?: Friend,
  game?: { href?: string; title?: string },
): string {
  const payload: PartyInvitePayload = {
    code: lobby.code,
    hostCode: lobby.hostCode,
    hostDisplayName: lobby.hostDisplayName,
    size: lobby.size,
    invitedCode: invitedFriend?.code ? normalizeFriendCode(invitedFriend.code) : undefined,
    invitedDisplayName: invitedFriend?.displayName,
    gameHref: game?.href ?? lobby.gameHref,
    gameTitle: game?.title ?? lobby.gameTitle,
    sentAt: nowIso(),
  };
  return base64UrlEncode(JSON.stringify(payload));
}

export function parsePartyInviteToken(token: string): PartyInvitePayload | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(token)) as Partial<PartyInvitePayload>;
    if (!parsed.code || !isPartyCodeShape(parsed.code)) return null;
    if (!parsed.hostCode || !isFriendCodeShape(parsed.hostCode)) return null;
    return {
      code: normalizePartyCode(parsed.code),
      hostCode: normalizeFriendCode(parsed.hostCode),
      hostDisplayName: typeof parsed.hostDisplayName === "string" ? parsed.hostDisplayName.trim() || "Host" : "Host",
      size: sanitizeSize(Number(parsed.size ?? 4)),
      invitedCode: typeof parsed.invitedCode === "string" && isFriendCodeShape(parsed.invitedCode)
        ? normalizeFriendCode(parsed.invitedCode)
        : undefined,
      invitedDisplayName: typeof parsed.invitedDisplayName === "string" ? parsed.invitedDisplayName.trim() : undefined,
      gameHref: typeof parsed.gameHref === "string" ? parsed.gameHref : undefined,
      gameTitle: typeof parsed.gameTitle === "string" ? parsed.gameTitle : undefined,
      sentAt: typeof parsed.sentAt === "string" ? parsed.sentAt : nowIso(),
    };
  } catch {
    return null;
  }
}

export function buildPartyInviteLink(
  lobby: PartyLobby,
  origin: string,
  invitedFriend?: Friend,
  game?: { href?: string; title?: string },
) {
  const token = buildPartyInviteToken(lobby, invitedFriend, game);
  const url = new URL("/app/games", origin);
  url.searchParams.set("join", token);
  return url.toString();
}

function parseJoinInput(input: string): { token?: string; code?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};
  try {
    const url = new URL(trimmed);
    const token = url.searchParams.get("join") ?? url.searchParams.get("party");
    if (token && !isPartyCodeShape(token)) return { token };
    if (token) return { code: normalizePartyCode(token) };
  } catch {
    // raw code path below
  }
  return { code: normalizePartyCode(trimmed) };
}

function isFriendWithHost(hostCode: FriendCode) {
  const social = getSocialState();
  return social.friends.some((friend) => friend.code === hostCode);
}

export function joinPartyFromInput(input: string):
  | { ok: true; lobby: PartyLobby; launchedHref?: string }
  | { ok: false; reason: "invalid" | "not-friends" | "full" | "self" | "wrong-recipient" | "needs-link" } {
  const parsed = parseJoinInput(input);
  const social = getSocialState();
  const selfDisplayName = getCachedPublicUsername();

  if (parsed.token) {
    const payload = parsePartyInviteToken(parsed.token);
    if (!payload) return { ok: false, reason: "invalid" };
    if (payload.hostCode === social.selfCode) return { ok: false, reason: "self" };
    if (!isFriendWithHost(payload.hostCode)) return { ok: false, reason: "not-friends" };
    if (payload.invitedCode && payload.invitedCode !== social.selfCode) {
      return { ok: false, reason: "wrong-recipient" };
    }

    const existing = readPartyLobby();
    const base = existing?.code === payload.code
      ? existing
      : normalizeLobby({
        id: `party-${payload.code}`,
        code: payload.code,
        hostCode: payload.hostCode,
        hostDisplayName: payload.hostDisplayName,
        size: payload.size,
        createdAt: payload.sentAt,
        gameHref: payload.gameHref,
        gameTitle: payload.gameTitle,
        seats: [
          {
            id: `seat-host-${payload.hostCode}`,
            index: 0,
            status: "host",
            code: payload.hostCode,
            displayName: payload.hostDisplayName,
            role: "Host",
            team: "Blush",
            ready: true,
            joinedAt: payload.sentAt,
          },
          ...(payload.invitedCode
            ? [{
                id: `seat-invite-${payload.invitedCode}`,
                index: 1,
                status: "invited" as const,
                code: payload.invitedCode,
                displayName: payload.invitedDisplayName ?? selfDisplayName,
                role: "Invited" as const,
                team: "Lavender" as const,
                ready: false,
                invitedAt: payload.sentAt,
              }]
            : []),
        ],
      });
    if (!base) return { ok: false, reason: "invalid" };
    const occupied = base.seats.find((seat) => seat.code === social.selfCode && seat.status !== "open");
    const index = occupied?.index ?? base.seats.findIndex((seat) => seat.status === "open" || seat.code === social.selfCode);
    if (index < 0) return { ok: false, reason: "full" };

    const joinedSeat: PartySeat = {
      id: `seat-guest-${social.selfCode}`,
      index,
      status: "occupied",
      code: social.selfCode,
      displayName: selfDisplayName,
      role: "Guest",
      team: teamForIndex(index),
      ready: false,
      joinedAt: nowIso(),
    };
    const seats = base.seats.map((seat, seatIndex) => (seatIndex === index ? joinedSeat : seat));
    const next = { ...base, seats, gameHref: payload.gameHref ?? base.gameHref, gameTitle: payload.gameTitle ?? base.gameTitle };
    writePartyLobby(next);
    recordPlayedWith({ code: payload.hostCode, displayName: payload.hostDisplayName, context: "party-lobby" });
    return { ok: true, lobby: next, launchedHref: payload.gameHref };
  }

  if (parsed.code && isPartyCodeShape(parsed.code)) {
    const lobby = readPartyLobby();
    if (!lobby || lobby.code !== parsed.code) return { ok: false, reason: "needs-link" };
    if (lobby.hostCode === social.selfCode) return { ok: false, reason: "self" };
    if (!isFriendWithHost(lobby.hostCode)) return { ok: false, reason: "not-friends" };
    const openIndex = lobby.seats.findIndex((seat) => seat.status === "open");
    if (openIndex < 0) return { ok: false, reason: "full" };
    const seat: PartySeat = {
      id: `seat-guest-${social.selfCode}`,
      index: openIndex,
      status: "occupied",
      code: social.selfCode,
      displayName: selfDisplayName,
      role: "Guest",
      team: teamForIndex(openIndex),
      ready: false,
      joinedAt: nowIso(),
    };
    const next = { ...lobby, seats: lobby.seats.map((entry, index) => (index === openIndex ? seat : entry)) };
    writePartyLobby(next);
    recordPlayedWith({ code: lobby.hostCode, displayName: lobby.hostDisplayName, context: "party-lobby" });
    return { ok: true, lobby: next };
  }

  return { ok: false, reason: "invalid" };
}
