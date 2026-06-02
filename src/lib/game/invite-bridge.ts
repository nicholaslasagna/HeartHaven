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
  setSelfCode,
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
  from_profile_id: string | null;
  to_profile_id: string | null;
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
 * Keep the browser's friend code aligned with the server profile.
 *
 * The server is canonical after sign-in. A fresh browser has an empty/random
 * local social store, and letting that store overwrite profiles.friend_code
 * breaks every existing invite/link for the account. Only the explicit
 * regenerate path passes `force=true`; normal boot/send adopts the server
 * code when one exists.
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
    const serverCode = normalizeFriendCode(String(profile?.friend_code ?? ""));
    if (!force && serverCode) {
      if (serverCode !== local.selfCode) {
        setSelfCode(serverCode);
      }
      codeSyncDone = true;
      return;
    }
    // Up to 5 collision-retry attempts. With a ~8M code space the
    // birthday-paradox crossover sits around 2,800 users — improbable
    // soon, but a regenerator can hit it any day. Without retry the
    // unique index on `profiles.friend_code` would reject the write
    // and the keeper would be permanently un-routable for invites.
    //
    // We branch on row-exists: if the profile already exists we just
    // UPDATE friend_code (preserves their display_name + username). If
    // it doesn't — e.g. they signed up before migration 0028's
    // handle_new_user trigger existed — we INSERT a fresh row with a
    // seeded display_name. Previously this code only did UPDATE, which
    // silently affected 0 rows and left downstream server-side lookups
    // (ban_keeper, refresh_keeper_names, etc.) coming up empty.
    const profileExists = profile != null;
    const seedDisplayName = (typeof window !== "undefined"
      ? (window.localStorage.getItem("hearthaven:public-username") ?? "").trim()
      : "") || (user.email?.split("@")[0] ?? "Keeper").slice(0, 24);
    let attempt = 0;
    let candidate = local.selfCode;
    while (attempt < 5) {
      const { error } = profileExists
        ? await supabase
            .from("profiles")
            .update({ friend_code: candidate })
            .eq("id", user.id)
        : await supabase
            .from("profiles")
            .insert({ id: user.id, friend_code: candidate, display_name: seedDisplayName });
      if (!error) {
        codeSyncDone = true;
        return;
      }
      const isUniqueViolation =
        error.code === "23505" || /duplicate|unique/i.test(error.message ?? "");
      if (!isUniqueViolation) {
        console.warn("[hearthaven invite-bridge] friend_code sync failed:", error.message);
        return;
      }
      // Collision — pick a fresh code locally and try again.
      const next = generateFreshFriendCode();
      candidate = next;
      setSelfCode(next);
      attempt += 1;
    }
    console.warn("[hearthaven invite-bridge] friend_code sync gave up after 5 collisions");
  } catch (error) {
    console.warn("[hearthaven invite-bridge] friend_code sync failed:", error);
  }
}

function generateFreshFriendCode() {
  // Inline import-style helper — duplicated from social.ts so the bridge
  // doesn't drag the social module's full surface into its own module
  // graph. Same alphabet + same shape.
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const DIGITS = "23456789";
  const pick = (src: string, n: number) =>
    Array.from({ length: n }, () => src.charAt(Math.floor(Math.random() * src.length))).join("");
  return `HH-${pick(ALPHABET, 5)}-${pick(DIGITS, 3)}`;
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
  // Sync on every send, but do not force-overwrite the server code. The
  // server profile is canonical; this call adopts it into local state
  // when the browser started with a generated fallback code.
  await syncFriendCodeToProfile(false);
  const senderCode = normalizeFriendCode(getSocialState().selfCode || invite.fromCode);
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
    const { data: recipientProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("friend_code", invite.toCode)
      .maybeSingle();
    // Guard against runaway re-sends — if the same sender already has a
    // pending invite for the same recipient, don't insert a duplicate.
    const existingQuery = supabase.from("friend_invites").select("id").eq("status", "pending").limit(1);
    const { data: existing } = recipientProfile?.id
      ? await existingQuery.eq("from_profile_id", user.id).eq("to_profile_id", recipientProfile.id).maybeSingle()
      : await existingQuery.eq("from_code", senderCode).eq("to_code", invite.toCode).maybeSingle();
    if (existing?.id) return existing.id;

    const insertPayload = {
        sender_profile_id: user.id,
        from_profile_id: user.id,
        to_profile_id: recipientProfile?.id ?? null,
        from_code: senderCode,
        from_display_name: invite.fromDisplayName,
        to_code: invite.toCode,
        message: invite.message ?? null,
      };

    const { data, error } = await supabase
      .from("friend_invites")
      .insert(insertPayload)
      .select("id")
      .single();
    if (error && /from_profile_id|to_profile_id|schema cache|column/i.test(error.message ?? "")) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("friend_invites")
        .insert({
          sender_profile_id: user.id,
          from_code: senderCode,
          from_display_name: invite.fromDisplayName,
          to_code: invite.toCode,
          message: invite.message ?? null,
        })
        .select("id")
        .single();
      if (!legacyError) return legacyData?.id ?? null;
    }
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
      // CRITICAL: the recipient SELECT policy on `friend_invites` reads
      //   to_code = (select friend_code from public.profiles where id = auth.uid())
      // If `profiles.friend_code` is NULL, the subquery returns NULL and
      // no row ever matches — the recipient never sees any invite.
      // Force the sync (rather than the cached-flag short-circuit) so a
      // fresh signup or a regenerate path always lands a row before we
      // subscribe.
      await syncFriendCodeToProfile(true);
      const local = getSocialState();
      const myCode = local.selfCode;
      if (!myCode) {
        console.warn("[hearthaven invite-bridge] aborting subscribe — local friend code missing");
        bootPromise = null;
        return;
      }
      // Double-check the profile row actually has it. If a 1st-time sync
      // ran into an error (network, RLS), we'd subscribe to a channel
      // that can never produce rows. Bail out so the next
      // ensureInviteRealtime() call retries.
      const { data: profileCheck } = await supabase
        .from("profiles")
        .select("friend_code")
        .eq("id", user.id)
        .maybeSingle();
      if (!profileCheck?.friend_code) {
        console.warn("[hearthaven invite-bridge] profiles.friend_code still null after sync — retry needed");
        bootPromise = null;
        return;
      }
      if (profileCheck.friend_code !== myCode) {
        // Cross-device case: the keeper regenerated their code on another
        // device; the server has the new one. Adopt it locally so the
        // subscription filter matches reality.
        console.info(
          "[hearthaven invite-bridge] adopting server-side friend code",
          profileCheck.friend_code,
          "over local",
          myCode,
        );
      }
      const effectiveCode = profileCheck.friend_code;

      // 1a. Backfill incoming — anything that arrived while we weren't
      //     connected. Block list is applied client-side so a blocked
      //     sender's invites never actually surface in the local inbox,
      //     even if their row hit the table before we blocked them.
      const blockedCodes = new Set(readSafetyState().blocks.map((entry) => entry.code));
      const { data: pending } = await supabase
        .from("friend_invites")
        .select("*")
        .eq("to_code", effectiveCode)
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
        .eq("from_code", effectiveCode)
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
        .channel(`friend-invites-${effectiveCode}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "friend_invites",
            filter: `to_code=eq.${effectiveCode}`,
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
            filter: `from_code=eq.${effectiveCode}`,
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
              if (matching) cancelOutgoingInvite(matching.id);
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
            filter: `to_code=eq.${effectiveCode}`,
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
