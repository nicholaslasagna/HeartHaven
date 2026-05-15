"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Coins, Heart, Sparkles, Trophy } from "lucide-react";
import { GameIcon } from "@/components/game/game-icon";
import { ACTIVITY_EVENT, type ActivityDetail } from "@/lib/game/activity";
import { playCozyCue, type CozyCue } from "@/lib/game/cozy-audio";
import { cn } from "@/lib/utils";

/**
 * RewardToastHost — the dopamine layer. Listens globally to the activity bus
 * and pops a soft animated toast whenever an achievement unlocks, a daily task
 * completes, or Casper's wish comes true. This is the bit that makes daily
 * play in HeartHaven feel like daily play in Webkinz — every meaningful action
 * gets a tiny, polished celebration.
 *
 * Mounted once in `game-shell.tsx` so it works on every (game) route.
 */

type ToastKind = "achievement" | "task" | "wish";

type Toast = {
  id: string;
  kind: ToastKind;
  icon: string;
  title: string;
  subtitle: string;
  coins: number;
  hearts: number;
};

const TOAST_DURATION_MS = 5200;
const ACHIEVEMENT_DURATION_MS = 6400;
const STACK_LIMIT = 4;

const KIND_STYLES: Record<ToastKind, { ring: string; chip: string; icon: string; label: string; cue: CozyCue }> = {
  achievement: {
    ring: "ring-honey-500/40 bg-gradient-to-br from-honey-100/95 to-cream-50/95",
    chip: "bg-honey-500 text-white",
    icon: "text-honey-700",
    label: "Achievement unlocked",
    cue: "reward",
  },
  task: {
    ring: "ring-blush-300/40 bg-gradient-to-br from-blush-100/95 to-cream-50/95",
    chip: "bg-blush-300 text-ink-900",
    icon: "text-blush-700",
    label: "Daily task complete",
    cue: "score",
  },
  wish: {
    ring: "ring-lavender-300/40 bg-gradient-to-br from-lavender-100/95 to-cream-50/95",
    chip: "bg-lavender-300 text-ink-900",
    icon: "text-lavender-500",
    label: "Casper's wish came true",
    cue: "petPurr",
  },
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function RewardToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function handle(event: Event) {
      const detail = (event as CustomEvent<ActivityDetail>).detail;
      if (!detail) return;

      const next: Toast[] = [];

      for (const def of detail.unlockedAchievements ?? []) {
        next.push({
          id: makeId(),
          kind: "achievement",
          icon: def.icon,
          title: def.name,
          subtitle: def.description,
          coins: def.rewardCoins,
          hearts: def.rewardHearts,
        });
      }

      for (const task of detail.completedTasks ?? []) {
        next.push({
          id: makeId(),
          kind: "task",
          icon: task.icon,
          title: task.label,
          subtitle: "Daily task complete",
          coins: task.rewardCoins,
          hearts: task.rewardHearts,
        });
      }

      if (detail.completedWish) {
        const wish = detail.completedWish;
        next.push({
          id: makeId(),
          kind: "wish",
          icon: wish.icon,
          title: wish.label,
          subtitle: wish.copy,
          coins: wish.rewardCoins,
          hearts: wish.rewardHearts,
        });
      }

      if (next.length === 0) return;

      // Play a single audio cue prioritized by event class.
      const lead = next.find((toast) => toast.kind === "achievement")
        ?? next.find((toast) => toast.kind === "wish")
        ?? next[0];
      if (lead) {
        try {
          playCozyCue(KIND_STYLES[lead.kind].cue);
        } catch {
          // Audio context might not be ready yet — silent fail is fine.
        }
      }

      setToasts((current) => {
        const merged = [...current, ...next];
        return merged.slice(-STACK_LIMIT);
      });

      // Auto-dismiss each new toast.
      for (const toast of next) {
        const duration = toast.kind === "achievement" ? ACHIEVEMENT_DURATION_MS : TOAST_DURATION_MS;
        window.setTimeout(() => {
          setToasts((current) => current.filter((entry) => entry.id !== toast.id));
        }, duration);
      }
    }

    window.addEventListener(ACTIVITY_EVENT, handle);
    return () => window.removeEventListener(ACTIVITY_EVENT, handle);
  }, []);

  return (
    <div
      aria-live="polite"
      aria-label="Reward notifications"
      className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(360px,calc(100vw-2.5rem))] flex-col-reverse gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const style = KIND_STYLES[toast.kind];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 36, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.94 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className={cn(
                "pointer-events-auto rounded-lg border border-white/60 p-3 shadow-[0_18px_48px_-22px_rgba(91,63,63,0.6)] backdrop-blur ring-1",
                style.ring,
              )}
            >
              <div className="flex items-start gap-3">
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", style.chip)}>
                  {toast.kind === "achievement" ? (
                    <Trophy className="size-5" />
                  ) : (
                    <GameIcon name={toast.icon} className="size-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[10px] font-black uppercase tracking-[0.15em]", style.icon)}>
                    {style.label}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-extrabold text-ink-900">{toast.title}</p>
                  <p className="line-clamp-2 text-xs font-bold text-ink-500">{toast.subtitle}</p>
                  {(toast.coins > 0 || toast.hearts > 0) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-extrabold">
                      {toast.coins > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-honey-100 px-2 py-0.5 text-honey-700">
                          <Coins className="size-3.5" /> +{toast.coins}
                        </span>
                      )}
                      {toast.hearts > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blush-100 px-2 py-0.5 text-blush-700">
                          <Heart className="size-3.5 fill-current" /> +{toast.hearts}
                        </span>
                      )}
                      {toast.kind === "wish" && (
                        <Sparkles className="size-3.5 text-lavender-500" aria-hidden />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
