"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Megaphone, X } from "lucide-react";
import {
  ANNOUNCEMENTS_EVENT,
  fetchAnnouncements,
  getCachedAnnouncements,
  getSeenAnnouncementIds,
} from "@/lib/game/announcements-store";

const TOAST_DISMISS_KEY = "hearthaven:announcements-toast-dismissed";

/**
 * Top-of-screen pop-up that nudges the keeper toward the Announcements
 * page when there are unseen entries. Shows once per fresh announcement
 * (we record the highest announcement id we've toasted so re-mounts
 * don't keep firing).
 */
export function AnnouncementsLoginToast() {
  const [unseenCount, setUnseenCount] = useState(0);
  const [latestTitle, setLatestTitle] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [topId, setTopId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      const seen = getSeenAnnouncementIds();
      const all = getCachedAnnouncements();
      const unseen = all.filter((announcement) => !seen.has(announcement.id));
      if (cancelled) return;
      setUnseenCount(unseen.length);
      if (unseen.length === 0) {
        setVisible(false);
        return;
      }
      const top = unseen[0];
      setLatestTitle(top.title);
      setTopId(top.id);
      // Only auto-show if the keeper hasn't dismissed this batch yet.
      try {
        const dismissedFor = window.localStorage.getItem(TOAST_DISMISS_KEY);
        if (dismissedFor === top.id) return;
      } catch {
        /* ignore quota errors */
      }
      setVisible(true);
    }
    // Initial fetch — pulls from Supabase, then refresh local view.
    void fetchAnnouncements().then(() => {
      if (!cancelled) refresh();
    });
    window.addEventListener(ANNOUNCEMENTS_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(ANNOUNCEMENTS_EVENT, refresh);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    if (topId) {
      try {
        window.localStorage.setItem(TOAST_DISMISS_KEY, topId);
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <AnimatePresence>
      {visible && unseenCount > 0 && (
        <motion.div
          key="announcement-toast"
          initial={{ y: -32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -32, opacity: 0 }}
          className="pointer-events-auto fixed inset-x-0 top-4 z-[60] mx-auto flex w-[min(540px,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-blush-300/40 bg-cream-50/95 px-4 py-3 shadow-[0_24px_60px_-22px_rgba(91,63,63,0.4)] backdrop-blur"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blush-100 text-blush-500">
            <Megaphone className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-extrabold uppercase tracking-normal text-blush-500">
              {unseenCount} new from HeartHaven
            </p>
            <p className="mt-0.5 truncate text-sm font-extrabold text-ink-900">
              {latestTitle ?? "Open Announcements to read more"}
            </p>
            <Link
              href="/app/memory-book"
              onClick={dismiss}
              className="mt-1 inline-flex items-center gap-1 text-xs font-extrabold text-lavender-500 hover:underline"
            >
              Open Announcements →
            </Link>
          </div>
          <button
            aria-label="Dismiss"
            className="grid size-7 shrink-0 place-items-center rounded-full text-ink-500 transition-colors hover:bg-cream-200"
            onClick={dismiss}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
