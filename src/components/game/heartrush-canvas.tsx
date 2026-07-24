"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

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

/** Fixed timestep so physics feel identical on 60Hz and 144Hz screens. */
const STEP = 1 / 60;
const GRAVITY = -52;
const MOVE_ACCEL = 145;
const MAX_SPEED = 12.5;
const FRICTION = 12;
const JUMP_VELOCITY = 17.5;
const DIVE_SPEED = 20;
const DIVE_TIME = 0.32;
const DIVE_COOLDOWN = 0.75;
const PLAYER_RADIUS = 0.42;
const FALL_Y = -14;
/** Grace window where a jump still works just after leaving a ledge. */
const COYOTE_TIME = 0.12;
/** Jump pressed slightly before landing still fires. Forgiving on purpose. */
const JUMP_BUFFER = 0.14;

export const HEARTRUSH_COLORS = [
  0xf07f9a, 0x7fc4f0, 0xf6c66a, 0x9ad98b,
  0xc79af0, 0xf09a6a, 0x6ad9c4, 0xe86a8f,
];

const FINISH_Z = -146;

export type HeartRushState = {
  x: number;
  y: number;
  z: number;
  /** 0 idle, 1 running, 2 airborne, 3 diving */
  a: number;
  /** checkpoint index, so late joiners see roughly where someone is */
  c: number;
};

export type HeartRushRemote = HeartRushState & {
  id: string;
  name: string;
  seat: number;
};

type HeartRushCanvasProps = {
  /** Shared wall-clock ms when the race begins. null = not started. */
  raceStartAt: number | null;
  mySeatIndex: number;
  myName: string;
  /** Called ~15x/sec with local state for broadcasting. Never re-renders. */
  onLocalState?: (state: HeartRushState) => void;
  /** Called once when the player crosses the finish line. */
  onFinish?: (elapsedMs: number) => void;
  onCheckpoint?: (index: number) => void;
  onError?: (message: string) => void;
};

/* ------------------------------------------------------------------ */
/* Course pieces                                                       */
/* ------------------------------------------------------------------ */

type Solid = {
  mesh: THREE.Object3D;
  hx: number;
  hz: number;
  top: number;
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

class Sweeper extends Obstacle {
  readonly pivot: THREE.Group;
  private readonly arm: THREE.Mesh;
  constructor(
    scene: THREE.Scene,
    private readonly origin: THREE.Vector3,
    private readonly length: number,
    private readonly speed: number,
    private readonly phase: number,
    color: number,
  ) {
    super();
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

    // Work in the arm's local frame: the bar is the X axis, so a hit is
    // "close to the axis in Z, inside the arm in X".
    const angle = this.pivot.rotation.y;
    const dx = pos.x - this.origin.x;
    const dz = pos.z - this.origin.z;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    if (Math.abs(localX) > this.length / 2 + PLAYER_RADIUS) return null;
    if (Math.abs(localZ) > 0.35 + PLAYER_RADIUS) return null;

    // Shove along the bar's sweep direction (its local Z), plus a hop so
    // the hit reads as comedic rather than instantly fatal.
    const dir = localZ >= 0 ? 1 : -1;
    const worldX = -Math.sin(angle) * dir;
    const worldZ = -Math.cos(angle) * dir;
    return new THREE.Vector3(worldX * 15, 8, worldZ * 15);
  }
}

class Bumper extends Obstacle {
  readonly mesh: THREE.Mesh;
  private readonly base: number;
  constructor(scene: THREE.Scene, position: THREE.Vector3, private readonly radius: number, private readonly phase: number) {
    super();
    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, 1.6, 24),
      new THREE.MeshStandardMaterial({ color: 0xf5a8c0, roughness: 0.2, metalness: 0.1 }),
    );
    this.mesh.position.copy(position);
    this.mesh.castShadow = true;
    this.base = position.y;
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
  private readonly ring: THREE.Mesh;
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

  reset() {
    this.reached = false;
    const material = this.ring.material as THREE.MeshStandardMaterial;
    material.color.set(0xffd479);
    material.emissive.set(0x7a5a12);
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

  constructor(private readonly scene: THREE.Scene) {
    this.buildStart();
    this.buildSweepers();
    this.buildMovingPlatforms();
    this.buildBumpers();
    this.buildBridge();
    this.buildFinish();
    this.buildBackdrop();
  }

  private platform(
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    color: number,
    update?: (t: number, mesh: THREE.Mesh) => void,
  ) {
    const height = 1;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.06 }),
    );
    mesh.position.set(x, y - height / 2, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.scene.add(mesh);
    const solid: Solid = {
      mesh,
      hx: width / 2,
      hz: depth / 2,
      top: y,
      prev: mesh.position.clone(),
      update: update ? (t: number) => update(t, mesh) : undefined,
    };
    this.solids.push(solid);
    return solid;
  }

  private buildStart() {
    this.platform(0, 0, 4, 16, 16, 0xffd9e4);
    this.checkpoints.push(new Checkpoint(this.scene, 0, new THREE.Vector3(0, 0, 0)));

    // Start banner so the lane direction reads instantly.
    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(5, 0.4, 10, 24, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xffb3c9, roughness: 0.3 }),
    );
    gate.position.set(0, 0, 10);
    this.scene.add(gate);
    this.decor.push(gate);
  }

  private buildSweepers() {
    this.platform(0, 0, -18, 14, 30, 0xfff0d6);
    this.obstacles.push(new Sweeper(this.scene, new THREE.Vector3(0, 1.2, -10), 11, 1.5, 0, 0xf2789b));
    this.obstacles.push(new Sweeper(this.scene, new THREE.Vector3(0, 1.2, -20), 11, -1.9, Math.PI / 2, 0xa07ff0));
    this.obstacles.push(new Sweeper(this.scene, new THREE.Vector3(0, 1.2, -29), 11, 2.3, Math.PI, 0x7fc4f0));
    this.checkpoints.push(new Checkpoint(this.scene, 1, new THREE.Vector3(0, 0, -32)));
  }

  private buildMovingPlatforms() {
    // Gap the player must cross on three oscillating pads.
    for (let i = 0; i < 3; i += 1) {
      const z = -42 - i * 9;
      const phase = i * 1.1;
      const range = 5.2;
      this.platform(0, 0, z, 6, 5, 0xbfe6ff, (t, mesh) => {
        mesh.position.x = Math.sin(t * 1.15 + phase) * range;
      });
    }
    this.checkpoints.push(new Checkpoint(this.scene, 2, new THREE.Vector3(0, 0, -66)));
    this.platform(0, 0, -68, 12, 10, 0xfff0d6);
  }

  private buildBumpers() {
    this.platform(0, 0, -84, 14, 24, 0xffe0ef);
    const spots: Array<[number, number]> = [
      [-3.6, -78], [3.6, -82], [-2.4, -88], [3.0, -92], [-4.2, -94],
    ];
    spots.forEach(([x, z], index) => {
      this.obstacles.push(new Bumper(this.scene, new THREE.Vector3(x, 0.8, z), 1.15, index * 0.8));
    });
    this.checkpoints.push(new Checkpoint(this.scene, 3, new THREE.Vector3(0, 0, -96)));
  }

  private buildBridge() {
    // Narrow beam. Deliberately short so a fall costs a few seconds, not a run.
    this.platform(0, 0, -108, 2.6, 22, 0xd8c8ff);
    // Two side rails purely as visual guides — they are decor, not solids.
    for (const side of [-1.7, 1.7]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.9, 22),
        new THREE.MeshStandardMaterial({ color: 0xfff6ff, roughness: 0.4 }),
      );
      rail.position.set(side, 0.4, -108);
      this.scene.add(rail);
      this.decor.push(rail);
    }
    this.checkpoints.push(new Checkpoint(this.scene, 4, new THREE.Vector3(0, 0, -122)));
  }

  private buildFinish() {
    this.platform(0, 0, -128, 10, 12, 0xfff0d6);

    // Ramp: a thin rotated box reads as a slope, and we register a stack of
    // narrow steps as the actual collision so the arcade AABB test still works.
    const rampLength = 10;
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.6, rampLength),
      new THREE.MeshStandardMaterial({ color: 0xffc98d, roughness: 0.3 }),
    );
    ramp.position.set(0, 1.1, -138);
    ramp.rotation.x = -0.28;
    ramp.castShadow = true;
    this.scene.add(ramp);
    this.decor.push(ramp);

    const steps = 10;
    for (let i = 0; i < steps; i += 1) {
      const z = -133.5 - i;
      const y = 0.25 + i * 0.29;
      this.platform(0, y, z, 8, 1.05, 0xffc98d);
    }

    this.platform(0, 3.1, -146, 14, 12, 0xc8ffd8);

    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(5.4, 0.5, 12, 28, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x8ee6a0, emissive: 0x1d5c2c, roughness: 0.3 }),
    );
    gate.position.set(0, 3.1, -144);
    this.scene.add(gate);
    this.decor.push(gate);
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
        10 - Math.random() * 170,
      );
      mesh.userData.spin = (Math.random() - 0.5) * 0.6;
      mesh.userData.bobPhase = Math.random() * Math.PI * 2;
      mesh.userData.baseY = mesh.position.y;
      this.scene.add(mesh);
      this.decor.push(mesh);
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

    // Two eyes so the character reads as facing its travel direction.
    const eyeGeometry = new THREE.SphereGeometry(0.1, 10, 8);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x3a2a2a });
    for (const side of [-0.17, 0.17]) {
      const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
      eye.position.set(side, 0.2, -PLAYER_RADIUS - 0.02);
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
      const delta = ((target - this.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
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
  onCheckpoint,
  onError,
}: HeartRushCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const raceStartRef = useRef(raceStartAt);
  const callbacksRef = useRef({ onLocalState, onFinish, onCheckpoint });
  const resetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    raceStartRef.current = raceStartAt;
  }, [raceStartAt]);

  useEffect(() => {
    callbacksRef.current = { onLocalState, onFinish, onCheckpoint };
  }, [onLocalState, onFinish, onCheckpoint]);

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
    try {
      course = new Course(scene);
      effects = new Effects(scene);
      player = new Player(scene, HEARTRUSH_COLORS[mySeatIndex % HEARTRUSH_COLORS.length]);
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
            HEARTRUSH_COLORS[entry.seat % HEARTRUSH_COLORS.length],
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
      player.checkpointIndex = 0;
      course.checkpoints.forEach((checkpoint) => checkpoint.reset());
      player.respawn(course.checkpoints[0].position);
    };
    resetRef.current = reset;
    reset();

    const resize = () => {
      const width = mount.clientWidth || 960;
      const height = Math.max(360, Math.round(width * 0.56));
      renderer.setSize(width, height, false);
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
          callbacksRef.current.onCheckpoint?.(checkpoint.index);
        }

        if (player.position.y < FALL_Y) {
          const spot = course.checkpoints[player.checkpointIndex].position;
          player.respawn(spot);
          effects.burst(spot.clone().setY(spot.y + 1.2), 0xffc2d6, 16, 8);
        }

        if (player.position.z <= FINISH_Z) {
          player.finished = true;
          effects.burst(player.position, 0xffe066, 40, 12);
          callbacksRef.current.onFinish?.(Math.max(0, Date.now() - (startAt ?? Date.now())));
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
      camera.position.lerp(cameraTarget, Math.min(1, dt * 4.5));
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

  return <div className="w-full overflow-hidden rounded-lg bg-sky-100" ref={mountRef} />;
}
