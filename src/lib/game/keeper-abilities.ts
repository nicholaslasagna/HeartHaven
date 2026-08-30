/**
 * Keeper abilities and how they unlock.
 *
 * Squeeze and dig were always available to everyone. These add abilities that
 * have to be earned, and they are earned from activity the game ALREADY
 * tracks for achievements — games played, coins earned, companion care, login
 * streak. Nothing new is stored: an ability is unlocked when the metric that
 * gates it crosses its threshold, so unlock state is derived rather than
 * saved. That means there is no extra record to migrate, nothing to fall out
 * of sync with the badge that celebrates the same milestone, and no separate
 * "unlocked" list to edit.
 *
 * Definitions live here rather than in the canvas so the buttons, the Phaser
 * scene and the checks all read the same list.
 */
import type { AchievementMetric } from "@/lib/game/achievements";

export type KeeperAbilityId = "squeeze" | "dig" | "sprint" | "forage" | "lantern";

export type KeeperAbility = {
  id: KeeperAbilityId;
  label: string;
  /** What it does, in the player's words. */
  description: string;
  /** Shown while it is still locked. */
  lockedHint: string;
  /** Keyboard shortcut, matching the scene's handler. */
  key: string;
  /** lucide-react icon name, resolved by the buttons. */
  icon: "PawPrint" | "Shovel" | "Wind" | "Sprout" | "Lantern";
  /** null for the two starter abilities every keeper begins with. */
  unlock: { metric: AchievementMetric; threshold: number } | null;
};

export const KEEPER_ABILITIES: KeeperAbility[] = [
  {
    id: "squeeze",
    label: "Squeeze gap",
    description: "Slip your companion through a lavender paw tunnel.",
    lockedHint: "",
    key: "E",
    icon: "PawPrint",
    unlock: null,
  },
  {
    id: "dig",
    label: "Dig fresh dirt",
    description: "Turn over a patch of fresh dirt for coins.",
    lockedHint: "",
    key: "F",
    icon: "Shovel",
    unlock: null,
  },
  {
    id: "sprint",
    label: "Second wind",
    description: "A burst of speed across the garden. Costs nothing but a breather.",
    lockedHint: "Play 5 mini-games to earn your second wind.",
    key: "Shift",
    icon: "Wind",
    unlock: { metric: "games-played", threshold: 5 },
  },
  {
    id: "forage",
    label: "Forage",
    description: "Gather moonberries from the bushes. They regrow each day.",
    lockedHint: "Care for your companion 10 times to learn foraging.",
    key: "G",
    icon: "Sprout",
    unlock: { metric: "pet-care-actions", threshold: 10 },
  },
  {
    id: "lantern",
    label: "Lantern sense",
    description: "Light the ground nearby and reveal what is hidden under it.",
    lockedHint: "Reach a 3-day visit streak to earn lantern sense.",
    key: "T",
    icon: "Lantern",
    unlock: { metric: "daily-streak", threshold: 3 },
  },
];

export const KEEPER_ABILITY_BY_ID: Record<KeeperAbilityId, KeeperAbility> =
  Object.fromEntries(KEEPER_ABILITIES.map((ability) => [ability.id, ability])) as Record<
    KeeperAbilityId,
    KeeperAbility
  >;

/** How far along the gating metric the keeper is, 0..1. */
export function abilityProgress(
  ability: KeeperAbility,
  progress: Partial<Record<AchievementMetric, number>>,
): number {
  if (!ability.unlock) return 1;
  const current = Math.max(0, progress[ability.unlock.metric] ?? 0);
  return Math.min(1, current / ability.unlock.threshold);
}

export function isAbilityUnlocked(
  ability: KeeperAbility,
  progress: Partial<Record<AchievementMetric, number>>,
): boolean {
  if (!ability.unlock) return true;
  return (progress[ability.unlock.metric] ?? 0) >= ability.unlock.threshold;
}

export function unlockedAbilityIds(
  progress: Partial<Record<AchievementMetric, number>>,
): KeeperAbilityId[] {
  return KEEPER_ABILITIES.filter((ability) => isAbilityUnlocked(ability, progress)).map((a) => a.id);
}

/**
 * The next ability the keeper will earn, and how far off it is — so the UI can
 * say "2 more games" instead of just greying a button out.
 */
export function nextAbilityToUnlock(
  progress: Partial<Record<AchievementMetric, number>>,
): { ability: KeeperAbility; remaining: number } | null {
  let best: { ability: KeeperAbility; remaining: number } | null = null;
  for (const ability of KEEPER_ABILITIES) {
    if (!ability.unlock || isAbilityUnlocked(ability, progress)) continue;
    const remaining = ability.unlock.threshold - Math.max(0, progress[ability.unlock.metric] ?? 0);
    if (!best || remaining < best.remaining) best = { ability, remaining };
  }
  return best;
}
