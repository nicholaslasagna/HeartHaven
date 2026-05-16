"use client";

import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { setSelfDisplayName } from "@/lib/game/social";

const PUBLIC_USERNAME_STORAGE_KEY = "hearthaven:public-username";
const USERNAME_MAX_LENGTH = 24;

export function normalizePublicUsername(value: string | null | undefined, fallback = "Keeper") {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
  return cleaned || fallback;
}

function usernameFromUser(user: User | null | undefined) {
  const metadata = user?.user_metadata as Record<string, unknown> | undefined;
  const metadataUsername =
    typeof metadata?.username === "string" ? metadata.username
    : typeof metadata?.user_name === "string" ? metadata.user_name
    : undefined;
  const emailPrefix = user?.email?.split("@")[0];
  return normalizePublicUsername(metadataUsername ?? emailPrefix, "Keeper");
}

export function getCachedPublicUsername() {
  if (typeof window === "undefined") return "Keeper";
  return normalizePublicUsername(window.localStorage.getItem(PUBLIC_USERNAME_STORAGE_KEY), "Keeper");
}

export function setCachedPublicUsername(username: string) {
  if (typeof window === "undefined") return;
  const normalized = normalizePublicUsername(username);
  window.localStorage.setItem(PUBLIC_USERNAME_STORAGE_KEY, normalized);
  setSelfDisplayName(normalized);
  window.dispatchEvent(new CustomEvent("hearthaven:public-username-changed", { detail: { username: normalized } }));
}

export async function resolvePublicUsername(user?: User | null) {
  if (!isSupabaseConfigured()) {
    const cached = getCachedPublicUsername();
    setSelfDisplayName(cached);
    return cached;
  }

  try {
    const supabase = getSupabaseBrowserClient();
    const activeUser = user ?? (await supabase.auth.getUser()).data.user;
    if (!activeUser) {
      const cached = getCachedPublicUsername();
      setSelfDisplayName(cached);
      return cached;
    }

    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", activeUser.id)
      .maybeSingle();

    // Precedence: server username > LOCAL cache > derived-from-user.
    // Falling straight to `usernameFromUser` (email prefix) was the bug —
    // a just-saved local value got clobbered by the email prefix whenever
    // the server returned null (e.g. signups without a profile row yet).
    const serverUsername = typeof data?.username === "string" ? data.username.trim() : "";
    const cached = getCachedPublicUsername();
    const candidate = serverUsername || (cached && cached !== "Keeper" ? cached : usernameFromUser(activeUser));
    const username = normalizePublicUsername(candidate);
    setCachedPublicUsername(username);
    return username;
  } catch {
    const fallback = usernameFromUser(user) || getCachedPublicUsername();
    setCachedPublicUsername(fallback);
    return fallback;
  }
}
