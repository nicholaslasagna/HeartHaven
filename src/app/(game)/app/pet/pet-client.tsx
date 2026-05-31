"use client";

import { Heart, Sparkles } from "lucide-react";
import { CompanionRosterPanel } from "@/components/cozy/companion-roster-panel";
import { KeeperCustomizerCard } from "@/components/cozy/keeper-customizer-card";
import { PetCarePanel } from "@/components/cozy/pet-care-panel";
import { CozyCard } from "@/components/cozy/cozy-card";
import { RedemptionCodePanel } from "@/components/cozy/redemption-code-panel";
import { AchievementsPanel } from "@/components/game/achievements-panel";
import { CasperWishPanel } from "@/components/game/casper-wish-panel";

/**
 * Companion care hub — HeartHaven's take on the Webkinz pet room. Your
 * companion's four vitals decay in real time; tending to them keeps your
 * companion content and earns you hearts. Milestones live alongside it.
 */
export function PetClient() {
  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Keeper studio</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Customize your keeper and companion</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Design the human avatar everyone sees in the world, choose the companion who walks with you, then care for
            them so the whole haven feels alive.
          </p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <KeeperCustomizerCard />
        <div className="grid gap-5">
          <CompanionRosterPanel />
          <RedemptionCodePanel />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <PetCarePanel />
        <div className="grid gap-5">
          <CasperWishPanel compact />
          <CozyCard className="p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-lavender-500" />
              <h2 className="font-display text-2xl text-ink-900">How care works</h2>
            </div>
            <ul className="mt-3 grid gap-2 text-sm font-bold text-ink-700">
              <li className="rounded-lg bg-honey-100/70 p-3">
                <span className="text-honey-700">Fullness, energy &amp; freshness</span> slowly drift down every hour —
                feeding, resting, and pampering top them back up.
              </li>
              <li className="rounded-lg bg-blush-100/70 p-3">
                <span className="text-blush-700">Happiness</span> sags faster when the other needs are neglected, so keep
                things balanced.
              </li>
              <li className="rounded-lg bg-garden-100/70 p-3">
                <span className="text-garden-700">Every care action earns a heart</span> and counts toward your daily
                tasks and caretaker achievements.
              </li>
            </ul>
            <p className="mt-3 flex items-center gap-1.5 text-xs font-bold text-ink-500">
              <Heart className="size-3.5 fill-current text-blush-500" />
              Care actions have short cooldowns — pop in across the day rather than all at once.
            </p>
          </CozyCard>
          <AchievementsPanel limit={6} />
        </div>
      </section>
    </div>
  );
}
