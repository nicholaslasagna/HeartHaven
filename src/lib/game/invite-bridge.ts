"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  acceptInviteFromCode,
  addFriendDirectly,
  cancelOutgoingInvite,
  declineFriendInvite,
  getSocialState,
  normalizeFriendCode,
  type FriendCode,
  type FriendInvite,
} from "@/lib/game/social";
import { readSafetyState } from "@/lib/game/safety";
import { getCachedPublicUsername } from "@/lib/game/public-identity";

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
  /** Filled when the recipient responds — used to add them to the sender's
   *  friend list automatically on accept. */
  responder_code: string | null;
  responder_display_name: string | null;
};

let codeSyncDone = false;
let realtimeChannel: ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]> | null = null;
let bootPromise: Promise<void> | null = null;
let friendCodeRegenListener: ((event: Event) => void) | null = null;

/**
 * Sync the local keeper's friend code onto `profiles.friend_code` so Postgres
 * can resolve "who is HH-XXXXX-NNN" for invite delivery. Idempotent in the
 * common case (the `codeSyncDone` flag short-circuits), but supports a
 * `force` flag for the regenerate path which needs to overwrite the cached
 * old code on the profile row.
 */
async function syncFriendCodeToProfile(force = false) {
  if (codeSyncDone && !force) return;
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
    if (!force && profile?.friend_code === local.selfCode) {
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
 * Tear down the existing realtime channel and rebuild it against the new
 * friend code. Invoked when the keeper regenerates their friend code on
 * the Account page — without this, realtime continues to filter on the
 * old code and inbound invites silently never arrive.
 */
async function handleFriendCodeRegenerated() {
  codeSyncDone = false;
  await syncFriendCodeToProfile(true);
  await teardownInviteRealtime();
  await ensureInviteRealtime();
}

/**
 * Mirror an outgoing invite into `friend_invites`. The recipient's Realtime
 * subscription will pick it up and route it into their inbox. Returns the
 * inserted row id (or null in local-only mode / on failure).
 */
export async function pushInviteToSupabase(invite: FriendInvite): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  await syncFriendCodeToProfile();
  // Sender-side block check — blocking someone means we never want to
  // pester them with another invite. The check is on the SENDER so the
  // server insert is skipped entirely rather than racing the recipient's
  // realtime subscription.
  const blocked = readSafetyState().blocks.some((entry) => entry.code === invite.toCode);
  if (blocked) {
    console.warn("[hearthaven invite-bridge] not sending — recipient is blocked");
    return null;
  }
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    // Guard against runaway re-sends — if the same sender already has a
    // pending invite for the same recipient, don't insert a duplicate.
    const { data: existing } = await supabase
      .from("friend_invites")
      .select("id")
      .eq("from_code", invite.fromCode)
      .eq("to_code", invite.toCode)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();
    if (existing?.id) return existing.id;
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
 * The sender's Realtime subscription will update their outgoing list — and
 * on `accepted`, will also add the responder to the sender's friend list
 * thanks to the `responder_code` + `responder_display_name` columns.
 */
export async function setSupabaseInviteStatus(
  fromCode: FriendCode,
  status: "accepted" | "declined" | "blocked" | "cancelled",
) {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const local = getSocialState();
    const normalized = normalizeFriendCode(fromCode);
    const update: Record<string, unknown> = {
      status,
      responded_at: new Date().toISOString(),
      responder_code: local.selfCode,
      responder_display_name: getCachedPublicUsername(),
    };
    await supabase
      .from("friend_invites")
      .update(update)
      .eq("from_code", normalized)
      .eq("to_code", local.selfCode)
      .eq("status", "pending");
  } catch (error) {
    console.warn("[hearthaven invite-bridge] status update failed:", error);
  }
}

/**
 * Mark our own pending outgoing invite as `cancelled` on the server. The
 * recipient's realtime subscription will see the UPDATE and (via the new
 * UPDATE handler below) wipe the row out of their local inbox so they
 * can't accept an invite the sender has already pulled back.
 */
export async function cancelSupabaseOutgoingInvite(toCode: FriendCode) {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const local = getSocialState();
    await supabase
      .from("friend_invites")
      .update({ status: "cancelled", responded_at: new Date().toISOString() })
      .eq("sender_profile_id", user.id)
      .eq("from_code", local.selfCode)
      .eq("to_code", normalizeFriendCode(toCode))
      .eq("status", "pending");
  } catch (error) {
    console.warn("[hearthaven invite-bridge] cancel failed:", error);
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
  // One-time listener so a friend-code regenerate from the Account page
  // tears down + rebuilds the subscription on the new code.
  if (!friendCodeRegenListener && typeof window !== "undefined") {
    friendCodeRegenListener = () => void handleFriendCodeRegenerated();
    window.addEventListener("hearthaven:friend-code-regenerated", friendCodeRegenListener);
  }
  bootPromise = (async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await syncFriendCodeToProfile();
      const local = getSocialState();
      const myCode = local.selfCode;
      if (!myCode) return;

      // 1a. Backfill incoming — anything that arrived while we weren't
      //     connected. Block list is applied client-side so a blocked
      //     sender's invites never actually surface in the local inbox,
      //     even if their row hit the table before we blocked them.
      const blockedCodes = new Set(readSafetyState().blocks.map((entry) => entry.code));
      const { data: pending } = await supabase
        .from("friend_invites")
        .select("*")
        .eq("to_code", myCode)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(40);
      if (Array.isArray(pending)) {
        for (const row of pending as SupabaseInviteRow[]) {
          if (blockedCodes.has(row.from_code)) continue;
          acceptInviteFromCode(row.from_code, row.from_display_name, row.message ?? undefined);
        }
      }
      // 1b. Backfill outgoing — any invite WE sent that the recipient
      //     accepted while we were offline. The realtime UPDATE channel
      //     only fires live, so without this the sender's friend list
      //     would silently miss acceptances that happened mid-disconnect.
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: accepted } = await supabase
        .from("friend_invites")
        .select("*")
        .eq("from_code", myCode)
        .eq("status", "accepted")
        .gte("responded_at", since)
        .order("responded_at", { ascending: false })
        .limit(40);
      if (Array.isArray(accepted)) {
        const localOutgoing = getSocialState().outgoing;
        for (const row of accepted as SupabaseInviteRow[]) {
          const code = row.responder_code ?? row.to_code;
          const displayName = row.responder_display_name ?? "Keeper";
          addFriendDirectly({ code, displayName });
          // Clean up any local outgoing record still marked pending so the
          // UI doesn't leave a stale "waiting on" row sitting around.
          const stale = localOutgoing.find((entry) => entry.toCode === row.to_code && entry.status === "pending");
          if (stale) cancelOutgoingInvite(stale.id);
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
            // Re-read the block list each event so unblocking takes effect
            // without a full page reload.
            const blocks = new Set(readSafetyState().blocks.map((entry) => entry.code));
            if (blocks.has(row.from_code)) return;
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
            if (row.status === "accepted") {
              if (matching) cancelOutgoingInvite(matching.id);
              // Add the responder to our friend list so a successful accept
              // shows up immediately on the sender's screen too. We do this
              // EVEN IF the local outgoing record is missing (e.g. it was
              // pruned by the 30-day backfill) — the server's accept is
              // authoritative, and the friend should still appear.
              const code = row.responder_code ?? row.to_code;
              const displayName = row.responder_display_name ?? "Keeper";
              addFriendDirectly({ code, displayName });
            } else if (row.status === "declined" || row.status === "blocked") {
              if (matching) declineFriendInvite(matching.id);
            } else if (row.status === "cancelled") {
              // Our own cancel echoed back — local record already in the
              // cancelled state, so nothing to do here. Including the
              // branch keeps the if/else exhaustive for future readers.
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "friend_invites",
            filter: `to_code=eq.${myCode}`,
          },
          (payload) => {
            // Incoming-side UPDATE — currently only used to handle SENDER
            // cancellations. If a sender pulls back an invite we already
            // dropped into our inbox, mark the inbox entry as declined so
            // we can't accidentally accept a cancelled invite.
            const row = payload.new as SupabaseInviteRow;
            if (!row || row.status !== "cancelled") return;
            const state = getSocialState();
            const pending = state.inbox.find(
              (entry) => entry.fromCode === row.from_code && entry.status === "pending",
            );
            if (pending) declineFriendInvite(pending.id);
          },
        )
        .subscribe();
    } catch (error) {
      console.warn("[hearthaven invite-bridge] realtime subscription failed:", error);
      // Clear the bootPromise on failure so subsequent calls can retry.
      // Previously a single failed boot stuck `bootPromise` to a resolved
      // promise that did nothing, blocking every retry until full reload.
      bootPromise = null;
      throw error;
    }
  })().catch(() => {
    /* swallow — error was already logged + bootPromise cleared above */
  });
  return bootPromise;
}

export async function teardownInviteRealtime() {
  if (realtimeChannel) {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.removeChannel(realtimeChannel);
    } catch {
      /* channel may already be gone; ignore */
    }
  }
  realtimeChannel = null;
  bootPromise = null;
  // Remove the regenerate listener too so a stale closure doesn't keep a
  // dead callback around after the page unmounts.
  if (friendCodeRegenListener && typeof window !== "undefined") {
    window.removeEventListener("hearthaven:friend-code-regenerated", friendCodeRegenListener);
    friendCodeRegenListener = null;
  }
}
