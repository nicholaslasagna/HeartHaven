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
export function createKeepsakeListener(onOpen: (text: string) => void) {
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
        onOpen(text);
      });
    }, 140);
  };
}
