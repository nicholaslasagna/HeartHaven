"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Flame, Gift } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { GameIcon } from "@/components/game/game-icon";
import { Badge } from "@/components/ui/badge";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { useDailyLoop } from "@/lib/game/use-daily-loop";
import { cn } from "@/lib/utils";

/**
 * DailyLoopPanel — "Today at HeartHaven": the daily gift, the login streak, and
 * the three rotating daily tasks. This is the come-back-tomorrow engine that
 * makes the dashboard a hub instead of a menu.
 */
export function DailyLoopPanel({ className }: { className?: string }) {
  const { tasks, streak, giftAvailable, giftPreview, claimGift, completedCount, totalTasks, ready } = useDailyLoop();
  const [justClaimed, setJustClaimed] = useState<{ coins: number; hearts: number } | null>(null);

  function handleClaim() {
    const result = claimGift();
    if (result) {
      setJustClaimed({ coins: result.coins, hearts: result.hearts });
      playCozyCue("reward");
      window.setTimeout(() => setJustClaimed(null), 2600);
    }
  }

  return (
    <CozyCard className={cn("p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gift className="size-5 text-blush-500" />
          <h2 className="font-display text-2xl text-ink-900">Today at HeartHaven</h2>
        </div>
        {streak > 0 && (
          <Badge variant="blush" className="gap-1">
            <Flame className="size-3.5 text-honey-700" /> {streak}-day streak
          </Badge>
        )}
      </div>

      {/* Daily gift */}
      <div
        className={cn(
          "mt-4 flex items-center justify-between gap-3 rounded-lg border p-4",
          giftAvailable
            ? "border-honey-500/30 bg-honey-100/70"
            : "border-cream-300 bg-cream-50/70",
        )}
      >
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-honey-700">Daily gift</p>
          <p className="mt-0.5 text-sm font-bold text-ink-700">
            {giftAvailable
              ? `Day ${streak + 1} reward: +${giftPreview.coins} coins, +${giftPreview.hearts} ${giftPreview.hearts === 1 ? "heart" : "hearts"}`
              : "Claimed today — come back tomorrow to grow your streak."}
          </p>
        </div>
        <CozyButton size="sm" disabled={!ready || !giftAvailable} onClick={handleClaim}>
          <Gift /> {giftAvailable ? "Claim" : "Claimed"}
        </CozyButton>
      </div>

      <AnimatePresence>
        {justClaimed && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 text-center text-sm font-extrabold text-garden-700"
          >
            Gift claimed! +{justClaimed.coins} coins, +{justClaimed.hearts}{" "}
            {justClaimed.hearts === 1 ? "heart" : "hearts"} added to your wallet.
          </motion.p>
        )}
      </AnimatePresence>

      {/* Daily tasks */}
      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Today&apos;s tasks</p>
        <p className="text-xs font-extrabold text-garden-700">
          {completedCount} / {totalTasks} done
        </p>
      </div>
      <div className="mt-2 grid gap-2">
        {tasks.map((task) => {
          const ratio = Math.min(1, task.progress / task.goal);
          return (
            <div
              key={task.id}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                task.complete ? "border-garden-300/50 bg-garden-100/60" : "border-cream-300 bg-white/70",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full",
                    task.complete ? "bg-garden-300 text-garden-700" : "bg-cream-200 text-ink-700",
                  )}
                >
                  {task.complete ? <CheckCircle2 className="size-5" /> : <GameIcon name={task.icon} className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-ink-900">{task.label}</p>
                  <p className="text-xs font-bold text-ink-500">
                    {task.complete
                      ? `Reward claimed · +${task.rewardCoins} coins`
                      : `${task.progress} / ${task.goal} · +${task.rewardCoins} coins, +${task.rewardHearts} ${task.rewardHearts === 1 ? "heart" : "hearts"}`}
                  </p>
                </div>
              </div>
              {!task.complete && (
                <div className="mt-2 h-1.5 rounded-full bg-cream-200">
                  <motion.div
                    className="h-full rounded-full bg-blush-300"
                    animate={{ width: `${ratio * 100}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CozyCard>
  );
}
