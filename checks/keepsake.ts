/**
 * Keepsake privacy check.
 *
 *   npm run check:keepsake
 *
 * A keepsake opens on the screen that asks for it. It travels to the other
 * screen only when a place holds exactly two people, so it can never be
 * pushed at a room full of them. Both ends of the relay enforce that, and the
 * receiving end enforces it without trusting the sending end.
 *
 * The counting is by PERSON, not by connection: one keeper with the place
 * open in two tabs is still one keeper, and a moment that silently refused to
 * travel for that reason would be a bad way to find out.
 */
import assert from "node:assert/strict";
import {
  KEEPSAKE_PARTY_SIZE,
  keepsakeIsPrivate,
  keepsakePresentCount,
} from "../src/lib/game/keepsake";

const results: string[] = [];

/** Presence as Supabase hands it over: keyed per client, each an array. */
const presence = (...people: Array<{ id: string; friendCode?: string }>) =>
  Object.fromEntries(people.map((person) => [person.id, [person]]));

/* -- counting people, not connections -- */
{
  assert.equal(keepsakePresentCount(presence()), 0, "an empty place holds nobody");
  assert.equal(
    keepsakePresentCount(presence({ id: "a", friendCode: "AAA-111" })),
    1,
    "alone is one",
  );
  assert.equal(
    keepsakePresentCount(presence(
      { id: "a", friendCode: "AAA-111" },
      { id: "b", friendCode: "BBB-222" },
    )),
    2,
    "two keepers are two",
  );
  assert.equal(
    keepsakePresentCount(presence(
      { id: "tab-1", friendCode: "AAA-111" },
      { id: "tab-2", friendCode: "aaa-111" },
      { id: "b", friendCode: "BBB-222" },
    )),
    2,
    "one keeper in two tabs is still one keeper",
  );
  assert.equal(
    keepsakePresentCount(presence({ id: "guest-1" }, { id: "guest-2" })),
    2,
    "guests without a code fall back to their client id",
  );
  results.push("counting  by keeper code where there is one · two tabs is one person · guests fall back to client id");
}

/* -- junk must read as "not private", never as "just the two of us" -- */
{
  for (const junk of [null, undefined, 0, "", "two", [], { a: null }, { a: "nope" }, { a: [null] }]) {
    assert.equal(keepsakeIsPrivate(junk), false, `junk presence (${JSON.stringify(junk)}) is never private`);
  }
  assert.equal(keepsakePresentCount({ a: [{}] }), 0, "an entry naming nobody counts as nobody");
  results.push("junk      malformed presence never reads as the two of you");
}

/* -- the gate itself -- */
{
  assert.equal(KEEPSAKE_PARTY_SIZE, 2, "it is for two people");
  assert.equal(keepsakeIsPrivate(presence({ id: "a" })), false, "alone: it stays on this screen");
  assert.equal(keepsakeIsPrivate(presence({ id: "a" }, { id: "b" })), true, "the two of you: it travels");
  assert.equal(
    keepsakeIsPrivate(presence({ id: "a" }, { id: "b" }, { id: "c" })),
    false,
    "a third person in the room and it does not travel",
  );
  assert.equal(
    keepsakeIsPrivate(presence(
      { id: "a", friendCode: "AAA-111" },
      { id: "a2", friendCode: "AAA-111" },
      { id: "b", friendCode: "BBB-222" },
    )),
    true,
    "your own second tab must not count as an audience",
  );
  results.push("gate      alone: no · the two of you: yes · a crowd: no · your own extra tab: still yes");
}

console.log(`\nKeepsake: all checks passed\n${results.map((line) => `  ${line}`).join("\n")}\n`);
