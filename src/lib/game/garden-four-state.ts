export type GardenFourWinningCell = [number, number];

export type GardenFourState = {
  gameOver: boolean;
  isDraw: boolean;
  winnerSeat: number | null;
  winningCells: GardenFourWinningCell[];
  finalScore: number | null;
  completedAt: string | null;
  moveCount: number;
  currentSeat: number;
};

function readWinningCells(value: unknown): GardenFourWinningCell[] {
  if (!Array.isArray(value)) return [];
  const cells: GardenFourWinningCell[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const row = Number(entry[0]);
    const col = Number(entry[1]);
    if (Number.isFinite(row) && Number.isFinite(col)) {
      cells.push([row, col]);
    }
  }
  return cells;
}

export function parseGardenFourState(metadata: Record<string, unknown> | undefined): GardenFourState | null {
  if (!metadata || !Array.isArray(metadata.board)) return null;

  const winnerRaw = metadata.winnerSeat;
  const winnerSeat =
    winnerRaw === null || winnerRaw === undefined ? null : Number(winnerRaw);

  return {
    gameOver: Boolean(metadata.gameOver),
    isDraw: Boolean(metadata.isDraw),
    winnerSeat: Number.isFinite(winnerSeat) ? winnerSeat : null,
    winningCells: readWinningCells(metadata.winningCells),
    finalScore: metadata.finalScore == null ? null : Number(metadata.finalScore),
    completedAt: metadata.completedAt == null ? null : String(metadata.completedAt),
    moveCount: Number(metadata.moveCount ?? 0),
    currentSeat: Number(metadata.currentSeat ?? 0),
  };
}
