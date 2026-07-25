/**
 * Lantern Leap — the simulation.
 *
 * Owns rules and state; knows nothing about three.js or React. The renderer
 * reads snapshots out of it, the netcode feeds remote players into it.
 *
 * Deterministic: fixed timestep, no Math.random, no wall-clock reads. Two
 * clients stepping the same inputs from the same start reach the same state,
 * which is what keeps 8-player co-op honest without streaming the world.
 */

import {
  NO_INPUT,
  PHYSICS,
  createPlayerBody,
  stepPlayer,
  touchingHazard,
  type PlayerBody,
  type PlayerInput,
} from "./physics";
import { createEnemy, updateEnemy, type Enemy } from "./entities";
import type { Level } from "./level";

export type LanternPlayer = {
  id: string;
  name: string;
  seat: number;
  local: boolean;
  body: PlayerBody;
  input: PlayerInput;
  squash: number;
  /** NSMB-style: a dead player floats until a teammate frees them. */
  bubbled: boolean;
  bubbleTimer: number;
  coins: number;
  finished: boolean;
  /** Last checkpoint reached, world coords. */
  respawn: { x: number; y: number };
};

export type Pickup = { id: number; kind: string; x: number; y: number; taken: boolean };

export type GameEvent =
  | { type: "coin"; playerId: string; pickupId: number }
  | { type: "gem"; playerId: string; pickupId: number }
  | { type: "stomp"; playerId: string; enemyId: number }
  | { type: "bubble"; playerId: string }
  | { type: "free"; playerId: string }
  | { type: "checkpoint"; playerId: string; x: number; y: number }
  | { type: "finish"; playerId: string; ms: number }
  | { type: "player"; playerId: string; kind: string };

/** How far below the lowest floor a player is considered lost. */
const DEATH_MARGIN = 4;
const BUBBLE_MIN = 1.2;
/** Reach for popping a teammate's bubble. */
const FREE_RADIUS = 1.4;

export class LanternGame {
  readonly players = new Map<string, LanternPlayer>();
  readonly pickups: Pickup[] = [];
  readonly enemies: Enemy[] = [];
  readonly events: GameEvent[] = [];
  time = 0;
  completed = false;

  private accumulator = 0;

  constructor(readonly level: Level) {
    let id = 0;
    for (const spawn of level.spawns) {
      if (spawn.kind === "coin" || spawn.kind === "gem") {
        this.pickups.push({ id: id++, kind: spawn.kind, x: spawn.x, y: spawn.y, taken: false });
      } else if (spawn.kind === "lantern") {
        this.pickups.push({ id: id++, kind: "lantern", x: spawn.x, y: spawn.y, taken: false });
      } else if (spawn.kind === "walker" || spawn.kind === "flyer" || spawn.kind === "spinner") {
        this.enemies.push(createEnemy(this.enemies.length, spawn.kind, spawn.x, spawn.y));
      }
    }
  }

  addPlayer(id: string, name: string, seat: number, local: boolean) {
    const existing = this.players.get(id);
    if (existing) return existing;
    const player: LanternPlayer = {
      id, name, seat, local,
      body: createPlayerBody(this.level.start.x + seat * 0.7, this.level.start.y + 0.2),
      input: { ...NO_INPUT },
      squash: 1,
      bubbled: false,
      bubbleTimer: 0,
      coins: 0,
      finished: false,
      respawn: { ...this.level.start },
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id: string) {
    this.players.delete(id);
  }

  setInput(id: string, input: PlayerInput) {
    const player = this.players.get(id);
    if (player) player.input = input;
  }

  /** Advance by real elapsed seconds, in fixed steps. */
  advance(dt: number) {
    this.accumulator += Math.min(dt, 0.25);
    let steps = 0;
    while (this.accumulator >= PHYSICS.STEP && steps < 30) {
      this.accumulator -= PHYSICS.STEP;
      this.step(PHYSICS.STEP);
      steps += 1;
    }
  }

  private step(dt: number) {
    this.time += dt;

    for (const enemy of this.enemies) updateEnemy(enemy, this.level.grid, dt);

    const rally = this.rallyPoint();

    for (const player of this.players.values()) {
      if (player.finished) continue;

      if (player.bubbled) {
        player.bubbleTimer += dt;
        /* Float toward the living players, not toward the checkpoint. A
           bubble that drifts back to the last lantern is one nobody can
           ever catch up to, which in co-op means the player is simply out
           of the game — the opposite of the mechanic's whole point. */
        const targetX = rally?.x ?? player.respawn.x;
        const targetY = (rally?.y ?? player.respawn.y) + 1.7;
        player.body.x += (targetX - player.body.x) * Math.min(1, dt * 1.4);
        player.body.y += (targetY - player.body.y) * Math.min(1, dt * 1.4);
        player.body.vx = 0;
        player.body.vy = 0;
        continue;
      }

      stepPlayer(player.body, player.input, this.level.grid, dt);
      for (const event of player.body.events) {
        this.events.push({ type: "player", playerId: player.id, kind: event });
        if (event === "land" || event === "pound-land") player.squash = 0.72;
        if (event === "jump" || event === "wall-jump") player.squash = 1.24;
      }
      player.squash += (1 - player.squash) * Math.min(1, dt * 14);

      // Enemies and pickups resolve for everyone, so the world stays
      // consistent on every screen without syncing it.
      this.resolveEnemies(player);
      this.resolvePickups(player);

      /* Damage is different: a remote player's own client decides whether
         they died, and sends us the answer. Judging it here too would fire
         a phantom bubble event on our screen every time we disagree for a
         frame, then get overwritten by the wire value. */
      if (
        player.local &&
        (touchingHazard(player.body, this.level.grid) || player.body.y < -DEATH_MARGIN)
      ) {
        this.bubble(player);
      }

      const goal = this.level.goal;
      if (
        Math.abs(player.body.x - goal.x) < 1.1 &&
        Math.abs(player.body.y - goal.y) < 2.2
      ) {
        player.finished = true;
        this.events.push({ type: "finish", playerId: player.id, ms: Math.round(this.time * 1000) });
        if ([...this.players.values()].every((entry) => entry.finished || entry.bubbled)) {
          this.completed = true;
        }
      }
    }

    this.resolveBubbleRescues();
  }

  private resolveEnemies(player: LanternPlayer) {
    const body = player.body;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = Math.abs(body.x - enemy.x);
      const dy = body.y - enemy.y;
      if (dx > 0.72 || dy > 1.2 || dy < -0.85) continue;

      // Coming down on top of it is a stomp; anything else hurts.
      if (body.vy < 0 && dy > 0.15) {
        enemy.dead = true;
        enemy.deadTimer = 0;
        // Holding jump on the stomp gives the higher bounce.
        body.vy = PHYSICS.JUMP_VELOCITY * (player.input.jump ? 0.95 : 0.72);
        player.squash = 1.3;
        this.events.push({ type: "stomp", playerId: player.id, enemyId: enemy.id });
      } else if (player.local) {
        this.bubble(player);
      }
      return;
    }
  }

  private resolvePickups(player: LanternPlayer) {
    const body = player.body;
    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      if (Math.abs(body.x - pickup.x) > 0.75) continue;
      if (Math.abs(body.y + 0.7 - pickup.y) > 0.95) continue;

      if (pickup.kind === "lantern") {
        pickup.taken = true;
        player.respawn = { x: pickup.x, y: pickup.y };
        this.events.push({ type: "checkpoint", playerId: player.id, x: pickup.x, y: pickup.y });
        continue;
      }
      pickup.taken = true;
      player.coins += pickup.kind === "gem" ? 10 : 1;
      this.events.push({
        type: pickup.kind === "gem" ? "gem" : "coin",
        playerId: player.id,
        pickupId: pickup.id,
      });
    }
  }

  private bubble(player: LanternPlayer) {
    if (player.bubbled) return;
    player.bubbled = true;
    player.bubbleTimer = 0;
    player.body.vx = 0;
    player.body.vy = 0;
    this.events.push({ type: "bubble", playerId: player.id });
  }

  /** Touch a floating teammate to pop them back into the level. */
  private resolveBubbleRescues() {
    const alive = [...this.players.values()].filter((p) => !p.bubbled && !p.finished);
    for (const player of this.players.values()) {
      if (!player.bubbled || player.bubbleTimer < BUBBLE_MIN) continue;

      // Solo play would otherwise deadlock, so a lone keeper self-frees.
      const soloTimeout = this.players.size === 1 && player.bubbleTimer > 2;
      const rescuer = alive.find(
        (other) =>
          Math.abs(other.body.x - player.body.x) < FREE_RADIUS &&
          Math.abs(other.body.y - player.body.y) < FREE_RADIUS + 0.6,
      );
      if (!rescuer && !soloTimeout) continue;

      player.bubbled = false;
      player.bubbleTimer = 0;
      if (rescuer) {
        // Popped by a teammate: rejoin right there with a little hop. Being
        // sent back to the lantern would punish the rescue, not reward it.
        player.body.y += 0.3;
        player.body.vy = 6;
      } else {
        player.body.x = player.respawn.x;
        player.body.y = player.respawn.y + 0.2;
        player.body.vy = 0;
      }
      player.body.vx = 0;
      this.events.push({ type: "free", playerId: player.id });
    }
  }

  /** Camera framing that keeps every active player on screen. */
  cameraFor(aspect: number, viewHeight: number) {
    const everyone = [...this.players.values()];
    // Frame the players actually playing; a bubble in transit would drag
    // the view and zoom everyone out for no reason.
    const active = everyone.some((p) => !p.bubbled) ? everyone.filter((p) => !p.bubbled) : everyone;
    if (active.length === 0) return { x: 0, y: 0, zoom: 1 };

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const player of active) {
      minX = Math.min(minX, player.body.x);
      maxX = Math.max(maxX, player.body.x);
      minY = Math.min(minY, player.body.y);
      maxY = Math.max(maxY, player.body.y);
    }

    const spanX = maxX - minX + 10;
    const spanY = maxY - minY + 7;
    // Zoom out only as far as needed to hold the group, never past 1.
    const zoom = Math.min(1, Math.min((viewHeight * aspect) / spanX, viewHeight / spanY));

    const halfHeight = viewHeight / 2 / zoom;
    const halfWidth = halfHeight * aspect;
    const level = this.level.grid;
    return {
      x: clamp((minX + maxX) / 2, halfWidth, Math.max(halfWidth, level.width - halfWidth)),
      y: clamp((minY + maxY) / 2 + 1, halfHeight - 1.5, Math.max(halfHeight - 1.5, level.height - halfHeight)),
      zoom,
    };
  }

  /** Centre of the players still in the level, for bubbles to drift to. */
  private rallyPoint() {
    let sumX = 0, sumY = 0, count = 0;
    for (const player of this.players.values()) {
      if (player.bubbled || player.finished) continue;
      sumX += player.body.x;
      sumY += player.body.y;
      count += 1;
    }
    return count === 0 ? null : { x: sumX / count, y: sumY / count };
  }

  drainEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
