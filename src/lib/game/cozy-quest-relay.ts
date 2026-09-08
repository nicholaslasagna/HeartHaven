/**
 * Cozy Quest as a shared round.
 *
 * Heart Hunt and Lantern Relay were local click games: the board lived in the
 * Phaser scene, a click mutated it in place, and nobody else could see any of
 * it. This folds both from the shared move log instead, the way Petal Catch
 * does, so several keepers can work one board and every client computes the
 * same result from the same rows.
 *
 * Two things make the fold deterministic without any extra machinery:
 *
 *   * The boards are FIXED layouts, not generated. Every client already draws
 *     the same targets in the same order, so there is no seed to agree on.
 *   * Time comes from `game_moves.created_at`, which the server stamps. The
 *     find bonus depends on how much of the round was left, and taking that
 *     from each device's own clock would have every client scoring the same
 *     move differently — and would let one lie about it.
 */
import type { GameMoveRecord, GameSessionSeat } from "@/lib/game/use-game-session";

export type CozyQuestVariant = "heart-hunt" | "lantern-relay";

export const COZY_QUEST_MOVE_TYPE = "cozy-quest-find";

export type CozyQuestConfig = {
  title: string;
  label: string;
  seconds: number;
  /** Lantern Relay must be lit along the path; the hunt can be any order. */
  ordered: boolean;
  /** Fixed board. Shared by the scene and the fold so they cannot disagree. */
  positions: ReadonlyArray<readonly [number, number]>;
};

export const COZY_QUEST_CONFIG: Record<CozyQuestVariant, CozyQuestConfig> = {
  "heart-hunt": {
    title: "Heart Hunt",
    label: "Find the hidden keepsakes before time runs out.",
    seconds: 50,
    ordered: false,
    positions: [
      [164, 190], [286, 386], [382, 234], [510, 402],
      [628, 220], [736, 374], [432, 326], [220, 292],
    ],
  },
  "lantern-relay": {
    title: "Lantern Relay",
    label: "Light the lantern path in order.",
    seconds: 45,
    ordered: true,
    positions: [
      [172, 410], [270, 342], [374, 420], [474, 332],
      [570, 418], [674, 338], [748, 420],
    ],
  },
};

/** A wrong lantern costs this much, and the score never goes below zero. */
export const COZY_QUEST_WRONG_PENALTY = 10;

export type CozyQuestEntry = {
  moveIndex: number;
  seatIndex: number;
  playerName: string;
  targetIndex: number;
  points: number;
  correct: boolean;
  secondsLeft: number;
};

export type CozyQuestState = {
  /** Target index to the seat that claimed it. */
  claimedBy: Record<number, number>;
  /** Next target for an ordered board; 0 for an unordered one. */
  nextIndex: number;
  foundCount: number;
  score: number;
  seatScores: number[];
  history: CozyQuestEntry[];
  lastEntry: CozyQuestEntry | null;
  allFound: boolean;
  gameOver: boolean;
  secondsLeft: number;
  finalScore: number;
};

/** A find is worth more the more of the round is left. */
export function cozyQuestFindPoints(secondsLeft: number): number {
  const remaining = Number.isFinite(secondsLeft) ? Math.max(0, secondsLeft) : 0;
  return 65 + Math.ceil(remaining * 1.5);
}

/** Coins and hearts for a finished round, from the folded score. */
export function cozyQuestReward(state: CozyQuestState): { coins: number; hearts: number } {
  const coins = 80 + Math.floor(state.finalScore / 5) + (state.allFound ? 60 : 0);
  const hearts = state.allFound ? 4 : state.finalScore > 350 ? 3 : 2;
  return { coins, hearts };
}

function seatName(seats: GameSessionSeat[], seatIndex: number) {
  return seats.find((seat) => seat.seat_index === seatIndex)?.display_name ?? `Seat ${seatIndex + 1}`;
}

export function reduceCozyQuestState(
  moves: GameMoveRecord[],
  seats: GameSessionSeat[],
  variant: CozyQuestVariant,
  startedAtMs: number,
  nowMs: number,
): CozyQuestState {
  const config = COZY_QUEST_CONFIG[variant];
  const targetCount = config.positions.length;
  const playerCount = Math.max(1, seats.length || 1);

  const claimedBy: Record<number, number> = {};
  const seatScores = Array.from({ length: playerCount }, () => 0);
  const history: CozyQuestEntry[] = [];
  let nextIndex = 0;
  let foundCount = 0;
  let score = 0;

  const started = Number.isFinite(startedAtMs) ? startedAtMs : 0;
  const secondsInto = (atMs: number) => Math.max(0, (atMs - started) / 1000);

  for (const move of [...moves].sort((a, b) => a.move_index - b.move_index)) {
    if (move.move_type !== COZY_QUEST_MOVE_TYPE) continue;
    if (move.payload.variant !== variant) continue;

    const at = Date.parse(move.created_at);
    if (!Number.isFinite(at)) continue;
    const left = config.seconds - secondsInto(at);
    // A move stamped after the round closed cannot count, however it arrived.
    if (left <= 0) continue;

    const targetIndex = Number(move.payload.targetIndex);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= targetCount) continue;
    // First claim wins: a second keeper reaching for the same keepsake is
    // simply late, not an error.
    if (claimedBy[targetIndex] !== undefined) continue;

    const seatIndex = Number.isInteger(move.seat_index) ? move.seat_index : 0;
    const correct = !config.ordered || targetIndex === nextIndex;
    const points = correct ? cozyQuestFindPoints(left) : -COZY_QUEST_WRONG_PENALTY;

    if (correct) {
      claimedBy[targetIndex] = seatIndex;
      foundCount += 1;
      if (config.ordered) nextIndex += 1;
    }

    score = Math.max(0, score + points);
    if (seatIndex >= 0 && seatIndex < seatScores.length) {
      seatScores[seatIndex] = Math.max(0, seatScores[seatIndex] + points);
    }

    history.push({
      moveIndex: move.move_index,
      seatIndex,
      playerName: seatName(seats, seatIndex),
      targetIndex,
      points,
      correct,
      secondsLeft: left,
    });
  }

  const secondsLeft = Math.max(0, config.seconds - secondsInto(Number.isFinite(nowMs) ? nowMs : started));
  const allFound = foundCount >= targetCount;
  const gameOver = allFound || secondsLeft <= 0;

  return {
    claimedBy,
    nextIndex: config.ordered ? nextIndex : 0,
    foundCount,
    score,
    seatScores,
    history,
    lastEntry: history.at(-1) ?? null,
    allFound,
    gameOver,
    secondsLeft,
    finalScore: score,
  };
}
