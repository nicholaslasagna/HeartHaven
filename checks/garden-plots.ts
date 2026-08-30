/**
 * Garden plot state check.
 *
 *   npm run check:garden-plots
 *
 * hardenGardenPlots runs on every read from the server AND on every save, and
 * it rebuilds each plot from a fixed list of fields. Anything it does not
 * know about is dropped in both directions. That makes it the single most
 * dangerous place to add server-side plot state: the watering cadence lives
 * in `wateredAt`, so a harden that forgot it would quietly reset the cooldown
 * on every sync and watering would go back to being a free button.
 */
import assert from "node:assert/strict";
import {
  hardenGardenPlots,
  mergeGardenPlotsWithDefaults,
  PLOT_STATUS_DAMP_PREFIX,
  type GardenPlotState,
} from "../src/lib/game/garden-plots";

const results: string[] = [];

const serverPlot = {
  id: "plot-a",
  name: "Moonberry",
  stage: "Growing",
  progress: 75,
  accent: "#F4B5BE",
  status: "Watered",
  wateredAt: "2026-08-30T10:15:00.000Z",
  tended: 3,
};

/* -- the cadence fields must survive a round trip -- */
{
  const [plot] = hardenGardenPlots([serverPlot]);
  assert.ok(plot, "a well-formed plot must survive hardening");
  assert.equal(plot.wateredAt, serverPlot.wateredAt, "wateredAt must survive — the cooldown is measured from it");
  assert.equal(plot.tended, 3, "tended must survive — the harvest payout is computed from it");
  assert.equal(plot.progress, 75, "progress must survive");

  // Harden is applied on save too, so a hardened plot must harden to itself.
  const twice = hardenGardenPlots([plot])[0];
  assert.deepEqual(twice, plot, "hardening must be idempotent, or values drift on every sync");
  results.push("round trip wateredAt and tended survive hardening, and hardening is idempotent");
}

/* -- junk must not become a free watering -- */
{
  const bad = hardenGardenPlots([{ ...serverPlot, wateredAt: "not a date", tended: -5 }])[0];
  assert.equal(bad.wateredAt, null, "an unparseable timestamp becomes null rather than a bogus date");
  assert.equal(bad.tended, 0, "negative tending floors at zero, so it cannot inflate a payout");

  const missing = hardenGardenPlots([{ id: "plot-b", name: "Sky Mint" }])[0];
  assert.equal(missing.wateredAt, null, "a plot written before the cadence existed reads as never watered");
  assert.equal(missing.tended, 0, "and as never tended");
  assert.equal(missing.progress, 0, "with no progress");

  const huge = hardenGardenPlots([{ ...serverPlot, tended: 10_000, progress: 9_999 }])[0];
  assert.ok(huge.tended <= 99, "tending is capped");
  assert.equal(huge.progress, 100, "progress is capped at 100");

  for (const junk of [null, undefined, 42, "no", [null], [{}], [{ id: "" }]]) {
    assert.doesNotThrow(() => hardenGardenPlots(junk), `hardening must survive ${JSON.stringify(junk)}`);
  }
  assert.deepEqual(hardenGardenPlots([{ id: "" }]), [], "a plot with no id is dropped");
  results.push("junk      bad timestamps null out · negative tending floors · caps hold · junk never throws");
}

/* -- merging keeps the server's plot, cadence and all -- */
{
  const defaults: GardenPlotState[] = [
    { id: "plot-a", name: "Moonberry", stage: "Seed", progress: 0, accent: "#F4B5BE", status: "New", wateredAt: null, tended: 0 },
    { id: "plot-z", name: "Sky Mint", stage: "Seed", progress: 0, accent: "#5E94B0", status: "New", wateredAt: null, tended: 0 },
  ];
  const merged = mergeGardenPlotsWithDefaults(defaults, hardenGardenPlots([serverPlot]));
  assert.equal(merged.length, 2, "the default layout decides which plots exist");
  const a = merged.find((plot) => plot.id === "plot-a");
  assert.equal(a?.wateredAt, serverPlot.wateredAt, "the server's cadence wins over the default");
  assert.equal(a?.tended, 3, "as does its tending record");
  const z = merged.find((plot) => plot.id === "plot-z");
  assert.equal(z?.wateredAt, null, "a plot the server has never seen keeps its default");

  assert.deepEqual(mergeGardenPlotsWithDefaults(defaults, null), defaults, "no server state means the defaults stand");
  assert.deepEqual(mergeGardenPlotsWithDefaults(defaults, []), defaults, "nor does an empty server list wipe the garden");
  results.push("merge     server cadence wins per plot · unseen plots keep defaults · empty server state is not a wipe");
}

/* -- the refusal marker the canvas keys on -- */
{
  // migration 0092 writes "Soil still damp · 1h 50m" when a plot is inside
  // its cooldown; the canvas uses this prefix to avoid counting a refused
  // watering toward the metrics that unlock abilities.
  assert.ok(PLOT_STATUS_DAMP_PREFIX.length > 0, "the damp marker must not be empty");
  assert.ok(`${PLOT_STATUS_DAMP_PREFIX} · 1h 50m`.startsWith(PLOT_STATUS_DAMP_PREFIX),
    "the marker must match what the server writes");
  assert.ok(!"Watered".startsWith(PLOT_STATUS_DAMP_PREFIX), "a real watering must not look like a refusal");
  assert.ok(!"Ready to harvest".startsWith(PLOT_STATUS_DAMP_PREFIX), "nor must a ready plot");
  results.push("status    the damp marker matches a refusal and nothing else");
}

console.log(`\nGarden plots: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
