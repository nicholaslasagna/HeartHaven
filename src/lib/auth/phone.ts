/**
 * Phone-number helpers used by signup + account update. We store phones in
 * E.164 form (`+` then 1–15 digits, first digit non-zero) which matches the
 * `profiles.phone` check constraint in migration 0023.
 *
 * We do NOT verify phone ownership via SMS in this MVP — phone is optional
 * and self-reported. The value is only used as a secondary ban-match key,
 * so the worst case for a malformed/false phone is that it doesn't help us
 * identify a returning banned user.
 */

const E164 = /^\+[1-9][0-9]{6,14}$/;

export type PhoneValidationResult =
  | { ok: true; phone: string }
  | { ok: false; reason: string };

/**
 * Normalize a free-text phone input into strict E.164. Accepts inputs with
 * spaces, dashes, parentheses, and a leading `+` or `00`. Empty input is
 * valid and resolves to `null` so callers can pass it straight to the DB.
 */
export function normalizePhone(raw: string | null | undefined): PhoneValidationResult | { ok: true; phone: null } {
  const cleaned = String(raw ?? "").trim();
  if (cleaned.length === 0) return { ok: true, phone: null };

  // Strip everything that isn't a digit or leading +; collapse a leading
  // `00` (international prefix used in many countries) into `+`.
  let condensed = cleaned.replace(/[^\d+]/g, "");
  if (condensed.startsWith("00")) condensed = `+${condensed.slice(2)}`;
  if (!condensed.startsWith("+")) condensed = `+${condensed}`;

  if (!E164.test(condensed)) {
    return { ok: false, reason: "Enter the phone with the country code, e.g. +14155550100." };
  }
  return { ok: true, phone: condensed };
}

/** Pretty-display helper for UI labels. Best-effort, never throws. */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  // Minimal grouping for readability — keep + and split into 3-3-4 chunks
  // when there are 11+ digits, otherwise leave as-is.
  const digits = phone.replace(/^\+/, "");
  if (digits.length < 10) return phone;
  if (digits.length === 10) return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return `+${digits.slice(0, digits.length - 10)} ${digits.slice(-10, -7)} ${digits.slice(-7, -4)} ${digits.slice(-4)}`;
}
