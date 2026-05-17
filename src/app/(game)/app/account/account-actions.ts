"use server";

import { redirect } from "next/navigation";
import { normalizePhone } from "@/lib/auth/phone";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  USERNAME_CHANGE_LIMIT,
  USERNAME_CHANGE_WINDOW_MS,
} from "@/lib/game/username-policy";
import { isUsernameAppropriate } from "@/lib/game/username-blacklist";

const USERNAME_MAX_LENGTH = 24;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

function normalize(raw: FormDataEntryValue | null): string {
  return String(raw ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
}

function redirectAccount(message: string): never {
  redirect(`/app/account?message=${encodeURIComponent(message)}`);
}

function pruneWindow(history: unknown, now: number): string[] {
  if (!Array.isArray(history)) return [];
  const cutoff = now - USERNAME_CHANGE_WINDOW_MS;
  return history
    .map((entry) => ({ entry: String(entry), time: Date.parse(String(entry)) }))
    .filter(({ time }) => Number.isFinite(time) && time >= cutoff)
    .sort((a, b) => b.time - a.time)
    .map(({ entry }) => entry);
}

/**
 * Update the keeper's public username. Enforces:
 *
 *   • shape: 3-24 chars of A-Za-z0-9 . _ -
 *   • uniqueness: case-insensitive — Supabase `profiles.username` is the
 *     authoritative source. A collision is reported back to the form.
 *   • rate limit: at most {@link USERNAME_CHANGE_LIMIT} changes per rolling
 *     365-day window per keeper, tracked on the profile row.
 *
 * In demo mode (no Supabase) we only validate the shape — the local client
 * already enforces the rate limit via `username-policy.ts`.
 */
export async function updateUsernameAction(formData: FormData) {
  const requested = normalize(formData.get("username"));

  if (requested.length < USERNAME_MIN_LENGTH) {
    redirectAccount(`Usernames are at least ${USERNAME_MIN_LENGTH} characters.`);
  }
  if (requested.length > USERNAME_MAX_LENGTH) {
    redirectAccount(`Usernames are at most ${USERNAME_MAX_LENGTH} characters.`);
  }
  if (!USERNAME_PATTERN.test(requested)) {
    redirectAccount("Usernames may only contain letters, numbers, dots, dashes, and underscores.");
  }
  // Appropriateness gate. The server is authoritative even if the client
  // filter is somehow bypassed (older bundle, REST hit, etc.).
  const appropriate = isUsernameAppropriate(requested);
  if (!appropriate.ok) {
    redirectAccount(appropriate.reason);
  }

  if (!isSupabaseConfigured()) {
    // Demo / preview mode: the local UI already enforces the rate limit and
    // writes to localStorage when the form submits client-side. Nothing for
    // the server to do.
    redirectAccount(`Username updated to @${requested}.`);
  }

  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirectAccount("Sign in to change your username.");
  }

  // Load the current profile row to read both the previous username and the
  // change history. Both are authoritative on the server side.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("username, username_changes")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    redirectAccount(`Could not load your profile: ${profileError.message}`);
  }

  const currentUsername = (profile?.username ?? "").trim();
  if (currentUsername.toLowerCase() === requested.toLowerCase()) {
    redirectAccount("That's already your username.");
  }

  const now = Date.now();
  const history = pruneWindow(profile?.username_changes, now);
  if (history.length >= USERNAME_CHANGE_LIMIT) {
    const oldestMs = Date.parse(history[history.length - 1]);
    const nextDate = new Date(oldestMs + USERNAME_CHANGE_WINDOW_MS);
    redirectAccount(
      `Username changes are limited to ${USERNAME_CHANGE_LIMIT} per year. Next change available ${nextDate.toLocaleDateString()}.`,
    );
  }

  // Uniqueness check — case-insensitive match against any OTHER profile.
  const { data: clash, error: clashError } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", requested)
    .neq("id", user.id)
    .maybeSingle();

  if (clashError) {
    redirectAccount(`Could not verify username availability: ${clashError.message}`);
  }
  if (clash) {
    redirectAccount(`The username @${requested} is taken. Try another spelling.`);
  }

  const nextHistory = [new Date(now).toISOString(), ...history].slice(0, USERNAME_CHANGE_LIMIT * 2);

  // Use UPSERT — fresh signups may not have a profile row yet, and a plain
  // UPDATE silently does nothing. The previous bug ("says saved but doesn't
  // show") was exactly this: update succeeded with 0 rows touched, and on
  // the next read `profiles.username` was still null, so we fell back to
  // the email prefix and clobbered the locally-cached value.
  const { error: updateError } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, username: requested, username_changes: nextHistory },
      { onConflict: "id" },
    );

  if (updateError) {
    // If the column `username_changes` isn't deployed yet, retry without it.
    // The local-side policy still enforces the per-year limit.
    if (/column .*username_changes/i.test(updateError.message)) {
      const { error: retryError } = await supabase
        .from("profiles")
        .upsert({ id: user.id, username: requested }, { onConflict: "id" });
      if (retryError) {
        redirectAccount(`Could not save your username: ${retryError.message}`);
      }
    } else {
      redirectAccount(`Could not save your username: ${updateError.message}`);
    }
  }

  redirectAccount(`Username updated to @${requested}.`);
}

/**
 * Add, replace, or clear the keeper's optional phone number. Stored E.164
 * on `profiles.phone`. Used as a secondary ban-match key — see migration
 * 0023. No SMS verification in this MVP; the value is self-reported.
 */
export async function updatePhoneAction(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirectAccount("Phone settings need Supabase configured.");
  }

  const intent = String(formData.get("intent") ?? "save");
  const parseResult = normalizePhone(formData.get("phone")?.toString() ?? null);
  if (!parseResult.ok) {
    redirectAccount(parseResult.reason);
  }
  // `intent=clear` always wipes the phone, regardless of the input field.
  const phone = intent === "clear" ? null : ("phone" in parseResult ? parseResult.phone : null);

  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirectAccount("Sign in to update your phone.");
  }

  // If the keeper is setting a phone, double-check it's not already in the
  // ban table — otherwise a banned user could attach a clean email to a
  // banned phone and slip through.
  if (phone) {
    const { data: isBanned } = await supabase.rpc("is_phone_banned", { p_phone: phone });
    if (isBanned === true) {
      redirectAccount("This phone number can't be added to a HeartHaven account.");
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ phone })
    .eq("id", user.id);

  if (error) {
    // Uniqueness violation = someone else already has it.
    if (/profiles_phone_unique/i.test(error.message)) {
      redirectAccount("That phone is already on another HeartHaven account.");
    }
    if (/profiles_phone_e164_chk/i.test(error.message)) {
      redirectAccount("Enter the phone with the country code, e.g. +14155550100.");
    }
    redirectAccount(`Could not save your phone: ${error.message}`);
  }

  redirectAccount(phone ? "Phone saved." : "Phone removed.");
}
