"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeartHandshake, LockKeyhole, Sparkles, Sun } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { FriendInviteCard } from "@/components/cozy/friend-invite-card";
import { readGardenDecor, writeGardenDecor, type GardenDecorPlacement } from "@/components/game/garden-canvas";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { CompanionMiniCard } from "@/components/game/park/companion-mini-card";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Badge } from "@/components/ui/badge";
import { recordActivity } from "@/lib/game/activity";
import { getSocialState, isFriendCodeShape, lookupFriendCode, normalizeFriendCode, recordPlayedWith } from "@/lib/game/social";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";
import { creditWallet } from "@/lib/game/wallet-store";
import type { friendInvite, partnerGardenPlots } from "@/lib/mock-data";

type PartnerGardenClientProps = {
  invite: typeof friendInvite;
  plots: typeof partnerGardenPlots;
};

const SUNSHINE_STORAGE_KEY = "hearthaven:partner-sunshine";
const DAILY_SUNSHINE = 3;

type SunshineState = {
  date: string;
  remaining: number;
  sent: number;
};

function localDateKey() {
  return new Date().toLocaleDateString("en-CA");
}

function readSunshineState(): SunshineState {
  const fallback = { date: localDateKey(), remaining: DAILY_SUNSHINE, sent: 0 };
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SUNSHINE_STORAGE_KEY) ?? "null") as Partial<SunshineState> | null;
    if (!parsed || parsed.date !== fallback.date) return fallback;
    return {
      date: fallback.date,
      remaining: Math.max(0, Math.min(DAILY_SUNSHINE, Number(parsed.remaining ?? DAILY_SUNSHINE))),
      sent: Math.max(0, Number(parsed.sent ?? 0)),
    };
  } catch {
    return fallback;
  }
}

function writeSunshineState(state: SunshineState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SUNSHINE_STORAGE_KEY, JSON.stringify(state));
}

function changedDecorIds(previous: GardenDecorPlacement[], next: GardenDecorPlacement[]) {
  const previousById = new Map(previous.map((decoration) => [decoration.id, JSON.stringify(decoration)]));
  return next
    .filter((decoration) => previousById.get(decoration.id) !== JSON.stringify(decoration))
    .map((decoration) => decoration.id);
}

export function PartnerGardenClient({ invite, plots }: PartnerGardenClientProps) {
  const searchParams = useSearchParams();
  const visitTargetRaw = searchParams.get("visit");
  const visitTarget = visitTargetRaw ? normalizeFriendCode(visitTargetRaw) : null;
  const isGuestVisit = Boolean(visitTarget);
  const allowedVisitTarget = visitTarget ? lookupFriendCode(visitTarget) : null;
  const isVisitAllowed = !visitTarget || Boolean(allowedVisitTarget) || isFriendCodeShape(visitTarget);
  const [sunshine, setSunshine] = useState(readSunshineState);
  const [message, setMessage] = useState(
    "First time? Sunshine spends one daily pulse to warm the shared garden, water every visible plot, cheer your companion, and add a tiny care reward.",
  );
  useEffect(() => {
    if (!visitTarget || !isFriendCodeShape(visitTarget)) return;
    recordPlayedWith({
      code: visitTarget,
      displayName: allowedVisitTarget?.displayName ?? "Keeper",
      context: "partner-garden-visit",
    });
  }, [visitTarget, allowedVisitTarget?.displayName]);
  const [selfFriendCode, setSelfFriendCode] = useState(() =>
    typeof window === "undefined" ? "" : getSocialState().selfCode,
  );
  useEffect(() => {
    const sync = () => setSelfFriendCode(getSocialState().selfCode);
    window.addEventListener("hearthaven:friend-code-regenerated", sync);
    return () => window.removeEventListener("hearthaven:friend-code-regenerated", sync);
  }, []);
  const channelHostCode = visitTarget ?? selfFriendCode;
  const realtime = useGardenRealtime({
    hostFriendCode: channelHostCode,
    gardenId: isVisitAllowed ? "shared-heart-garden" : "friend-only-partner-gate",
    gardenName: isVisitAllowed ? "Shared Heart Garden" : "Friend-only shared garden",
    invitePath: "/app/partner-garden",
  });
  const canEditGarden = !isGuestVisit || realtime.approvedDecoratorCodes.includes(realtime.localFriendCode);
  const realtimeDecor = realtime.decor as GardenDecorPlacement[] | null;
  const [decor, setDecor] = useState<GardenDecorPlacement[]>(() => readGardenDecor("partner"));
  const [pendingDecorIds, setPendingDecorIds] = useState<string[]>([]);
  const [decorSaveStatus, setDecorSaveStatus] = useState("Shared garden decor ready");
  const latestPersistedDecorRef = useRef<GardenDecorPlacement[]>(decor);
  const saveRealtimeDecor = realtime.saveDecor;

  // Mirror server-canonical decor for the partner-garden (variant="partner").
  // Same external-subscription justification — the realtime hook is the
  // external system whose updates we sync into local state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (realtimeDecor) {
      setDecor(realtimeDecor);
      latestPersistedDecorRef.current = realtimeDecor;
      writeGardenDecor("partner", realtimeDecor);
      setDecorSaveStatus(
        realtime.decorVersion > 0 ? `Shared garden decor synced · v${realtime.decorVersion}` : "Shared garden decor synced",
      );
      return;
    }

    if (realtime.decorLoading) {
      setDecorSaveStatus("Loading shared garden decor...");
      return;
    }

    const localDecor = readGardenDecor("partner");
    setDecor(localDecor);
    latestPersistedDecorRef.current = localDecor;
    setDecorSaveStatus("Shared garden decor loaded locally");
  }, [realtime.decorLoading, realtime.decorVersion, realtimeDecor]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDecorChange = useCallback(async (next: GardenDecorPlacement[]) => {
    if (!canEditGarden) {
      setDecorSaveStatus("You don't have permission to edit this garden.");
      return;
    }

    const previous = latestPersistedDecorRef.current;
    setPendingDecorIds(changedDecorIds(previous, next));
    setDecor(next);
    writeGardenDecor("partner", next);
    setDecorSaveStatus("Saving shared garden decor...");

    const result = await saveRealtimeDecor(next);
    setPendingDecorIds([]);

    if (result.ok) {
      latestPersistedDecorRef.current = next;
      setDecorSaveStatus(`Shared garden decor saved · v${result.version}`);
      return;
    }

    if (result.reason === "network") {
      latestPersistedDecorRef.current = next;
      setDecorSaveStatus("Shared garden decor saved locally. Online sync will retry when the garden reconnects.");
      return;
    }

    const fallback = result.reason === "conflict" ? (realtimeDecor ?? previous) : previous;
    latestPersistedDecorRef.current = fallback;
    setDecor(fallback);
    writeGardenDecor("partner", fallback);
    setDecorSaveStatus(
      result.reason === "conflict"
        ? "Someone else updated this — try again."
        : result.reason === "unauthorized"
          ? "You don't have permission to edit this garden."
          : (result.message ?? "Shared garden decor could not be saved."),
    );
  }, [canEditGarden, realtimeDecor, saveRealtimeDecor]);

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
    if (sunshine.remaining <= 0) {
      setMessage("All sunshine pulses were used today. Come back tomorrow for three fresh garden care pulses.");
      return;
    }

    const next = {
      date: localDateKey(),
      remaining: sunshine.remaining - 1,
      sent: sunshine.sent + 1,
    };
    setSunshine(next);
    writeSunshineState(next);

    creditWallet({
      gameId: "partner-sunshine",
      label: "Shared Garden Sunshine",
      score: next.sent,
      coins: 18,
      hearts: 1,
    });
    recordActivity("garden-watered", Math.max(1, plots.length), { source: "partner-sunshine" });
    recordActivity("coins-earned", 18, { source: "partner-sunshine" });
    recordActivity("hearts-earned", 1, { source: "partner-sunshine" });

    window.dispatchEvent(new CustomEvent("hearthaven:partner-sunshine", { detail: { sent: next.sent } }));
    setMessage("Sunshine sent: every visible plot gets a warm watering pulse, your companion cheers, and your wallet receives +18 coins and +1 heart.");
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
          <p className="mt-1 text-xs font-extrabold uppercase tracking-normal text-blush-500">
            {sunshine.sent} sent today · {sunshine.remaining} left
          </p>
        </div>
        <CozyButton disabled={sunshine.remaining <= 0} onClick={sendSunshine}>
          <Sun /> Send sunshine ({sunshine.remaining} left)
        </CozyButton>
      </CozyCard>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-3">
          <GardenCanvasLoader
            canEditGarden={canEditGarden}
            decor={decor}
            onAvatarMove={realtime.sendMove}
            onDecorChange={handleDecorChange}
            pendingDecorIds={pendingDecorIds}
            plots={plots}
            remotePlayers={realtime.players}
            variant="partner"
          />
          <p className="rounded-md border border-blush-300/40 bg-white/70 px-3 py-2 text-xs font-extrabold text-blush-700">
            {decorSaveStatus}
          </p>
          <CompanionMiniCard />
        </div>
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
            Once connected, this page will open the accepted partner link and shared garden.
          </p>
          <div className="mt-4 rounded-lg border border-lavender-300/50 bg-lavender-100 p-3 text-sm font-extrabold text-ink-700">
            <LockKeyhole className="mr-2 inline size-4 text-lavender-500" />
            Private love note and memory unlocks stay visible only to the linked partners.
          </div>
          <CozyButton className="mt-4" variant="warm">Manage partner invite</CozyButton>
        </CozyCard>
      </div>
    </div>
  );
}
