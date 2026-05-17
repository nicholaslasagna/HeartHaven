"use client";

import { useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, BellRing, Calendar, Check, Coins, Gift, Heart, Megaphone, Sparkles, Wrench } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { useAnnouncements, type AnnouncementRow } from "@/lib/game/use-announcements";
import { getCatalogItemArt, getCatalogItemArtFit } from "@/lib/game/item-art";
import { marketCatalog } from "@/lib/catalog";

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 0) return "Just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const KIND_META: Record<AnnouncementRow["kind"], { label: string; tint: string; Icon: typeof Megaphone }> = {
  info: { label: "Update", tint: "text-lavender-500", Icon: Megaphone },
  reward: { label: "Reward", tint: "text-honey-700", Icon: Gift },
  "login-bonus": { label: "Login bonus", tint: "text-blush-500", Icon: Sparkles },
  event: { label: "Event", tint: "text-garden-700", Icon: Calendar },
  maintenance: { label: "Maintenance", tint: "text-sky-500", Icon: Wrench },
};

export function MemoryBookClient() {
  const { rows, loading, unseenCount, claim, markAllSeen, refresh } = useAnnouncements();

  // Auto-mark everything seen when the page is opened so the nav badge
  // clears the moment the keeper actually looks at the list.
  useEffect(() => {
    markAllSeen();
  }, [markAllSeen]);

  return (
    <div className="grid gap-5">
      <section className="hh-card relative overflow-hidden p-5">
        <div className="pointer-events-none absolute inset-0 hh-bg-paper opacity-40" aria-hidden />
        <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="hh-eyebrow text-lavender-500 flex items-center gap-1">
              <Megaphone className="size-3" /> Announcements
            </p>
            <h1 className="hh-display mt-1 text-4xl text-ink-900">
              From the HeartHaven team
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
              New gifts, login bonuses, events, and quiet updates. Anything with a reward chip can be claimed once —
              the coins, hearts, or item land in your wallet the moment you tap Claim.
            </p>
            {unseenCount > 0 && (
              <p className="mt-2 text-xs font-extrabold uppercase tracking-normal text-blush-500">
                {unseenCount} new since your last visit
              </p>
            )}
          </div>
          <CozyButton variant="warm" onClick={() => void refresh()}>
            <BellRing /> Refresh
          </CozyButton>
        </div>
      </section>

      {loading && rows.length === 0 ? (
        <CozyCard className="p-6 text-center text-sm font-bold text-ink-500">
          Loading the latest announcements…
        </CozyCard>
      ) : rows.length === 0 ? (
        <CozyCard className="p-8 text-center">
          <Bell className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-sm font-bold text-ink-600">No announcements yet — quiet around here.</p>
        </CozyCard>
      ) : (
        <ul className="grid gap-4">
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.li
                key={row.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
              >
                <AnnouncementCard row={row} onClaim={() => void claim(row.id)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function AnnouncementCard({ row, onClaim }: { row: AnnouncementRow; onClaim: () => void }) {
  const meta = KIND_META[row.kind];
  const Icon = meta.Icon;
  const rewardItem = row.rewardCatalogItemId
    ? marketCatalog.find((item) => item.id === row.rewardCatalogItemId)
    : null;

  return (
    <CozyCard className={`p-5 transition ${row.seen ? "opacity-95" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className={`grid size-10 shrink-0 place-items-center rounded-full bg-cream-100 ${meta.tint}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`${meta.tint} border-current/30 bg-white/70`}>
              {meta.label}
            </Badge>
            {!row.seen && (
              <Badge variant="blush" className="text-[10px]">
                NEW
              </Badge>
            )}
            {row.claimed && (
              <Badge variant="garden" className="text-[10px]">
                <Check className="size-3" /> Claimed
              </Badge>
            )}
            <span className="text-[11px] font-bold text-ink-500">{relativeTime(row.publishesAt)}</span>
          </div>
          <h2 className="mt-2 font-display text-2xl text-ink-900">{row.title}</h2>
          <p className="mt-1 whitespace-pre-line text-sm font-semibold leading-6 text-ink-700">{row.body}</p>
          {row.hasReward && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-honey-300/50 bg-honey-100/60 px-3 py-2 text-sm font-extrabold text-honey-700">
              <Gift className="size-4" />
              {row.rewardCoins > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Coins className="size-3.5" /> +{row.rewardCoins}
                </span>
              )}
              {row.rewardHearts > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Heart className="size-3.5 fill-current text-blush-500" /> +{row.rewardHearts}
                </span>
              )}
              {rewardItem && (
                <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-2 py-1 text-xs font-extrabold text-ink-700">
                  <span className="grid size-8 place-items-center overflow-hidden rounded-md border border-cream-300 bg-cream-50">
                    <Image
                      alt={`${rewardItem.name} preview`}
                      className={`block size-full ${getCatalogItemArtFit(rewardItem) === "cover" ? "object-cover" : "object-contain p-0.5"}`}
                      height={64}
                      src={getCatalogItemArt(rewardItem)}
                      width={64}
                    />
                  </span>
                  {rewardItem.name}
                </span>
              )}
              <CozyButton
                className="ml-auto"
                size="sm"
                variant={row.claimed ? "warm" : "default"}
                disabled={row.claimed}
                onClick={onClaim}
              >
                {row.claimed ? "Already claimed" : "Claim"}
              </CozyButton>
            </div>
          )}
        </div>
      </div>
    </CozyCard>
  );
}
