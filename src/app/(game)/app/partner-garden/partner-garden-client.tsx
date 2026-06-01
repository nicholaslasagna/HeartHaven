"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, HeartHandshake, Loader2, LockKeyhole, Send, Sparkles, Sun, UserPlus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { FriendInviteCard } from "@/components/cozy/friend-invite-card";
import { getDefaultGardenDecor, readGardenDecor, writeGardenDecor, type GardenDecorPlacement } from "@/components/game/garden-canvas";
import { GardenCanvasLoader } from "@/components/game/garden-canvas-loader";
import { GardenSocialPanel } from "@/components/game/garden-social-panel";
import { CompanionMiniCard } from "@/components/game/park/companion-mini-card";
import { SeasonalEventBanner } from "@/components/seasonal/seasonal-event-banner";
import { Badge } from "@/components/ui/badge";
import { recordActivity } from "@/lib/game/activity";
import { getSocialState, isFriendCodeShape, lookupFriendCode, normalizeFriendCode, recordPlayedWith } from "@/lib/game/social";
import { useSocial } from "@/lib/game/use-social";
import { mergeGardenPlotsWithDefaults, type GardenPlotState } from "@/lib/game/garden-plots";
import { useGardenRealtime } from "@/lib/game/use-garden-realtime";
import { usePartnerLink } from "@/lib/game/use-partner-link";
import {
  clearPendingGardenSave,
  queuePendingGardenSave,
  readPendingGardenSave,
} from "@/lib/game/multiplayer-save-retry";
import { creditWallet } from "@/lib/game/wallet-store";

const PARTNER_GARDEN_ID = "shared-heart-garden";
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
  const router = useRouter();
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
  const social = useSocial();
  const partner = usePartnerLink();
  const [partnerCode, setPartnerCode] = useState("");
  const [partnerNotice, setPartnerNotice] = useState("Choose one trusted keeper. Partner-only memories and the shared garden unlock after they accept.");
  const [partnerBusy, setPartnerBusy] = useState<string | null>(null);
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
  const [decor, setDecor] = useState<GardenDecorPlacement[]>(() =>
    isGuestVisit ? getDefaultGardenDecor("partner") : readGardenDecor("partner"),
  );
  const [pendingDecorIds, setPendingDecorIds] = useState<string[]>([]);
  const [decorSaveStatus, setDecorSaveStatus] = useState("Shared garden decor ready");
  const latestPersistedDecorRef = useRef<GardenDecorPlacement[]>(decor);
  const saveRealtimeDecor = realtime.saveDecor;
  const defaultPlots = useMemo(() => plots as GardenPlotState[], [plots]);
  const [gardenPlots, setGardenPlots] = useState<GardenPlotState[]>(defaultPlots);
  const seededPlotsRef = useRef(false);

  // Mirror server-canonical decor for the partner-garden (variant="partner").
  // Same external-subscription justification — the realtime hook is the
  // external system whose updates we sync into local state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (realtimeDecor) {
      setDecor(realtimeDecor);
      latestPersistedDecorRef.current = realtimeDecor;
      if (!isGuestVisit) writeGardenDecor("partner", realtimeDecor);
      setDecorSaveStatus(
        realtime.decorVersion > 0 ? `Shared garden decor synced · v${realtime.decorVersion}` : "Shared garden decor synced",
      );
      return;
    }

    if (realtime.decorLoading) {
      setDecorSaveStatus("Loading shared garden decor...");
      return;
    }

    const localDecor = isGuestVisit ? getDefaultGardenDecor("partner") : readGardenDecor("partner");
    setDecor(localDecor);
    latestPersistedDecorRef.current = localDecor;
    setDecorSaveStatus("Shared garden decor loaded locally");
  }, [isGuestVisit, realtime.decorLoading, realtime.decorVersion, realtimeDecor]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (realtime.plotsLoading) return;
    const merged = mergeGardenPlotsWithDefaults(defaultPlots, realtime.plots);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGardenPlots(merged);
    if (!realtime.plots && canEditGarden && !isGuestVisit && !seededPlotsRef.current) {
      seededPlotsRef.current = true;
      void realtime.savePlots(defaultPlots);
    }
  }, [canEditGarden, defaultPlots, isGuestVisit, realtime.plots, realtime.plotsLoading, realtime.savePlots]);

  const handlePlotCare = useCallback(
    async (plotId: string, action: "water" | "harvest") => {
      if (!canEditGarden) return;
      setDecorSaveStatus(action === "water" ? "Watering shared plot..." : "Harvesting shared plot...");
      const result = await realtime.applyPlotAction(plotId, action);
      setDecorSaveStatus(result.ok ? `Plot updated · v${result.version}` : (result.message ?? "Plot action failed."));
    },
    [canEditGarden, realtime],
  );

  const handleDecorChange = useCallback(async (next: GardenDecorPlacement[]) => {
    if (!canEditGarden) {
      setDecorSaveStatus("You don't have permission to edit this garden.");
      return;
    }

    const previous = latestPersistedDecorRef.current;
    setPendingDecorIds(changedDecorIds(previous, next));
    setDecor(next);
    if (!isGuestVisit) writeGardenDecor("partner", next);
    setDecorSaveStatus("Saving shared garden decor...");

    const result = await saveRealtimeDecor(next);
    setPendingDecorIds([]);

    if (result.ok) {
      latestPersistedDecorRef.current = next;
      clearPendingGardenSave(channelHostCode, PARTNER_GARDEN_ID);
      setDecorSaveStatus(`Shared garden decor saved · v${result.version}`);
      return;
    }

    if (result.reason === "network") {
      latestPersistedDecorRef.current = next;
      queuePendingGardenSave({
        hostCode: channelHostCode,
        gardenId: PARTNER_GARDEN_ID,
        decor: next,
        savedAt: Date.now(),
      });
      setDecorSaveStatus("Shared garden decor saved locally. Retrying online sync when the garden reconnects...");
      return;
    }

    const fallback = result.reason === "conflict" ? (realtimeDecor ?? previous) : previous;
    latestPersistedDecorRef.current = fallback;
    setDecor(fallback);
    if (!isGuestVisit) writeGardenDecor("partner", fallback);
    setDecorSaveStatus(
      result.reason === "conflict"
        ? "Someone else updated this — try again."
        : result.reason === "unauthorized"
          ? "You don't have permission to edit this garden."
          : (result.message ?? "Shared garden decor could not be saved."),
    );
  }, [canEditGarden, channelHostCode, isGuestVisit, realtimeDecor, saveRealtimeDecor]);

  useEffect(() => {
    if (realtime.connectionState !== "connected" || !canEditGarden) return;
    const pending = readPendingGardenSave(channelHostCode, PARTNER_GARDEN_ID);
    if (!pending) return;
    queueMicrotask(() => {
      void handleDecorChange(pending.decor as GardenDecorPlacement[]);
    });
  }, [canEditGarden, channelHostCode, handleDecorChange, realtime.connectionState]);

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href, { scroll: false });
    },
    [router],
  );

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

  async function requestPartnerLink(targetCode?: string) {
    const code = normalizeFriendCode(targetCode ?? partnerCode);
    if (!isFriendCodeShape(code)) {
      setPartnerNotice("Enter a valid friend code like HH-ABCDE-123.");
      return;
    }
    setPartnerBusy(`request:${code}`);
    const result = await partner.requestPartner(code);
    setPartnerBusy(null);
    if (!result.ok) {
      setPartnerNotice(result.reason === "offline" ? "Partner linking needs online play enabled." : result.reason);
      return;
    }
    setPartnerCode("");
    setPartnerNotice("Partner invite sent. They will see it here and can accept from their Partner page.");
  }

  async function respondToPartnerLink(accept: boolean) {
    if (!partner.link) return;
    setPartnerBusy(accept ? "accept" : "decline");
    const result = accept
      ? await partner.acceptPartner(partner.link.link_id)
      : await partner.declinePartner(partner.link.link_id);
    setPartnerBusy(null);
    if (!result.ok) {
      setPartnerNotice(result.reason);
      return;
    }
    setPartnerNotice(accept ? "Partner link accepted. Your shared garden is ready." : "Partner invite declined.");
  }

  async function unlinkPartner() {
    setPartnerBusy("unlink");
    const result = await partner.unlinkPartner();
    setPartnerBusy(null);
    setPartnerNotice(result.ok ? "Partner link ended." : result.reason);
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
            onNavigate={handleNavigate}
            pendingDecorIds={pendingDecorIds}
            onPlotCare={handlePlotCare}
            plots={gardenPlots}
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
          gardenId="shared-heart-garden"
          inviteUrl={realtime.inviteUrl}
          inviteType="garden"
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
            Connect with one trusted keeper. They receive the invite here, then both of you share this garden.
          </p>
          <div className="mt-4 rounded-lg border border-lavender-300/50 bg-lavender-100 p-3 text-sm font-extrabold text-ink-700">
            <LockKeyhole className="mr-2 inline size-4 text-lavender-500" />
            Private love note and memory unlocks stay visible only to the linked partners.
          </div>
          {partner.loading ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-cream-300 bg-cream-50 px-3 py-3 text-sm font-extrabold text-ink-600">
              <Loader2 className="size-4 animate-spin text-lavender-500" /> Checking partner link...
            </div>
          ) : partner.isPartnered && partner.link ? (
            <div className="mt-4 grid gap-3">
              <div className="rounded-lg border border-garden-300/50 bg-garden-100/75 p-3">
                <p className="text-xs font-extrabold uppercase tracking-normal text-garden-700">Linked partner</p>
                <p className="mt-1 font-display text-2xl text-ink-900">@{partner.link.other_display_name}</p>
                <p className="font-mono text-xs font-bold text-ink-500">{partner.link.other_friend_code}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <CozyButton onClick={() => setPartnerNotice("You are already in your shared garden.")}>
                  <HeartHandshake /> Shared garden active
                </CozyButton>
                <CozyButton disabled={partnerBusy === "unlink"} onClick={() => void unlinkPartner()} variant="secondary">
                  <X /> End link
                </CozyButton>
              </div>
            </div>
          ) : partner.pendingIncoming && partner.link ? (
            <div className="mt-4 rounded-lg border border-blush-300/50 bg-blush-100/65 p-3">
              <p className="text-xs font-extrabold uppercase tracking-normal text-blush-600">Partner invite received</p>
              <p className="mt-1 text-sm font-bold text-ink-800">
                @{partner.link.other_display_name} wants to link gardens with you.
              </p>
              <p className="font-mono text-xs font-bold text-ink-500">{partner.link.other_friend_code}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <CozyButton disabled={partnerBusy === "accept"} onClick={() => void respondToPartnerLink(true)}>
                  <Check /> Accept
                </CozyButton>
                <CozyButton disabled={partnerBusy === "decline"} onClick={() => void respondToPartnerLink(false)} variant="secondary">
                  <X /> Decline
                </CozyButton>
              </div>
            </div>
          ) : partner.pendingOutgoing && partner.link ? (
            <div className="mt-4 rounded-lg border border-honey-500/35 bg-honey-100/70 p-3">
              <p className="text-xs font-extrabold uppercase tracking-normal text-honey-700">Invite sent</p>
              <p className="mt-1 text-sm font-bold text-ink-800">
                Waiting for @{partner.link.other_display_name} to accept.
              </p>
              <p className="font-mono text-xs font-bold text-ink-500">{partner.link.other_friend_code}</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              <div className="grid gap-2 rounded-lg border border-cream-300 bg-cream-50/80 p-3">
                <label className="text-xs font-extrabold uppercase tracking-normal text-ink-500" htmlFor="partner-code">
                  Partner friend code
                </label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    className="min-w-0 rounded-md border border-cream-300 bg-white px-3 py-2 text-sm font-bold text-ink-900 placeholder:font-normal focus:border-lavender-300 focus:outline-none"
                    id="partner-code"
                    onChange={(event) => setPartnerCode(event.target.value)}
                    placeholder="HH-ABCDE-123"
                    value={partnerCode}
                  />
                  <CozyButton disabled={partnerBusy?.startsWith("request")} onClick={() => void requestPartnerLink()} variant="warm">
                    <Send /> Send
                  </CozyButton>
                </div>
              </div>
              {social.friends.length > 0 && (
                <div className="rounded-lg border border-blush-300/40 bg-blush-100/45 p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-600">
                    <UserPlus className="size-3.5" /> Pick from friends
                  </p>
                  <div className="grid max-h-44 gap-2 overflow-y-auto pr-1">
                    {social.friends.map((friend) => (
                      <button
                        className="flex items-center justify-between gap-2 rounded-md border border-white/70 bg-white/80 px-2.5 py-2 text-left transition hover:-translate-y-0.5 hover:border-blush-300"
                        disabled={partnerBusy === `request:${friend.code}`}
                        key={friend.code}
                        onClick={() => void requestPartnerLink(friend.code)}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-extrabold text-ink-900">{friend.displayName}</span>
                          <span className="block font-mono text-[11px] font-bold text-ink-500">{friend.code}</span>
                        </span>
                        <span className="rounded-full bg-blush-200 px-3 py-1 text-xs font-extrabold text-blush-700">
                          Link
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="mt-3 rounded-md border border-cream-300 bg-white/75 px-3 py-2 text-xs font-extrabold text-ink-600">
            {partnerNotice}
          </p>
        </CozyCard>
      </div>
    </div>
  );
}
