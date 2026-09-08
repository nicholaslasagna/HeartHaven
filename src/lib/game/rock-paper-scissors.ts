/**
 * Rock paper scissors rules.
 *
 * Pulled out of the client component so the table can be checked. An RPS
 * table is easy to get subtly wrong in a way no one notices for a while —
 * one reversed pair and a single matchup silently favours the wrong seat —
 * and the fix is cheap only if something is asserting the whole 3x3.
 *
 * Rules only. Everything about how a round is displayed, submitted or
 * animated stays in the component.
 */

export type RpsChoice = "rock" | "paper" | "scissors";
export type RpsPlayerId = "blush" | "lavender";
export type RpsOutcome = RpsPlayerId | "tie";

export const RPS_CHOICES: readonly RpsChoice[] = ["rock", "paper", "scissors"] as const;

/** Rounds one player must take to win the match. */
export const RPS_ROUNDS_TO_WIN = 3;

const VALID = new Set<string>(RPS_CHOICES);

/** Seat index to team. Seats beyond the two-player table have no team. */
export function rpsSeatToPlayer(seatIndex: number | null | undefined): RpsPlayerId | null {
  if (seatIndex === 0) return "blush";
  if (seatIndex === 1) return "lavender";
  return null;
}

/** A choice off the wire, or null if it is not one of the three. */
export function rpsChoiceFromPayload(value: unknown): RpsChoice | null {
  if (typeof value !== "string") return null;
  return VALID.has(value) ? (value as RpsChoice) : null;
}

/** Round numbers start at 1; anything unreadable is the first round. */
export function rpsRoundFromPayload(value: unknown): number {
  const round = Number(value);
  return Number.isFinite(round) && round > 0 ? Math.floor(round) : 1;
}

export function rpsWinner(blush: RpsChoice, lavender: RpsChoice): RpsOutcome {
  if (blush === lavender) return "tie";
  if (
    (blush === "rock" && lavender === "scissors") ||
    (blush === "paper" && lavender === "rock") ||
    (blush === "scissors" && lavender === "paper")
  ) {
    return "blush";
  }
  return "lavender";
}
