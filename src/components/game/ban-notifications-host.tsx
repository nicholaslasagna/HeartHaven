"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Toast feed that surfaces ban-action acknowledgements to a keeper who
 * filed reports. Reads from `ban_notifications` (RLS-scoped to the
 * signed-in user), shows each unacknowledged row as a dismissible card,
 * and on dismiss stamps `acknowledged_at` so the card never reappears.
 *
 * Mounted once inside `GameShell` so it covers every authenticated route.
 *
 * Design choices:
 *   - One DB query on mount + a 30s refresh tick. Cheap, avoids the
 *     overhead of a realtime subscription for a feature that's rarely
 *     used. If a ban lands seconds after a keeper opens the app, they
 *     see the notice within half a minute.
 *   - We acknowledge optimistically — the row is removed from state the
 *     moment the user dismisses it. The UPDATE is fire-and-forget; if it
 *     fails the worst case is the toast comes back on next refresh.
 *   - No mention of the banned user's email/phone/display name. The
 *     friend code is the only identifier shown, which the reporter
 *     already knows from filing the report.
 */

type BanNotification = {
  id: string;
  banned_friend_code: string;
  reason_category: string;
  created_at: string;
};

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "recently";
  const delta = Date.now() - then;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function BanNotificationsHost() {
  const [notifications, setNotifications] = useState<BanNotification[]>([]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;

    async function load() {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("ban_notifications")
        .select("id, banned_friend_code, reason_category, created_at")
        .is("acknowledged_at", null)
        .order("created_at", { ascending: false })
        .limit(8);
      if (cancelled) return;
      if (error || !Array.isArray(data)) return;
      setNotifications(data as BanNotification[]);
    }

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function dismiss(id: string) {
    setNotifications((current) => current.filter((entry) => entry.id !== id));
    if (!isSupabaseConfigured()) return;
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase
        .from("ban_notifications")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("id", id);
    } catch {
      // Best-effort. The next refresh will re-fetch and the toast may
      // reappear — acceptable for a fire-and-forget acknowledgement.
    }
  }

  if (notifications.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-40 flex w-[min(360px,calc(100vw-2.5rem))] flex-col gap-3"
    >
      {notifications.map((entry) => (
        <article
          key={entry.id}
          className="pointer-events-auto rounded-2xl border border-cream-300 bg-white/95 p-4 shadow-[0_18px_44px_-20px_rgba(91,63,63,0.45)]"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-garden-100 text-garden-700">
              <ShieldCheck className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold uppercase tracking-normal text-garden-700">
                Report actioned
              </p>
              <h3 className="mt-1 text-sm font-black leading-5 text-ink-900">
                A keeper you reported has been removed from HeartHaven.
              </h3>
              <p className="mt-1 text-xs font-semibold leading-5 text-ink-700">
                Friend code <code className="rounded bg-cream-100 px-1 py-0.5">{entry.banned_friend_code}</code> · category {entry.reason_category} · {formatWhen(entry.created_at)}
              </p>
              <p className="mt-2 text-xs font-bold leading-5 text-ink-500">
                Thank you for taking the time to report. Your report helped keep HeartHaven safer.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void dismiss(entry.id)}
              className="rounded-full p-1 text-ink-500 transition hover:bg-cream-100 hover:text-ink-800"
              aria-label="Dismiss notification"
            >
              <X className="size-4" />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
