"use client";

import { useState } from "react";
import { HeartHandshake, LockKeyhole, Sparkles, Sun } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { FriendInviteCard } from "@/components/cozy/friend-invite-card";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Badge } from "@/components/ui/badge";
import { lookupFriendCode } from "@/lib/game/social";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";
import type { friendInvite, partnerGardenPlots } from "@/lib/mock-data";

type PartnerGardenClientProps = {
  invite: typeof friendInvite;
  plots: typeof partnerGardenPlots;
};

export function PartnerGardenClient({ invite, plots }: PartnerGardenClientProps) {
  const searchParams = useSearchParams();
  const visitTarget = searchParams.get("visit");
  const isGuestVisit = Boolean(visitTarget);
  const allowedVisitTarget = visitTarget ? lookupFriendCode(visitTarget) : null;
  const isVisitAllowed = !visitTarget || Boolean(allowedVisitTarget);
  const [sunshine, setSunshine] = useState(3);
  const [message, setMessage] = useState("Casper is watching the shared gate.");
  const realtime = useGardenRealtime({
    gardenId: isVisitAllowed ? "shared-heart-garden" : "friend-only-partner-gate",
    gardenName: isVisitAllowed ? "Shared Heart Garden" : "Friend-only shared garden",
    invitePath: "/app/partner-garden",
  });
  const canEditGarden = !isGuestVisit || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);

  if (!isVisitAllowed) {
    return (
      <div className="grid gap-5">
        <section className="rounded-lg border border-blush-300/40 bg-blush-100/65 p-6 shadow-sm">
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Private shared garden</p>
          <h1 className="mt-2 font-display text-4xl text-ink-900">Accept an invite first.</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Shared garden links only open for trusted keepers. Add the host through Friends before entering a private
            garden visit.
          </p>
          <CozyButton asChild className="mt-4" variant="warm">
            <a href="/app/friends">Open Friends</a>
          </CozyButton>
        </section>
      </div>
    );
  }

  function sendSunshine() {
    setSunshine((value) => value + 1);
    setMessage("Sunshine sent to the partner garden.");
    // TODO: Broadcast partner garden care events through Supabase Realtime.
  }

  return (
    <div className="grid gap-5">
      <SeasonalEventBanner compact />
      <section className="rounded-lg border border-blush-300/40 bg-blush-100/55 p-5 shadow-sm">
        <Badge variant="blush">
          <Sparkles className="size-3.5" />
          Private garden
        </Badge>
        <h1 className="mt-3 font-display text-4xl text-ink-900">Shared Heart Garden</h1>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
          A partner-linked garden for shared quests, protected memories, and private gifts.
        </p>
      </section>
      <CozyCard className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-2xl text-ink-900">Shared care pulse</h2>
          <p className="text-sm font-bold text-ink-700">{message}</p>
        </div>
        <CozyButton onClick={sendSunshine}>
          <Sun /> Send sunshine ({sunshine})
        </CozyButton>
      </CozyCard>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <GardenCanvasLoader
          canEditGarden={canEditGarden}
          onAvatarMove={realtime.sendMove}
          plots={plots}
          remotePlayers={realtime.players}
          variant="partner"
        />
        <GardenSocialPanel
          canManagePlacement={!isGuestVisit}
          approvedDecoratorCodes={realtime.approvedDecoratorCodes}
          connectionState={realtime.connectionState}
          inviteUrl={realtime.inviteUrl}
          messages={realtime.messages}
          onToggleDecorator={realtime.toggleDecoratorPermission}
          players={realtime.players}
          roomCode={realtime.gardenCode}
          sendChat={realtime.sendChat}
          status={realtime.status}
        />
      </section>
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <FriendInviteCard {...invite} />
        <CozyCard className="p-5">
          <div className="flex items-center gap-2">
            <HeartHandshake className="size-5 text-blush-500" />
            <h2 className="font-display text-2xl text-ink-900">Partner link</h2>
          </div>
          <p className="mt-2 text-sm font-semibold leading-6 text-ink-700">
            Once connected, this page should read accepted <code>partner_links</code> and shared garden rows.
          </p>
          <div className="mt-4 rounded-lg border border-lavender-300/50 bg-lavender-100 p-3 text-sm font-extrabold text-ink-700">
            <LockKeyhole className="mr-2 inline size-4 text-lavender-500" />
            Private love note and memory unlocks stay behind partner RLS.
          </div>
          <CozyButton className="mt-4" variant="warm">Manage partner invite</CozyButton>
        </CozyCard>
      </div>
    </div>
  );
}
