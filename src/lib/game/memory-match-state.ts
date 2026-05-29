import type { GameSessionSeat } from "@/lib/game/use-game-session";
import {
  MEMORY_MATCH_BOARD_SIZE,
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
};

function readIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
}

function readPairBoard(value: unknown): MemoryMatchPairId[] {
  if (!Array.isArray(value) || value.length < MEMORY_MATCH_BOARD_SIZE) return [];
  return value.slice(0, MEMORY_MATCH_BOARD_SIZE).map((entry) => {
    const id = String(entry);
    return id in MEMORY_MATCH_PAIR_DATA ? (id as MemoryMatchPairId) : "heart";
  });
}

export function parseMemoryMatchState(
  metadata: Record<string, unknown> | undefined,
): MemoryMatchState | null {
  if (!metadata) return null;
  const board = readPairBoard(metadata.board);
  if (board.length < MEMORY_MATCH_BOARD_SIZE) return null;

  const mode = metadata.mode === "party" ? "party" : "couples";

  return {
    mode,
    board,
    matched: readIntArray(metadata.matched),
    revealed: readIntArray(metadata.revealed),
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
