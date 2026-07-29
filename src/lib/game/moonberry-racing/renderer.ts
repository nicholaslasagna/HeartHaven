/**
 * Moonberry Racing — three.js presentation.
 *
 * Owns everything visual and nothing else: no input, no rules, no netcode.
 * It is handed a read-only snapshot each frame and draws it. That split is
 * why the handling could be tuned and verified long before any of this
 * existed, and why the look can be reworked without risking the feel.
 *
 * Track geometry is GENERATED from the course centreline rather than
 * modelled, so a course author edits one array of control points and the
 * road, banking, verges, rails and minimap all follow. Every course loads
 * through exactly this path — there is no per-course special casing.
 */

import * as THREE from "three";
import {
  courseTangent,
  sampleCourse,
  type Course,
  type SurfaceKind,
} from "./track";

/** Ribbon resolution. 10 samples per control point keeps corners smooth. */
const SAMPLES_PER_POINT = 10;
const VERGE_WIDTH = 3.2;
const RAIL_HEIGHT = 1.05;

export type KartView = {
  id: string;
  seat: number;
  name: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Visual lean, from steering and drift. */
  lean: number;
  driftSide: 0 | 1 | -1;
  driftCharge: number;
  boosting: boolean;
  airborne: boolean;
  spinning: boolean;
  local: boolean;
  position: number;
  finished: boolean;
};

export type RacingSnapshot = {
  karts: KartView[];
  /** Seconds of race time; hazards are pure functions of it. */
  raceTime: number;
  /** Which kart the camera follows. */
  followId: string | null;
  /** Held briefly on a rear-view press. */
  rearView: boolean;
  itemBoxesTaken: Set<number>;
};

const SEAT_COLORS = [
  0xf07f9a, 0x7fc4f0, 0xf6c66a, 0x9ad98b,
  0xc79af0, 0xf09a6a, 0x6ad9c4, 0xe86a8f,
];
export const kartColor = (seat: number) => SEAT_COLORS[Math.abs(seat) % SEAT_COLORS.length];

/** Per-surface look. Ice is glossy, off-road is matte and darker. */
function surfaceTint(kind: SurfaceKind | undefined, base: THREE.Color) {
  const color = base.clone();
  switch (kind) {
    case "ice": return color.lerp(new THREE.Color(0xdff2ff), 0.72);
    case "offroad": return color.lerp(new THREE.Color(0x4a3a2a), 0.55);
    case "boost": return color.lerp(new THREE.Color(0xffd166), 0.5);
    case "conveyor": return color.lerp(new THREE.Color(0x6a5a3a), 0.4);
    default: return color;
  }
}

export class MoonberryRacingRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly kartRigs = new Map<string, THREE.Group>();
  private readonly itemBoxMeshes: THREE.Mesh[] = [];
  private readonly hazardMeshes: Array<{ mesh: THREE.Object3D; spec: Course["hazards"][number] }> = [];
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camReady = false;
  private baseFov = 68;

  constructor(readonly course: Course) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.3, 900);

    const sky = new THREE.Color(course.palette.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(course.palette.fog, 90, 420);

    this.buildLights();
    this.buildTrack();
    this.buildRails();
    this.buildFeatures();
    this.buildSurround();
  }

  private track<T extends { dispose: () => void }>(item: T) {
    this.disposables.push(item);
    return item;
  }

  private buildLights() {
    /* A night course lit only by a hemisphere of its own dark palette reads
       as a black void, so the fill is deliberately brighter than the sky and
       a flat ambient keeps the tarmac legible. */
    this.scene.add(new THREE.HemisphereLight(
      new THREE.Color(this.course.palette.sky).lerp(new THREE.Color(0xffffff), 0.35),
      new THREE.Color(this.course.palette.road).lerp(new THREE.Color(0xffffff), 0.2),
      2.2,
    ));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
    sun.position.set(120, 220, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 700;
    const span = 220;
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.sun = sun;

    // Cool counter-light so kart silhouettes read against the road.
    const rim = new THREE.DirectionalLight(this.course.palette.accent, 0.85);
    rim.position.set(-90, 70, -120);
    this.scene.add(rim);
  }

  private sun?: THREE.DirectionalLight;

  /** Ribbon geometry swept along the centreline, banked and vertex-coloured. */
  private buildTrack() {
    const count = this.course.points.length * SAMPLES_PER_POINT;
    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const base = new THREE.Color(this.course.palette.road);

    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const point = sampleCourse(this.course, t);
      const tangent = courseTangent(this.course, t);
      // Perpendicular in the XZ plane.
      const px = -tangent.z;
      const pz = tangent.x;
      const half = point.width / 2;
      const bank = point.bank ?? 0;
      // Banking lifts the outer edge; a lean into the corner reads instantly.
      const lift = Math.sin(bank) * half;

      const tint = surfaceTint(point.surface, base);
      for (const side of [-1, 1]) {
        positions.push(
          point.x + px * half * side,
          point.y + lift * side,
          point.z + pz * half * side,
        );
        colors.push(tint.r, tint.g, tint.b);
        uvs.push(side < 0 ? 0 : 1, t * count * 0.5);
      }

      if (i < count) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geometry = this.track(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = this.track(new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.05,
    }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Verge: a wider, darker skirt so the road edge is unmistakable and the
    // world does not simply end at the tarmac.
    const vergeGeom = this.track(new THREE.BufferGeometry());
    const vp: number[] = [];
    const vi: number[] = [];
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const point = sampleCourse(this.course, t);
      const tangent = courseTangent(this.course, t);
      const px = -tangent.z;
      const pz = tangent.x;
      const half = point.width / 2;
      for (const side of [-1, 1]) {
        vp.push(
          point.x + px * (half + VERGE_WIDTH) * side,
          point.y - 0.35,
          point.z + pz * (half + VERGE_WIDTH) * side,
        );
      }
      if (i < count) {
        const a = i * 2;
        vi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    vergeGeom.setAttribute("position", new THREE.Float32BufferAttribute(vp, 3));
    vergeGeom.setIndex(vi);
    vergeGeom.computeVertexNormals();
    const vergeMat = this.track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.course.palette.road).multiplyScalar(0.55),
      roughness: 0.9,
    }));
    const verge = new THREE.Mesh(vergeGeom, vergeMat);
    verge.receiveShadow = true;
    verge.position.y -= 0.05;
    this.scene.add(verge);
  }

  /** Glowing rails, instanced. They read as barriers AND as the racing line. */
  private buildRails() {
    const count = this.course.points.length * SAMPLES_PER_POINT;
    const geometry = this.track(new THREE.BoxGeometry(0.5, RAIL_HEIGHT, 3.4));
    const material = this.track(new THREE.MeshStandardMaterial({
      color: this.course.palette.rail,
      emissive: new THREE.Color(this.course.palette.rail).multiplyScalar(0.35),
      roughness: 0.35,
    }));
    const mesh = new THREE.InstancedMesh(geometry, material, count * 2);
    const matrix = new THREE.Matrix4();
    let index = 0;

    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      const point = sampleCourse(this.course, t);
      const tangent = courseTangent(this.course, t);
      const px = -tangent.z;
      const pz = tangent.x;
      const half = point.width / 2 + 0.5;
      const yaw = Math.atan2(tangent.x, tangent.z);
      for (const side of [-1, 1]) {
        matrix.makeRotationY(yaw);
        matrix.setPosition(
          point.x + px * half * side,
          point.y + RAIL_HEIGHT / 2,
          point.z + pz * half * side,
        );
        mesh.setMatrixAt(index, matrix);
        index += 1;
      }
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    this.scene.add(mesh);
  }

  /** Boost pads, ramps, item boxes, hazards and the start/finish gantry. */
  private buildFeatures() {
    const place = (t: number, offset: number) => {
      const point = sampleCourse(this.course, t);
      const tangent = courseTangent(this.course, t);
      return {
        x: point.x + -tangent.z * offset,
        y: point.y,
        z: point.z + tangent.x * offset,
        yaw: Math.atan2(tangent.x, tangent.z),
        point,
      };
    };

    for (const pad of this.course.boostPads) {
      const at = place(pad.t, pad.offset);
      const mesh = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(pad.width, 7)),
        this.track(new THREE.MeshStandardMaterial({
          color: 0xffd166,
          emissive: 0xffb020,
          emissiveIntensity: 1.4,
          roughness: 0.3,
          transparent: true,
          opacity: 0.92,
        })),
      );
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.rotation.y = at.yaw;
      mesh.position.set(at.x, at.y + 0.06, at.z);
      this.scene.add(mesh);
    }

    for (const ramp of this.course.ramps) {
      const at = place(ramp.t, ramp.offset);
      const mesh = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(ramp.width, ramp.height, ramp.length)),
        this.track(new THREE.MeshStandardMaterial({
          color: this.course.palette.accent, roughness: 0.5,
        })),
      );
      mesh.position.set(at.x, at.y + ramp.height / 2 - 0.1, at.z);
      mesh.rotation.y = at.yaw;
      // Tilt so the leading edge meets the road rather than forming a step.
      mesh.rotation.x = -Math.atan2(ramp.height, ramp.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    const boxGeom = this.track(new THREE.BoxGeometry(1.5, 1.5, 1.5));
    const boxMat = this.track(new THREE.MeshStandardMaterial({
      color: 0xffe08a,
      emissive: 0xff9ecb,
      emissiveIntensity: 0.7,
      roughness: 0.25,
      metalness: 0.2,
    }));
    this.course.itemBoxes.forEach((box) => {
      const at = place(box.t, box.offset);
      const mesh = new THREE.Mesh(boxGeom, boxMat);
      mesh.position.set(at.x, at.y + 1.5, at.z);
      mesh.castShadow = true;
      this.itemBoxMeshes.push(mesh);
      this.scene.add(mesh);
    });

    for (const hazard of this.course.hazards) {
      const at = place(hazard.t, hazard.offset);
      const radius = hazard.radius ?? 1.6;
      const mesh = new THREE.Mesh(
        this.track(new THREE.IcosahedronGeometry(radius, 1)),
        this.track(new THREE.MeshStandardMaterial({
          color: 0xff7f9a,
          emissive: 0x5a1030,
          roughness: 0.4,
        })),
      );
      mesh.position.set(at.x, at.y + radius, at.z);
      mesh.castShadow = true;
      mesh.userData.home = mesh.position.clone();
      mesh.userData.yaw = at.yaw;
      this.hazardMeshes.push({ mesh, spec: hazard });
      this.scene.add(mesh);
    }

    // Start/finish gantry, so the line is unmistakable.
    const line = place(0, 0);
    const gantry = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(line.point.width * 0.62, 0.55, 10, 26, Math.PI)),
      this.track(new THREE.MeshStandardMaterial({
        color: this.course.palette.accent,
        emissive: new THREE.Color(this.course.palette.accent).multiplyScalar(0.5),
        roughness: 0.35,
      })),
    );
    gantry.position.set(line.x, line.y, line.z);
    gantry.rotation.y = line.yaw;
    this.scene.add(gantry);

    const stripe = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(line.point.width, 2.4)),
      this.track(new THREE.MeshStandardMaterial({ color: 0xf7f7ff, roughness: 0.6 })),
    );
    stripe.rotation.set(-Math.PI / 2, 0, 0);
    stripe.rotation.y = line.yaw;
    stripe.position.set(line.x, line.y + 0.07, line.z);
    this.scene.add(stripe);
  }

  /** Ground plane far below and a few distant shapes, so the void has depth. */
  private buildSurround() {
    const ground = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(2000, 2000)),
      this.track(new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.course.palette.fog).multiplyScalar(0.7),
        roughness: 1,
      })),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -28;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Deterministic scenery: no Math.random, so every client sees the same
    // skyline and a screenshot is reproducible.
    const geometry = this.track(new THREE.ConeGeometry(18, 60, 6));
    const material = this.track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.course.palette.sky).lerp(new THREE.Color(0xffffff), 0.18),
      roughness: 0.85,
    }));
    const mesh = new THREE.InstancedMesh(geometry, material, 40);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 40; i += 1) {
      const angle = (i / 40) * Math.PI * 2;
      const wobble = Math.sin(i * 12.9898) * 0.5 + 0.5;
      const radius = 380 + wobble * 180;
      matrix.makeScale(0.6 + wobble, 0.5 + wobble * 1.4, 0.6 + wobble);
      matrix.setPosition(Math.cos(angle) * radius, -26, Math.sin(angle) * radius);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  /* -------------------------------------------------------------- */

  private makeKartRig(view: KartView) {
    const group = new THREE.Group();
    const color = kartColor(view.seat);

    const body = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(1.5, 0.55, 2.4)),
      this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.25 })),
    );
    body.position.y = 0.55;
    body.castShadow = true;
    body.name = "body";
    group.add(body);

    const nose = new THREE.Mesh(
      this.track(new THREE.ConeGeometry(0.5, 1.1, 12)),
      this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.25 })),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.55, 1.6);
    group.add(nose);

    // A driver blob so a kart reads as carrying someone.
    const driver = new THREE.Mesh(
      this.track(new THREE.CapsuleGeometry(0.32, 0.4, 6, 12)),
      this.track(new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55),
        roughness: 0.5,
      })),
    );
    driver.position.set(0, 1.15, -0.2);
    driver.castShadow = true;
    group.add(driver);

    const wheelGeom = this.track(new THREE.CylinderGeometry(0.42, 0.42, 0.36, 14));
    const wheelMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2a2028, roughness: 0.75 }));
    for (const [wx, wz] of [[-0.82, 0.85], [0.82, 0.85], [-0.82, -0.85], [0.82, -0.85]]) {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.42, wz);
      wheel.castShadow = true;
      group.add(wheel);
    }

    // Drift sparks: shown only while charging, colour-coded by band so the
    // sweet spot is readable from the kart itself, not just the HUD.
    const spark = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.3, 10, 8)),
      this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })),
    );
    spark.position.set(0, 0.25, -1.3);
    spark.visible = false;
    spark.name = "spark";
    group.add(spark);

    const flame = new THREE.Mesh(
      this.track(new THREE.ConeGeometry(0.42, 1.6, 10)),
      this.track(new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.85 })),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(0, 0.5, -1.9);
    flame.visible = false;
    flame.name = "flame";
    group.add(flame);

    this.scene.add(group);
    return group;
  }

  private syncKarts(snapshot: RacingSnapshot, dt: number) {
    const seen = new Set<string>();
    for (const view of snapshot.karts) {
      seen.add(view.id);
      let rig = this.kartRigs.get(view.id);
      if (!rig) {
        rig = this.makeKartRig(view);
        this.kartRigs.set(view.id, rig);
        rig.position.set(view.x, view.y, view.z);
        rig.rotation.y = view.heading;
      }

      if (view.local) {
        // The local kart is authoritative: draw it exactly where it is.
        rig.position.set(view.x, view.y, view.z);
        rig.rotation.y = view.heading;
      } else {
        /* Remote karts are damped toward their reported pose. Frame-rate
           independent, so a 144Hz client and a 60Hz client converge at the
           same real-world rate instead of one snapping faster. */
        const k = 1 - Math.exp(-9 * dt);
        rig.position.lerp(new THREE.Vector3(view.x, view.y, view.z), k);
        const delta = ((view.heading - rig.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        rig.rotation.y += delta * k;
      }

      const body = rig.getObjectByName("body");
      if (body) body.rotation.z = -view.lean * 0.35;

      const spark = rig.getObjectByName("spark") as THREE.Mesh | undefined;
      if (spark) {
        spark.visible = view.driftCharge > 0.02;
        const material = spark.material as THREE.MeshBasicMaterial;
        // Blue building, gold in the sweet spot, red once overcharged.
        material.color.setHex(
          view.driftCharge < 0.45 ? 0x7fc4f0 : view.driftCharge <= 0.85 ? 0xffd166 : 0xff6b6b,
        );
        const pulse = 1 + Math.sin(snapshot.raceTime * 30) * 0.25;
        spark.scale.setScalar((0.6 + view.driftCharge) * pulse);
      }

      const flame = rig.getObjectByName("flame") as THREE.Mesh | undefined;
      if (flame) {
        flame.visible = view.boosting;
        flame.scale.setScalar(1 + Math.sin(snapshot.raceTime * 26) * 0.2);
      }

      if (view.spinning) rig.rotation.y += dt * 9;
      rig.visible = !view.finished || view.local;
    }

    for (const [id, rig] of this.kartRigs) {
      if (seen.has(id)) continue;
      this.scene.remove(rig);
      this.kartRigs.delete(id);
    }
  }

  private syncFeatures(snapshot: RacingSnapshot, dt: number) {
    this.itemBoxMeshes.forEach((mesh, index) => {
      const taken = snapshot.itemBoxesTaken.has(index);
      mesh.visible = !taken;
      mesh.rotation.y += dt * 1.4;
      mesh.rotation.x += dt * 0.6;
    });

    // Hazards are pure functions of race time, which is why they need no
    // network traffic: eight clients compute identical positions.
    for (const { mesh, spec } of this.hazardMeshes) {
      const home = mesh.userData.home as THREE.Vector3;
      const yaw = mesh.userData.yaw as number;
      const phase = ((snapshot.raceTime / spec.period) + (spec.phase ?? 0)) * Math.PI * 2;
      const swing = Math.sin(phase) * 6;
      mesh.position.set(
        home.x + -Math.cos(yaw) * swing,
        home.y + Math.abs(Math.cos(phase)) * 0.6,
        home.z + Math.sin(yaw) * swing,
      );
      mesh.rotation.y += dt * 1.2;
    }
  }

  /** Chase camera: damped, looks ahead into turns, widens on boost. */
  private updateCamera(snapshot: RacingSnapshot, dt: number) {
    const follow = snapshot.karts.find((k) => k.id === snapshot.followId) ?? snapshot.karts[0];
    if (!follow) return;

    const behind = snapshot.rearView ? -1 : 1;
    const heading = follow.heading;
    const distance = 9.5;
    const height = 4.4;

    const targetPos = new THREE.Vector3(
      follow.x - Math.sin(heading) * distance * behind,
      follow.y + height,
      follow.z - Math.cos(heading) * distance * behind,
    );
    // Look ahead of the kart so corners open up before you reach them.
    const targetLook = new THREE.Vector3(
      follow.x + Math.sin(heading) * 11 * behind,
      follow.y + 1.5,
      follow.z + Math.cos(heading) * 11 * behind,
    );

    if (!this.camReady) {
      this.camPos.copy(targetPos);
      this.camLook.copy(targetLook);
      this.camReady = true;
    } else {
      // Frame-rate independent damping; a raw lerp factor would make the
      // camera lag differently at 60 and 144Hz.
      const k = 1 - Math.exp(-7 * dt);
      const kLook = 1 - Math.exp(-9 * dt);
      this.camPos.lerp(targetPos, k);
      this.camLook.lerp(targetLook, kLook);
    }

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    const wantedFov = this.baseFov + (follow.boosting ? 9 : 0) + Math.abs(follow.lean) * 3;
    this.camera.fov += (wantedFov - this.camera.fov) * (1 - Math.exp(-6 * dt));
    this.camera.updateProjectionMatrix();

    if (this.sun) {
      // Keep the shadow frustum with the action.
      this.sun.position.set(follow.x + 120, follow.y + 220, follow.z + 90);
      this.sun.target.position.set(follow.x, follow.y, follow.z);
      this.sun.target.updateMatrixWorld();
    }
  }

  /** Snap the camera on the next frame, for a respawn or a race start. */
  resetCamera() {
    this.camReady = false;
  }

  update(snapshot: RacingSnapshot, aspect: number, dt: number) {
    this.camera.aspect = aspect;
    this.syncKarts(snapshot, dt);
    this.syncFeatures(snapshot, dt);
    this.updateCamera(snapshot, dt);
  }

  dispose() {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.kartRigs.clear();
    this.itemBoxMeshes.length = 0;
    this.hazardMeshes.length = 0;
    this.scene.clear();
  }
}
