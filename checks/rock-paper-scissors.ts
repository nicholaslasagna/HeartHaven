/**
 * Rock paper scissors rules check.
 *
 *   npm run check:rock-paper-scissors
 *
 * The whole 3x3 table is asserted, not a sample of it. One reversed pair in
 * an RPS table silently favours a seat in a single matchup, which is the kind
 * of thing that survives a long time because every individual game still
 * looks plausible.
 */
import assert from "node:assert/strict";
import {
  rpsChoiceFromPayload,
  rpsRoundFromPayload,
  rpsSeatToPlayer,
  rpsWinner,
  RPS_CHOICES,
  RPS_ROUNDS_TO_WIN,
  type RpsChoice,
} from "../src/lib/game/rock-paper-scissors";

const results: string[] = [];

/* -- the full table -- */
{
  const beats: Record<RpsChoice, RpsChoice> = {
    rock: "scissors",
    paper: "rock",
    scissors: "paper",
  };

  let decided = 0;
  let tied = 0;
  for (const blush of RPS_CHOICES) {
    for (const lavender of RPS_CHOICES) {
      const outcome = rpsWinner(blush, lavender);
      if (blush === lavender) {
        assert.equal(outcome, "tie", `${blush} against itself is a tie`);
        tied += 1;
        continue;
      }
      const expected = beats[blush] === lavender ? "blush" : "lavender";
      assert.equal(outcome, expected, `${blush} against ${lavender} should be ${expected}`);
      decided += 1;
    }
  }
  assert.equal(tied, 3, "exactly the three identical pairings tie");
  assert.equal(decided, 6, "the other six are decided");

  /* Antisymmetry: swapping the seats must swap the winner. A table that
     fails this favours whoever sits in seat 0. */
  for (const a of RPS_CHOICES) {
    for (const b of RPS_CHOICES) {
      if (a === b) continue;
      const forward = rpsWinner(a, b);
      const reversed = rpsWinner(b, a);
      assert.notEqual(forward, "tie", `${a} vs ${b} is decisive`);
      assert.equal(
        reversed,
        forward === "blush" ? "lavender" : "blush",
        `swapping seats must swap the winner for ${a} vs ${b} — otherwise a seat has an edge`,
      );
    }
  }

  // No choice may be strictly best or strictly worst.
  for (const choice of RPS_CHOICES) {
    const wins = RPS_CHOICES.filter((other) => rpsWinner(choice, other) === "blush").length;
    const losses = RPS_CHOICES.filter((other) => rpsWinner(choice, other) === "lavender").length;
    assert.equal(wins, 1, `${choice} must beat exactly one other choice`);
    assert.equal(losses, 1, `${choice} must lose to exactly one other choice`);
  }
  results.push("table     all 9 pairings correct · swapping seats swaps the winner · each choice beats one and loses to one");
}

/* -- seats and payloads off the wire -- */
{
  assert.equal(rpsSeatToPlayer(0), "blush", "seat 0 is the first team");
  assert.equal(rpsSeatToPlayer(1), "lavender", "seat 1 is the second");
  for (const seat of [2, -1, null, undefined, Number.NaN]) {
    assert.equal(rpsSeatToPlayer(seat), null, `seat ${seat} is not at this two-player table`);
  }

  for (const choice of RPS_CHOICES) {
    assert.equal(rpsChoiceFromPayload(choice), choice, `${choice} survives the wire`);
  }
  for (const junk of ["lizard", "spock", "ROCK", "", null, undefined, 7, {}, ["rock"]]) {
    assert.equal(rpsChoiceFromPayload(junk), null, `${JSON.stringify(junk)} is not a choice`);
  }

  assert.equal(rpsRoundFromPayload(3), 3, "a round number survives");
  assert.equal(rpsRoundFromPayload("4"), 4, "including as a string");
  assert.equal(rpsRoundFromPayload(2.7), 2, "fractional rounds floor");
  for (const junk of [0, -1, "nope", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(rpsRoundFromPayload(junk), 1, `${junk} falls back to the first round, never 0 or negative`);
  }
  results.push("wire      only the three choices are accepted · unknown seats have no team · rounds start at 1, never below");
}

/* -- match length -- */
{
  assert.equal(RPS_ROUNDS_TO_WIN, 3, "best of five means first to three");
  assert.ok(RPS_ROUNDS_TO_WIN > 0, "a match must be winnable");
  results.push(`match     first to ${RPS_ROUNDS_TO_WIN} takes it`);
}

console.log(`\nRock Paper Scissors: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
