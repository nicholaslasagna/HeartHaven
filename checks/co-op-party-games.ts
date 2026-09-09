/**
 * Co-op party game check.
 *
 *   npm run check:co-op-party-games
 *
 * Firefly Grove, Moonbeam Bake-Off and Moonlight Melody all fold from the
 * shared move log, so the reducer decides what every player at the table
 * sees. It is also where a desync last hid: migration 0076 had to repair a
 * turn guard that replayed every co-op row without the gameKey filter the
 * client applies, which left any session that hosted a second round
 * permanently out of step.
 */
import assert from "node:assert/strict";
import {
  coOpPartyGames,
  reduceCoopGameState,
  type CoopGameDefinition,
  type CoopGameKey,
} from "../src/lib/game/co-op-party-games";
import type { GameMoveRecord, GameSessionSeat } from "../src/lib/game/use-game-session";

const results: string[] = [];
const KEYS = Object.keys(coOpPartyGames) as CoopGameKey[];
const seats: GameSessionSeat[] = [
  { seat_index: 0, display_name: "Rose", profile_id: "p0" },
  { seat_index: 1, display_name: "Sky", profile_id: "p1" },
] as unknown as GameSessionSeat[];

let moveIndex = 0;
function act(def: CoopGameDefinition, seat: number, actionId: string, extra: Record<string, unknown> = {}): GameMoveRecord {
  return {
    move_index: moveIndex++,
    profile_id: `p${seat}`,
    seat_index: seat,
    move_type: "coop-action",
    payload: { gameKey: def.gameKey, actionId, ...extra },
    created_at: new Date().toISOString(),
  };
}
/** A move that satisfies whichever fields this game grades on. */
function correctMove(def: CoopGameDefinition, seat: number, stepIndex: number): GameMoveRecord {
  const step = def.steps[stepIndex];
  return act(def, seat, step.actionId, {
    value: step.targetValue,
    ingredientId: step.ingredientId,
    routeId: step.routeId,
    formationId: step.formationId,
    beat: step.beat,
    dynamicId: step.dynamicId,
  });
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/* -- the definitions themselves -- */
{
  for (const key of KEYS) {
    const def = coOpPartyGames[key];
    assert.ok(def.steps.length > 0, `${key} needs steps`);
    assert.ok(def.missLimit > 0, `${key} needs a miss limit`);
    assert.ok(def.maxTurns >= def.steps.length,
      `${key} allows ${def.maxTurns} turns for ${def.steps.length} steps — the round could not be completed`);
    for (const step of def.steps) {
      assert.ok(step.points > 0, `${key} step ${step.id} must be worth something`);
      assert.ok(def.actions.some((a) => a.id === step.actionId),
        `${key} step ${step.id} asks for an action the game does not have`);
    }
    assert.equal(new Set(def.steps.map((s) => s.id)).size, def.steps.length, `${key} step ids must be unique`);
  }
  results.push(`games     ${KEYS.length} rounds · every step asks for an action that exists · each is completable within its turn limit`);
}

/* -- THE REGRESSION: the numbers on screen must agree --
   The team score and the per-seat scores are rendered in the same panel. A
   miss used to subtract from the team and from nobody, so after one mistake
   the seats no longer added up to the total directly above them. */
{
  for (const key of KEYS) {
    const def = coOpPartyGames[key];
    moveIndex = 0;
    const moves: GameMoveRecord[] = [];
    for (let step = 0; step < 3; step += 1) moves.push(correctMove(def, step % 2, step));

    const banked = reduceCoopGameState(def, moves, seats);
    assert.equal(sum(banked.seatScores), banked.score, `${key}: seats must add up to the team score`);
    assert.ok(banked.score > 0, `${key}: correct play must score`);

    const wrong = def.actions.find((a) => a.id !== def.steps[3]?.actionId)!.id;
    moves.push(act(def, 1, wrong));
    const missed = reduceCoopGameState(def, moves, seats);

    assert.equal(missed.misses, 1, `${key}: a wrong action is a miss`);
    assert.ok(missed.score < banked.score, `${key}: a miss must cost the team`);
    assert.equal(sum(missed.seatScores), missed.score,
      `${key}: after a miss the seats must still add up to the team score`);
    assert.ok(missed.seatScores[1] < banked.seatScores[1],
      `${key}: the miss must be charged to the seat that made it`);
    assert.equal(missed.seatScores[0], banked.seatScores[0],
      `${key}: and not to anyone else`);
  }
  results.push("scores    seats always add up to the team total · a miss is charged to the seat that made it, and only that seat");
}

/* -- nothing may go negative, however badly it goes -- */
{
  for (const key of KEYS) {
    const def = coOpPartyGames[key];
    moveIndex = 0;
    const wrong = def.actions.find((a) => a.id !== def.steps[0].actionId)!.id;
    const moves = Array.from({ length: 10 }, (_, i) => act(def, i % 2, wrong));
    const state = reduceCoopGameState(def, moves, seats);
    assert.ok(state.score >= 0, `${key}: the team score must never go negative`);
    assert.ok(state.seatScores.every((s) => s >= 0), `${key}: nor may any seat`);
    assert.ok(state.finalScore >= 0, `${key}: nor the final score`);
    assert.equal(state.gameOver, true, `${key}: repeated misses end the round`);
    assert.equal(state.success, false, `${key}: and it is not a success`);
  }
  results.push("floors    a disastrous round bottoms out at zero for the team and every seat, and ends");
}

/* -- turn order and the guards that stop a desync -- */
{
  const def = coOpPartyGames[KEYS[0]];

  moveIndex = 0;
  const outOfTurn = reduceCoopGameState(def, [correctMove(def, 1, 0)], seats);
  assert.equal(outOfTurn.countedMoves, 0, "a move from the seat whose turn it is not is ignored");

  moveIndex = 0;
  const otherGame = reduceCoopGameState(def, [
    { ...correctMove(def, 0, 0), payload: { ...correctMove(def, 0, 0).payload, gameKey: "some-other-game" } },
  ], seats);
  assert.equal(otherGame.countedMoves, 0,
    "a co-op row from a DIFFERENT game in the same session is ignored — this is what 0076 had to repair");

  moveIndex = 0;
  const otherType = reduceCoopGameState(def, [{ ...correctMove(def, 0, 0), move_type: "chat" }], seats);
  assert.equal(otherType.countedMoves, 0, "another move type is ignored");

  moveIndex = 0;
  const unknownAction = reduceCoopGameState(def, [act(def, 0, "not-an-action")], seats);
  assert.equal(unknownAction.countedMoves, 0, "an action the game does not have is ignored");
  results.push("guards    wrong seat, another game's rows, other move types and unknown actions all ignored");
}

/* -- the fold is deterministic -- */
{
  for (const key of KEYS) {
    const def = coOpPartyGames[key];
    moveIndex = 0;
    const moves = [correctMove(def, 0, 0), correctMove(def, 1, 1), correctMove(def, 0, 2)];
    const a = reduceCoopGameState(def, moves, seats);
    const b = reduceCoopGameState(def, [...moves].reverse(), seats);
    assert.deepEqual(b, a, `${key}: array order must not matter — the fold sorts by move_index`);
    assert.deepEqual(reduceCoopGameState(def, moves, seats), a, `${key}: the same log folds the same`);
    assert.equal(a.currentStepIndex, 3, `${key}: three correct steps advance three steps`);
  }
  results.push("fold      order-independent and repeatable, so every player at the table computes the same round");
}

/* -- finishing pays a bonus, and only on a finish -- */
{
  for (const key of KEYS) {
    const def = coOpPartyGames[key];
    moveIndex = 0;
    const moves = def.steps.map((_, index) => correctMove(def, index % 2, index));
    const done = reduceCoopGameState(def, moves, seats);
    assert.equal(done.success, true, `${key}: playing every step completes the round`);
    assert.equal(done.gameOver, true, `${key}: and ends it`);
    assert.equal(done.progress, 1, `${key}: with full progress`);
    assert.ok(done.finalScore > done.score, `${key}: completing pays a bonus on top of the score`);
  }
  results.push("finish    every step played completes the round and pays the completion bonus");
}

console.log(`\nCo-op party games: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
