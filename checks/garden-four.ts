/**
 * Garden Four board and state check.
 *
 *   npm run check:garden-four
 *
 * The win detection lives in SQL, so what is worth pinning here is the seam
 * either side of it: that the client and the server agree on the shape of
 * the board, and that the state the server sends survives parsing intact.
 *
 * The board-size assertion is not theoretical. Multiplayer Pool rejected
 * every shot for two months because the client racked 16 balls and the
 * server validated 10, and Memory Match dealt duplicate hearts when the two
 * decks drifted apart. Garden Four has the same shape — a grid defined in
 * the canvas and a grid defined in submit_game_move — so the two are checked
 * against each other rather than trusted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGardenFourState } from "../src/lib/game/garden-four-state";

const results: string[] = [];

/* -- client and server agree on the grid -- */
{
  const canvas = readFileSync("src/components/game/garden-four-canvas.tsx", "utf8");
  const columns = Number(canvas.match(/const COLUMNS = (\d+)/)?.[1]);
  const rows = Number(canvas.match(/const ROWS = (\d+)/)?.[1]);
  assert.ok(Number.isInteger(columns) && Number.isInteger(rows),
    "the canvas must declare its grid as plain constants so this can be checked");

  const migration = readFileSync("supabase/migrations/0038_garden_four_win_detection.sql", "utf8");
  const serverRows = Number(migration.match(/p_rows integer default (\d+)/)?.[1]);
  const serverCols = Number(migration.match(/p_cols integer default (\d+)/)?.[1]);
  assert.ok(Number.isInteger(serverRows) && Number.isInteger(serverCols),
    "the migration must declare the grid as defaults so this can be checked");

  assert.equal(columns, serverCols, `client draws ${columns} columns, server validates ${serverCols}`);
  assert.equal(rows, serverRows, `client draws ${rows} rows, server validates ${serverRows}`);

  // Connect Four needs room for a line of four in every direction.
  assert.ok(columns >= 4 && rows >= 4, "a board smaller than four cannot be won");
  results.push(`grid      client and server agree on ${columns}x${rows} · large enough for a line of four`);
}

/* -- state survives the trip -- */
{
  const won = parseGardenFourState({
    board: [[0, 0], [0, 0]],
    gameOver: true,
    isDraw: false,
    winnerSeat: 1,
    winningCells: [[5, 0], [5, 1], [5, 2], [5, 3]],
    finalScore: 420,
    completedAt: "2026-09-08T10:00:00.000Z",
    moveCount: 7,
    currentSeat: 1,
  });
  assert.ok(won, "a finished game must parse");
  assert.equal(won.winnerSeat, 1, "the winner survives");
  assert.equal(won.winningCells.length, 4, "and so does the line to highlight");
  assert.deepEqual(won.winningCells[0], [5, 0], "cells keep their row/column order");
  assert.equal(won.finalScore, 420, "the score survives");

  // Seat 0 is a real seat, and must not be mistaken for "nobody won".
  const seatZero = parseGardenFourState({ board: [], winnerSeat: 0, gameOver: true });
  assert.equal(seatZero?.winnerSeat, 0, "seat 0 winning is not the same as no winner");

  const drawn = parseGardenFourState({ board: [], gameOver: true, isDraw: true, winnerSeat: null });
  assert.equal(drawn?.winnerSeat, null, "a draw has no winner");
  assert.equal(drawn?.isDraw, true, "and says so");
  results.push("state     winner, line and score survive · seat 0 is a winner, not an absence · draws parse");
}

/* -- malformed state must not reach the board renderer -- */
{
  assert.equal(parseGardenFourState(undefined), null, "no metadata is not a game");
  assert.equal(parseGardenFourState({}), null, "metadata without a board is not a game");
  assert.equal(parseGardenFourState({ board: "nope" }), null, "a board must be an array");

  // Half-formed highlight cells would draw somewhere arbitrary on the grid.
  const messy = parseGardenFourState({
    board: [],
    winningCells: [
      [1, 2],          // fine
      "no",            // not a cell
      [3],             // half a cell
      [4, 5, 6],       // extra is ignored, the pair is usable
      [null, 1],       // Number(null) is 0 — must NOT become [0, 1]
      ["", 2],         // Number("") is 0 either — same trap
      [undefined, 3],  // and again
      [-1, 2],         // off the board
      [1.5, 2],        // between squares
      ["7", "8"],      // numeric strings are a real wire format
    ],
  });
  assert.ok(messy, "a usable state with messy highlights still parses");
  assert.deepEqual(messy.winningCells, [[1, 2], [4, 5], [7, 8]],
    "only well-formed cells are kept — a partial cell must not become a coordinate");

  for (const junk of [
    { board: [], winnerSeat: "banana" },
    { board: [], moveCount: "many" },
    { board: [], finalScore: {} },
    { board: [], completedAt: 12345 },
  ]) {
    assert.doesNotThrow(() => parseGardenFourState(junk), `junk metadata must not throw: ${JSON.stringify(junk)}`);
  }
  assert.equal(parseGardenFourState({ board: [], winnerSeat: "banana" })?.winnerSeat, null,
    "an unreadable winner is nobody, not NaN");
  results.push("junk      no board means no game · malformed highlight cells dropped · unreadable winner is nobody");
}

console.log(`\nGarden Four: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
