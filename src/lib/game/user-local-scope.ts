"use client";

export const USER_LOCAL_SCOPE_KEY = "hearthaven:active-auth-user-id";
export const USER_LOCAL_SCOPE_EVENT = "hearthaven:user-local-scope-changed";

const USER_SCOPED_KEYS = [
  "hearthaven:achievements",
  "hearthaven:companion-roster",
  "hearthaven:daily-loop",
  "hearthaven:daily-wish",
  "hearthaven:discoveries-state",
  "hearthaven:guest-player-id",
  "hearthaven:garden-abilities-state",
  "hearthaven:inventory-state",
  "hearthaven:keeper-body-id",
  "hearthaven:keeper-character-id",
  "hearthaven:keeper-hair-color-id",
  "hearthaven:keeper-hair-style-id",
  "hearthaven:keeper-outfit-id",
  "hearthaven:keeper-palette",
  "hearthaven:keeper-palette-id",
  "hearthaven:keeper-skin-id",
  "hearthaven:pending-room-saves:v1",
  "hearthaven:pet-accessory",
  "hearthaven:pet-name",
  "hearthaven:pet-species-id",
  "hearthaven:pet-tone",
  "hearthaven:pet-tone-id",
  "hearthaven:pet-type",
  "hearthaven:pet-vitals",
  "hearthaven:player-progression",
  "hearthaven:public-username",
  "hearthaven:reward-state",
  "hearthaven:safety-state",
  "hearthaven:social-state",
  "hearthaven:username-change-history",
];

const USER_SCOPED_PREFIXES = [
  "hearthaven:garden-decor:v3:",
  "hearthaven:pet-vitals:",
  "hearthaven:room-expansions:v1:",
  "hearthaven:room-placements:v2:",
  "hearthaven:room-surfaces:v1:",
];

function removeUserScopedLocalState() {
  for (const key of USER_SCOPED_KEYS) {
    window.localStorage.removeItem(key);
  }

  const prefixMatches: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && USER_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      prefixMatches.push(key);
    }
  }
  for (const key of prefixMatches) {
    window.localStorage.removeItem(key);
  }
}

export function ensureUserLocalScope(userId: string | null | undefined) {
  if (typeof window === "undefined" || !userId) return false;

  const previousUserId = window.localStorage.getItem(USER_LOCAL_SCOPE_KEY);
  if (previousUserId === userId) return false;

  removeUserScopedLocalState();
  window.localStorage.setItem(USER_LOCAL_SCOPE_KEY, userId);
  window.dispatchEvent(
    new CustomEvent(USER_LOCAL_SCOPE_EVENT, {
      detail: { previousUserId, userId },
    }),
  );
  return true;
}
