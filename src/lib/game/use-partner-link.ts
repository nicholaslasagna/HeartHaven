"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * usePartnerLink — the "world for two" pairing flow.
 *
 * Migration 0001 created the `partner_links` table; migration 0034 adds
 * the four RPCs this hook wraps:
 *
 *   request_partner_link(target_friend_code)
 *   respond_partner_link(link_id, accept)
 *   unlink_partner()
 *   get_my_partner()
 *
 * The hook polls + subscribes to `partner_links` for the current keeper
 * so an incoming request shows up live without a refresh. The shape is
 * deliberately minimal — Codex's redesign will surface this in the
 * Friends or Account page as a "Make this person my partner" affordance.
 */

export type PartnerLink = {
  link_id: string;
  status: "pending" | "accepted" | "declined" | "blocked";
  /** "requester" = we sent the request, "partner" = we received it. */
  role: "requester" | "partner";
  other_profile_id: string;
  other_friend_code: string;
  other_display_name: string;
  anniversary_on: string | null;
  created_at: string;
  updated_at: string;
};

type Result =
  | { ok: true }
  | { ok: false; reason: string };

export function usePartnerLink() {
  const [link, setLink] = useState<PartnerLink | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const hydrate = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLink(null);
      setLoading(false);
      return;
    }
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("get_my_partner");
      if (error || !Array.isArray(data) || data.length === 0) {
        setLink(null);
      } else {
        const row = data[0] as PartnerLink;
        setLink(row);
      }
    } catch {
      setLink(null);
    }
    setLoading(false);
  }, []);

  // Initial hydrate + realtime subscription. Both sides of a pair need
  // to see updates: Alice when Bob accepts, Bob when Alice's request
  // lands. Filtering server-side by RLS means we only get rows that
  // include us — no extra filter needed here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function start() {
      await hydrate();
      if (cancelled) return;
      const supabase = getSupabaseBrowserClient();
      const channel = supabase
        .channel("partner-link:self")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "partner_links" },
          () => {
            void hydrate();
          },
        )
        .subscribe();
      channelRef.current = channel;
    }
    void start();
    return () => {
      cancelled = true;
      if (channelRef.current) {
        void getSupabaseBrowserClient().removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [hydrate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Actions ─────────────────────────────────────────────────────────

  const requestPartner = useCallback(
    async (targetFriendCode: string): Promise<Result> => {
      if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
      try {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase.rpc("request_partner_link", {
          p_target_friend_code: targetFriendCode,
        });
        if (error) return { ok: false, reason: error.message };
        await hydrate();
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "network" };
      }
    },
    [hydrate],
  );

  const respondPartner = useCallback(
    async (linkId: string, accept: boolean): Promise<Result> => {
      if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
      try {
        const supabase = getSupabaseBrowserClient();
        const { error } = await supabase.rpc("respond_partner_link", {
          p_link_id: linkId,
          p_accept: accept,
        });
        if (error) return { ok: false, reason: error.message };
        await hydrate();
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "network" };
      }
    },
    [hydrate],
  );

  const acceptPartner = useCallback((linkId: string) => respondPartner(linkId, true), [respondPartner]);
  const declinePartner = useCallback((linkId: string) => respondPartner(linkId, false), [respondPartner]);

  const unlinkPartner = useCallback(async (): Promise<Result> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "offline" };
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("unlink_partner");
      if (error) return { ok: false, reason: error.message };
      await hydrate();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "network" };
    }
  }, [hydrate]);

  return {
    link,
    loading,
    isPartnered: link?.status === "accepted",
    pendingIncoming: link?.status === "pending" && link.role === "partner",
    pendingOutgoing: link?.status === "pending" && link.role === "requester",
    requestPartner,
    acceptPartner,
    declinePartner,
    unlinkPartner,
    refresh: hydrate,
  };
}
