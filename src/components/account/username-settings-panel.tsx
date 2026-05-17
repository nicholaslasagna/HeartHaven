"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AtSign, BadgeCheck, Save, ShieldAlert } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCachedPublicUsername,
  normalizePublicUsername,
  resolvePublicUsername,
  setCachedPublicUsername,
} from "@/lib/game/public-identity";
import { isUsernameAppropriate } from "@/lib/game/username-blacklist";
import {
  USERNAME_CHANGE_LIMIT,
  computeStatus,
  getUsernameChangeStatus,
  hydrateUsernameHistory,
  pruneUsernameHistory,
  recordUsernameChange,
  type UsernameChangeStatus,
} from "@/lib/game/username-policy";
import { updateUsernameAction } from "@/app/(game)/app/account/account-actions";

type UsernameSettingsPanelProps = {
  /**
   * History from the authoritative Supabase profile row (ISO timestamps).
   * Hydrates the local rate-limit display so server + client agree on how
   * many changes the keeper has left this year.
   */
  serverHistory?: string[] | null;
  /** Current username from the authoritative profile row (if available). */
  serverUsername?: string | null;
};

function formatRemaining(status: UsernameChangeStatus): string {
  if (status.allowed) {
    return `${status.changesRemaining} of ${USERNAME_CHANGE_LIMIT} changes remaining this year.`;
  }
  if (status.nextAllowedAt) {
    const when = new Date(status.nextAllowedAt);
    return `You've used all ${USERNAME_CHANGE_LIMIT} changes this year. Next change unlocks ${when.toLocaleDateString()}.`;
  }
  return `You've used all ${USERNAME_CHANGE_LIMIT} changes this year.`;
}

export function UsernameSettingsPanel({ serverHistory, serverUsername }: UsernameSettingsPanelProps) {
  const [username, setUsername] = useState(() =>
    serverUsername ? normalizePublicUsername(serverUsername) : getCachedPublicUsername(),
  );
  const [draft, setDraft] = useState(() =>
    serverUsername ? normalizePublicUsername(serverUsername) : getCachedPublicUsername(),
  );
  const [status, setStatus] = useState<UsernameChangeStatus>(() =>
    computeStatus(pruneUsernameHistory(serverHistory ?? [])),
  );
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Sync the server-side history into local on mount so the limit display
  // stays in step with what the server will enforce. The setState is
  // deferred to a microtask so React doesn't see it as a synchronous
  // cascade inside the effect body.
  useEffect(() => {
    if (serverHistory && serverHistory.length > 0) {
      hydrateUsernameHistory(serverHistory);
    }
    queueMicrotask(() => setStatus(getUsernameChangeStatus()));
  }, [serverHistory]);

  // Refresh from Supabase (or cache) on mount so the displayed username is
  // always the authoritative one.
  useEffect(() => {
    let cancelled = false;
    void resolvePublicUsername().then((next) => {
      if (cancelled) return;
      setUsername(next);
      setDraft((current) => (current === "" ? next : current));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function validate(candidate: string): string | null {
    if (candidate.length < 3) return "Usernames are at least 3 characters.";
    if (candidate.length > 24) return "Usernames are at most 24 characters.";
    if (!/^[a-zA-Z0-9_.-]+$/.test(candidate)) {
      return "Use letters, numbers, dots, dashes, or underscores only.";
    }
    if (candidate.toLowerCase() === username.toLowerCase()) {
      return "That's already your username.";
    }
    // Local appropriateness check. The same list runs server-side in
    // `updateUsernameAction`, so this just avoids a round trip + gives
    // the user instant feedback while they're typing.
    const appropriate = isUsernameAppropriate(candidate);
    if (!appropriate.ok) return appropriate.reason;
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const candidate = normalizePublicUsername(draft);
    const validationError = validate(candidate);
    if (validationError) {
      event.preventDefault();
      setNotice({ tone: "error", text: validationError });
      return;
    }
    const liveStatus = getUsernameChangeStatus();
    if (!liveStatus.allowed) {
      event.preventDefault();
      setNotice({ tone: "error", text: formatRemaining(liveStatus) });
      setStatus(liveStatus);
      return;
    }
    // Cache locally so the in-game header updates immediately. The server
    // action re-checks the rate limit (so the server is still the source of
    // truth) and persists to Supabase.
    setCachedPublicUsername(candidate);
    const nextStatus = recordUsernameChange();
    setStatus(nextStatus);
    setUsername(candidate);
    setNotice({ tone: "ok", text: `Username updated to @${candidate}.` });
    // Let the form action run — the page redirects with a message.
  }

  return (
    <CozyCard className="p-5">
      <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-lavender-500">
        <AtSign className="size-4" /> Public username
      </p>
      <h2 className="mt-2 font-display text-3xl text-ink-900">@{username}</h2>
      <p className="mt-2 text-sm font-bold text-ink-700">
        This is the name everyone else sees in chat, on invites, and above your keeper. Your email stays private.
      </p>

      <form action={updateUsernameAction} onSubmit={handleSubmit} className="mt-4 grid gap-3">
        <label className="grid gap-2 text-sm font-extrabold text-ink-700">
          New username
          <Input
            aria-describedby="username-help"
            disabled={!status.allowed}
            maxLength={24}
            minLength={3}
            name="username"
            onChange={(event) => {
              setDraft(event.target.value);
              if (notice?.tone === "error") setNotice(null);
            }}
            pattern="[A-Za-z0-9_.-]{3,24}"
            placeholder="moonberrykeeper"
            required
            value={draft}
          />
        </label>
        <p id="username-help" className="flex items-center gap-1 text-xs font-bold text-ink-600">
          <BadgeCheck className="size-3.5 text-garden-700" />
          {formatRemaining(status)}
        </p>
        {notice && (
          <p
            className={`flex items-center gap-1 text-xs font-extrabold ${
              notice.tone === "error" ? "text-blush-700" : "text-garden-700"
            }`}
          >
            {notice.tone === "error" && <ShieldAlert className="size-3.5" />}
            {notice.text}
          </p>
        )}
        <Button className="w-fit" disabled={!status.allowed}>
          <Save /> Save username
        </Button>
      </form>
    </CozyCard>
  );
}
