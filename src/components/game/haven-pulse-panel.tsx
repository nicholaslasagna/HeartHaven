"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Gift, PawPrint, Sparkles, Star, Trophy } from "lucide-react";
import { motion } from "framer-motion";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { getPetSpecies } from "@/lib/game/avatar-customization";
import {
  COMPANION_ROSTER_EVENT,
  getActiveCompanion,
  getCompanionRoster,
  type CompanionRecord,
} from "@/lib/game/companion-roster";
import { useDailyLoop } from "@/lib/game/use-daily-loop";
import { usePlayerProgression } from "@/lib/game/use-player-progression";
import { cn } from "@/lib/utils";

type HavenPulsePanelProps = {
  activeZone: "room" | "garden" | "park";
};

const ZONE_COPY: Record<HavenPulsePanelProps["activeZone"], { label: string; copy: string; tone: string }> = {
  room: {
    label: "Room day",
    copy: "Decorate, care for your companion, and host friends from your room drawer.",
    tone: "border-blush-300/50 bg-blush-100/70 text-blush-700",
  },
  garden: {
    label: "Garden day",
    copy: "Water plots, walk the lantern road, and invite friends into the growing space.",
    tone: "border-garden-300/50 bg-garden-100/70 text-garden-700",
  },
  park: {
    label: "Park day",
    copy: "Meet friends, launch party games, and build player points through shared time.",
    tone: "border-honey-500/40 bg-honey-100/80 text-honey-700",
  },
};

function getTaskSummary(tasks: ReturnType<typeof useDailyLoop>["tasks"]) {
  if (tasks.length === 0) return "Daily tasks are waking up.";
  const next = tasks.find((task) => !task.complete);
  if (!next) return "All daily tasks are complete.";
  return `${next.label}: ${next.progress}/${next.goal}`;
}

export function HavenPulsePanel({ activeZone }: HavenPulsePanelProps) {
  const daily = useDailyLoop();
  const progression = usePlayerProgression();
  const [activeCompanion, setActiveCompanion] = useState<CompanionRecord>(() =>
    getActiveCompanion(getCompanionRoster()),
  );
  const [giftResult, setGiftResult] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setActiveCompanion(getActiveCompanion(getCompanionRoster()));
    sync();
    window.addEventListener(COMPANION_ROSTER_EVENT, sync);
    window.addEventListener("hearthaven:pet-customization-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(COMPANION_ROSTER_EVENT, sync);
      window.removeEventListener("hearthaven:pet-customization-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const species = getPetSpecies(activeCompanion.speciesId);
  const levelProgress = Math.min(100, (progression.currentLevelPoints / progression.nextLevelPoints) * 100);
  const taskSummary = useMemo(() => getTaskSummary(daily.tasks), [daily.tasks]);
  const zoneCopy = ZONE_COPY[activeZone];

  function claimGift() {
    const result = daily.claimGift();
    if (!result) return;
    const itemCopy = result.item ? ` + ${result.item.name}` : "";
    setGiftResult(`+${result.coins} coins, +${result.hearts} hearts${itemCopy}`);
  }

  return (
    <CozyCard className="overflow-hidden p-0">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="blush" className="border-white/70 bg-white/80">
              <Sparkles className="size-3.5" /> Haven pulse
            </Badge>
            <span className={cn("rounded-full border px-2.5 py-1 text-xs font-extrabold", zoneCopy.tone)}>
              {zoneCopy.label}
            </span>
            <span className="rounded-full border border-lavender-300/40 bg-lavender-100/70 px-2.5 py-1 text-xs font-extrabold text-lavender-500">
              Streak {daily.streak || 0}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div>
              <h2 className="font-display text-3xl text-ink-900">Today in HeartHaven</h2>
              <p className="mt-1 max-w-2xl text-sm font-bold leading-6 text-ink-700">{zoneCopy.copy}</p>
              <div className="mt-4 grid gap-2 rounded-lg border border-cream-300 bg-cream-50/75 p-3">
                <div className="flex items-center justify-between gap-3 text-sm font-black text-ink-800">
                  <span className="flex items-center gap-2">
                    <Trophy className="size-4 text-honey-700" /> Level {progression.level}
                  </span>
                  <span>{progression.currentLevelPoints}/{progression.nextLevelPoints} pts</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white">
                  <motion.div
                    animate={{ width: `${levelProgress}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-honey-500 via-blush-300 to-lavender-300"
                    transition={{ duration: 0.45, ease: "easeOut" }}
                  />
                </div>
                <p className="text-xs font-bold text-ink-600">
                  New companions unlock every 10 levels. Playing with friends, caring for pets, and finishing daily
                  activities all move this bar.
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-lg border border-garden-300/40 bg-garden-100/70 p-3">
                <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">
                  <Star className="size-3.5" /> Daily task
                </p>
                <p className="mt-1 text-sm font-black text-ink-800">{taskSummary}</p>
                <p className="mt-1 text-xs font-bold text-ink-600">
                  {daily.completedCount}/{daily.totalTasks} complete today
                </p>
              </div>

              <div className="rounded-lg border border-honey-500/35 bg-honey-100/75 p-3">
                <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-honey-700">
                  <Gift className="size-3.5" /> Daily surprise
                </p>
                <p className="mt-1 text-sm font-black text-ink-800">
                  {daily.giftPreview.coins} coins + {daily.giftPreview.hearts} hearts + mystery item
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CozyButton disabled={!daily.ready || !daily.giftAvailable} size="sm" variant="warm" onClick={claimGift}>
                    <Gift /> {daily.giftAvailable ? "Open gift" : "Claimed"}
                  </CozyButton>
                  {giftResult && <span className="text-xs font-extrabold text-honey-700">{giftResult}</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative grid min-h-[236px] place-items-center overflow-hidden border-t border-cream-300 bg-gradient-to-br from-cream-50 via-blush-100 to-lavender-100 p-5 lg:border-l lg:border-t-0">
          <div className="absolute inset-0 opacity-55 [background-image:radial-gradient(circle_at_20%_20%,rgba(244,181,190,0.45),transparent_26%),radial-gradient(circle_at_82%_26%,rgba(142,112,189,0.22),transparent_24%),radial-gradient(circle_at_55%_86%,rgba(110,150,81,0.2),transparent_30%)]" />
          <motion.div
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
            className="relative grid justify-items-center"
          >
            <div className="absolute bottom-6 h-6 w-28 rounded-full bg-ink-900/16 blur-[2px]" />
            <Image
              alt={`${activeCompanion.name} the ${species.label}`}
              className="relative h-36 w-auto object-contain drop-shadow-[0_16px_24px_rgba(91,63,63,0.25)]"
              height={288}
              priority={activeZone === "room"}
              src={`/game-assets/generated/pet-art-preview-${activeCompanion.speciesId}.png`}
              width={256}
            />
            <div className="relative mt-2 rounded-full border border-white/80 bg-white/78 px-3 py-1 text-center shadow-sm">
              <p className="flex items-center justify-center gap-1.5 text-sm font-black text-ink-900">
                <PawPrint className="size-4 text-blush-500" /> {activeCompanion.name}
              </p>
              <p className="text-xs font-bold text-ink-600">{species.label}</p>
            </div>
            <Link
              className="relative mt-3 rounded-md border border-blush-300/50 bg-white/76 px-3 py-2 text-xs font-extrabold text-ink-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white"
              href="/app/pet"
            >
              Care and customize
            </Link>
          </motion.div>
        </div>
      </div>
    </CozyCard>
  );
}
