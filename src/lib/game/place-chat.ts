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

export async function getPlaceChatMessages(input: {
  placeType: PlaceChatType;
  hostFriendCode: string;
  placeId: string;
  limit?: number;
}): Promise<GardenChatMessage[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_place_chat_messages", {
    p_place_type: input.placeType,
    p_host_friend_code: input.hostFriendCode,
    p_place_id: input.placeId,
    p_limit: input.limit ?? 30,
  });
  if (error) throw error;
  return Array.isArray(data)
    ? data.map((row) => mapRow(row as PlaceChatRow)).filter((row): row is GardenChatMessage => Boolean(row))
    : [];
}
