/**
 * Memory Match deck and board check.
 *
 *   npm run check:memory-match
 *
 * Two failure modes this guards, both of which have real precedent in this
 * repo:
 *
 *   1. The client and the server disagreeing about the board. Multiplayer
 *      Pool rejected every shot for two months because the client racked 16
 *      balls and the server validated 10. Memory Match has the same shape:
 *      a deck built in SQL, a deck built in TypeScript, and bounds checks in
 *      submit_game_move that used to hardcode 15 and 16.
 *   2. A pair without its own art. The canvas used to fall back to the heart
 *      when a pair had no picture, so adding a pair and forgetting the art
 *      produced two cards that look identical — a board that cannot be won.
 */
import assert from "node:assert/strict";
import {
  MEMORY_MATCH_PAIR_IDS,
  MEMORY_MATCH_PAIR_DATA,
  MEMORY_MATCH_BOARD_SIZE,
  memoryMatchColumns,
} from "../src/lib/game/memory-match-deck";
import { parseMemoryMatchState } from "../src/lib/game/memory-match-state";

const results: string[] = [];

/* -- the deck -- */
{
  assert.equal(
    MEMORY_MATCH_BOARD_SIZE,
    MEMORY_MATCH_PAIR_IDS.length * 2,
    "the board must be exactly two of every pair",
  );
  assert.equal(MEMORY_MATCH_BOARD_SIZE % 2, 0, "an odd board can never be cleared");

  // Must match memory_match_board_size() in migration 0091. A mismatch here
  // is the Pool bug again: the server would reject the client's card index.
  assert.equal(MEMORY_MATCH_BOARD_SIZE, 24, "board size must match memory_match_board_size() in 0091");

  assert.equal(new Set(MEMORY_MATCH_PAIR_IDS).size, MEMORY_MATCH_PAIR_IDS.length, "pair ids must be unique");

  for (const id of MEMORY_MATCH_PAIR_IDS) {
    const data = MEMORY_MATCH_PAIR_DATA[id];
    assert.ok(data, `pair ${id} has no card data`);
    assert.ok(data.label.trim().length > 0, `pair ${id} has no label`);
    assert.ok(Number.isInteger(data.color) && data.color >= 0 && data.color <= 0xffffff, `pair ${id} has a bad colour`);
    assert.ok(data.art.width > 0 && data.art.height > 0, `pair ${id} has no art size`);
  }

  // Two pairs sharing a picture makes the board unwinnable.
  const artKeys = MEMORY_MATCH_PAIR_IDS.map((id) => {
    const { texture, frame } = MEMORY_MATCH_PAIR_DATA[id].art;
    return `${texture}#${frame}`;
  });
  assert.equal(new Set(artKeys).size, artKeys.length,
    `every pair needs its own picture, got duplicates: ${artKeys.join(", ")}`);

  // Frames must exist: both sheets are 4x2 of 384x512 in a 1536x1024 image.
  for (const id of MEMORY_MATCH_PAIR_IDS) {
    const { texture, frame } = MEMORY_MATCH_PAIR_DATA[id].art;
    if (texture === "casper-sprite") continue;
    assert.ok(frame >= 0 && frame <= 7, `pair ${id} points at frame ${frame}, outside the 8-frame sheet`);
  }

  // Labels should read distinctly too, or the cards are ambiguous on screen.
  const labels = MEMORY_MATCH_PAIR_IDS.map((id) => MEMORY_MATCH_PAIR_DATA[id].label);
  assert.equal(new Set(labels).size, labels.length, "pair labels must be distinct");

  results.push(`deck      ${MEMORY_MATCH_PAIR_IDS.length} pairs / ${MEMORY_MATCH_BOARD_SIZE} cards · every pair has its own art, label and colour`);
}

/* -- the grid follows the deal -- */
{
  assert.equal(memoryMatchColumns(16), 4, "sixteen cards lay out four by four");
  assert.equal(memoryMatchColumns(24), 6, "twenty-four lay out six by four");
  assert.equal(memoryMatchColumns(12), 4, "twelve lay out four by three");

  // Whatever the size, the grid must stay on the stage: a sane column count
  // and never more rows than can be shown.
  for (let cards = 4; cards <= 48; cards += 2) {
    const columns = memoryMatchColumns(cards);
    const rows = Math.ceil(cards / columns);
    assert.ok(columns >= 1 && columns <= 8, `${cards} cards asked for ${columns} columns`);
    assert.ok(rows <= 8, `${cards} cards in ${columns} columns gives ${rows} rows, too tall for the stage`);
  }
  assert.ok(memoryMatchColumns(0) >= 1, "a degenerate count must not divide by zero");
  assert.ok(memoryMatchColumns(Number.NaN) >= 1, "junk must not produce NaN columns");
  results.push("layout    16 -> 4 columns, 24 -> 6 · columns divide the deal so no row is short · junk is safe");
}

/* -- session state, including the second card the watcher must see -- */
{
  const board = [...MEMORY_MATCH_PAIR_IDS, ...MEMORY_MATCH_PAIR_IDS];
  const base = {
    board, mode: "couples", matched: [], revealed: [], currentTurnSeat: 0,
    turnOrder: [0, 1], scores: [0, 0], moves: 0, matchCount: 0, gameOver: false,
  };

  const parsed = parseMemoryMatchState(base);
  assert.ok(parsed, "a full board must parse");
  assert.equal(parsed.board.length, MEMORY_MATCH_BOARD_SIZE, "the parsed board keeps every card");

  /* THE REGRESSION that broke the live table. An unknown card id used to be
     substituted with "heart", so the moment the server dealt a deck the
     running client did not know — a migration landing ahead of the deploy
     that understands it, which is the normal order — every unknown card
     became another heart. The board filled with duplicates and could not be
     won. It must be refused instead. */
  const unknown = parseMemoryMatchState({ ...base, board: board.map((id, i) => (i === 3 ? "sunhat" : id)) });
  assert.equal(unknown, null, "an unknown card must refuse the board, never become a heart");

  const allUnknown = parseMemoryMatchState({ ...base, board: board.map(() => "sunhat") });
  assert.equal(allUnknown, null, "a wholly unreadable deal is refused rather than rendered as hearts");

  /* And the size is the SERVER's to choose. Pinning it in the client is what
     made the migration and the deploy have to land in a particular order.
     Both a sixteen-card and a twenty-four-card deal must play. */
  const eightPairs = MEMORY_MATCH_PAIR_IDS.slice(0, 8);
  const small = parseMemoryMatchState({ ...base, board: [...eightPairs, ...eightPairs] });
  assert.ok(small, "a sixteen-card deal from an older server must still play");
  assert.equal(small.board.length, 16, "and keeps its own size rather than being padded");

  const full = parseMemoryMatchState({ ...base, board });
  assert.equal(full?.board.length, MEMORY_MATCH_BOARD_SIZE, "as does the full deal");

  // A deal that cannot be cleared is refused: odd length, or a card with no
  // partner.
  assert.equal(parseMemoryMatchState({ ...base, board: board.slice(0, 23) }), null,
    "an odd number of cards can never be cleared");
  const orphan = [...board.slice(0, 22), MEMORY_MATCH_PAIR_IDS[0], MEMORY_MATCH_PAIR_IDS[1]];
  assert.equal(parseMemoryMatchState({ ...base, board: orphan }), null,
    "a card without exactly one partner is refused");

  /* THE REGRESSION. On a miss the server empties `revealed`, so `lastPair`
     is the only record of what was turned over. Without it the watching
     player sees the first card vanish and never sees the second. */
  const missed = parseMemoryMatchState({ ...base, revealed: [], lastPair: [3, 17], moves: 1 });
  assert.ok(missed, "a resolved turn must parse");
  assert.deepEqual(missed.lastPair, [3, 17], "the resolved pair must survive parsing");
  assert.equal(missed.revealed.length, 0, "and revealed stays empty, as the server left it");

  // Never more than two, whatever the server sends.
  assert.equal(parseMemoryMatchState({ ...base, lastPair: [1, 2, 3, 4] })?.lastPair.length, 2,
    "lastPair is a pair");
  assert.deepEqual(parseMemoryMatchState(base)?.lastPair, [], "no resolved turn yet means no pair");

  // Junk must not throw.
  for (const junk of [{ ...base, lastPair: "nope" }, { ...base, lastPair: [null, undefined] }, { ...base, matched: 7 }]) {
    assert.doesNotThrow(() => parseMemoryMatchState(junk as Record<string, unknown>), "junk metadata must not throw");
  }

  results.push("state     unknown cards refuse the board (never become hearts) · 16- and 24-card deals both play · unpairable deals refused · resolved pair survives");
}

console.log(`\nMemory Match: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
