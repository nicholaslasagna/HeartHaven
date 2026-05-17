"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ANNOUNCEMENTS_EVENT,
  type Announcement,
  claimAnnouncement,
  fetchAnnouncements,
  getCachedAnnouncements,
  getClaimedAnnouncementIds,
  getSeenAnnouncementIds,
  getUnseenCount,
  markAllAnnouncementsSeen,
  markAnnouncementSeen,
} from "@/lib/game/announcements-store";

export type AnnouncementRow = Announcement & {
  seen: boolean;
  claimed: boolean;
  hasReward: boolean;
};

/**
 * React-bound view of the developer announcements list. Refreshes on mount
 * (one network round-trip) and re-emits whenever a local seen/claim event
 * fires. Components consume `rows` for the list + `unseenCount` for the
 * nav badge.
 */
export function useAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>(getCachedAnnouncements);
  const [seenIds, setSeenIds] = useState<Set<string>>(getSeenAnnouncementIds);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(getClaimedAnnouncementIds);
  const [unseenCount, setUnseenCount] = useState(getUnseenCount);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchAnnouncements().then(() => {
      if (cancelled) return;
      setAnnouncements(getCachedAnnouncements());
      setLoading(false);
    });
    const sync = () => {
      setAnnouncements(getCachedAnnouncements());
      setSeenIds(getSeenAnnouncementIds());
      setClaimedIds(getClaimedAnnouncementIds());
      setUnseenCount(getUnseenCount());
    };
    window.addEventListener(ANNOUNCEMENTS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      cancelled = true;
      window.removeEventListener(ANNOUNCEMENTS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const rows: AnnouncementRow[] = useMemo(
    () =>
      announcements.map((announcement) => ({
        ...announcement,
        seen: seenIds.has(announcement.id),
        claimed: claimedIds.has(announcement.id),
        hasReward:
          announcement.rewardCoins > 0 ||
          announcement.rewardHearts > 0 ||
          Boolean(announcement.rewardCatalogItemId),
      })),
    [announcements, seenIds, claimedIds],
  );

  const claim = useCallback((id: string) => claimAnnouncement(id), []);
  const markSeen = useCallback((id: string) => markAnnouncementSeen(id), []);
  const markAllSeen = useCallback(() => markAllAnnouncementsSeen(), []);
  const refresh = useCallback(() => fetchAnnouncements(), []);

  return {
    rows,
    loading,
    unseenCount,
    claim,
    markSeen,
    markAllSeen,
    refresh,
  };
}
