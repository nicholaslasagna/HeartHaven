"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  acceptInviteFromCode,
  cancelOutgoingInvite,
  declineFriendInvite,
  getSocialState,
  normalizeFriendCode,
  type FriendCode,
  type FriendInvite,
} from "@/lib/game/social";

/**
 * invite-bridge — the seam between the local social state and Supabase.
 *
 * Local-only mode (no Supabase env vars): everything still works through
 * localStorage and shareable links — this module is a no-op.
 *
 * Supabase mode:
 *   • On first mount we lift the locally-generated friend code onto the
 *     `profiles.friend_code` column so Postgres can route incoming invites.
 *   • Sending an invite inserts a row into `friend_invites`. The recipient's
 *     Realtime subscription gets the INSERT immediately and drops it into
 *     their local inbox — no shareable-link round-trip needed.
 *   • We listen for inbound INSERTs and outbound UPDATEs (accept / decline)
 *     and reconcile them back into the local social store.
 */

type SupabaseInviteRow = {
  id: string;
  sender_profile_id: string;
  from_code: string;
  from_display_name: string;
  to_code: string;
  message: string | null;
  status: "pending" | "accepted" | "declined" | "blocked" | "cancelled";
  created_at: string;
  responded_at: string | null;
};

let codeSyncDone = false;
let realtimeChannel: ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]> | null = null;
let bootPromise: Promise<void> | null = null;

/**
 * Sync the local keeper's friend code onto `profiles.friend_code` so Postgres
 * can resolve "who is HH-XXXXX-NNN" for invite delivery. Runs once per
 * session; subsequent calls are no-ops.
 */
async function syncFriendCodeToProfile() {
  if (codeSyncDone) return;
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const local = getSocialState();
    if (!local.selfCode) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("friend_code")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.friend_code === local.selfCode) {
      codeSyncDone = true;
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ friend_code: local.selfCode })
      .eq("id", user.id);
    if (!error) codeSyncDone = true;
  } catch (error) {
    console.warn("[hearthaven invite-bridge] friend_code sync failed:", error);
  }
}

/**
 * Mirror an outgoing invite into `friend_invites`. The recipient's Realtime
 * subscription will pick it up and route it into their inbox. Returns the
 * inserted row id (or null in local-only mode / on failure).
 */
export async function pushInviteToSupabase(invite: FriendInvite): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  await syncFriendCodeToProfile();
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("friend_invites")
      .insert({
        sender_profile_id: user.id,
        from_code: invite.fromCode,
        from_display_name: invite.fromDisplayName,
        to_code: invite.toCode,
        message: invite.message ?? null,
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[hearthaven invite-bridge] insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (error) {
    console.warn("[hearthaven invite-bridge] insert exception:", error);
    return null;
  }
}

/**
 * Tell the server an incoming invite has been accepted / declined / blocked.
 * The sender's Realtime subscription will update their outgoing list.
 */
export async function setSupabaseInviteStatus(
  fromCode: FriendCode,
  status: "accepted" | "declined" | "blocked",
) {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const local = getSocialState();
    const normalized = normalizeFriendCode(fromCode);
    await supabase
      .from("friend_invites")
      .update({ status, responded_at: new Date().toISOString() })
      .eq("from_code", normalized)
      .eq("to_code", local.selfCode)
      .eq("status", "pending");
  } catch (error) {
    console.warn("[hearthaven invite-bridge] status update failed:", error);
  }
}

/**
 * Subscribe to Realtime so any invite addressed to our friend_code lands in
 * the local inbox the moment the sender hits Send. Also backfills anything
 * we missed while offline. Idempotent — safe to call from a hook mount.
 */
export async function ensureInviteRealtime(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await syncFriendCodeToProfile();
      const local = getSocialState();
      const myCode = local.selfCode;
      if (!myCode) return;

      // 1. Backfill — anything that arrived while we weren't connected.
      const { data: pending } = await supabase
        .from("friend_invites")
        .select("*")
        .eq("to_code", myCode)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(40);
      if (Array.isArray(pending)) {
        for (const row of pending as SupabaseInviteRow[]) {
          acceptInviteFromCode(row.from_code, row.from_display_name, row.message ?? undefined);
        }
      }

      // 2. Live channel — every new row addressed to us drops into the
      //    inbox immediately. The RLS policy on the table means we can only
      //    receive rows where `to_code = our friend_code`, which is also
      //    what the filter restricts on the client side.
      if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
      realtimeChannel = supabase
        .channel(`friend-invites-${myCode}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "friend_invites",
            filter: `to_code=eq.${myCode}`,
          },
          (payload) => {
            const row = payload.new as SupabaseInviteRow;
            if (!row || row.status !== "pending") return;
            acceptInviteFromCode(row.from_code, row.from_display_name, row.message ?? undefined);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "friend_invites",
            filter: `from_code=eq.${myCode}`,
          },
          (payload) => {
            const row = payload.new as SupabaseInviteRow;
            if (!row) return;
            // The recipient acted on one of our outgoing invites — reconcile.
            const state = getSocialState();
            const matching = state.outgoing.find((entry) => entry.toCode === row.to_code && entry.status === "pending");
            if (!matching) return;
            if (row.status === "accepted") {
              // Mirror the acceptance into the local outgoing list so the UI
              // stops nagging about a "pending" invite that was settled.
              cancelOutgoingInvite(matching.id);
            } else if (row.status === "declined" || row.status === "blocked") {
              declineFriendInvite(matching.id);
            }
          },
        )
        .subscribe();
    } catch (error) {
      console.warn("[hearthaven invite-bridge] realtime subscription failed:", error);
    }
  })();
  return bootPromise;
}

export async function teardownInviteRealtime() {
  if (!realtimeChannel) return;
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.removeChannel(realtimeChannel);
  } catch {
    /* channel may already be gone; ignore */
  }
  realtimeChannel = null;
  bootPromise = null;
}
