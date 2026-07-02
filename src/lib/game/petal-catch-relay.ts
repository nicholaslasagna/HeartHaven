import type { GameMoveRecord, GameSessionSeat } from "@/lib/game/use-game-session";

export type PetalRelayKind = "petal" | "heart" | "golden" | "thorn";
export type PetalRelayResult = "catch" | "miss";

export type PetalRelayItem = {
  id: string;
  kind: PetalRelayKind;
  x: number;
  speed: number;
  sway: number;
};

export type PetalRelayHistoryEntry = {
  moveIndex: number;
  seatIndex: number;
  playerName: string;
  itemIndex: number;
  kind: PetalRelayKind;
  result: PetalRelayResult;
  points: number;
  comboAfter: number;
  copy: string;
};

export type PetalRelayState = {
  itemIndex: number;
  currentItem: PetalRelayItem | null;
  currentSeat: number;
  score: number;
  combo: number;
  misses: number;
  progress: number;
  seatScores: number[];
  history: PetalRelayHistoryEntry[];
  lastEntry: PetalRelayHistoryEntry | null;
  gameOver: boolean;
  success: boolean;
  finalScore: number;
};

const relayPattern: Array<Omit<PetalRelayItem, "id">> = [
  { kind: "petal", x: 136, speed: 118, sway: 0.65 },
  { kind: "petal", x: 392, speed: 126, sway: -0.45 },
  { kind: "heart", x: 662, speed: 132, sway: 0.55 },
  { kind: "thorn", x: 252, speed: 138, sway: -0.6 },
  { kind: "petal", x: 744, speed: 144, sway: 0.38 },
  { kind: "golden", x: 482, speed: 150, sway: -0.36 },
  { kind: "petal", x: 178, speed: 156, sway: 0.48 },
  { kind: "heart", x: 586, speed: 162, sway: -0.52 },
  { kind: "thorn", x: 708, speed: 168, sway: 0.44 },
  { kind: "petal", x: 328, speed: 174, sway: -0.5 },
  { kind: "petal", x: 792, speed: 180, sway: 0.34 },
  { kind: "heart", x: 224, speed: 186, sway: -0.42 },
  { kind: "golden", x: 618, speed: 194, sway: 0.5 },
  { kind: "thorn", x: 438, speed: 202, sway: -0.34 },
  { kind: "petal", x: 112, speed: 206, sway: 0.58 },
  { kind: "heart", x: 756, speed: 212, sway: -0.54 },
  { kind: "petal", x: 514, speed: 218, sway: 0.36 },
  { kind: "thorn", x: 288, speed: 224, sway: -0.44 },
  { kind: "golden", x: 676, speed: 230, sway: 0.46 },
  { kind: "petal", x: 374, speed: 236, sway: -0.38 },
  { kind: "heart", x: 152, speed: 242, sway: 0.52 },
  { kind: "petal", x: 818, speed: 248, sway: -0.4 },
  { kind: "golden", x: 466, speed: 254, sway: 0.33 },
  { kind: "heart", x: 704, speed: 260, sway: -0.48 },
];

export const petalRelayItems: PetalRelayItem[] = relayPattern.map((item, index) => ({
  ...item,
  id: `relay-${index + 1}-${item.kind}`,
}));

export const PETAL_RELAY_MOVE_TYPE = "petal-catch-relay";
export const PETAL_RELAY_MISS_LIMIT = 8;

export function petalRelayKindLabel(kind: PetalRelayKind) {
  if (kind === "heart") return "Heart";
  if (kind === "golden") return "Moon petal";
  if (kind === "thorn") return "Thorn";
  return "Petal";
}

export function petalRelayPoints(kind: PetalRelayKind, result: PetalRelayResult, combo: number) {
  if (result === "miss") {
    return kind === "thorn" ? 55 : 0;
  }
  if (kind === "thorn") return -45;
  if (kind === "heart") return 120 + combo * 10;
  if (kind === "golden") return 180 + combo * 14;
  return 75 + combo * 8;
}

function seatName(seats: GameSessionSeat[], seatIndex: number) {
  return seats.find((seat) => seat.seat_index === seatIndex)?.display_name ?? `Seat ${seatIndex + 1}`;
}

function coerceRelayKind(value: unknown): PetalRelayKind | null {
  return value === "petal" || value === "heart" || value === "golden" || value === "thorn" ? value : null;
}

function coerceRelayResult(value: unknown): PetalRelayResult | null {
  return value === "catch" || value === "miss" ? value : null;
}

export function reducePetalRelayState(moves: GameMoveRecord[], seats: GameSessionSeat[]): PetalRelayState {
  const playerCount = Math.max(1, seats.length || 1);
  const seatScores = Array.from({ length: playerCount }, () => 0);
  const history: PetalRelayHistoryEntry[] = [];
  let itemIndex = 0;
  let currentSeat = 0;
  let score = 0;
  let combo = 0;
  let misses = 0;
  let gameOver = false;

  const orderedMoves = [...moves].sort((a, b) => a.move_index - b.move_index);
  for (const move of orderedMoves) {
    if (move.move_type !== PETAL_RELAY_MOVE_TYPE) continue;
    if (move.payload.gameKey !== "petal-catch") continue;
    if (gameOver) continue;
    if (move.seat_index !== currentSeat) continue;

    const item = petalRelayItems[itemIndex];
    if (!item) {
      gameOver = true;
      break;
    }

    const payloadItemIndex = Number(move.payload.itemIndex ?? -1);
    const payloadKind = coerceRelayKind(move.payload.kind);
    const result = coerceRelayResult(move.payload.result);
    if (payloadItemIndex !== itemIndex || payloadKind !== item.kind || !result) continue;

    const points = petalRelayPoints(item.kind, result, combo);
    if (result === "catch" && item.kind !== "thorn") {
      combo += 1;
    } else if (result === "miss" && item.kind === "thorn") {
      combo += 1;
    } else {
      combo = 0;
      misses += 1;
    }

    score = Math.max(0, score + points);
    seatScores[currentSeat] = Math.max(0, (seatScores[currentSeat] ?? 0) + points);

    history.push({
      moveIndex: move.move_index,
      seatIndex: currentSeat,
      playerName: seatName(seats, currentSeat),
      itemIndex,
      kind: item.kind,
      result,
      points,
      comboAfter: combo,
      copy:
        result === "catch"
          ? item.kind === "thorn"
            ? "caught a thorn"
            : `caught a ${petalRelayKindLabel(item.kind).toLowerCase()}`
          : item.kind === "thorn"
            ? "dodged a thorn"
            : `missed a ${petalRelayKindLabel(item.kind).toLowerCase()}`,
    });

    itemIndex += 1;
    gameOver = itemIndex >= petalRelayItems.length || misses >= PETAL_RELAY_MISS_LIMIT;
    currentSeat = (currentSeat + 1) % playerCount;
  }

  const success = itemIndex >= petalRelayItems.length && misses < PETAL_RELAY_MISS_LIMIT;
  const finalScore = Math.max(0, score + (success ? 300 + combo * 12 : 0));
  return {
    itemIndex,
    currentItem: petalRelayItems[itemIndex] ?? null,
    currentSeat,
    score,
    combo,
    misses,
    progress: Math.min(1, itemIndex / petalRelayItems.length),
    seatScores,
    history: history.toReversed(),
    lastEntry: history.at(-1) ?? null,
    gameOver,
    success,
    finalScore,
  };
}
