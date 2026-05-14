"use client";

import { motion } from "framer-motion";
import { Lock, Trophy } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { GameIcon } from "@/components/game/game-icon";
import { Badge } from "@/components/ui/badge";
import { useAchievements } from "@/lib/game/use-achievements";
import { cn } from "@/lib/utils";

/**
 * AchievementsPanel — the milestone trophy room. Locked badges show a progress
 * bar toward their threshold; unlocked badges glow and show their one-time
 * coin/heart reward. Progress is driven entirely by the activity bus.
 */
export function AchievementsPanel({ className, limit }: { className?: string; limit?: number }) {
  const { badges, unlockedCount, totalCount } = useAchievements();

  // When limited (dashboard preview), surface the closest-to-unlocking locked
  // badges first, then the rest — so the panel always shows momentum.
  const ordered = [...badges].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? 1 : -1;
    return b.ratio - a.ratio;
  });
  const shown = limit ? ordered.slice(0, limit) : ordered;

  return (
    <CozyCard className={cn("p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="size-5 text-honey-700" />
          <h2 className="font-display text-2xl text-ink-900">Achievements</h2>
        </div>
        <Badge variant="garden">
          {unlockedCount} / {totalCount}
        </Badge>
      </div>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {shown.map(({ def, current, unlocked, ratio }) => (
          <motion.div
            key={def.id}
            initial={false}
            animate={{ scale: unlocked ? 1 : 1 }}
            className={cn(
              "rounded-lg border p-3",
              unlocked
                ? "border-honey-500/40 bg-honey-100/70 shadow-[0_10px_30px_-22px_rgba(217,165,62,0.9)]"
                : "border-cream-300 bg-white/70",
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-full",
                  unlocked ? "bg-honey-500 text-white" : "bg-cream-200 text-ink-500",
                )}
              >
                {unlocked ? <GameIcon name={def.icon} className="size-5" /> : <Lock className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-ink-900">{def.name}</p>
                <p className="truncate text-xs font-bold text-ink-500">{def.description}</p>
              </div>
            </div>
            {unlocked ? (
              <p className="mt-2 text-xs font-extrabold text-honey-700">
                Unlocked · +{def.rewardCoins} coins, +{def.rewardHearts}{" "}
                {def.rewardHearts === 1 ? "heart" : "hearts"}
              </p>
            ) : (
              <>
                <div className="mt-2 h-1.5 rounded-full bg-cream-200">
                  <div
                    className="h-full rounded-full bg-lavender-300"
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs font-bold text-ink-500">
                  {current.toLocaleString()} / {def.threshold.toLocaleString()}
                </p>
              </>
            )}
          </motion.div>
        ))}
      </div>
    </CozyCard>
  );
}
