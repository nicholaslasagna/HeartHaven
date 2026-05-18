"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * BanWatchdog — listens for an INSERT into `ban_self_alerts` scoped to
 * the current keeper and instantly signs them out + redirects them to
 * /account-suspended. Mounted once in `GameShell` so every signed-in
 * route is covered.
 *
 * Why this matters: the middleware's `is_current_user_banned` check is
 * cached for 60 seconds to avoid an RPC on every page navigation. That's
 * fine for slow-burn ban discovery, but not for "I just hit ban_keeper
 * in Studio and want the user kicked NOW." This realtime path closes
 * that gap — the moment the row lands, the offender's tab reacts.
 *
 * Implementation notes:
 *   - Filter on `banned_profile_id=eq.<myUserId>` so Supabase only
 *     ships rows for *this* user. Saves bandwidth and bypasses any
 *     concern about another user's ban accidentally landing here.
 *   - We don't try to be clever about race conditions with the
 *     middleware. Both paths converge on /account-suspended; whichever
 *     fires first wins.
 *   - Fail open. If the realtime channel can't connect (bad network,
 *     Supabase outage), the middleware ban check is still in place as
 *     the durable backstop.
 */
export function BanWatchdog() {
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    async function start() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      // A per-user channel name keeps things tidy in Supabase's
      // realtime presence dashboard if Nick ever inspects it. The
      // filter is what actually scopes the events.
      const channel = supabase
        .channel(`ban-watchdog:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "ban_self_alerts",
            filter: `banned_profile_id=eq.${user.id}`,
          },
          async (payload) => {
            const banId =
              payload?.new && typeof (payload.new as { ban_id?: unknown }).ban_id === "string"
                ? ((payload.new as { ban_id: string }).ban_id)
                : null;

            // Paranoia: if the alert references a ban that's already
            // expired (e.g. the row was inserted just as the temp ban
            // lapsed), don't bother signing out. The middleware
            // `is_current_user_banned` check also filters by
            // expires_at, so the user would just bounce back to /app/*
            // anyway — but the redirect+signout dance is jarring.
            if (banId) {
              try {
                const { data } = await supabase.rpc("get_ban_summary", { p_ban_id: banId });
                const row = Array.isArray(data) ? data[0] : null;
                const expiresAt = row && typeof row.expires_at === "string" ? row.expires_at : null;
                if (expiresAt) {
                  const expiresMs = new Date(expiresAt).getTime();
                  if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
                    return; // already expired; ignore the alert
                  }
                }
              } catch {
                // RPC blip — fall through to sign-out. Better to bounce
                // the keeper to /account-suspended once than to leave
                // them in a banned-but-undetected state.
              }
            }

            // Sign out first so the cookie session can't be reused on a
            // back-button navigation. Even if signOut races slow, the
            // /account-suspended redirect itself is harmless to view.
            void supabase.auth.signOut().finally(() => {
              const target = banId
                ? `/account-suspended?ref=${encodeURIComponent(banId)}`
                : "/account-suspended";
              router.replace(target);
            });
          },
        )
        .subscribe();

      cleanup = () => {
        void supabase.removeChannel(channel);
      };
    }

    void start();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [router]);

  return null;
}
