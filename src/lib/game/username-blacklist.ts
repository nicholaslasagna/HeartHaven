/**
 * username-blacklist — bans the worst classes of public usernames before
 * they're ever saved. The list is intentionally short: covers obvious
 * slurs, sexual terms, threats, and impersonation handles. It's NOT a
 * perfect filter (no list can be) — it's the floor that catches the
 * common stuff, and we lean on reports + admin moderation for the rest.
 *
 * The check normalizes:
 *   • Lowercases the candidate
 *   • Strips dots/dashes/underscores (the only punctuation we allow)
 *   • Maps common digit-letter substitutions (1→i, 3→e, 0→o, 4→a, 5→s, 7→t, @→a, $→s)
 *
 * This way `f.u.c.k`, `fu_ck`, `f4ck`, `Fück` all collapse to the same
 * canonical form for matching.
 *
 * NOTE: this is also exposed to the server action, so the same list is
 * authoritative at the DB layer. Adding a new entry once protects both
 * the client and the upsert path.
 */

const SLURS_AND_SEVERE = [
  // Racial / ethnic slurs and severe pejoratives.
  "nigger",
  "nigga",
  "chink",
  "spic",
  "kike",
  "gook",
  "wetback",
  "raghead",
  // LGBTQ slurs.
  "faggot",
  "tranny",
  "dyke",
  // Anti-religious slurs.
  "mudslime",
  "kaffir",
  // Threats / violence.
  "killyourself",
  "kysuser",
  "kysplease",
  "ihopeyoudie",
];

const SEXUAL_AND_OBSCENE = [
  "porn",
  "porno",
  "sex",
  "sexy",
  "sexgod",
  "horny",
  "cum",
  "cumming",
  "anal",
  "blowjob",
  "bj",
  "incest",
  "rape",
  "rapist",
  "molest",
  "pedo",
  "pedophile",
  "loli",
  "shota",
  "groomer",
  "nudes",
  "nude",
  "cock",
  "dick",
  "pussy",
  "vagina",
  "penis",
  "boobs",
  "boob",
  "tits",
  "bdsm",
  "fetish",
  "kink",
  "slut",
  "whore",
  "thot",
  "milf",
];

const PROFANITY = [
  "fuck",
  "fucked",
  "fucking",
  "fucker",
  "shit",
  "asshole",
  "bitch",
  "bastard",
  "cunt",
  "piss",
  "dipshit",
  "bullshit",
  "wank",
  "wanker",
];

const IMPERSONATION = [
  // Reserved / official handles. Block anyone trying to pretend to be us.
  "hearthaven",
  "admin",
  "moderator",
  "support",
  "staff",
  "official",
  "system",
  "anthropic",
  "claude",
  "supabase",
  "owner",
];

// Combined list — internal only. Use `isUsernameAppropriate()` from outside.
const BLACKLIST = [...SLURS_AND_SEVERE, ...SEXUAL_AND_OBSCENE, ...PROFANITY, ...IMPERSONATION];

/**
 * Collapse a candidate string to a canonical form for blacklist matching.
 * Lowercases, strips allowed punctuation, then folds common digit/letter
 * substitutions so leet-speak variants share a key with their unobfuscated
 * counterpart.
 */
/**
 * Normalize a single confusable Unicode code point to its ASCII look-alike
 * so common homoglyph bypasses (Cyrillic 'а' / Greek 'α' / fullwidth 'ａ')
 * don't sneak past the blacklist by visually impersonating Latin letters.
 *
 * The map covers the highest-frequency abusers — full Unicode confusable
 * coverage would need a dependency on `confusables` or similar; this
 * inline list stops the easy attacks without the dep weight.
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic look-alikes
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
  "А": "a", "В": "b", "Е": "e", "К": "k", "М": "m", "Н": "h", "О": "o", "Р": "p", "С": "c", "Т": "t",
  // Greek look-alikes
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u",
  "Α": "a", "Β": "b", "Ε": "e", "Η": "h", "Ι": "i", "Κ": "k", "Μ": "m", "Ν": "n", "Ο": "o", "Ρ": "p",
};

function foldHomoglyphs(input: string): string {
  let out = "";
  for (const ch of input) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}

function canonicalize(value: string): string {
  // NFKC > NFD: NFKC collapses compatibility characters too (e.g.
  // fullwidth 'ｆｕｃｋ' → 'fuck'), and is the recommended baseline for
  // username matching. Diacritics still get stripped explicitly via the
  // combining-mark range after, so "fück" → "fuck".
  let working = value.normalize("NFKC").toLowerCase();
  working = foldHomoglyphs(working);
  working = working
    .replace(/[._\-@]+/g, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/\$/g, "s")
    // Strip combining diacritical marks after decomposing.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Anything outside [a-z] gets dropped.
    .replace(/[^a-z]/g, "");
  return working;
}

/**
 * Result of an appropriateness check.
 * - `ok: true` → username passes
 * - `ok: false` → blocked; `reason` is a user-facing string explaining why
 */
export type UsernameAppropriateResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Returns `ok: true` if the username has no blacklist hit, otherwise
 * `ok: false` with a user-friendly reason. The reason intentionally does
 * NOT echo the offending term so the UI doesn't repeat slurs back at
 * anyone — it just says "isn't allowed".
 */
export function isUsernameAppropriate(candidate: string): UsernameAppropriateResult {
  const canonical = canonicalize(candidate);
  if (!canonical) {
    return { ok: false, reason: "Usernames must contain at least one letter." };
  }
  for (const banned of BLACKLIST) {
    if (canonical.includes(banned)) {
      return {
        ok: false,
        reason: "That username isn't allowed in HeartHaven. Try something else.",
      };
    }
  }
  return { ok: true };
}

/**
 * Read-only view of the list, exposed for tests and admin tooling only.
 * Not a public surface — don't render this in the UI.
 */
export function getUsernameBlacklistForTesting(): readonly string[] {
  return BLACKLIST;
}
