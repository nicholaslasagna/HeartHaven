"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle2, Gift, Heart, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { GameIcon } from "@/components/game/game-icon";
import { Badge } from "@/components/ui/badge";
import { useDailyWish } from "@/lib/game/use-daily-wish";
import { cn } from "@/lib/utils";

/**
 * CasperWishPanel — one pet-driven daily nudge.
 *
 * This is deliberately more emotional than a task list: it makes the companion
 * feel like they have a tiny desire today, and real game actions satisfy it.
 */
export function CasperWishPanel({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { wish, ratio, ready } = useDailyWish();

  return (
    <CozyCard className={cn("overflow-hidden p-0", className)}>
      <div className={cn("grid gap-0", compact ? "" : "lg:grid-cols-[0.9fr_1.1fr]")}>
        <div className="relative min-h-44 overflow-hidden bg-cream-100">
          <Image
            src="/game-assets/generated/casper-daily-wish-card.png"
            alt="Casper beside a glowing daily wish mailbox"
            width={1456}
            height={1040}
            className="h-full min-h-44 w-full object-cover"
            sizes={compact ? "(max-width: 768px) 100vw, 380px" : "(max-width: 1024px) 100vw, 440px"}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-900/42 via-transparent to-transparent" />
          <Badge className="absolute left-4 top-4 border-white/40 bg-white/24 text-white shadow-sm backdrop-blur">
            <Sparkles className="size-3.5" />
            Casper&apos;s wish
          </Badge>
        </div>

        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">Today&apos;s tiny ritual</p>
              <h2 className="mt-1 font-display text-3xl leading-tight text-ink-900">{wish.label}</h2>
            </div>
            <span
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-full",
                wish.complete ? "bg-garden-100 text-garden-700" : "bg-blush-100 text-blush-600",
              )}
            >
              {wish.complete ? <CheckCircle2 className="size-5" /> : <GameIcon name={wish.icon} className="size-5" />}
            </span>
          </div>

          <p className="mt-3 text-sm font-bold leading-6 text-ink-700">{wish.copy}</p>

          <div className="mt-4 rounded-lg border border-cream-300 bg-white/70 p-3">
            <div className="flex items-center justify-between text-xs font-extrabold text-ink-600">
              <span>{wish.progress} / {wish.goal}</span>
              <span>
                +{wish.rewardCoins} coins · +{wish.rewardHearts} {wish.rewardHearts === 1 ? "heart" : "hearts"}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-cream-200">
              <motion.div
                className={cn("h-full rounded-full", wish.complete ? "bg-garden-400" : "bg-blush-300")}
                animate={{ width: `${ratio * 100}%` }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <CozyButton asChild size="sm" aria-disabled={!ready}>
              <Link href={wish.actionHref}>
                {wish.complete ? "Wish complete" : wish.actionLabel}
                {wish.complete ? <Heart /> : <Gift />}
              </Link>
            </CozyButton>
            {wish.complete && (
              <p className="text-sm font-extrabold text-garden-700">
                Reward sent to your wallet.
              </p>
            )}
          </div>
        </div>
      </div>
    </CozyCard>
  );
}
