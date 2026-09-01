export type GardenPlotState = {
  id: string;
  name: string;
  stage: string;
  progress: number;
  accent: string;
  status: string;
  /* When the plot was last watered, ISO, or null if it never has been.
     apply_garden_plot_action enforces the watering cadence from this, and
     hardenGardenPlots runs on every read AND every save — so a field it does
     not know about is stripped in both directions and the cadence would
     silently reset. Anything the server tracks per plot has to be listed
     here too.*/
  wateredAt: string | null;
  /** Waterings since the last harvest. Decides the harvest payout. */
  tended: number;
};

/* Written by apply_garden_plot_action (migration 0092) when a plot is still
   inside its watering cooldown. The canvas checks for it so it does not
   count a refused watering as a real one. */
export const PLOT_STATUS_DAMP_PREFIX = "Soil still damp";

const PLOT_ID_MAX = 64;
const PLOT_NAME_MAX = 64;
const PLOT_STAGE_MAX = 32;
const PLOT_STATUS_MAX = 48;

function clampProgress(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function sanitizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clampTended(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(99, Math.max(0, Math.floor(n)));
}

function sanitizeText(value: unknown, max: number, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : fallback;
}

export function hardenGardenPlots(raw: unknown): GardenPlotState[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: GardenPlotState[] = [];
  for (let i = 0; i < raw.length && cleaned.length < 32; i += 1) {
    const row = raw[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = sanitizeText(r.id, PLOT_ID_MAX, "");
    if (!id) continue;
    cleaned.push({
      id,
      name: sanitizeText(r.name, PLOT_NAME_MAX, "Garden plot"),
      stage: sanitizeText(r.stage, PLOT_STAGE_MAX, "Seed"),
      progress: clampProgress(r.progress),
      accent: sanitizeText(r.accent, 16, "#6E9651"),
      status: sanitizeText(r.status, PLOT_STATUS_MAX, "New"),
      wateredAt: sanitizeTimestamp(r.wateredAt),
      tended: clampTended(r.tended),
    });
  }
  return cleaned;
}

export function mergeGardenPlotsWithDefaults(
  defaults: GardenPlotState[],
  serverPlots: GardenPlotState[] | null,
): GardenPlotState[] {
  if (!serverPlots || serverPlots.length === 0) return defaults;
  const byId = new Map(serverPlots.map((plot) => [plot.id, plot]));
  return defaults.map((plot) => byId.get(plot.id) ?? plot);
}
