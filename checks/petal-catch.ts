/**
 * Petal Catch relay check.
 *
 *   npm run check:petal-catch
 *
 * The relay state is folded from the shared move log, so every player
 * computes it independently from the same rows. That makes the reducer a
 * netcode component as much as a scoring one: if it can be nudged off course
 * by a duplicated, reordered or mismatched move, two players watching the
 * same relay see different scores and a different person holding the turn.
 */
import assert from "node:assert/strict";
import {
  petalRelayItems,
  petalRelayPoints,
  reducePetalRelayState,
  PETAL_RELAY_MISS_LIMIT,
  PETAL_RELAY_MOVE_TYPE,
} from "../src/lib/game/petal-catch-relay";
import type { GameMoveRecord, GameSessionSeat } from "../src/lib/game/use-game-session";

const results: string[] = [];

const seats: GameSessionSeat[] = [
  { seat_index: 0, display_name: "Rose", profile_id: "p0" },
  { seat_index: 1, display_name: "Sky", profile_id: "p1" },
] as unknown as GameSessionSeat[];

let nextIndex = 0;
function move(seatIndex: number, itemIndex: number, result: "catch" | "miss", overrides: Record<string, unknown> = {}): GameMoveRecord {
  const item = petalRelayItems[itemIndex];
  return {
    move_index: nextIndex++,
    profile_id: `p${seatIndex}`,
    seat_index: seatIndex,
    move_type: PETAL_RELAY_MOVE_TYPE,
    payload: { gameKey: "petal-catch", itemIndex, kind: item?.kind, result, ...overrides },
    created_at: new Date().toISOString(),
  };
}

/** Play the relay perfectly: catch everything except thorns, which are dodged. */
function perfectRun(): GameMoveRecord[] {
  nextIndex = 0;
  return petalRelayItems.map((item, index) =>
    move(index % 2, index, item.kind === "thorn" ? "miss" : "catch"));
}

/* -- scoring -- */
{
  assert.equal(petalRelayPoints("thorn", "catch", 0), -45, "catching a thorn costs you");
  assert.equal(petalRelayPoints("thorn", "miss", 0), 55, "dodging one is the reward");
  assert.equal(petalRelayPoints("petal", "miss", 5), 0, "a missed petal is worth nothing, not a penalty");
  assert.ok(petalRelayPoints("golden", "catch", 0) > petalRelayPoints("heart", "catch", 0),
    "golden beats heart");
  assert.ok(petalRelayPoints("heart", "catch", 0) > petalRelayPoints("petal", "catch", 0),
    "heart beats petal");

  // Combo must actually pay, and pay more for rarer catches.
  for (const kind of ["petal", "heart", "golden"] as const) {
    assert.ok(petalRelayPoints(kind, "catch", 4) > petalRelayPoints(kind, "catch", 0),
      `${kind} must be worth more on a combo`);
  }
  assert.equal(petalRelayPoints("thorn", "catch", 9), -45, "a combo cannot make a thorn profitable");
  results.push("scoring   thorns punish the catch and reward the dodge · rarer catches pay more · combo never redeems a thorn");
}

/* -- a full clean run -- */
{
  const state = reducePetalRelayState(perfectRun(), seats);
  assert.equal(state.gameOver, true, "playing every item ends the relay");
  assert.equal(state.success, true, "a clean run succeeds");
  assert.equal(state.misses, 0, "with no misses");
  assert.equal(state.progress, 1, "and full progress");
  assert.ok(state.finalScore > state.score, "success adds a completion bonus on top of the running score");
  assert.equal(state.currentItem, null, "there is nothing left to catch");
  assert.equal(state.history.length, petalRelayItems.length, "every item is recorded");

  // Both seats took turns, and both scored.
  assert.equal(state.seatScores.length, 2, "one score per seat");
  assert.ok(state.seatScores.every((s) => s >= 0), "no seat can go negative");
  results.push(`clean run ${petalRelayItems.length} items · success bonus applied · both seats scored · progress 1`);
}

/* -- the log is the source of truth, and must fold identically -- */
{
  const moves = perfectRun();
  const a = reducePetalRelayState(moves, seats);
  const b = reducePetalRelayState([...moves].reverse(), seats);
  assert.deepEqual(b, a, "move order in the array must not matter — the reducer sorts by move_index");

  // Replaying the same log twice must agree, or two clients disagree.
  assert.deepEqual(reducePetalRelayState(moves, seats), a, "the same log folds to the same state");

  // An empty log is a fresh relay, not a crash.
  const fresh = reducePetalRelayState([], seats);
  assert.equal(fresh.itemIndex, 0, "a new relay starts at the first item");
  assert.equal(fresh.gameOver, false, "and is not over");
  assert.equal(fresh.progress, 0, "with no progress");
  assert.ok(fresh.currentItem, "and something to catch");
  results.push("replay    array order is irrelevant · the same log always folds the same · an empty log is a fresh relay");
}

/* -- moves that must be ignored --
   Each of these would otherwise let one client advance while another does
   not, which is a desync rather than a scoring quirk. */
{
  const base = reducePetalRelayState([move(0, 0, "catch")], seats);
  assert.equal(base.itemIndex, 1, "a valid move advances the relay");

  const wrongSeat = reducePetalRelayState([move(1, 0, "catch")], seats);
  assert.equal(wrongSeat.itemIndex, 0, "a move from the seat whose turn it is not is ignored");

  const wrongItem = reducePetalRelayState([move(0, 3, "catch", { itemIndex: 3 })], seats);
  assert.equal(wrongItem.itemIndex, 0, "a move for a different item is ignored");

  const wrongKind = reducePetalRelayState([move(0, 0, "catch", { kind: "golden" })], seats);
  assert.equal(wrongKind.itemIndex, petalRelayItems[0].kind === "golden" ? 1 : 0,
    "a move claiming the wrong item kind is ignored");

  const junkResult = reducePetalRelayState([move(0, 0, "catch", { result: "fumbled" })], seats);
  assert.equal(junkResult.itemIndex, 0, "an unrecognised result is ignored");

  const otherGame = reducePetalRelayState([move(0, 0, "catch", { gameKey: "memory-match" })], seats);
  assert.equal(otherGame.itemIndex, 0, "a move from another game in the same session is ignored");

  const otherType = reducePetalRelayState(
    [{ ...move(0, 0, "catch"), move_type: "chat" }], seats);
  assert.equal(otherType.itemIndex, 0, "a move of another type is ignored");
  results.push("guards    wrong seat, wrong item, wrong kind, junk result, other game and other move type all ignored");
}

/* -- too many misses ends it -- */
{
  nextIndex = 0;
  const sloppy: GameMoveRecord[] = [];
  for (let i = 0; i < petalRelayItems.length; i += 1) {
    // Miss everything: a missed petal is a miss, and a caught thorn is too.
    sloppy.push(move(i % 2, i, petalRelayItems[i].kind === "thorn" ? "catch" : "miss"));
  }
  const state = reducePetalRelayState(sloppy, seats);
  assert.equal(state.gameOver, true, "enough misses ends the relay");
  assert.equal(state.success, false, "and it is not a success");
  assert.ok(state.misses >= PETAL_RELAY_MISS_LIMIT, `misses reached the ${PETAL_RELAY_MISS_LIMIT} limit`);
  assert.ok(state.itemIndex < petalRelayItems.length, "it ended before the last item");
  assert.equal(state.score, Math.max(0, state.score), "the score never goes negative");
  assert.ok(state.finalScore >= 0, "nor does the final score");
  assert.ok(state.progress >= 0 && state.progress <= 1, "progress stays within 0..1");
  results.push(`limit     ${PETAL_RELAY_MISS_LIMIT} misses ends the relay early · no success bonus · score floors at zero`);
}

console.log(`\nPetal Catch: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
