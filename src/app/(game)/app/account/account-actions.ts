"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  USERNAME_CHANGE_LIMIT,
  USERNAME_CHANGE_WINDOW_MS,
} from "@/lib/game/username-policy";

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

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ username: requested, username_changes: nextHistory })
    .eq("id", user.id);

  if (updateError) {
    // If the column `username_changes` isn't deployed yet, fall back to just
    // updating the username. The local-side policy still enforces the limit.
    if (/column .*username_changes/i.test(updateError.message)) {
      const { error: retryError } = await supabase
        .from("profiles")
        .update({ username: requested })
        .eq("id", user.id);
      if (retryError) {
        redirectAccount(`Could not save your username: ${retryError.message}`);
      }
    } else {
      redirectAccount(`Could not save your username: ${updateError.message}`);
    }
  }

  redirectAccount(`Username updated to @${requested}.`);
}
