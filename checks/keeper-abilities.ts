/**
 * Keeper ability unlock check.
 *
 *   npm run check:keeper-abilities
 *
 * Abilities unlock off the metrics the achievements already track, so the
 * things worth pinning are the rules rather than the gameplay: that the two
 * starter abilities are always available, that a gated one is locked below
 * its threshold and unlocked at it, that progress never goes backwards, and
 * that no two abilities claim the same key — which would leave one of them
 * unreachable from the keyboard with nothing to show for it.
 */
import assert from "node:assert/strict";
import {
  KEEPER_ABILITIES,
  KEEPER_ABILITY_BY_ID,
  abilityProgress,
  isAbilityUnlocked,
  unlockedAbilityIds,
  nextAbilityToUnlock,
} from "../src/lib/game/keeper-abilities";
import { ACHIEVEMENTS } from "../src/lib/game/achievements";

const results: string[] = [];
const NOTHING = {};

/* -- catalogue integrity -- */
{
  const ids = KEEPER_ABILITIES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "ability ids must be unique");

  // Two abilities on one key means one of them can never be pressed.
  const keys = KEEPER_ABILITIES.map((a) => a.key.toUpperCase());
  assert.equal(new Set(keys).size, keys.length, `ability keys must be unique, got ${keys.join(", ")}`);

  // The garden canvas also binds Q (sniff) and WASD, with R taken by decor
  // rotate. An ability on one of those would fight the existing controls.
  const taken = ["Q", "W", "A", "S", "D", "R"];
  for (const ability of KEEPER_ABILITIES) {
    assert.ok(!taken.includes(ability.key.toUpperCase()),
      `${ability.id} claims ${ability.key}, which the garden already uses`);
  }

  for (const ability of KEEPER_ABILITIES) {
    assert.ok(ability.label.trim(), `${ability.id} needs a label`);
    assert.ok(ability.description.trim(), `${ability.id} needs a description`);
    assert.equal(KEEPER_ABILITY_BY_ID[ability.id], ability, "the id index must match the list");
    if (ability.unlock) {
      assert.ok(ability.unlock.threshold > 0, `${ability.id} needs a positive threshold`);
      assert.ok(ability.lockedHint.trim(), `${ability.id} is gated, so it must say how to earn it`);
      // The gating metric has to be one the game actually records.
      assert.ok(ACHIEVEMENTS.some((badge) => badge.metric === ability.unlock!.metric),
        `${ability.id} gates on ${ability.unlock.metric}, which nothing tracks`);
    } else {
      assert.equal(ability.lockedHint, "", `${ability.id} is a starter, so it needs no hint`);
    }
  }
  results.push(`catalogue ${KEEPER_ABILITIES.length} abilities · ids and keys unique · no clash with Q/WASD/R · every gate is a tracked metric`);
}

/* -- starters vs earned -- */
{
  const starters = KEEPER_ABILITIES.filter((a) => !a.unlock).map((a) => a.id);
  assert.deepEqual(unlockedAbilityIds(NOTHING), starters,
    "a brand new keeper has exactly the starter abilities");
  assert.ok(starters.includes("squeeze") && starters.includes("dig"),
    "squeeze and dig stay available to everyone");

  for (const ability of KEEPER_ABILITIES) {
    if (!ability.unlock) {
      assert.equal(isAbilityUnlocked(ability, NOTHING), true, `${ability.id} must never be locked`);
      assert.equal(abilityProgress(ability, NOTHING), 1, `${ability.id} is always fully available`);
      continue;
    }
    const { metric, threshold } = ability.unlock;
    assert.equal(isAbilityUnlocked(ability, { [metric]: threshold - 1 }), false,
      `${ability.id} must stay locked one short of ${threshold}`);
    assert.equal(isAbilityUnlocked(ability, { [metric]: threshold }), true,
      `${ability.id} must unlock exactly at ${threshold}`);
    assert.equal(isAbilityUnlocked(ability, { [metric]: threshold * 10 }), true,
      `${ability.id} must stay unlocked well past its threshold`);

    // Another metric moving must not unlock it.
    const other = metric === "games-played" ? "coins-earned" : "games-played";
    assert.equal(isAbilityUnlocked(ability, { [other]: 100000 }), false,
      `${ability.id} must only respond to ${metric}`);
  }
  results.push(`unlocks   starters always on · each gate bites exactly at its threshold · unrelated progress does not unlock`);
}

/* -- progress is well behaved -- */
{
  for (const ability of KEEPER_ABILITIES) {
    if (!ability.unlock) continue;
    const { metric, threshold } = ability.unlock;
    let previous = -1;
    for (let value = 0; value <= threshold * 2; value += 1) {
      const p = abilityProgress(ability, { [metric]: value });
      assert.ok(p >= 0 && p <= 1, `${ability.id} progress left 0..1 at ${value}: ${p}`);
      assert.ok(p >= previous, `${ability.id} progress went backwards at ${value}`);
      previous = p;
    }
    assert.equal(abilityProgress(ability, { [metric]: threshold }), 1, `${ability.id} reads full at its threshold`);
    // Junk and negatives must not produce a negative bar or a crash.
    assert.equal(abilityProgress(ability, { [metric]: -50 }), 0, `${ability.id} clamps negative progress`);
  }
  results.push("progress  monotonic, clamped to 0..1, negatives floor at zero");
}

/* -- the "next unlock" hint -- */
{
  const next = nextAbilityToUnlock(NOTHING);
  assert.ok(next, "a new keeper has something to work toward");
  const cheapest = KEEPER_ABILITIES
    .filter((a) => a.unlock)
    .reduce((best, a) => (a.unlock!.threshold < best.unlock!.threshold ? a : best));
  assert.equal(next.ability.id, cheapest.id, "the nearest ability is the one suggested");
  assert.equal(next.remaining, cheapest.unlock!.threshold, "and the distance is the whole threshold");

  // With everything earned there is nothing left to suggest.
  const maxed = Object.fromEntries(KEEPER_ABILITIES.filter((a) => a.unlock).map((a) => [a.unlock!.metric, 999999]));
  assert.equal(nextAbilityToUnlock(maxed), null, "a fully unlocked keeper is not nagged");
  assert.equal(unlockedAbilityIds(maxed).length, KEEPER_ABILITIES.length, "and holds every ability");
  results.push("next up   suggests the nearest ability with the right distance · silent once everything is earned");
}

console.log(`\nKeeper abilities: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
