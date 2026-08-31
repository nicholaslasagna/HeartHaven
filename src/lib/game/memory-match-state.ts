import type { GameSessionSeat } from "@/lib/game/use-game-session";
import {
  MEMORY_MATCH_MIN_BOARD_SIZE,
  MEMORY_MATCH_PAIR_DATA,
  type MemoryMatchPairId,
} from "@/lib/game/memory-match-deck";

export type MemoryMatchMode = "couples" | "party";

export type MemoryMatchState = {
  mode: MemoryMatchMode;
  board: MemoryMatchPairId[];
  matched: number[];
  revealed: number[];
  currentTurnSeat: number;
  turnOrder: number[];
  scores: number[];
  moves: number;
  matchCount: number;
  gameOver: boolean;
  finalScore: number | null;
  winnerSeats: number[];
  lastResult: "match" | "miss" | null;
  /* The two cards the last turn actually turned over. The server clears
     `revealed` the moment it resolves a pair, so without this the other
     player never sees the second card — they watch one card go up and then
     vanish, which removes the only thing memory match is about. */
  lastPair: number[];
};

function readIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
}

/**
 * Read the board the server actually dealt.
 *
 * Two rules, both learned the hard way:
 *
 * 1. NEVER substitute an unknown card. This used to fall back to "heart", so
 *    the moment the server dealt an id the running client did not know — a
 *    migration applied ahead of the deploy that understands it, which is the
 *    normal order — every unknown card became another heart. The table filled
 *    with duplicates and could not be won. A board we cannot read is refused
 *    outright; the client then says it is waiting for the server, which is
 *    true and recoverable.
 *
 * 2. Do not demand a particular SIZE. The size is the server's to choose. As
 *    long as the deal is coherent, a sixteen-card table and a twenty-four-card
 *    table are both perfectly playable, and neither the migration nor the
 *    deploy has to land first.
 */
function readPairBoard(value: unknown): MemoryMatchPairId[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < MEMORY_MATCH_MIN_BOARD_SIZE || value.length % 2 !== 0) return null;

  const board: MemoryMatchPairId[] = [];
  const seen = new Map<string, number>();
  for (const entry of value) {
    const id = String(entry);
    if (!(id in MEMORY_MATCH_PAIR_DATA)) return null;
    board.push(id as MemoryMatchPairId);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }

  // Every card must have exactly one partner, or the table cannot be cleared.
  for (const count of seen.values()) {
    if (count !== 2) return null;
  }
  return board;
}

export function parseMemoryMatchState(
  metadata: Record<string, unknown> | undefined,
): MemoryMatchState | null {
  if (!metadata) return null;
  const board = readPairBoard(metadata.board);
  if (!board) return null;

  const mode = metadata.mode === "party" ? "party" : "couples";

  return {
    mode,
    board,
    matched: readIntArray(metadata.matched),
    revealed: readIntArray(metadata.revealed),
    lastPair: readIntArray(metadata.lastPair).slice(0, 2),
    currentTurnSeat: Number(metadata.currentTurnSeat ?? 0),
    turnOrder: readIntArray(metadata.turnOrder),
    scores: readIntArray(metadata.scores),
    moves: Number(metadata.moves ?? 0),
    matchCount: Number(metadata.matchCount ?? 0),
    gameOver: Boolean(metadata.gameOver),
    finalScore: metadata.finalScore == null ? null : Number(metadata.finalScore),
    winnerSeats: readIntArray(metadata.winnerSeats),
    lastResult:
      metadata.lastResult === "match" || metadata.lastResult === "miss"
        ? metadata.lastResult
        : null,
  };
}

export function seatDisplayName(seats: GameSessionSeat[], seatIndex: number, fallback: string) {
  return seats.find((seat) => seat.seat_index === seatIndex)?.display_name ?? fallback;
}

export function buildTurnLabels(
  state: MemoryMatchState,
  seats: GameSessionSeat[],
): string[] {
  const order = state.turnOrder.length > 0 ? state.turnOrder : [0, 1];
  return order.map((seatIndex, index) => {
    const name = seatDisplayName(seats, seatIndex, `Seat ${seatIndex + 1}`);
    if (state.mode === "couples") {
      return index === 0 ? name : name;
    }
    return name;
  });
}

export function scoreForSeat(state: MemoryMatchState, seatIndex: number): number {
  const order = state.turnOrder.length > 0 ? state.turnOrder : [0, 1];
  const scoreIndex = order.indexOf(seatIndex);
  if (scoreIndex < 0) return 0;
  return state.scores[scoreIndex] ?? 0;
}
