"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  heartRushSeatColor,
  type HeartRushRemote,
  type HeartRushState,
} from "@/lib/game/heartrush-shared";
import {
  HEARTRUSH_GRAVITY,
  HEARTRUSH_JUMP_VELOCITY,
  HEARTRUSH_LEVELS,
  HEARTRUSH_MAX_SPEED,
  heartRushLevelSeed,
  planHeartRushCourse,
  type BumperSpec,
  type CoursePlan,
  type PadSpec,
  type RailSpec,
  type SweeperSpec,
} from "@/lib/game/heartrush-course";

/**
 * HeartRush — a 2-8 player 3D obstacle course.
 *
 * Multiplayer model (the reason this is cheap to run):
 *
 *   • EVERY obstacle is a pure function of elapsed race time. A sweeper's
 *     angle is `t * speed`; a moving platform's X is `sin(t * w)`. Give
 *     all clients the same `raceStartAt` timestamp and every course in
 *     the party is frame-identical with ZERO obstacle network traffic.
 *     That is what makes 8 players affordable — we only ever sync the
 *     eight capsules, never the world.
 *
 *   • Player positions arrive as plain broadcast messages (see
 *     heartrush-client) and are lerped toward, so packet loss looks like
 *     smoothing rather than teleporting.
 *
 *   • Movement is client-authoritative. This is a cozy party racer with
 *     friends, and server-authoritative 3D physics is a different project.
 *     Finish TIMES are the thing that matters competitively, and those go
 *     through the ordered `game_moves` log, which is authoritative.
 *
 * ponytail: collision is AABB-top tests against a flat solid list, not a
 * physics engine. Arcade feel is the spec, and a real solver would be
 * ~10x the code. Swap in cannon-es only if we ever need slopes/stacking.
 */

/**
 * Shortest signed turn between two angles, valid for any input.
 *
 * The compact `((a - b + 3PI) % 2PI) - PI` form only holds while the
 * difference stays above -3PI, because JavaScript's `%` keeps the sign of
 * the dividend. Rotations accumulate, so eventually it returns a value
 * outside +/-PI and the avatar snaps the long way round.
 */
function shortestAngle(a: number, b: number) {
  const twoPi = Math.PI * 2;
  let delta = (a - b) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  else if (delta < -Math.PI) delta += twoPi;
  return delta;
}

/** Fixed timestep so physics feel identical on 60Hz and 144Hz screens. */
const STEP = 1 / 60;
/* Jump/gravity/top-speed live in heartrush-course so the generator sizes its
   gaps with the same numbers the physics use here. One source of truth. */
const GRAVITY = -HEARTRUSH_GRAVITY;
const JUMP_VELOCITY = HEARTRUSH_JUMP_VELOCITY;
const MAX_SPEED = HEARTRUSH_MAX_SPEED;
const MOVE_ACCEL = 145;
const FRICTION = 12;
const DIVE_SPEED = 20;
const DIVE_TIME = 0.32;
const DIVE_COOLDOWN = 0.75;
const PLAYER_RADIUS = 0.42;
const FALL_Y = -14;
/** Grace window where a jump still works just after leaving a ledge. */
const COYOTE_TIME = 0.12;
/** Jump pressed slightly before landing still fires. Forgiving on purpose. */
const JUMP_BUFFER = 0.14;

export type { HeartRushRemote, HeartRushState };

type HeartRushCanvasProps = {
  /** Shared wall-clock ms when the race begins. null = not started. */
  raceStartAt: number | null;
  mySeatIndex: number;
  myName: string;
  /** Called ~15x/sec with local state for broadcasting. Never re-renders. */
  onLocalState?: (state: HeartRushState) => void;
  /** Called once when the player crosses the finish line. */
  onFinish?: (elapsedMs: number) => void;
  /** Fires on every checkpoint and every level change. */
  onProgress?: (progress: { level: number; levels: number; checkpoint: number; checkpoints: number }) => void;
  onError?: (message: string) => void;
};

/* ------------------------------------------------------------------ */
/* Course pieces                                                       */
/* ------------------------------------------------------------------ */

type Solid = {
  mesh: THREE.Object3D;
  hx: number;
  hz: number;
  /** Previous world position, so riders inherit platform movement. */
  prev: THREE.Vector3;
  update?: (t: number) => void;
};

/** Anything that pushes the player around: sweepers, bumpers. */
abstract class Obstacle {
  abstract update(t: number): void;
  /** Return an impulse to apply, or null when not touching. */
  abstract collide(pos: THREE.Vector3, vel: THREE.Vector3): THREE.Vector3 | null;
}

/** Half-depth of the arm box, and how far the end caps stick out past it. */
const ARM_HALF_THICKNESS = 0.35;
const ARM_CAP_RADIUS = 0.52;

class Sweeper extends Obstacle {
  readonly pivot: THREE.Group;
  private readonly origin: THREE.Vector3;
  private readonly length: number;
  private readonly speed: number;
  private readonly phase: number;
  private readonly arm: THREE.Mesh;

  constructor(scene: THREE.Scene, spec: SweeperSpec) {
    super();
    this.origin = new THREE.Vector3(spec.x, spec.y, spec.z);
    this.length = spec.length;
    this.speed = spec.speed;
    this.phase = spec.phase;
    const { color } = spec;
    const origin = this.origin;
    const length = this.length;
    this.pivot = new THREE.Group();
    this.pivot.position.copy(origin);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 2.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xf3e6df, roughness: 0.45 }),
    );
    post.position.y = -0.6;
    post.castShadow = true;
    this.pivot.add(post);

    this.arm = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.7, 0.7),
      new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.05 }),
    );
    this.arm.castShadow = true;
    this.pivot.add(this.arm);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
    );
    cap.position.x = length / 2;
    this.arm.add(cap);
    const cap2 = cap.clone();
    cap2.position.x = -length / 2;
    this.arm.add(cap2);

    scene.add(this.pivot);
  }

  update(t: number) {
    this.pivot.rotation.y = t * this.speed + this.phase;
  }

  collide(pos: THREE.Vector3) {
    // Bar sits ~0.9 above the platform; ignore anyone jumping over it.
    const dy = pos.y - this.origin.y;
    if (dy < -0.9 || dy > 1.5) return null;

    /* Work in the arm's local frame: the bar lies along local X, so a hit
       is "inside the arm in X, close to it in Z".

       three.js rotates local→world about Y as
           xw =  x·cos + z·sin
           zw = -x·sin + z·cos
       so world→local is that matrix TRANSPOSED. Applying the forward
       matrix here instead (which is what a Math.cos(-angle) pair does)
       mirrors the box about the arm, leaving the hitbox lagging the
       visible bar by twice the rotation — hits from thin air at one
       angle, a bar you walk straight through at another. */
    const angle = this.pivot.rotation.y;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = pos.x - this.origin.x;
    const dz = pos.z - this.origin.z;
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    // The end caps are spheres centred on the arm ends, so they add reach.
    if (Math.abs(localX) > this.length / 2 + ARM_CAP_RADIUS + PLAYER_RADIUS) return null;
    if (Math.abs(localZ) > ARM_HALF_THICKNESS + PLAYER_RADIUS) return null;

    /* Shove out along the face the player is standing on — local ±Z, which
       is world (±sin, ±cos). A bar sweeping toward you reaches you on its
       leading face, so "away from the bar" is also "the way it was going".
       Plus a hop, so a hit reads as comedic rather than instantly fatal. */
    const dir = localZ >= 0 ? 1 : -1;
    return new THREE.Vector3(sin * dir * 15, 8, cos * dir * 15);
  }
}

class Bumper extends Obstacle {
  readonly mesh: THREE.Mesh;
  private readonly radius: number;
  private readonly phase: number;
  private readonly base: number;
  constructor(scene: THREE.Scene, spec: BumperSpec) {
    super();
    this.radius = spec.radius;
    this.phase = spec.phase;
    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.radius, spec.radius, 1.6, 24),
      new THREE.MeshStandardMaterial({ color: 0xf5a8c0, roughness: 0.2, metalness: 0.1 }),
    );
    this.mesh.position.set(spec.x, spec.y, spec.z);
    this.mesh.castShadow = true;
    this.base = spec.y;
    scene.add(this.mesh);
  }

  update(t: number) {
    const pulse = 1 + Math.sin(t * 3 + this.phase) * 0.08;
    this.mesh.scale.set(pulse, 1, pulse);
    this.mesh.position.y = this.base + Math.sin(t * 2 + this.phase) * 0.12;
  }

  collide(pos: THREE.Vector3) {
    const dx = pos.x - this.mesh.position.x;
    const dz = pos.z - this.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    const reach = this.radius + PLAYER_RADIUS;
    if (dist > reach || dist < 0.0001) return null;
    if (Math.abs(pos.y - this.base) > 1.8) return null;
    const nx = dx / dist;
    const nz = dz / dist;
    return new THREE.Vector3(nx * 19, 7, nz * 19);
  }
}

class Checkpoint {
  readonly index: number;
  readonly position: THREE.Vector3;
  readonly ring: THREE.Mesh;
  private reached = false;
  constructor(scene: THREE.Scene, index: number, position: THREE.Vector3) {
    this.index = index;
    this.position = position.clone();
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6, 0.16, 12, 32),
      new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0x7a5a12, roughness: 0.3 }),
    );
    this.ring.position.copy(position).add(new THREE.Vector3(0, 1.8, 0));
    this.ring.rotation.x = Math.PI / 2;
    scene.add(this.ring);
  }

  update(t: number) {
    this.ring.rotation.z = t * (this.reached ? 2.4 : 0.9);
    this.ring.position.y = this.position.y + 1.8 + Math.sin(t * 2 + this.index) * 0.12;
  }

  /** True the first time the player passes through. */
  tryClaim(pos: THREE.Vector3) {
    if (this.reached) return false;
    if (Math.abs(pos.x - this.position.x) > 4.5) return false;
    if (Math.abs(pos.z - this.position.z) > 1.6) return false;
    this.reached = true;
    const material = this.ring.material as THREE.MeshStandardMaterial;
    material.color.set(0x8ee6a0);
    material.emissive.set(0x1d6b30);
    return true;
  }

}

class Effects {
  private readonly pool: THREE.Mesh[] = [];
  private readonly live: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  constructor(private readonly scene: THREE.Scene) {
    const geometry = new THREE.SphereGeometry(0.13, 8, 6);
    for (let i = 0; i < 90; i += 1) {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }),
      );
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push(mesh);
    }
  }

  burst(at: THREE.Vector3, color: number, count: number, power = 6) {
    for (let i = 0; i < count; i += 1) {
      const mesh = this.pool.pop();
      if (!mesh) return;
      mesh.position.copy(at);
      mesh.visible = true;
      mesh.scale.setScalar(1);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      const angle = Math.random() * Math.PI * 2;
      const speed = power * (0.4 + Math.random() * 0.8);
      this.live.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(angle) * speed, 3 + Math.random() * power, Math.sin(angle) * speed),
        life: 0.6,
      });
    }
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const particle = this.live[i];
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.mesh.visible = false;
        this.pool.push(particle.mesh);
        this.live.splice(i, 1);
        continue;
      }
      particle.vel.y += GRAVITY * dt * 0.5;
      particle.mesh.position.addScaledVector(particle.vel, dt);
      particle.mesh.scale.setScalar(Math.max(0.05, particle.life));
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = particle.life / 0.6;
    }
  }

  dispose() {
    this.pool.forEach((mesh) => this.scene.remove(mesh));
    this.live.forEach((particle) => this.scene.remove(particle.mesh));
  }
}

/* ------------------------------------------------------------------ */
/* Course                                                              */
/* ------------------------------------------------------------------ */

class Course {
  readonly solids: Solid[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly checkpoints: Checkpoint[] = [];
  readonly decor: THREE.Object3D[] = [];
  readonly finishZ: number;
  readonly level: number;
  /** Everything added to the scene, so a level swap can take it all back. */
  private readonly roots: THREE.Object3D[] = [];

  constructor(private readonly scene: THREE.Scene, plan: CoursePlan) {
    this.finishZ = plan.finishZ;
    this.level = plan.level;

    for (const pad of plan.pads) this.addPad(pad);
    for (const spec of plan.sweepers) {
      const sweeper = new Sweeper(scene, spec);
      this.obstacles.push(sweeper);
      this.roots.push(sweeper.pivot);
    }
    for (const spec of plan.bumpers) {
      const bumper = new Bumper(scene, spec);
      this.obstacles.push(bumper);
      this.roots.push(bumper.mesh);
    }
    for (const rail of plan.rails) this.addRail(rail);
    for (const spec of plan.checkpoints) {
      const checkpoint = new Checkpoint(scene, spec.index, new THREE.Vector3(spec.x, spec.y, spec.z));
      this.checkpoints.push(checkpoint);
      this.roots.push(checkpoint.ring);
    }
    if (plan.ramp) this.addRamp(plan.ramp);
    this.addGates(plan);
    this.buildBackdrop();
  }

  private track<T extends THREE.Object3D>(object: T) {
    this.scene.add(object);
    this.roots.push(object);
    return object;
  }

  private addPad(pad: PadSpec) {
    const height = 1;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(pad.width, height, pad.depth),
      new THREE.MeshStandardMaterial({ color: pad.color, roughness: 0.28, metalness: 0.06 }),
    );
    mesh.position.set(pad.x, pad.y - height / 2, pad.z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.track(mesh);

    const sway = pad.sway;
    this.solids.push({
      mesh,
      hx: pad.width / 2,
      hz: pad.depth / 2,
      prev: mesh.position.clone(),
      update: sway
        ? (t: number) => {
            mesh.position.x = pad.x + Math.sin(t * sway.speed + sway.phase) * sway.range;
          }
        : undefined,
    });
  }

  private addRail(rail: RailSpec) {
    // Purely a visual guide on the narrow beam — decor, never a solid.
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.9, rail.depth),
      new THREE.MeshStandardMaterial({ color: 0xfff6ff, roughness: 0.4 }),
    );
    mesh.position.set(rail.x, rail.y, rail.z);
    this.decor.push(this.track(mesh));
  }

  private addRamp(ramp: { z: number; y: number; length: number }) {
    // The stepped pads under this are the real collision; the slab just
    // makes the staircase read as a ramp.
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.6, ramp.length),
      new THREE.MeshStandardMaterial({ color: 0xffc98d, roughness: 0.3 }),
    );
    mesh.position.set(0, ramp.y, ramp.z);
    mesh.rotation.x = -0.28;
    mesh.castShadow = true;
    this.decor.push(this.track(mesh));
  }

  private addGates(plan: CoursePlan) {
    const start = new THREE.Mesh(
      new THREE.TorusGeometry(5, 0.4, 10, 24, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xffb3c9, roughness: 0.3 }),
    );
    start.position.set(0, 0, 10);
    this.decor.push(this.track(start));

    const deck = plan.pads[plan.pads.length - 1];
    const finish = new THREE.Mesh(
      new THREE.TorusGeometry(5.4, 0.5, 12, 28, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x8ee6a0, emissive: 0x1d5c2c, roughness: 0.3 }),
    );
    finish.position.set(0, deck?.y ?? 0, plan.gateZ);
    this.decor.push(this.track(finish));
  }

  private buildBackdrop() {
    // Floating shapes that drift — cheap way to make the void feel alive.
    for (let i = 0; i < 26; i += 1) {
      const geometry = i % 3 === 0
        ? new THREE.IcosahedronGeometry(1.2 + Math.random(), 0)
        : new THREE.TorusGeometry(1.1 + Math.random(), 0.32, 8, 16);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: [0xffc2d6, 0xc7b3ff, 0xa8e6ff, 0xffe6a8][i % 4],
          roughness: 0.4,
        }),
      );
      mesh.position.set(
        (Math.random() - 0.5) * 90,
        -6 + Math.random() * 34,
        10 - Math.random() * (Math.abs(this.finishZ) + 30),
      );
      mesh.userData.spin = (Math.random() - 0.5) * 0.6;
      mesh.userData.bobPhase = Math.random() * Math.PI * 2;
      mesh.userData.baseY = mesh.position.y;
      this.decor.push(this.track(mesh));
    }
  }

  update(t: number) {
    for (const solid of this.solids) {
      if (!solid.update) continue;
      solid.prev.copy(solid.mesh.position);
      solid.update(t);
    }
    for (const obstacle of this.obstacles) obstacle.update(t);
    for (const checkpoint of this.checkpoints) checkpoint.update(t);
    for (const piece of this.decor) {
      if (typeof piece.userData.spin !== "number") continue;
      piece.rotation.y += piece.userData.spin * 0.01;
      piece.rotation.x += piece.userData.spin * 0.004;
      piece.position.y = piece.userData.baseY + Math.sin(t * 0.7 + piece.userData.bobPhase) * 0.6;
    }
  }

  /** Tear the whole level out of the scene before building the next one. */
  dispose() {
    for (const root of this.roots) {
      this.scene.remove(root);
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
    }
    this.roots.length = 0;
    this.solids.length = 0;
    this.obstacles.length = 0;
    this.checkpoints.length = 0;
    this.decor.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

type Input = { x: number; z: number; jump: boolean; dive: boolean };

class Player {
  readonly group: THREE.Group;
  readonly position = new THREE.Vector3(0, 1.2, 6);
  readonly velocity = new THREE.Vector3();
  grounded = false;
  checkpointIndex = 0;
  finished = false;
  private coyote = 0;
  private buffer = 0;
  private diveTimer = 0;
  private diveCooldown = 0;
  private squash = 1;
  private readonly body: THREE.Mesh;

  constructor(scene: THREE.Scene, color: number) {
    this.group = new THREE.Group();
    this.body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.55, 6, 14),
      new THREE.MeshStandardMaterial({ color, roughness: 0.24, metalness: 0.05 }),
    );
    this.body.castShadow = true;
    this.group.add(this.body);

    /* Two eyes so the character reads as facing its travel direction.
       Forward is local +Z: the group is turned with
       `rotation.y = atan2(vx, vz)`, and three.js maps local +Z to world
       (sin, cos) — exactly the velocity. Putting the eyes on -Z is what
       had the capsule running the course while staring back at you. */
    const eyeGeometry = new THREE.SphereGeometry(0.1, 10, 8);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x3a2a2a });
    for (const side of [-0.17, 0.17]) {
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eye.position.set(side, 0.2, PLAYER_RADIUS + 0.02);
      this.body.add(eye);
    }
    scene.add(this.group);
    this.group.position.copy(this.position);
  }

  respawn(at: THREE.Vector3) {
    this.position.copy(at).add(new THREE.Vector3(0, 1.4, 0));
    this.velocity.set(0, 0, 0);
    this.diveTimer = 0;
    this.grounded = false;
  }

  get animState() {
    if (this.diveTimer > 0) return 3;
    if (!this.grounded) return 2;
    return Math.hypot(this.velocity.x, this.velocity.z) > 1.5 ? 1 : 0;
  }

  step(dt: number, input: Input, course: Course, effects: Effects) {
    this.diveCooldown = Math.max(0, this.diveCooldown - dt);
    this.buffer = input.jump ? JUMP_BUFFER : Math.max(0, this.buffer - dt);

    if (this.diveTimer > 0) {
      this.diveTimer -= dt;
    } else if (input.dive && this.diveCooldown <= 0 && (input.x !== 0 || input.z !== 0)) {
      this.diveTimer = DIVE_TIME;
      this.diveCooldown = DIVE_COOLDOWN;
      const length = Math.hypot(input.x, input.z) || 1;
      this.velocity.x = (input.x / length) * DIVE_SPEED;
      this.velocity.z = (input.z / length) * DIVE_SPEED;
      if (this.grounded) this.velocity.y = 5;
      effects.burst(this.position, 0xfff0b0, 8, 4);
    }

    // Horizontal control. A dive keeps its momentum instead of steering.
    if (this.diveTimer <= 0) {
      this.velocity.x += input.x * MOVE_ACCEL * dt;
      this.velocity.z += input.z * MOVE_ACCEL * dt;
      if (input.x === 0) this.velocity.x -= this.velocity.x * Math.min(1, FRICTION * dt);
      if (input.z === 0) this.velocity.z -= this.velocity.z * Math.min(1, FRICTION * dt);
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed > MAX_SPEED) {
        this.velocity.x = (this.velocity.x / speed) * MAX_SPEED;
        this.velocity.z = (this.velocity.z / speed) * MAX_SPEED;
      }
    }

    if (this.grounded) this.coyote = COYOTE_TIME;
    else this.coyote = Math.max(0, this.coyote - dt);

    if (this.buffer > 0 && this.coyote > 0) {
      this.velocity.y = JUMP_VELOCITY;
      this.grounded = false;
      this.coyote = 0;
      this.buffer = 0;
      this.squash = 1.28;
      effects.burst(this.position, 0xffffff, 5, 3);
    }

    this.velocity.y += GRAVITY * dt;

    for (const obstacle of course.obstacles) {
      const impulse = obstacle.collide(this.position, this.velocity);
      if (!impulse) continue;
      this.velocity.copy(impulse);
      this.diveTimer = 0;
      this.grounded = false;
      this.squash = 0.7;
      effects.burst(this.position, 0xffc2d6, 10, 6);
      break;
    }

    const wasGrounded = this.grounded;
    this.position.addScaledVector(this.velocity, dt);
    this.grounded = false;

    // Land on whichever solid top we crossed this step.
    for (const solid of course.solids) {
      const dx = Math.abs(this.position.x - solid.mesh.position.x);
      const dz = Math.abs(this.position.z - solid.mesh.position.z);
      if (dx > solid.hx + PLAYER_RADIUS || dz > solid.hz + PLAYER_RADIUS) continue;

      const top = solid.mesh.position.y + 0.5;
      const feet = this.position.y - 0.85;
      if (this.velocity.y > 0.01) continue;
      if (feet > top + 0.6 || feet < top - 1.2) continue;

      this.position.y = top + 0.85;
      this.velocity.y = 0;
      this.grounded = true;
      // Ride moving platforms.
      if (solid.update) {
        this.position.x += solid.mesh.position.x - solid.prev.x;
        this.position.z += solid.mesh.position.z - solid.prev.z;
      }
      break;
    }

    if (!wasGrounded && this.grounded) {
      this.squash = 0.72;
      effects.burst(this.position.clone().setY(this.position.y - 0.7), 0xffffff, 6, 3);
    }

    this.squash += (1 - this.squash) * Math.min(1, dt * 12);
    this.body.scale.set(2 - this.squash, this.squash, 2 - this.squash);
    this.group.position.copy(this.position);

    // Face travel direction; dive lies the capsule forward.
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.6) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      const delta = shortestAngle(target, this.group.rotation.y);
      this.group.rotation.y += delta * Math.min(1, dt * 12);
    }
    this.body.rotation.x = this.diveTimer > 0 ? -1.1 : this.body.rotation.x * (1 - Math.min(1, dt * 8));
  }
}

/* ------------------------------------------------------------------ */
/* Remote avatars                                                      */
/* ------------------------------------------------------------------ */

function makeNameSprite(name: string, color: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the player name label.");
  context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.font = "bold 40px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 8;
  context.strokeStyle = "rgba(255,255,255,0.95)";
  context.strokeText(name.slice(0, 12), 128, 32);
  context.fillText(name.slice(0, 12), 128, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }),
  );
  sprite.scale.set(2.6, 0.65, 1);
  return sprite;
}

class RemoteAvatar {
  readonly group = new THREE.Group();
  readonly target = new THREE.Vector3();
  constructor(scene: THREE.Scene, name: string, color: number) {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.55, 6, 14),
      new THREE.MeshStandardMaterial({ color, roughness: 0.3, transparent: true, opacity: 0.92 }),
    );
    body.castShadow = true;
    this.group.add(body);
    const label = makeNameSprite(name, color);
    label.position.y = 1.35;
    this.group.add(label);
    scene.add(this.group);
  }

  update(dt: number) {
    // Lerp instead of snapping: dropped packets look like smoothing.
    this.group.position.lerp(this.target, Math.min(1, dt * 9));
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function HeartRushCanvas({
  raceStartAt,
  mySeatIndex,
  myName,
  onLocalState,
  onFinish,
  onProgress,
  onError,
}: HeartRushCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const raceStartRef = useRef(raceStartAt);
  const callbacksRef = useRef({ onLocalState, onFinish, onProgress });
  const resetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    raceStartRef.current = raceStartAt;
  }, [raceStartAt]);

  useEffect(() => {
    callbacksRef.current = { onLocalState, onFinish, onProgress };
  }, [onLocalState, onFinish, onProgress]);

  // A new race start means a fresh run for everyone.
  useEffect(() => {
    if (raceStartAt !== null) resetRef.current?.();
  }, [raceStartAt]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      // No silent fallback: tell the player their browser can't run it.
      onError?.("HeartRush needs WebGL, and this browser refused to start it.");
      return;
    }

    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfe9ff);
    scene.fog = new THREE.Fog(0xbfe9ff, 60, 190);

    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xffd9ec, 1.05));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
    sun.position.set(18, 40, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -60;
    scene.add(sun);

    let course: Course;
    let player: Player;
    let effects: Effects;
    let levelIndex = 0;
    // Set when the player is teleported, so the chase cam cuts instead of
    // flying the length of the old course to catch up.
    let snapCamera = true;

    /* The seed is the shared race-start stamp, so all eight racers plan the
       identical three courses without a byte of extra traffic. */
    const buildLevel = (level: number) => {
      course?.dispose();
      levelIndex = level;
      const plan = planHeartRushCourse(heartRushLevelSeed(raceStartRef.current ?? 1, level), level);
      course = new Course(scene, plan);
      player.checkpointIndex = 0;
      player.respawn(course.checkpoints[0].position);
      snapCamera = true;
      callbacksRef.current.onProgress?.({
        level,
        levels: HEARTRUSH_LEVELS,
        checkpoint: 0,
        checkpoints: course.checkpoints.length - 1,
      });
    };

    try {
      effects = new Effects(scene);
      player = new Player(scene, heartRushSeatColor(mySeatIndex));
      buildLevel(0);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "HeartRush could not build the course.");
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      return;
    }

    const remotes = new Map<string, RemoteAvatar>();

    const input: Input = { x: 0, z: 0, jump: false, dive: false };
    const held = new Set<string>();
    const readInput = () => {
      const left = held.has("a") || held.has("arrowleft");
      const right = held.has("d") || held.has("arrowright");
      const up = held.has("w") || held.has("arrowup");
      const down = held.has("s") || held.has("arrowdown");
      input.x = Number(right) - Number(left);
      input.z = Number(down) - Number(up);
      input.dive = held.has("shift");
    };
    const isTyping = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping()) return;
      const key = event.key.toLowerCase();
      if (key === " " || key === "spacebar") {
        event.preventDefault();
        input.jump = true;
        held.add(" ");
      } else {
        held.add(key);
      }
      if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
      readInput();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      held.delete(key === "spacebar" ? " " : key);
      if (key === " " || key === "spacebar") input.jump = false;
      readInput();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onRemote = (event: Event) => {
      const detail = (event as CustomEvent<{ players?: HeartRushRemote[] }>).detail;
      const list = detail?.players ?? [];
      const seen = new Set<string>();
      for (const entry of list) {
        seen.add(entry.id);
        let avatar = remotes.get(entry.id);
        if (!avatar) {
          avatar = new RemoteAvatar(
            scene,
            entry.name,
            heartRushSeatColor(entry.seat),
          );
          avatar.group.position.set(entry.x, entry.y, entry.z);
          remotes.set(entry.id, avatar);
        }
        avatar.target.set(entry.x, entry.y, entry.z);
      }
      for (const [id, avatar] of remotes) {
        if (seen.has(id)) continue;
        avatar.dispose(scene);
        remotes.delete(id);
      }
    };
    window.addEventListener("hearthaven:heartrush-remote", onRemote);

    const reset = () => {
      player.finished = false;
      buildLevel(0);
    };
    resetRef.current = reset;
    reset();

    const resize = () => {
      const width = mount.clientWidth || 960;
      const height = Math.max(360, Math.round(width * 0.56));
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const cameraTarget = new THREE.Vector3();
    let accumulator = 0;
    let last = performance.now();
    let broadcastTimer = 0;
    let frame = 0;

    const loop = () => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const startAt = raceStartRef.current;
      const running = startAt !== null && Date.now() >= startAt;
      // Obstacle time is derived from the SHARED start stamp, so every
      // client animates the identical course without syncing a thing.
      const courseTime = startAt === null ? now / 1000 : (Date.now() - startAt) / 1000;
      course.update(courseTime);
      effects.update(dt);

      accumulator += dt;
      while (accumulator >= STEP) {
        accumulator -= STEP;
        if (running && !player.finished) {
          player.step(STEP, input, course, effects);
        } else {
          // Idle bob on the start pad before the gun.
          player.step(STEP, { x: 0, z: 0, jump: false, dive: false }, course, effects);
        }
      }
      input.jump = false;

      if (running && !player.finished) {
        for (const checkpoint of course.checkpoints) {
          if (!checkpoint.tryClaim(player.position)) continue;
          player.checkpointIndex = Math.max(player.checkpointIndex, checkpoint.index);
          effects.burst(checkpoint.position.clone().setY(checkpoint.position.y + 1.6), 0x8ee6a0, 14, 7);
          callbacksRef.current.onProgress?.({
            level: levelIndex,
            levels: HEARTRUSH_LEVELS,
            checkpoint: player.checkpointIndex,
            checkpoints: course.checkpoints.length - 1,
          });
        }

        if (player.position.y < FALL_Y) {
          const spot = course.checkpoints[player.checkpointIndex].position;
          player.respawn(spot);
          effects.burst(spot.clone().setY(spot.y + 1.2), 0xffc2d6, 16, 8);
        }

        if (player.position.z <= course.finishZ) {
          effects.burst(player.position, 0xffe066, 40, 12);
          if (levelIndex < HEARTRUSH_LEVELS - 1) {
            buildLevel(levelIndex + 1);
          } else {
            player.finished = true;
            // One clock across all three levels: the whole run is the time.
            callbacksRef.current.onFinish?.(Math.max(0, Date.now() - (startAt ?? Date.now())));
          }
        }
      }

      broadcastTimer += dt;
      if (broadcastTimer >= 1 / 15) {
        broadcastTimer = 0;
        callbacksRef.current.onLocalState?.({
          x: Number(player.position.x.toFixed(2)),
          y: Number(player.position.y.toFixed(2)),
          z: Number(player.position.z.toFixed(2)),
          a: player.animState,
          c: player.checkpointIndex,
        });
      }

      for (const avatar of remotes.values()) avatar.update(dt);

      // Fixed-orientation chase cam: readable on a linear course and
      // impossible to get disoriented in.
      cameraTarget.set(player.position.x * 0.55, player.position.y + 7.4, player.position.z + 12.5);
      camera.position.lerp(cameraTarget, snapCamera ? 1 : Math.min(1, dt * 4.5));
      snapCamera = false;
      camera.lookAt(player.position.x * 0.6, player.position.y + 1.1, player.position.z - 5);

      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("hearthaven:heartrush-remote", onRemote);
      resetRef.current = null;
      effects.dispose();
      course.dispose();
      remotes.forEach((avatar) => avatar.dispose(scene));
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else if (material) material.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // Seat/name are fixed for the life of a session; rebuilding the scene on
    // every prop tick would be a disaster.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySeatIndex, myName]);

  return <div className="min-h-[360px] w-full overflow-hidden rounded-lg bg-sky-100" ref={mountRef} />;
}
