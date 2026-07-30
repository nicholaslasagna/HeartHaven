/**
 * Moonberry Racing — items, hazards and contact.
 *
 * The layer that turns power-ups from a list of definitions into something
 * that actually happens to a kart. Pure: no three.js, no clock, no
 * Math.random — item rolls are seeded, hazards are functions of race time,
 * and projectiles integrate on the fixed step. Two clients running the same
 * inputs reach the same outcome, which is what keeps this honest without
 * streaming every fireball.
 *
 * DESIGN RULES enforced here, not just documented:
 *   • Nothing takes control away for longer than MAX_CONTROL_LOSS.
 *   • Every incoming projectile warns its target before it lands.
 *   • A shield eats exactly one hit, then breaks.
 *   • Respawn invulnerability blocks chain hits.
 *   • Contact between karts pushes and scrubs speed — it never traps.
 */

import { applyCollision, applySpinout, type KartBody } from "./kart";
import {
  BOX_RESPAWN,
  POWER_UPS,
  absorbHit,
  pickupSeed,
  positionFraction,
  rollPowerUp,
  speedMultiplier,
  stepEffects,
  type ActiveEffect,
  type PowerUp,
  type PowerUpId,
} from "./powerups";
import { hazardPosition, sampleCourse, type Course } from "./track";

/** Kart footprint used for every contact test. */
export const KART_RADIUS = 0.95;
/** How close you must be to sweep up an item crate. */
export const BOX_REACH = 2.4;

export type Projectile = {
  id: number;
  ownerId: string;
  kind: PowerUpId;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Seconds before it expires on its own. */
  life: number;
};

export type Trap = {
  id: number;
  ownerId: string;
  kind: PowerUpId;
  x: number;
  z: number;
  life: number;
};

/** Anything the combat layer needs to know about a racer. */
export type CombatRacer = {
  id: string;
  seat: number;
  kart: KartBody;
  effects: ActiveEffect[];
  item: PowerUp | null;
  position: number;
  spectator: boolean;
  finishedAt: number | null;
  /** Simulated on this machine. Only the local kart resolves its own fate. */
  local: boolean;
};

export type CombatEvent =
  | { type: "pickup"; racerId: string; item: PowerUpId }
  | { type: "used"; racerId: string; item: PowerUpId }
  | { type: "hit"; racerId: string; by: PowerUpId; sourceId: string | null }
  | { type: "blocked"; racerId: string; by: PowerUpId }
  | { type: "hazard"; racerId: string }
  | { type: "bump"; racerId: string; otherId: string };

const PROJECTILE_SPEED = 26;
const PROJECTILE_LIFE = 4;
const TRAP_LIFE = 20;
const FIZZY_RADIUS = 5.5;

export class Arena {
  readonly projectiles: Projectile[] = [];
  readonly traps: Trap[] = [];
  /** Box index -> race time it becomes available again. */
  private readonly boxCooldown = new Map<number, number>();
  private nextId = 1;

  constructor(
    readonly course: Course,
    /** Lobby setting. With items off, crates never appear and nothing fires. */
    readonly itemsEnabled = true,
  ) {}

  /** Which crates are currently collected, for the renderer. */
  takenBoxes(raceTime: number) {
    const taken = new Set<number>();
    // Items disabled means every crate stays hidden for the whole race.
    if (!this.itemsEnabled) {
      this.course.itemBoxes.forEach((_box, index) => taken.add(index));
      return taken;
    }
    for (const [index, readyAt] of this.boxCooldown) {
      if (raceTime < readyAt) taken.add(index);
    }
    return taken;
  }

  /**
   * Sweep a racer through the crates. Returns any item picked up.
   *
   * A racer already holding something passes straight through, so you cannot
   * bank a stockpile — the crate stays up for whoever is behind.
   */
  private collectBoxes(racer: CombatRacer, raceTime: number, fieldSize: number, events: CombatEvent[]) {
    if (!this.itemsEnabled || racer.item) return;
    this.course.itemBoxes.forEach((box, index) => {
      if (racer.item) return;
      const readyAt = this.boxCooldown.get(index) ?? -Infinity;
      if (raceTime < readyAt) return;

      const at = sampleCourse(this.course, box.t);
      // Crates sit offset from the centreline, same as the renderer draws them.
      if (Math.hypot(racer.kart.x - at.x, racer.kart.z - at.z) > BOX_REACH) return;

      this.boxCooldown.set(index, raceTime + BOX_RESPAWN);
      const item = rollPowerUp(
        pickupSeed(racer.id, index, Math.floor(raceTime)),
        positionFraction(racer.position, fieldSize),
      );
      racer.item = item;
      events.push({ type: "pickup", racerId: racer.id, item: item.id });
    });
  }

  /**
   * Fire whatever the racer is holding. Returns what was used and the pose it
   * fired from, so the caller can broadcast exactly what happened.
   */
  useItem(racer: CombatRacer, events: CombatEvent[]) {
    const item = racer.item;
    if (!item) return null;
    racer.item = null;
    events.push({ type: "used", racerId: racer.id, item: item.id });
    const fired = {
      item: item.id,
      pose: { x: racer.kart.x, z: racer.kart.z, heading: racer.kart.heading },
    };

    switch (item.kind) {
      case "self":
      case "defence": {
        // Applies to the user immediately; no warning needed, no victim.
        racer.effects = [
          ...racer.effects,
          { id: item.id, remaining: item.duration, warning: 0, sourceId: racer.id },
        ];
        return fired;
      }
      case "projectile": {
        const heading = racer.kart.heading;
        this.projectiles.push({
          id: this.nextId++,
          ownerId: racer.id,
          kind: item.id,
          x: racer.kart.x + Math.sin(heading) * 2,
          z: racer.kart.z + Math.cos(heading) * 2,
          vx: Math.sin(heading) * PROJECTILE_SPEED,
          vz: Math.cos(heading) * PROJECTILE_SPEED,
          life: PROJECTILE_LIFE,
        });
        return fired;
      }
      case "trap": {
        const heading = racer.kart.heading;
        this.traps.push({
          id: this.nextId++,
          ownerId: racer.id,
          kind: item.id,
          // Dropped BEHIND, so it threatens whoever is chasing.
          x: racer.kart.x - Math.sin(heading) * 2.5,
          z: racer.kart.z - Math.cos(heading) * 2.5,
          life: TRAP_LIFE,
        });
        return fired;
      }
      case "area": {
        // Immediate shove on everyone close by.
        this.pendingBurst = { x: racer.kart.x, z: racer.kart.z, ownerId: racer.id, kind: item.id };
        return fired;
      }
      default:
        return fired;
    }
  }

  private pendingBurst: { x: number; z: number; ownerId: string; kind: PowerUpId } | null = null;

  /**
   * Land an effect on a racer, respecting shields and invulnerability.
   * Returns true when the hit actually stuck.
   */
  private landHit(racer: CombatRacer, kind: PowerUpId, sourceId: string | null, events: CombatEvent[]) {
    if (racer.spectator || racer.finishedAt !== null) return false;
    if (racer.kart.invulnTimer > 0) return false;

    /* A remote kart's shield, invulnerability and spin are decided on THEIR
       machine, not ours — the same rule the platformer uses for remote
       deaths. We still play the visual so the hit reads, but we do not claim
       it landed, and their next pose report is the truth. */
    if (!racer.local) {
      if (kind === "sugar-spark") applySpinout(racer.kart);
      events.push({ type: "hit", racerId: racer.id, by: kind, sourceId });
      return true;
    }

    const shield = absorbHit(racer.effects);
    if (shield.blocked) {
      racer.effects = shield.effects;
      events.push({ type: "blocked", racerId: racer.id, by: kind });
      return false;
    }

    const item = POWER_UPS[kind];
    racer.effects = [
      ...racer.effects,
      // The warning is a lead time BEFORE the effect bites, so a victim
      // always gets a cue rather than being stopped out of nowhere.
      { id: kind, remaining: item.duration, warning: item.warning, sourceId },
    ];
    events.push({ type: "hit", racerId: racer.id, by: kind, sourceId });
    // Only the spark actually takes the wheel away.
    if (kind === "sugar-spark") applySpinout(racer.kart);
    return true;
  }

  /**
   * Advance one fixed step: effects, projectiles, traps, hazards, contact.
   * `racers` is mutated in place.
   */
  step(racers: CombatRacer[], raceTime: number, dt: number): CombatEvent[] {
    const events: CombatEvent[] = [];
    const active = racers.filter((r) => !r.spectator && r.finishedAt === null);
    const fieldSize = Math.max(1, racers.filter((r) => !r.spectator).length);

    for (const racer of racers) {
      racer.effects = stepEffects(racer.effects, dt);
      /* Only the LOCAL kart may claim a crate. If every client also granted
         items to the remote karts it can see, the same crate would be
         claimed several times over and cooldowns would drift apart. A remote
         pickup arrives through `applyRemotePickup` instead. */
      if (racer.local && !racer.spectator && racer.finishedAt === null) {
        this.collectBoxes(racer, raceTime, fieldSize, events);
      }
    }

    /* -- area burst, queued by useItem -- */
    if (this.pendingBurst) {
      const burst = this.pendingBurst;
      this.pendingBurst = null;
      for (const racer of active) {
        if (racer.id === burst.ownerId) continue;
        const dx = racer.kart.x - burst.x;
        const dz = racer.kart.z - burst.z;
        if (Math.hypot(dx, dz) > FIZZY_RADIUS) continue;
        if (this.landHit(racer, burst.kind, burst.ownerId, events)) {
          applyCollision(racer.kart, dx, dz);
        }
      }
    }

    /* -- projectiles -- */
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const shot = this.projectiles[i];
      shot.life -= dt;
      shot.x += shot.vx * dt;
      shot.z += shot.vz * dt;
      if (shot.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const victim = active.find(
        (racer) =>
          racer.id !== shot.ownerId &&
          Math.hypot(racer.kart.x - shot.x, racer.kart.z - shot.z) < KART_RADIUS + 0.6,
      );
      if (victim) {
        this.landHit(victim, shot.kind, shot.ownerId, events);
        this.projectiles.splice(i, 1);
      }
    }

    /* -- traps: armed for whoever drives over them, including the owner --
       A trap that cannot catch its own dropper rewards blocking the racing
       line with no risk, so it stays live for everyone after a short arming
       delay. */
    for (let i = this.traps.length - 1; i >= 0; i -= 1) {
      const trap = this.traps[i];
      trap.life -= dt;
      if (trap.life <= 0) {
        this.traps.splice(i, 1);
        continue;
      }
      const armed = trap.life < TRAP_LIFE - 0.6;
      const victim = active.find(
        (racer) =>
          (armed || racer.id !== trap.ownerId) &&
          Math.hypot(racer.kart.x - trap.x, racer.kart.z - trap.z) < KART_RADIUS + 0.5,
      );
      if (victim) {
        this.landHit(victim, trap.kind, trap.ownerId, events);
        this.traps.splice(i, 1);
      }
    }

    /* -- course hazards, from the same function the renderer draws -- */
    for (const spec of this.course.hazards) {
      const at = hazardPosition(this.course, spec, raceTime);
      for (const racer of active) {
        if (racer.kart.invulnTimer > 0) continue;
        const dx = racer.kart.x - at.x;
        const dz = racer.kart.z - at.z;
        if (Math.hypot(dx, dz) > at.radius + KART_RADIUS) continue;
        // Airborne over a low hazard clears it, which makes hops meaningful.
        if (racer.kart.y > at.y + at.radius) continue;

        const shield = absorbHit(racer.effects);
        if (shield.blocked) {
          racer.effects = shield.effects;
          events.push({ type: "blocked", racerId: racer.id, by: "sprinkle-shield" });
          continue;
        }
        if (applySpinout(racer.kart)) {
          events.push({ type: "hazard", racerId: racer.id });
        }
      }
    }

    /* -- kart against kart: a shove, never a trap -- */
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i];
        const b = active[j];
        const dx = b.kart.x - a.kart.x;
        const dz = b.kart.z - a.kart.z;
        const distance = Math.hypot(dx, dz);
        if (distance > KART_RADIUS * 2 || distance < 1e-6) continue;
        applyCollision(a.kart, -dx, -dz);
        applyCollision(b.kart, dx, dz);
        events.push({ type: "bump", racerId: a.id, otherId: b.id });
      }
    }

    return events;
  }

  /**
   * A crate claimed on another machine. Marks the same crate spent here, so
   * every client hides and respawns it together.
   */
  applyRemotePickup(racer: CombatRacer | undefined, boxIndex: number, item: PowerUpId, raceTime: number) {
    this.boxCooldown.set(boxIndex, raceTime + BOX_RESPAWN);
    if (racer) racer.item = POWER_UPS[item];
  }

  /**
   * An item used on another machine. The pose travels with the event rather
   * than being read from our copy of their kart, because our copy is up to a
   * broadcast interval stale and a projectile spawned from the wrong place
   * diverges from there on.
   */
  applyRemoteUse(
    racer: CombatRacer | undefined,
    ownerId: string,
    item: PowerUpId,
    pose: { x: number; z: number; heading: number },
  ) {
    if (racer) racer.item = null;
    const spec = POWER_UPS[item];
    switch (spec.kind) {
      case "self":
      case "defence":
        if (racer) {
          racer.effects = [
            ...racer.effects,
            { id: item, remaining: spec.duration, warning: 0, sourceId: ownerId },
          ];
        }
        return;
      case "projectile":
        this.projectiles.push({
          id: this.nextId++,
          ownerId,
          kind: item,
          x: pose.x + Math.sin(pose.heading) * 2,
          z: pose.z + Math.cos(pose.heading) * 2,
          vx: Math.sin(pose.heading) * PROJECTILE_SPEED,
          vz: Math.cos(pose.heading) * PROJECTILE_SPEED,
          life: PROJECTILE_LIFE,
        });
        return;
      case "trap":
        this.traps.push({
          id: this.nextId++,
          ownerId,
          kind: item,
          x: pose.x - Math.sin(pose.heading) * 2.5,
          z: pose.z - Math.cos(pose.heading) * 2.5,
          life: TRAP_LIFE,
        });
        return;
      case "area":
        this.pendingBurst = { x: pose.x, z: pose.z, ownerId, kind: item };
        return;
      default:
        return;
    }
  }

  /** Speed scaling from a racer's live effects, for the handling model. */
  static speedFactor(racer: CombatRacer) {
    return speedMultiplier(racer.effects);
  }

  dispose() {
    this.projectiles.length = 0;
    this.traps.length = 0;
    this.boxCooldown.clear();
  }
}
