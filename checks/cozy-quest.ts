/**
 * Cozy Quest shared-round check.
 *
 *   npm run check:cozy-quest
 *
 * Both boards fold from the shared move log, so the reducer decides what
 * every keeper sees. Two people reaching for the same keepsake, a move that
 * lands after the timer, a lantern lit out of order — each has to resolve the
 * same way on every device, or the round diverges and two players see
 * different winners.
 */
import assert from "node:assert/strict";
import {
  COZY_QUEST_CONFIG,
  COZY_QUEST_MOVE_TYPE,
  COZY_QUEST_WRONG_PENALTY,
  cozyQuestFindPoints,
  cozyQuestReward,
  reduceCozyQuestState,
  type CozyQuestVariant,
} from "../src/lib/game/cozy-quest-relay";
import type { GameMoveRecord, GameSessionSeat } from "../src/lib/game/use-game-session";

const results: string[] = [];
const START = Date.parse("2026-09-08T12:00:00.000Z");
const seats: GameSessionSeat[] = [
  { seat_index: 0, display_name: "Rose", profile_id: "p0" },
  { seat_index: 1, display_name: "Sky", profile_id: "p1" },
] as unknown as GameSessionSeat[];

let moveIndex = 0;
function find(seatIndex: number, targetIndex: number, secondsIn: number, variant: CozyQuestVariant): GameMoveRecord {
  return {
    move_index: moveIndex++,
    profile_id: `p${seatIndex}`,
    seat_index: seatIndex,
    move_type: COZY_QUEST_MOVE_TYPE,
    payload: { variant, targetIndex },
    created_at: new Date(START + secondsIn * 1000).toISOString(),
  };
}
const fold = (moves: GameMoveRecord[], variant: CozyQuestVariant, nowSeconds = 1) =>
  reduceCozyQuestState(moves, seats, variant, START, START + nowSeconds * 1000);

/* -- both boards are fixed, so every client draws the same one -- */
{
  for (const variant of ["heart-hunt", "lantern-relay"] as const) {
    const config = COZY_QUEST_CONFIG[variant];
    assert.ok(config.positions.length >= 4, `${variant} needs a board`);
    assert.ok(config.seconds > 0, `${variant} needs a round length`);
    const seen = new Set(config.positions.map(([x, y]) => `${x},${y}`));
    assert.equal(seen.size, config.positions.length, `${variant} must not stack two targets on one spot`);
  }
  assert.equal(COZY_QUEST_CONFIG["lantern-relay"].ordered, true, "the relay is a path");
  assert.equal(COZY_QUEST_CONFIG["heart-hunt"].ordered, false, "the hunt is not");
  results.push("boards    fixed layouts, no duplicate positions · relay is ordered, hunt is not");
}

/* -- two keepers on one board -- */
{
  moveIndex = 0;
  const state = fold([
    find(0, 0, 1, "heart-hunt"),
    find(1, 3, 2, "heart-hunt"),
    find(0, 5, 3, "heart-hunt"),
  ], "heart-hunt");

  assert.equal(state.foundCount, 3, "each keeper's find counts");
  assert.equal(state.claimedBy[0], 0, "the first keepsake belongs to whoever reached it");
  assert.equal(state.claimedBy[3], 1, "and so does the second");
  assert.ok(state.seatScores[0] > 0 && state.seatScores[1] > 0, "both keepers score");
  assert.equal(state.score, state.seatScores[0] + state.seatScores[1], "the shared score is the sum of theirs");

  // THE race: two keepers reaching for the same keepsake. First move wins,
  // and the loser is simply late — not an error, and not a double score.
  moveIndex = 0;
  const raced = fold([find(0, 2, 1, "heart-hunt"), find(1, 2, 1, "heart-hunt")], "heart-hunt");
  assert.equal(raced.foundCount, 1, "one keepsake, one find");
  assert.equal(raced.claimedBy[2], 0, "the earlier move takes it");
  assert.equal(raced.seatScores[1], 0, "the later keeper scores nothing for it");
  results.push("shared    both keepers score on one board · a tie for the same keepsake goes to the earlier move");
}

/* -- the relay must be walked in order -- */
{
  moveIndex = 0;
  const wrong = fold([find(0, 4, 1, "lantern-relay")], "lantern-relay");
  assert.equal(wrong.foundCount, 0, "lighting out of order lights nothing");
  assert.equal(wrong.nextIndex, 0, "and does not advance the path");
  assert.equal(wrong.history[0].correct, false, "it is recorded as a miss");
  assert.equal(wrong.history[0].points, -COZY_QUEST_WRONG_PENALTY, "and costs the penalty");

  moveIndex = 0;
  const walked = fold([
    find(0, 0, 1, "lantern-relay"),
    find(1, 1, 2, "lantern-relay"),
    find(0, 2, 3, "lantern-relay"),
  ], "lantern-relay");
  assert.equal(walked.foundCount, 3, "walking the path in order lights it");
  assert.equal(walked.nextIndex, 3, "and advances");

  // The score can never be driven below zero by repeated mistakes.
  moveIndex = 0;
  const punished = fold(
    Array.from({ length: 6 }, (_, i) => find(0, 6 - (i % 3), 1, "lantern-relay")),
    "lantern-relay");
  assert.ok(punished.score >= 0, "the score floors at zero however many mistakes are made");
  results.push(`relay     out-of-order lights nothing and costs ${COZY_QUEST_WRONG_PENALTY} · in-order advances · score floors at zero`);
}

/* -- moves that must not count -- */
{
  moveIndex = 0;
  const late = fold([find(0, 0, COZY_QUEST_CONFIG["heart-hunt"].seconds + 5, "heart-hunt")], "heart-hunt");
  assert.equal(late.foundCount, 0, "a move stamped after the round closed cannot count");

  moveIndex = 0;
  const wrongVariant = fold([find(0, 0, 1, "lantern-relay")], "heart-hunt");
  assert.equal(wrongVariant.foundCount, 0, "a move from the other quest in the same session is ignored");

  moveIndex = 0;
  const offBoard = fold([find(0, 99, 1, "heart-hunt"), find(0, -1, 1, "heart-hunt")], "heart-hunt");
  assert.equal(offBoard.foundCount, 0, "a target that is not on the board is ignored");

  moveIndex = 0;
  const otherType = fold([{ ...find(0, 0, 1, "heart-hunt"), move_type: "chat" }], "heart-hunt");
  assert.equal(otherType.foundCount, 0, "another move type is ignored");
  results.push("guards    late, off-board, wrong-quest and wrong-type moves all ignored");
}

/* -- folding is deterministic -- */
{
  moveIndex = 0;
  const moves = [find(0, 0, 1, "heart-hunt"), find(1, 1, 2, "heart-hunt"), find(0, 2, 3, "heart-hunt")];
  const a = fold(moves, "heart-hunt");
  const b = fold([...moves].reverse(), "heart-hunt");
  assert.deepEqual(b, a, "array order is irrelevant — the fold sorts by move_index");
  assert.deepEqual(fold(moves, "heart-hunt"), a, "the same log always folds the same");

  // Time comes from the server stamp, so the same log scores the same
  // whatever the local clock says.
  const later = reduceCozyQuestState(moves, seats, "heart-hunt", START, START + 30_000);
  assert.equal(later.score, a.score, "a device joining later reads the same score");
  assert.ok(later.secondsLeft < a.secondsLeft, "though it sees less time remaining");
  results.push("fold      order-independent · repeatable · a late joiner reads the same score from the same rows");
}

/* -- finishing -- */
{
  moveIndex = 0;
  const all = fold(
    COZY_QUEST_CONFIG["heart-hunt"].positions.map((_, i) => find(i % 2, i, 1 + i, "heart-hunt")),
    "heart-hunt");
  assert.equal(all.allFound, true, "clearing the board finishes the round");
  assert.equal(all.gameOver, true, "and ends it");
  const reward = cozyQuestReward(all);
  assert.ok(reward.coins > 0 && reward.hearts > 0, "a finished round pays");
  assert.ok(cozyQuestReward(all).coins > cozyQuestReward({ ...all, allFound: false, finalScore: 0 }).coins,
    "clearing the whole board pays more than not");

  const timedOut = fold([], "heart-hunt", COZY_QUEST_CONFIG["heart-hunt"].seconds + 1);
  assert.equal(timedOut.gameOver, true, "the timer ends the round on its own");
  assert.equal(timedOut.allFound, false, "without a clear");
  assert.equal(timedOut.secondsLeft, 0, "and no time left");

  assert.ok(cozyQuestFindPoints(40) > cozyQuestFindPoints(5), "finding early is worth more");
  assert.ok(cozyQuestFindPoints(-5) >= 65, "a nonsense clock cannot produce a negative find");
  results.push("finish    clearing the board or running out of time ends it · early finds pay more · rewards scale");
}

console.log(`\nCozy Quest: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
