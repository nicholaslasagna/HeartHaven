"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSocialState } from "@/lib/game/social";

/**
 * party-bridge — lets a host broadcast "everyone follow me to X" without
 * needing to send fresh invites. The mechanic:
 *
 *   • Each keeper subscribes to a personal realtime channel keyed off
 *     their friend code (`party:HH-XXXXX-NNN`). Friends who want to
 *     "follow" the host stay subscribed to that channel.
 *   • When the host hits "Bring my party to Garden" / "to a game" /
 *     etc., we broadcast a single `party_relocate` event on the host's
 *     channel with the destination path. Followers receive it, see a
 *     toast that says "Host moved to Garden — follow?", and click to
 *     navigate.
 *
 * Why a separate channel from the scene-bound presence channels?
 *   • A friend can be subscribed to your party even while you're in a
 *     different room. The party channel persists across scene changes,
 *     where the scene presence channel does not.
 *   • Keeping the destinations decoupled lets us extend later (e.g.
 *     calling a friend into a private bowling room).
 *
 * Subscription is fire-and-forget. When the friend's tab tears down we
 * remove the channel; on next mount it re-subscribes.
 */

export type PartyRelocateEvent = {
  /** Destination path, e.g. `/app/area?zone=garden` or `/app/bowling`. */
  path: string;
  /** Optional human label like "Casper's garden" used in the follow toast. */
  label?: string;
  /** Host's friend code. Followers ignore events from non-friends. */
  hostCode: string;
  /** Host's public display name at broadcast time. */
  hostDisplayName: string;
  sentAt: number;
};

type FollowerChannelEntry = {
  channel: ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]>;
  hostCode: string;
};

const followerChannels: FollowerChannelEntry[] = [];

function channelName(hostCode: string) {
  return `party:${hostCode.toUpperCase()}`;
}

function pathWithHostVisit(path: string, hostCode: string) {
  if (!path.startsWith("/app/")) return path;
  try {
    const url = new URL(path, window.location.origin);
    const isWorldPlace =
      url.pathname === "/app/area" ||
      url.pathname === "/app/room" ||
      url.pathname === "/app/garden" ||
      url.pathname === "/app/park" ||
      url.pathname === "/app/partner-garden";
    if (isWorldPlace && !url.searchParams.get("visit")) {
      url.searchParams.set("visit", hostCode);
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return path;
  }
}

/**
 * Host action — broadcast a follow-me event to anyone subscribed to our
 * party channel. The host can opt in to being "followable" any time;
 * receiving is gated on the friend explicitly subscribing first.
 */
export async function broadcastPartyRelocate(input: { path: string; label?: string }): Promise<{ ok: boolean }> {
  if (!isSupabaseConfigured()) return { ok: false };
  if (typeof window === "undefined") return { ok: false };
  try {
    const supabase = getSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const social = getSocialState();
    if (!social.selfCode) return { ok: false };
    const channel = supabase.channel(channelName(social.selfCode));
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });
    const payload: PartyRelocateEvent = {
      path: pathWithHostVisit(input.path, social.selfCode),
      label: input.label,
      hostCode: social.selfCode,
      hostDisplayName: social.selfDisplayName || "Keeper",
      sentAt: Date.now(),
    };
    await channel.send({ type: "broadcast", event: "party_relocate", payload });
    // Tear the host's transient channel back down — we only needed it
    // long enough to push the message.
    await supabase.removeChannel(channel);
    return { ok: true };
  } catch (error) {
    console.warn("[hearthaven party-bridge] broadcast failed:", error);
    return { ok: false };
  }
}

/**
 * Follower mount — subscribe to a friend's party channel. Adds a window
 * event dispatcher so any UI can render the follow toast / banner.
 * Returns an unsubscribe function the caller cleans up on unmount.
 */
export function subscribeToHostParty(hostCode: string): () => void {
  if (!isSupabaseConfigured()) return () => {};
  if (typeof window === "undefined") return () => {};
  if (!hostCode) return () => {};
  // Already subscribed? Idempotent.
  const existing = followerChannels.find((entry) => entry.hostCode === hostCode);
  if (existing) return () => unsubscribeFromHostParty(hostCode);
  try {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(channelName(hostCode));
    channel.on("broadcast", { event: "party_relocate" }, ({ payload }) => {
      const event = payload as PartyRelocateEvent;
      if (!event?.path || !event?.hostCode) return;
      window.dispatchEvent(
        new CustomEvent("hearthaven:party-follow-prompt", { detail: event }),
      );
    });
    channel.subscribe();
    followerChannels.push({ channel, hostCode });
  } catch (error) {
    console.warn("[hearthaven party-bridge] subscribe failed:", error);
  }
  return () => unsubscribeFromHostParty(hostCode);
}

export function unsubscribeFromHostParty(hostCode: string) {
  const index = followerChannels.findIndex((entry) => entry.hostCode === hostCode);
  if (index === -1) return;
  const entry = followerChannels[index];
  followerChannels.splice(index, 1);
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseBrowserClient();
    void supabase.removeChannel(entry.channel);
  } catch {
    /* channel may already be gone */
  }
}

/**
 * Re-sync the follower channels to match the local keeper's CURRENT
 * friend list. Called whenever the social state changes (friend added /
 * removed) so newly-added friends start receiving party events and
 * removed friends stop being tracked.
 */
export function syncFollowerChannelsWithFriends(): void {
  if (!isSupabaseConfigured()) return;
  if (typeof window === "undefined") return;
  const friends = getSocialState().friends.map((entry) => entry.code);
  const friendSet = new Set(friends);
  // Drop channels for keepers no longer in our friend list.
  for (const entry of [...followerChannels]) {
    if (!friendSet.has(entry.hostCode)) {
      unsubscribeFromHostParty(entry.hostCode);
    }
  }
  // Add channels for friends we're not yet subscribed to.
  for (const code of friends) {
    if (!followerChannels.some((entry) => entry.hostCode === code)) {
      subscribeToHostParty(code);
    }
  }
}
