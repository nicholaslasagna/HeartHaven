/**
 * Rotate-hint rule check.
 *
 *   npm run check:orientation
 *
 * A prompt that appears when it is not wanted is worse than no prompt, so
 * the rule for showing it is pinned rather than eyeballed. The hint is for
 * one situation only: a wide game held upright on a phone, where turning the
 * device roughly triples the play area.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldSuggestRotate, ROTATE_HINT_MAX_WIDTH } from "../src/lib/game/orientation";

const results: string[] = [];
const phone = { portrait: true, coarsePointer: true, width: 390 };

/* -- when it should and should not appear -- */
{
  assert.equal(shouldSuggestRotate(phone), true, "a phone held upright is exactly the case for it");
  assert.equal(shouldSuggestRotate({ ...phone, portrait: false }), false,
    "once turned, the hint has done its job and must go");

  // A narrow desktop window is somebody's deliberate choice, not a mistake.
  assert.equal(shouldSuggestRotate({ ...phone, coarsePointer: false }), false,
    "a narrow desktop window must never be nagged");

  // A tablet upright still shows a usable picture.
  assert.equal(shouldSuggestRotate({ ...phone, width: 820 }), false,
    "a large portrait viewport is fine as it is");
  assert.equal(shouldSuggestRotate({ ...phone, width: ROTATE_HINT_MAX_WIDTH }), true,
    "the boundary itself still qualifies");
  assert.equal(shouldSuggestRotate({ ...phone, width: ROTATE_HINT_MAX_WIDTH + 1 }), false,
    "and one pixel past it does not");

  // Nothing measurable means no hint: a missing signal must not invent one.
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(shouldSuggestRotate({ ...phone, width }), false,
      `an unmeasurable width (${width}) must not trigger the hint`);
  }
  results.push(`rule      phone upright only · never on desktop or tablets · boundary at ${ROTATE_HINT_MAX_WIDTH}px · unmeasurable means silent`);
}

/* -- it is a hint, not a wall -- */
{
  const source = readFileSync("src/components/game/rotate-hint.tsx", "utf8");

  // The world must keep running underneath and stay touchable.
  assert.ok(source.includes("pointer-events-none"),
    "the hint's container must not swallow taps meant for the game");
  assert.ok(!/inset-0[^"]*bg-/.test(source),
    "the hint must not cover the whole play area — it is a suggestion, not a modal");
  assert.ok(source.includes("Dismiss"), "it must be dismissible");
  assert.ok(source.includes("sessionStorage"),
    "dismissal should last the session, so it does not nag between rounds");
  assert.ok(source.includes("role=\"status\""), "announced politely, not as an alert that interrupts");
  results.push("manner    sits over one edge · play continues underneath · dismissible for the session · polite to screen readers");
}

/* -- shown on the games that actually gain from it -- */
{
  const wide = [
    ["kart racing", "src/components/game/moonberry-racing-canvas.tsx"],
    ["bowling", "src/components/game/moonberry-bowling-canvas.tsx"],
    ["HeartRush", "src/components/game/heartrush-canvas.tsx"],
    ["Lantern Leap", "src/components/game/lantern-leap/lantern-leap-canvas.tsx"],
    ["pool", "src/components/game/pool-canvas.tsx"],
  ] as const;

  for (const [name, path] of wide) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("<RotateHint"), `${name} is a wide game and should offer the hint`);
    // An absolutely positioned hint needs a positioned ancestor, or it
    // escapes to the page and lands somewhere else entirely.
    assert.ok(/className="[^"]*relative/.test(source),
      `${name} must give the hint a positioned container`);
  }

  // The upright games must NOT nag: their worlds are as tall as they are wide.
  for (const [name, path] of [
    ["memory match", "src/components/game/memory-match-canvas.tsx"],
    ["the garden", "src/components/game/garden-canvas.tsx"],
  ] as const) {
    const source = readFileSync(path, "utf8");
    assert.ok(!source.includes("<RotateHint"), `${name} plays fine upright and must not ask for a rotation`);
  }
  results.push(`games     ${wide.length} wide games offer it, each with a positioned container · upright games left alone`);
}

console.log(`\nOrientation: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
