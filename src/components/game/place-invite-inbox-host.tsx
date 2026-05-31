"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, DoorOpen, X } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { usePlaceInvites, type PlaceInvite } from "@/lib/game/place-invites";
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
    if (response === "accepted" && result.targetUrl) {
      router.push(result.targetUrl, { scroll: false });
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-[140] flex w-[min(390px,calc(100vw-2rem))] flex-col gap-2">
      {invites.slice(0, 3).map((invite) => (
        <div
          className="rounded-lg border border-blush-300/60 bg-white/95 p-3 shadow-[0_18px_45px_rgba(91,63,63,0.18)] backdrop-blur"
          key={invite.id}
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-blush-100 text-blush-600">
              <DoorOpen className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold uppercase tracking-normal text-blush-600">{inviteTitle(invite)}</p>
              <p className="mt-0.5 truncate text-sm font-black text-ink-900">
                {invite.inviterDisplayName} invited you
              </p>
              <p className="mt-0.5 text-xs font-bold capitalize text-ink-600">{inviteTarget(invite)}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-ink-500">
                <Clock className="size-3" /> Expires soon
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <CozyButton
              className={cn("flex-1", busyId === invite.id && "opacity-70")}
              disabled={busyId === invite.id}
              onClick={() => void act(invite, "accepted")}
              size="sm"
            >
              <Check /> Accept
            </CozyButton>
            <CozyButton
              disabled={busyId === invite.id}
              onClick={() => void act(invite, "declined")}
              size="sm"
              variant="warm"
            >
              <X /> Decline
            </CozyButton>
          </div>
        </div>
      ))}
      {error && (
        <p className="rounded-md border border-blush-300 bg-blush-100 px-3 py-2 text-xs font-extrabold text-blush-700">
          {error}
        </p>
      )}
    </div>
  );
}
