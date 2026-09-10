"use client";

/**
 * A private keepsake, kept sealed until it is asked for.
 *
 * The contents are encrypted with a key derived from the unlock sequence
 * itself, so nothing here — and nothing in the shipped bundle — contains the
 * words or the sequence. What is stored is the sealed bytes and the salt they
 * were sealed with. Read this file all you like: without performing the
 * sequence there is no key, and without the key AES-GCM will not authenticate
 * the block, so it simply refuses to open.
 *
 * That is also why there is no separate check for "was the sequence right".
 * A wrong sequence derives a wrong key, the block fails its own integrity
 * check, and the attempt ends quietly. Nothing is logged and nothing changes
 * on screen, so there is no way to probe for a near miss.
 */

const SEALED = {
  salt: "IqnELinRkHNMqdIY+C0P7Q==",
  iv: "06SR/LljOWqhFFNt",
  body: "LqHkSSP5Z4rZifk6UgAdc18CrvH3EHnwxwHiYhemgBYJUg==",
  rounds: 310000,
  /* How many keys the phrase is. Knowing the length gives nothing away — it
     is what lets the listener make ONE attempt on the exact tail rather than
     grinding a key derivation over every possible tail on every keystroke. */
  steps: 8,
} as const;

/** How long a partial attempt stays alive between keys. */
export const KEEPSAKE_STEP_TIMEOUT_MS = 4000;

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

/**
 * Open the keepsake with the given phrase, or return null.
 *
 * Returns null rather than throwing: a wrong phrase is not an error, it is
 * simply someone typing.
 */
export async function openKeepsake(phrase: string): Promise<string | null> {
  if (typeof window === "undefined" || !window.crypto?.subtle) return null;
  try {
    const encoder = new TextEncoder();
    const phraseBytes = encoder.encode(phrase);
    const phraseBuffer = new ArrayBuffer(phraseBytes.length);
    new Uint8Array(phraseBuffer).set(phraseBytes);
    const base = await window.crypto.subtle.importKey(
      "raw", phraseBuffer, "PBKDF2", false, ["deriveKey"],
    );
    const key = await window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: fromBase64(SEALED.salt), iterations: SEALED.rounds, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
    );
    const opened = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(SEALED.iv) }, key, fromBase64(SEALED.body),
    );
    return new TextDecoder().decode(opened);
  } catch {
    return null;
  }
}

/**
 * Follows a key sequence without knowing what it is.
 *
 * The sequence is never held here either. Each key is appended to the phrase
 * attempted so far, and the phrase is simply offered to the keepsake; if it
 * opens, that was the sequence. A wrong turn falls back to the longest tail
 * that could still be a beginning, so a fumbled start does not have to be
 * restarted from nothing.
 */
export function createKeepsakeListener(onOpen: (text: string, phrase: string) => void) {
  let trail: string[] = [];
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let opened = false;

  return function offer(rawKey: string, now: number) {
    if (opened) return;
    if (now - lastAt > KEEPSAKE_STEP_TIMEOUT_MS) trail = [];
    lastAt = now;

    trail.push(rawKey.toLowerCase());
    if (trail.length > SEALED.steps) trail = trail.slice(-SEALED.steps);
    if (trail.length < SEALED.steps) return;

    /* Debounced, so a burst of keys costs one key derivation rather than one
       per press — and the attempt that survives is always the most recent
       tail, which is the completed phrase. */
    if (timer) clearTimeout(timer);
    const attempt = trail.join(" ");
    timer = setTimeout(() => {
      timer = null;
      void openKeepsake(attempt).then((text) => {
        if (!text || opened) return;
        opened = true;
        trail = [];
        onOpen(text, attempt);
      });
    }, 140);
  };
}

/* ── Sharing it ───────────────────────────────────────────────────────────
   The keepsake opens on the screen that asks for it. When the asker is
   standing somewhere with other people, the phrase is passed along the
   channel that place already keeps, so it opens for them too.

   Only the phrase travels. Every client already carries the sealed block and
   opens its own copy, so the words themselves never cross the wire — and a
   client that receives a phrase which does not open simply does nothing. */

/** Broadcast event name for a passed-along phrase. */
export const KEEPSAKE_EVENT = "place_keepsake";

/**
 * It is for two people. Not a lobby, not an audience.
 *
 * Both ends check this. The sending end so it never leaves a crowded place,
 * and the receiving end so it does not matter what the sending end claims —
 * a screen with a third person in the room will not open it however the
 * phrase arrived.
 */
export const KEEPSAKE_PARTY_SIZE = 2;

/**
 * How many PEOPLE are here, rather than how many browser tabs.
 *
 * Presence is keyed per client, so one person with the place open twice would
 * otherwise count as two and the moment would silently refuse to travel.
 * A keeper code is the identity where the entry carries one; a guest has only
 * its client id to go by.
 */
export function keepsakePresentCount(state: unknown): number {
  if (!state || typeof state !== "object") return 0;
  const people = new Set<string>();
  for (const entries of Object.values(state as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const row = entry as { friendCode?: unknown; id?: unknown } | null;
      const code = typeof row?.friendCode === "string" ? row.friendCode.trim().toUpperCase() : "";
      const id = typeof row?.id === "string" ? row.id.trim() : "";
      const who = code || id;
      if (who) people.add(who);
    }
  }
  return people.size;
}

/** Just the two of you, or it stays on the screen that asked for it. */
export function keepsakeIsPrivate(state: unknown): boolean {
  return keepsakePresentCount(state) === KEEPSAKE_PARTY_SIZE;
}

type Relay = (phrase: string) => void;

let relay: Relay | null = null;
const arrivals = new Set<Relay>();

/** A connected place lends the keepsake its channel for as long as it is open. */
export function registerKeepsakeRelay(send: Relay) {
  relay = send;
  return () => {
    if (relay === send) relay = null;
  };
}

/** Pass the phrase to whoever else is here. No place connected, no-one to tell. */
export function shareKeepsake(phrase: string) {
  try {
    relay?.(phrase);
  } catch {
    /* The moment is not worth an exception. It has already opened locally. */
  }
}

/** Hand a received broadcast payload to whoever is listening. */
export function deliverKeepsake(payload: unknown) {
  const phrase = (payload as { phrase?: unknown } | null | undefined)?.phrase;
  if (typeof phrase !== "string" || phrase.length === 0 || phrase.length > 512) return;
  for (const listener of arrivals) listener(phrase);
}

export function onKeepsakeArrival(listener: Relay) {
  arrivals.add(listener);
  return () => {
    arrivals.delete(listener);
  };
}
