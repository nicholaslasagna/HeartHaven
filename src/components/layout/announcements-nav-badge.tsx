"use client";

import { useEffect, useState } from "react";
import {
  ANNOUNCEMENTS_EVENT,
  fetchAnnouncements,
  getUnseenCount,
} from "@/lib/game/announcements-store";

/**
 * Tiny badge that hangs off the "Announcements" nav entry showing how
 * many unseen items are waiting. Reads from the local store + auto-
 * refreshes on the announcements event.
 */
export function AnnouncementsNavBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    function sync() {
      setCount(getUnseenCount());
    }
    sync();
    void fetchAnnouncements().then(sync);
    window.addEventListener(ANNOUNCEMENTS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ANNOUNCEMENTS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unseen announcement${count === 1 ? "" : "s"}`}
      className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-blush-500 px-1.5 py-0.5 text-[10px] font-black text-white shadow-sm"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
