"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  isMultiplayerDiagnosticsEnabled,
  MULTIPLAYER_DIAGNOSTIC_EVENT,
  type MultiplayerRpcDiagnostic,
} from "@/lib/game/multiplayer-diagnostics";
import {
  ROOM_REALTIME_DIAGNOSTIC_EVENT,
  type RoomRealtimeDiagnostic,
} from "@/lib/game/room-realtime-diagnostics";
import { PLACE_INVITES_REFRESHED_EVENT } from "@/lib/game/place-invites";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";

type DiagnosticSnapshot = {
  authUserId: string | null;
  friendCode: string | null;
  latestInviteId: string | null;
  latestInviteTargetUrl: string | null;
  latestInviteType: string | null;
  pendingInvitesCount: number | null;
  profileId: string | null;
  sessionPlayersCount: number | null;
  supabaseHost: string | null;
  username: string | null;
};

function supabaseHostFromUrl(url?: string) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

export function MultiplayerDiagnosticsPanel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const enabled = isMultiplayerDiagnosticsEnabled();
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>({
    authUserId: null,
    friendCode: null,
    latestInviteId: null,
    latestInviteTargetUrl: null,
    latestInviteType: null,
    pendingInvitesCount: null,
    profileId: null,
    sessionPlayersCount: null,
    supabaseHost: supabaseHostFromUrl(getSupabaseConfig().url),
    username: null,
  });
  const [lastRpc, setLastRpc] = useState<MultiplayerRpcDiagnostic | null>(null);
  const [roomRealtime, setRoomRealtime] = useState<RoomRealtimeDiagnostic | null>(null);

  const routeValues = useMemo(() => {
    const sessionId = searchParams.get("session");
    return {
      hostCode: searchParams.get("visit") ?? searchParams.get("join") ?? searchParams.get("invite"),
      route: paramsKey ? `${pathname}?${paramsKey}` : pathname,
      sessionId,
      zone: searchParams.get("zone"),
    };
  }, [paramsKey, pathname, searchParams]);

  useEffect(() => {
    if (!enabled) return;
    const onRpc = (event: Event) => {
      setLastRpc((event as CustomEvent<MultiplayerRpcDiagnostic>).detail);
    };
    const onInvites = (event: Event) => {
      const detail = (event as CustomEvent<{
        count?: number;
        latestInviteId?: string | null;
        latestInviteType?: string | null;
        latestTargetUrl?: string | null;
      }>).detail;
      setSnapshot((current) => ({
        ...current,
        latestInviteId: detail?.latestInviteId ?? null,
        latestInviteTargetUrl: detail?.latestTargetUrl ?? null,
        latestInviteType: detail?.latestInviteType ?? null,
        pendingInvitesCount: typeof detail?.count === "number" ? detail.count : current.pendingInvitesCount,
      }));
    };
    const onRoomRealtime = (event: Event) => {
      const detail = (event as CustomEvent<RoomRealtimeDiagnostic>).detail;
      setRoomRealtime((current) => ({ ...current, ...detail }));
    };
    window.addEventListener(MULTIPLAYER_DIAGNOSTIC_EVENT, onRpc);
    window.addEventListener(PLACE_INVITES_REFRESHED_EVENT, onInvites);
    window.addEventListener(ROOM_REALTIME_DIAGNOSTIC_EVENT, onRoomRealtime);
    return () => {
      window.removeEventListener(MULTIPLAYER_DIAGNOSTIC_EVENT, onRpc);
      window.removeEventListener(PLACE_INVITES_REFRESHED_EVENT, onInvites);
      window.removeEventListener(ROOM_REALTIME_DIAGNOSTIC_EVENT, onRoomRealtime);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured()) return;
    let cancelled = false;

    async function refresh() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let profile: { friend_code: string | null; id: string; username: string | null } | null = null;
      let pendingInvitesCount: number | null = null;
      let sessionPlayersCount: number | null = null;

      if (user?.id) {
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("id, username, friend_code")
          .eq("id", user.id)
          .maybeSingle();
        profile = profileRow;

        const { data: invites } = await supabase.rpc("get_my_pending_place_invites");
        pendingInvitesCount = Array.isArray(invites) ? invites.length : null;

        if (routeValues.sessionId) {
          const { data: sessionRows } = await supabase.rpc("get_game_session_state", {
            p_session_id: routeValues.sessionId,
          });
          const row = Array.isArray(sessionRows) ? sessionRows[0] : null;
          sessionPlayersCount = Array.isArray(row?.seats) ? row.seats.length : null;
        }
      }

      if (!cancelled) {
        setSnapshot((current) => ({
          authUserId: user?.id ?? null,
          friendCode: profile?.friend_code ?? null,
          latestInviteId: current.latestInviteId,
          latestInviteTargetUrl: current.latestInviteTargetUrl,
          latestInviteType: current.latestInviteType,
          pendingInvitesCount,
          profileId: profile?.id ?? null,
          sessionPlayersCount,
          supabaseHost: supabaseHostFromUrl(getSupabaseConfig().url),
          username: profile?.username ?? null,
        }));
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, routeValues.sessionId]);

  if (!enabled) return null;

  return (
    <aside className="fixed bottom-4 left-4 z-[160] max-h-[70vh] w-[min(380px,calc(100vw-2rem))] overflow-auto rounded-lg border border-lavender-300 bg-white/95 p-3 text-xs font-bold text-ink-800 shadow-2xl">
      <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-lavender-600">Multiplayer diagnostics</p>
      <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt>Supabase</dt><dd className="truncate font-mono">{snapshot.supabaseHost ?? "not configured"}</dd>
        <dt>Auth user</dt><dd className="truncate font-mono">{snapshot.authUserId ?? "none"}</dd>
        <dt>Profile</dt><dd className="truncate font-mono">{snapshot.profileId ?? "none"}</dd>
        <dt>Username</dt><dd className="truncate">{snapshot.username ?? "none"}</dd>
        <dt>Friend code</dt><dd className="truncate font-mono">{snapshot.friendCode ?? "none"}</dd>
        <dt>Route</dt><dd className="truncate font-mono">{routeValues.route}</dd>
        <dt>Host/join code</dt><dd className="truncate font-mono">{routeValues.hostCode ?? "none"}</dd>
        <dt>Session</dt><dd className="truncate font-mono">{routeValues.sessionId ?? "none"}</dd>
        <dt>Zone</dt><dd className="truncate">{routeValues.zone ?? "none"}</dd>
        <dt>Pending invites</dt><dd>{snapshot.pendingInvitesCount ?? "unknown"}</dd>
        <dt>Latest invite</dt><dd className="truncate font-mono">{snapshot.latestInviteId ?? "none"}</dd>
        <dt>Invite type</dt><dd className="truncate">{snapshot.latestInviteType ?? "none"}</dd>
        <dt>Invite target</dt><dd className="truncate font-mono">{snapshot.latestInviteTargetUrl ?? "none"}</dd>
        <dt>Session players</dt><dd>{snapshot.sessionPlayersCount ?? "unknown"}</dd>
        <dt>Room channel</dt><dd className="truncate font-mono">{roomRealtime?.roomChannelName ?? "none"}</dd>
        <dt>Room host code</dt><dd className="truncate font-mono">{roomRealtime?.resolvedRoomHostCode ?? "none"}</dd>
        <dt>Room status</dt><dd className="truncate">{roomRealtime?.roomConnectionState ?? "unknown"}</dd>
        <dt>Presence count</dt><dd>{roomRealtime?.presenceCount ?? "unknown"}</dd>
        <dt>Remote players</dt><dd>{roomRealtime?.remotePlayerCount ?? "unknown"}</dd>
        <dt>Remote pets</dt><dd>{roomRealtime?.remoteCompanionCount ?? "unknown"}</dd>
        <dt>Room version</dt><dd>{roomRealtime?.roomPlacementVersion ?? "unknown"}</dd>
        <dt>Placement recv</dt><dd className="truncate font-mono">{roomRealtime?.lastPlacementBroadcastAt ?? "none"}</dd>
        <dt>Placement poll</dt><dd className="truncate font-mono">{roomRealtime?.lastPlacementPollAt ?? "none"}</dd>
        <dt>Placement canvas</dt><dd className="truncate font-mono">{roomRealtime?.lastPlacementAppliedAt ?? "none"}</dd>
        <dt>Room error</dt><dd className="truncate text-blush-700">{roomRealtime?.lastRealtimeError ?? "none"}</dd>
        <dt>Last RPC</dt><dd className="truncate">{lastRpc ? `${lastRpc.name} ${lastRpc.ok ? "ok" : "failed"}` : "none"}</dd>
        <dt>Last error</dt><dd className="truncate text-blush-700">{lastRpc?.error ?? "none"}</dd>
      </dl>
    </aside>
  );
}
