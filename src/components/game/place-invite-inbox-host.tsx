"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, DoorOpen, Users, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { usePlaceInvites, type PlaceInvite } from "@/lib/game/place-invites";
import { recordMultiplayerRpc } from "@/lib/game/multiplayer-diagnostics";
import { cn } from "@/lib/utils";

function inviteTitle(invite: PlaceInvite) {
  if (invite.inviteType === "room") return "Room invite";
  if (invite.inviteType === "garden") return "Garden invite";
  if (invite.inviteType === "park") return "Park invite";
  if (invite.inviteType === "party") return "Party lobby invite";
  return "Game invite";
}

function inviteTarget(invite: PlaceInvite) {
  if (invite.roomId) return invite.roomId.replaceAll("-", " ");
  if (invite.gardenId) return invite.gardenId.replaceAll("-", " ");
  return invite.targetUrl.split("?")[0].replace("/app/", "").replaceAll("-", " ");
}

export function PlaceInviteInboxHost() {
  const router = useRouter();
  const { invites, respond } = usePlaceInvites();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invites.length === 0) return null;

  async function act(invite: PlaceInvite, response: "accepted" | "declined") {
    setBusyId(invite.id);
    setError(null);
    const result = await respond(invite.id, response);
    setBusyId(null);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    if (response === "accepted") {
      if (!result.targetUrl) {
        const message = "Invite accepted, but the destination is missing.";
        recordMultiplayerRpc("place_invite_accept.navigate", message);
        setError(message);
        return;
      }
      recordMultiplayerRpc("place_invite_accept.navigate");
      router.push(result.targetUrl, { scroll: false });
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[140] flex w-[min(390px,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence>
        {invites.slice(0, 3).map((invite) => (
          <motion.div
            animate={{ opacity: 1, x: 0, y: 0 }}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-lavender-300/60 bg-cream-50 p-4 shadow-[0_18px_44px_-22px_rgba(91,63,63,0.45)]"
            exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
            initial={{ opacity: 0, x: 24, y: 6 }}
            key={invite.id}
            role="status"
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-lavender-100">
              {invite.inviteType === "party" ? (
                <Users className="size-5 text-lavender-500" aria-hidden />
              ) : (
                <DoorOpen className="size-5 text-lavender-500" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">
                @{invite.inviterDisplayName} invited you
              </p>
              <p className="mt-1 text-sm font-bold leading-5 text-ink-800">
                Join {inviteTarget(invite)}?
              </p>
              <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-ink-500">
                <Clock className="size-3" /> {inviteTitle(invite)} expires soon
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full bg-blush-500 px-3 py-1.5 text-xs font-extrabold text-cream-50 shadow-sm transition hover:-translate-y-0.5 hover:bg-blush-300 disabled:opacity-65",
                    busyId === invite.id && "opacity-70",
                  )}
                  disabled={busyId === invite.id}
                  onClick={() => void act(invite, "accepted")}
                  type="button"
                >
                  Accept <ArrowRight className="size-3.5" />
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-white/80 px-3 py-1.5 text-xs font-extrabold text-ink-600 transition hover:bg-cream-200 disabled:opacity-65"
                  disabled={busyId === invite.id}
                  onClick={() => void act(invite, "declined")}
                  type="button"
                >
                  Not now
                </button>
              </div>
            </div>
            <button
              aria-label="Dismiss invite"
              className="grid size-7 place-items-center rounded-full text-ink-500 transition-colors hover:bg-cream-200"
              disabled={busyId === invite.id}
              onClick={() => void act(invite, "declined")}
              type="button"
            >
              <X className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      {error && (
        <p className="pointer-events-auto rounded-md border border-blush-300 bg-blush-100 px-3 py-2 text-xs font-extrabold text-blush-700">
          {error}
        </p>
      )}
    </div>
  );
}
