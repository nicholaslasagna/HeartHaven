"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Users, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { SOCIAL_EVENT } from "@/lib/game/social";
import {
  syncFollowerChannelsWithFriends,
  type PartyRelocateEvent,
} from "@/lib/game/party-bridge";

/**
 * Floating toast that listens for `hearthaven:party-follow-prompt` events
 * (broadcast by a host through `broadcastPartyRelocate()`) and lets the
 * keeper one-click follow without re-inviting.
 *
 * Sits in the layout shell so it's available everywhere — the host can
 * move from /app/area to /app/games to /app/bowling and friends get the
 * prompt regardless of where they currently are.
 *
 * Auto-dismisses after 12 seconds, can be dismissed manually, and dedupes
 * by host code (a host quickly moving twice replaces the older prompt).
 */
export function PartyFollowToast() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<PartyRelocateEvent[]>([]);

  // Keep follower subscriptions in lockstep with the friend list. When a
  // friend is added or removed we re-sync so the host's broadcasts
  // reach the right inboxes.
  useEffect(() => {
    syncFollowerChannelsWithFriends();
    const onSocial = () => syncFollowerChannelsWithFriends();
    window.addEventListener(SOCIAL_EVENT, onSocial);
    window.addEventListener("storage", onSocial);
    return () => {
      window.removeEventListener(SOCIAL_EVENT, onSocial);
      window.removeEventListener("storage", onSocial);
    };
  }, []);

  useEffect(() => {
    function onPrompt(event: Event) {
      const detail = (event as CustomEvent<PartyRelocateEvent>).detail;
      if (!detail?.path || !detail?.hostCode) return;
      setPrompts((current) => {
        // Dedupe by host — if they fired a relocate twice in a row, only
        // the latest one is relevant.
        const filtered = current.filter((entry) => entry.hostCode !== detail.hostCode);
        return [detail, ...filtered].slice(0, 3);
      });
    }
    window.addEventListener("hearthaven:party-follow-prompt", onPrompt);
    return () => window.removeEventListener("hearthaven:party-follow-prompt", onPrompt);
  }, []);

  // Auto-dismiss after 12 seconds. Each prompt gets its own timer so a
  // newly-arrived one doesn't reset the older one's countdown.
  useEffect(() => {
    if (prompts.length === 0) return;
    const timers = prompts.map((prompt) =>
      window.setTimeout(() => {
        setPrompts((current) => current.filter((entry) => entry !== prompt));
      }, 12_000),
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [prompts]);

  function follow(prompt: PartyRelocateEvent) {
    setPrompts((current) => current.filter((entry) => entry !== prompt));
    router.push(prompt.path);
  }

  function dismiss(prompt: PartyRelocateEvent) {
    setPrompts((current) => current.filter((entry) => entry !== prompt));
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[120] flex flex-col gap-2">
      <AnimatePresence>
        {prompts.map((prompt) => (
          <motion.div
            key={`${prompt.hostCode}-${prompt.sentAt}`}
            initial={{ opacity: 0, x: 24, y: 6 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="pointer-events-auto flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-lavender-300/60 bg-cream-50 p-4 shadow-[0_18px_44px_-22px_rgba(91,63,63,0.45)]"
            role="status"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-lavender-100">
              <Users className="size-5 text-lavender-500" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">
                @{prompt.hostDisplayName} is hosting
              </p>
              <p className="mt-1 text-sm font-bold leading-5 text-ink-800">
                They moved to {prompt.label ?? "a new area"}. Want to follow?
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="inline-flex items-center gap-1.5 rounded-full bg-blush-500 px-3 py-1.5 text-xs font-extrabold text-cream-50 shadow-sm transition hover:-translate-y-0.5 hover:bg-blush-300"
                  onClick={() => follow(prompt)}
                  type="button"
                >
                  Follow <ArrowRight className="size-3.5" />
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/80 px-3 py-1.5 text-xs font-extrabold text-ink-600 transition hover:bg-cream-200"
                  onClick={() => dismiss(prompt)}
                  type="button"
                >
                  Not now
                </button>
              </div>
            </div>
            <button
              aria-label="Dismiss"
              className="grid size-7 place-items-center rounded-full text-ink-500 transition-colors hover:bg-cream-200"
              onClick={() => dismiss(prompt)}
              type="button"
            >
              <X className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
