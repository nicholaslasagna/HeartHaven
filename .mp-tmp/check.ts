import assert from "node:assert/strict";
import { LanternGame } from "../src/lib/game/lantern-leap/game";
import { parseLevel } from "../src/lib/game/lantern-leap/level";
import { NO_INPUT, type PlayerInput } from "../src/lib/game/lantern-leap/physics";

// Ledge, 3-tile pit, then a long run to the goal.
const level = parseLevel({ id: "mp", name: "MP", theme: "dusk", parTime: 99 }, [
  "                                        ",
  "  p     o                            G  ",
  "  ###########   #######################  ",
  "  ###########   #######################  ",
]);
const input = (o: Partial<PlayerInput> = {}): PlayerInput => ({ ...NO_INPUT, ...o });
const run = (g: LanternGame, seconds: number) => { for (let i = 0; i < seconds * 60; i += 1) g.advance(1 / 60); };

/* --- 8 players all spawn, none overlap into a crash, camera holds them --- */
{
  const g = new LanternGame(level);
  for (let i = 0; i < 8; i += 1) g.addPlayer(`p${i}`, `P${i}`, i, i === 0);
  assert.equal(g.players.size, 8);
  run(g, 1);
  for (const p of g.players.values()) assert.ok(Number.isFinite(p.body.x) && Number.isFinite(p.body.y), "no NaN");

  const tight = g.cameraFor(16 / 9, 15);
  // Spread them far apart; the camera must zoom out to hold the group.
  [...g.players.values()].forEach((p, i) => { p.body.x = 4 + i * 4; });
  const wide = g.cameraFor(16 / 9, 15);
  assert.ok(wide.zoom < tight.zoom, `camera must zoom out for a spread group (${wide.zoom} < ${tight.zoom})`);
  assert.ok(wide.zoom > 0.1, "but not collapse");
}

/* --- a bubbled player floats to the GROUP, not back to the checkpoint --- */
{
  const g = new LanternGame(level);
  const a = g.addPlayer("a", "A", 0, true);
  const b = g.addPlayer("b", "B", 1, true);
  run(g, 0.5);
  // Walk B far to the right, well past the pit.
  b.body.x = 30; b.body.y = 2;
  // Kill A in the pit.
  a.body.x = 13; a.body.y = -10;
  run(g, 0.2);
  assert.ok(a.bubbled, "falling into the pit must bubble");
  const startDist = Math.abs(a.body.x - b.body.x);
  run(g, 1.0);
  const endDist = Math.abs(a.body.x - b.body.x);
  assert.ok(endDist < startDist, `bubble must drift toward the group (${startDist.toFixed(1)} -> ${endDist.toFixed(1)})`);
  assert.ok(a.body.x > 10, `and not back to the spawn checkpoint (x=${a.body.x.toFixed(1)})`);
}

/* --- a teammate popping the bubble frees you IN PLACE, not at the lantern --- */
{
  const g = new LanternGame(level);
  const a = g.addPlayer("a", "A", 0, true);
  const b = g.addPlayer("b", "B", 1, true);
  run(g, 0.5);
  b.body.x = 25; b.body.y = 2;
  a.body.x = 13; a.body.y = -10;
  run(g, 0.2);
  assert.ok(a.bubbled);
  run(g, 3.0);   // drift to B, get popped
  assert.ok(!a.bubbled, "a teammate in range must free the bubble");
  assert.ok(Math.abs(a.body.x - b.body.x) < 6, `freed next to the rescuer, not at spawn (a=${a.body.x.toFixed(1)} b=${b.body.x.toFixed(1)})`);
  assert.ok(a.body.x > 15, "definitely not teleported back to the start");
}

/* --- solo play still self-rescues to the checkpoint, no deadlock --- */
{
  const g = new LanternGame(level);
  const a = g.addPlayer("a", "A", 0, true);
  run(g, 0.5);
  a.body.x = 13; a.body.y = -10;
  run(g, 0.2);
  assert.ok(a.bubbled, "solo player bubbles");
  run(g, 4);
  assert.ok(!a.bubbled, "a lone keeper must self-free rather than deadlock");
  assert.ok(Math.abs(a.body.x - level.start.x) < 2, `solo respawn returns to the checkpoint (x=${a.body.x.toFixed(1)})`);
}

/* --- remote players are authoritative over their own death --- */
{
  const g = new LanternGame(level);
  const local = g.addPlayer("me", "Me", 0, true);
  const remote = g.addPlayer("them", "Them", 1, false);
  run(g, 0.5);
  // Drop BOTH into the pit. Only the local one may bubble locally; the
  // remote's own client decides and tells us over the wire.
  local.body.x = 13; local.body.y = -10;
  remote.body.x = 13; remote.body.y = -10;
  run(g, 0.3);
  assert.ok(local.bubbled, "local player bubbles from the pit");
  assert.ok(!remote.bubbled, "remote player must NOT be bubbled by our simulation");
}

/* --- pickups are shared: whoever touches it, everyone sees it gone --- */
{
  const g = new LanternGame(level);
  g.addPlayer("a", "A", 0, true);
  const b = g.addPlayer("b", "B", 1, false);
  run(g, 0.5);
  const coin = g.pickups.find((p) => p.kind === "coin")!;
  assert.ok(!coin.taken);
  // The REMOTE player walks onto it; the coin must still vanish for us.
  b.body.x = coin.x; b.body.y = coin.y - 0.7;
  run(g, 0.1);
  assert.ok(coin.taken, "a remote player's pickup must resolve locally too");
}

console.log("lantern-leap multiplayer OK");
