"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { GardenChatMessage } from "@/lib/game/chat-moderation";

export type PlaceChatType = "room" | "garden" | "park" | "partner-garden";

type PlaceChatRow = {
  id?: string;
  place_type?: string;
  place_id?: string;
  host_friend_code?: string;
  sender_friend_code?: string;
  sender_display_name?: string;
  body?: string;
  created_at?: string;
};

function mapRow(row: PlaceChatRow): GardenChatMessage | null {
  if (!row.id || !row.body) return null;
  return {
    id: row.id,
    playerId: row.sender_friend_code ?? row.id,
    displayName: row.sender_display_name ?? "Keeper",
    friendCode: row.sender_friend_code ?? undefined,
    roomId: row.place_type === "room" ? row.place_id : undefined,
    text: row.body,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
  };
}

export async function sendPlaceChatMessage(input: {
  placeType: PlaceChatType;
  hostFriendCode: string;
  placeId: string;
  body: string;
}): Promise<GardenChatMessage | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("send_place_chat_message", {
    p_place_type: input.placeType,
    p_host_friend_code: input.hostFriendCode,
    p_place_id: input.placeId,
    p_body: input.body,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? mapRow(row as PlaceChatRow) : null;
}

/**
 * Clear a place's stored chat.
 *
 * Called as a keeper joins, so nobody reads back a conversation they were not
 * part of and the table cannot grow without bound. Chat is delivered live
 * over a broadcast channel and the stored rows are only ever used to backfill
 * a joiner, so this takes nothing away from anyone already in the room —
 * their conversation is already on their screen.
 *
 * Never throws: failing to clear must not stop somebody entering a place.
 * Privacy does not rest on this call succeeding, because the client no longer
 * asks for history at all.
 */
export async function clearPlaceChat(input: {
  placeType: PlaceChatType;
  hostFriendCode: string;
  placeId: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.rpc("clear_place_chat", {
      p_host_friend_code: input.hostFriendCode,
      p_place_type: input.placeType,
      p_place_id: input.placeId,
    });
  } catch {
    /* A place that could not be cleared simply keeps rows nobody reads. */
  }
}
