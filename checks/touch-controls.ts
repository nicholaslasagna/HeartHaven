/**
 * On-screen control check.
 *
 *   npm run check:touch-controls
 *
 * Mobile problems are invisible from a desktop browser, so these are the two
 * rules worth enforcing in code rather than by eye:
 *
 *   1. Every pad button is at least as big as a fingertip. All three pads
 *      had drifted under the minimum — the kart's were about 29px tall —
 *      while a comment claimed they cleared it.
 *   2. Every pad overlay disables native touch gestures. Without that, a
 *      thumb dragging a steering pad scrolls the page instead of steering.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOUCH_BUTTON_BASE, TOUCH_TARGET_MIN_PX } from "../src/lib/game/touch-controls";

const results: string[] = [];

/* -- the shared button really encodes the minimum -- */
{
  assert.equal(TOUCH_TARGET_MIN_PX, 44, "44px is the figure Apple's and Google's guidance agree on");
  for (const axis of ["min-h", "min-w"]) {
    const match = TOUCH_BUTTON_BASE.match(new RegExp(`${axis}-\\[(\\d+)px\\]`));
    assert.ok(match, `the shared button must set ${axis} explicitly, or padding decides the size`);
    assert.ok(
      Number(match[1]) >= TOUCH_TARGET_MIN_PX,
      `${axis} is ${match[1]}px, under the ${TOUCH_TARGET_MIN_PX}px minimum`,
    );
  }
  assert.ok(TOUCH_BUTTON_BASE.includes("pointer-events-auto"),
    "pad buttons sit inside a pointer-events-none overlay, so they must opt back in");
  results.push(`button    shared base pins ${TOUCH_TARGET_MIN_PX}px in both axes and re-enables pointer events`);
}

/* -- every pad uses it, and blocks page gestures -- */
{
  const pads = [
    ["kart", "src/components/game/moonberry-racing-canvas.tsx"],
    ["HeartRush", "src/components/game/heartrush-canvas.tsx"],
    ["Lantern Leap", "src/components/game/lantern-leap/lantern-leap-canvas.tsx"],
  ] as const;

  for (const [name, path] of pads) {
    const source = readFileSync(path, "utf8");

    assert.ok(source.includes("TOUCH_BUTTON_BASE"),
      `${name}'s pad must size its buttons from the shared base, not its own padding`);

    // A bespoke class string with its own vertical padding is how each pad
    // drifted under the minimum in the first place.
    const bespoke = source.match(/const buttonClass\s*=\s*\n?\s*"pointer-events-auto[^;]*py-\d/);
    assert.equal(bespoke, null, `${name} still sizes a pad button by padding alone`);

    /* touch-action: none on the overlay. Without it a drag on the pad is a
       page scroll, which on a phone means steering scrolls the page and the
       kart carries straight on. */
    assert.ok(/touch-none/.test(source), `${name}'s pad overlay must disable native touch gestures`);
    assert.ok(/pointer-events-none absolute inset-0 touch-none/.test(source),
      `${name}'s overlay must cover the canvas without swallowing taps meant for it`);
  }
  results.push(`overlays  ${pads.length} pads use the shared size · none size by padding · all disable page gestures`);
}

/* -- the drag surfaces you play ON, not just the pads -- */
{
  // Pool is dragged from the cue ball and bowling is a swipe, both directly
  // on the play surface. If those elements do not block native gestures the
  // shot becomes a page scroll.
  for (const [name, path, marker] of [
    ["pool table", "src/components/game/pool-canvas.tsx", "touch-none"],
    ["bowling lane", "src/components/game/moonberry-bowling-canvas.tsx", "touch-none"],
  ] as const) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(marker), `the ${name} is dragged directly, so it must block page gestures`);
    assert.ok(/onPointerDown=/.test(source), `the ${name} must use pointer events, which cover mouse and touch alike`);
  }
  results.push("surfaces  pool and bowling are pointer-driven and block page gestures while you aim");
}

console.log(`\nTouch controls: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
