"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { normalizeFriendCode } from "@/lib/game/social";

export type PlaceInviteType = "room" | "garden" | "park" | "party" | "game";

export type PlaceInvite = {
  id: string;
  inviteType: PlaceInviteType;
  targetUrl: string;
  targetSessionId: string | null;
  hostFriendCode: string | null;
  gardenId: string | null;
  roomId: string | null;
  inviterFriendCode: string;
  inviterDisplayName: string;
  expiresAt: string;
  createdAt: string;
};

type PlaceInviteRow = {
  id?: string;
  invite_type?: string;
  target_url?: string;
  target_session_id?: string | null;
  host_friend_code?: string | null;
  garden_id?: string | null;
  room_id?: string | null;
  inviter_friend_code?: string | null;
  inviter_display_name?: string | null;
  expires_at?: string;
  created_at?: string;
};

export type SendPlaceInviteInput = {
  friendCode: string;
  inviteType: PlaceInviteType;
  targetUrl: string;
  targetSessionId?: string | null;
  gardenId?: string | null;
  roomId?: string | null;
};

export type SendPlaceInviteResult =
  | { ok: true; inviteId: string }
  | { ok: false; reason: string };

export type RespondPlaceInviteResult =
  | { ok: true; status: "accepted" | "declined"; targetUrl: string | null }
  | { ok: false; reason: string };

export function toPlaceTargetPath(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "/app/area";
  try {
    const parsed = new URL(trimmed, typeof window === "undefined" ? "https://realfiction.store" : window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return trimmed.startsWith("/app/") ? trimmed : "/app/area";
  }
}

function mapPlaceInviteRow(row: PlaceInviteRow): PlaceInvite | null {
  if (!row.id || !row.target_url || !row.invite_type) return null;
  const inviteType = row.invite_type as PlaceInviteType;
  if (!["room", "garden", "park", "party", "game"].includes(inviteType)) return null;
  return {
    id: row.id,
    inviteType,
    targetUrl: row.target_url,
    targetSessionId: row.target_session_id ?? null,
    hostFriendCode: row.host_friend_code ?? null,
    gardenId: row.garden_id ?? null,
    roomId: row.room_id ?? null,
    inviterFriendCode: row.inviter_friend_code ?? "HH-XXXXX-XXX",
    inviterDisplayName: row.inviter_display_name ?? "Keeper",
    expiresAt: row.expires_at ?? new Date(Date.now() + 15 * 60_000).toISOString(),
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export async function sendPlaceInviteToFriend(input: SendPlaceInviteInput): Promise<SendPlaceInviteResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: "Online invites are not configured." };

  const friendCode = normalizeFriendCode(input.friendCode);
  const targetUrl = toPlaceTargetPath(input.targetUrl);
  if (!friendCode) return { ok: false, reason: "Friend code is missing." };
  if (!targetUrl.startsWith("/app/")) return { ok: false, reason: "Invite target is invalid." };

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc("invite_friend_to_current_place", {
      p_friend_code: friendCode,
      p_invite_type: input.inviteType,
      p_target_url: targetUrl,
      p_target_session_id: input.targetSessionId ?? null,
      p_garden_id: input.gardenId ?? null,
      p_room_id: input.roomId ?? null,
    });

    if (error) return { ok: false, reason: error.message };
    const row = Array.isArray(data) ? data[0] : null;
    const inviteId = typeof row?.id === "string" ? row.id : "";
    if (!inviteId) return { ok: false, reason: "Invite was not created." };
    return { ok: true, inviteId };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Could not send invite." };
  }
}

export function usePlaceInvites() {
  const [invites, setInvites] = useState<PlaceInvite[]>([]);
  const [loading, setLoading] = useState(() => isSupabaseConfigured());
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setInvites([]);
      setLoading(false);
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: rpcError } = await supabase.rpc("get_my_pending_place_invites");
      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return;
      }
      const mapped = Array.isArray(data)
        ? data.map((row) => mapPlaceInviteRow(row as PlaceInviteRow)).filter((row): row is PlaceInvite => Boolean(row))
        : [];
      setInvites(mapped);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load invites.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    let cancelled = false;

    async function subscribe() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setLoading(false);
        return;
      }
      await refresh();
      if (cancelled) return;

      const channel = supabase
        .channel(`current-place-invites:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "current_place_invites",
            filter: `recipient_id=eq.${user.id}`,
          },
          () => {
            void refresh();
          },
        )
        .subscribe();
      channelRef.current = channel;
    }

    void subscribe();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void getSupabaseBrowserClient().removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [refresh]);

  const respond = useCallback(async (inviteId: string, response: "accepted" | "declined"): Promise<RespondPlaceInviteResult> => {
    if (!isSupabaseConfigured()) return { ok: false, reason: "Online invites are not configured." };
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: rpcError } = await supabase.rpc("respond_to_place_invite", {
        p_invite_id: inviteId,
        p_response: response,
      });
      if (rpcError) return { ok: false, reason: rpcError.message };
      const row = Array.isArray(data) ? data[0] : null;
      if (!row?.ok) {
        return { ok: false, reason: typeof row?.message === "string" ? row.message : "Invite could not be updated." };
      }
      setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      return {
        ok: true,
        status: response,
        targetUrl: typeof row.target_url === "string" ? row.target_url : null,
      };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Could not update invite." };
    }
  }, []);

  return useMemo(
    () => ({
      error,
      invites,
      loading,
      refresh,
      respond,
    }),
    [error, invites, loading, refresh, respond],
  );
}
