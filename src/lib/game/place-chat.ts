"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type PlaceChatType = "room" | "garden" | "park" | "partner-garden";

/**
 * Chat is never stored.
 *
 * Messages travel over the place's Realtime broadcast channel and exist only
 * in the clients that were present to hear them. Nothing is written down, so
 * there is no history for a later arrival to read, no table for a spammer to
 * fill, and nothing at rest to leak.
 *
 * What still goes through the server is permission. Before broadcasting, a
 * client asks whether this keeper may speak here right now — which enforces
 * the mute and the flood guard, and returns the identity to show beside the
 * message so a name comes from the profile rather than from whatever the
 * sending client typed.
 */
export type PlaceChatAuthorization = {
  senderFriendCode: string;
  senderDisplayName: string;
};

/**
 * Ask whether this keeper may speak in this place.
 *
 * Throws with the server's reason when they may not — muted, sending too
 * fast, or not welcome in this place — so the caller can show it. Returns
 * null when Supabase is not configured, which is the offline/demo path where
 * chat is purely local anyway.
 */
export async function authorizePlaceChat(input: {
  placeType: PlaceChatType;
  hostFriendCode: string;
  placeId: string;
}): Promise<PlaceChatAuthorization | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("authorize_place_chat", {
    p_place_type: input.placeType,
    p_host_friend_code: input.hostFriendCode,
    p_place_id: input.placeId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { sender_friend_code?: string; sender_display_name?: string }
    | null;
  if (!row?.sender_friend_code) return null;
  return {
    senderFriendCode: row.sender_friend_code,
    senderDisplayName: row.sender_display_name ?? "Keeper",
  };
}
