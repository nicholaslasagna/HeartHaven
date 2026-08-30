/**
 * Pacing for remote characters in the shared garden and park.
 *
 * Positions arrive as discrete packets. Between them a remote keeper or pet
 * has to be glided from where it was to where it now is, and the ONLY glide
 * length that produces continuous motion is the interval the packets actually
 * arrive at. Too short and the character reaches its target early and freezes
 * until the next packet — which reads as lag or a bad connection even when
 * every packet arrived perfectly on time.
 *
 * That was the bug behind "pets look choppy when someone else controls them":
 * the pet's glide was timed from how far the KEEPER had moved, so a player
 * driving their companion — keeper standing still — gave their pet the 100ms
 * "barely moved" glide against packets ~120ms apart, and it stuttered.
 */

/** Never snap; even a tiny correction is smoothed over this long. */
export const REMOTE_GLIDE_MIN_MS = 90;
/** A gap longer than this is a stall or a tab-away; do not glide for a second. */
export const REMOTE_GLIDE_MAX_MS = 420;
/** Used for the first update, when no interval has been observed yet. */
export const REMOTE_GLIDE_DEFAULT_MS = 190;

/**
 * How long to glide, given the gap since the last applied update.
 * Measured rather than assumed, so it tracks the real connection.
 */
export function remoteGlideMs(sinceLastSyncMs: number | null | undefined): number {
  if (sinceLastSyncMs === null || sinceLastSyncMs === undefined || !Number.isFinite(sinceLastSyncMs)) {
    return REMOTE_GLIDE_DEFAULT_MS;
  }
  if (sinceLastSyncMs < REMOTE_GLIDE_MIN_MS) return REMOTE_GLIDE_MIN_MS;
  if (sinceLastSyncMs > REMOTE_GLIDE_MAX_MS) return REMOTE_GLIDE_MAX_MS;
  return sinceLastSyncMs;
}

/**
 * The share of each packet interval a character spends motionless because its
 * glide finished early. 0 is continuous motion; 0.5 means it is standing
 * still half the time, which is exactly what choppiness is.
 */
export function stallFraction(glideMs: number, arrivalIntervalMs: number): number {
  if (arrivalIntervalMs <= 0) return 0;
  const idle = Math.max(0, arrivalIntervalMs - glideMs);
  return idle / arrivalIntervalMs;
}
