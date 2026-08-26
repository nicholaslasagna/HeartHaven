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
import { angleDelta } from "./kart";
import { companionArtAsset } from "@/lib/game/companion-art";
import type { RacerCompanion } from "./race";
import {
  courseTangent,
  hazardPosition,
  sampleCourse,
  sampleShortcut,
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
  companion?: RacerCompanion;
};

export type ShotView = { id: number; kind: string; x: number; z: number; trap: boolean };

export type RacingSnapshot = {
  karts: KartView[];
  /** Live projectiles and dropped traps. */
  shots?: ShotView[];
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


/**
 * Triangular prism in track-local space: flat at the near edge, rising to
 * `height` at the far lip, with local +Z pointing the way the karts travel.
 */
function rampGeometry(width: number, height: number, length: number) {
  const w = width / 2;
  const l = length / 2;
  const v = new Float32Array([
    -w, 0, -l,   w, 0, -l,           // near edge, on the road
    -w, height, l,   w, height, l,   // lip
    -w, 0, l,   w, 0, l,             // base under the lip
  ]);
  const index = [
    0, 1, 3, 0, 3, 2,   // the ramp surface itself
    2, 3, 5, 2, 5, 4,   // vertical back face
    0, 4, 5, 0, 5, 1,   // underside
    0, 2, 4,            // left cheek
    1, 5, 3,            // right cheek
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(v, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

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

/**
 * The kart hull, as a plan-view outline extruded upward.
 *
 * A plain box was the single biggest tell that these were placeholders. The
 * outline tapers toward the nose and bulges at the rear axle, and the bevel
 * rounds every edge, so the hull catches light along its length instead of
 * showing four flat faces.
 *
 * The shape is drawn with the nose at -y because extruding along +z and then
 * rotating -90 degrees about X maps shape -y onto world +z (forward) and the
 * extrusion onto world +y (up).
 */
/** Tyre radius, shared by the wheel mesh and the roll-per-metre maths. */
const WHEEL_RADIUS = 0.42;

function kartChassisGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.40, -1.18);
  shape.quadraticCurveTo(-0.66, -0.72, -0.64, -0.18);
  shape.quadraticCurveTo(-0.63, 0.62, -0.58, 1.12);
  shape.lineTo(0.58, 1.12);
  shape.quadraticCurveTo(0.63, 0.62, 0.64, -0.18);
  shape.quadraticCurveTo(0.66, -0.72, 0.40, -1.18);
  shape.lineTo(-0.40, -1.18);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0.36, 0);
  geometry.computeVertexNormals();
  return geometry;
}

export class MoonberryRacingRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly kartRigs = new Map<string, THREE.Group>();
  private readonly companionTextures = new Map<string, THREE.Texture>();
  private readonly companionTextureLoader = new THREE.TextureLoader();
  private readonly itemBoxMeshes: THREE.Mesh[] = [];
  private readonly hazardMeshes: Array<{ mesh: THREE.Object3D; spec: Course["hazards"][number] }> = [];
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camReady = false;
  private baseFov = 68;
  /** Shared across every live projectile / trap, allocated once. */
  private readonly projectileAsset: { geometry: THREE.BufferGeometry; material: THREE.Material };
  private readonly trapAsset: { geometry: THREE.BufferGeometry; material: THREE.Material };
  private readonly wheelAsset: { geometry: THREE.BufferGeometry; material: THREE.Material };
  /* Every kart is the same shape, so the SHAPES are built once for the whole
     field and only the two painted materials differ per seat. Eight racers
     used to mean eight copies of each hull. */
  private readonly kartParts: {
    chassis: THREE.BufferGeometry;
    nose: THREE.BufferGeometry;
    pod: THREE.BufferGeometry;
    spoiler: THREE.BufferGeometry;
    stay: THREE.BufferGeometry;
    hoop: THREE.BufferGeometry;
    exhaust: THREE.BufferGeometry;
    rim: THREE.BufferGeometry;
    torso: THREE.BufferGeometry;
    helmet: THREE.BufferGeometry;
    visor: THREE.BufferGeometry;
    arm: THREE.BufferGeometry;
    trim: THREE.Material;
    rubberTrim: THREE.Material;
    glass: THREE.Material;
  };

  /** How many GPU resources are held. Flat over time, or something leaks. */
  get resourceCount() {
    return this.disposables.length;
  }

  constructor(
    readonly course: Course,
    /** Honour the player's (or the OS's) reduced-motion setting. */
    readonly reducedMotion = false,
  ) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.3, 900);

    const sky = new THREE.Color(course.palette.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(course.palette.fog, 90, 420);

    this.projectileAsset = {
      geometry: this.track(new THREE.SphereGeometry(0.55, 14, 12)),
      material: this.track(new THREE.MeshStandardMaterial({
        color: 0xc94f8a, emissive: 0x5a1030, emissiveIntensity: 0.8, roughness: 0.3,
      })),
    };
    this.trapAsset = {
      geometry: this.track(new THREE.CylinderGeometry(0.8, 0.9, 0.18, 14)),
      material: this.track(new THREE.MeshStandardMaterial({
        color: 0xf0a94a, emissive: 0x6a4410, emissiveIntensity: 0.8, roughness: 0.3,
      })),
    };

    this.wheelAsset = {
      geometry: this.track(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.36, 14)),
      material: this.track(new THREE.MeshStandardMaterial({ color: 0x2a2028, roughness: 0.75 })),
    };

    this.kartParts = {
      chassis: this.track(kartChassisGeometry()),
      nose: this.track(new THREE.ConeGeometry(0.44, 0.95, 14)),
      pod: this.track(new THREE.BoxGeometry(0.3, 0.34, 1.25)),
      spoiler: this.track(new THREE.BoxGeometry(1.24, 0.08, 0.34)),
      stay: this.track(new THREE.BoxGeometry(0.09, 0.42, 0.1)),
      hoop: this.track(new THREE.TorusGeometry(0.34, 0.06, 8, 16, Math.PI)),
      exhaust: this.track(new THREE.CylinderGeometry(0.075, 0.09, 0.5, 10)),
      rim: this.track(new THREE.CylinderGeometry(0.24, 0.24, 0.38, 12)),
      torso: this.track(new THREE.CapsuleGeometry(0.26, 0.3, 5, 12)),
      helmet: this.track(new THREE.SphereGeometry(0.235, 14, 12)),
      // A shallow cap of a sphere: the visor sits proud of the helmet face.
      visor: this.track(new THREE.SphereGeometry(0.238, 14, 10, 0, Math.PI, 1.05, 0.75)),
      arm: this.track(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8)),
      trim: this.track(new THREE.MeshStandardMaterial({ color: 0xe9e2d6, roughness: 0.45, metalness: 0.35 })),
      rubberTrim: this.track(new THREE.MeshStandardMaterial({ color: 0x3a2f38, roughness: 0.85 })),
      glass: this.track(new THREE.MeshStandardMaterial({
        color: 0x2a3550, roughness: 0.12, metalness: 0.6, emissive: 0x101828, emissiveIntensity: 0.4,
      })),
    };

    this.buildLights();
    this.buildTrack();
    this.buildShortcuts();
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
    /* Lift the road off its raw palette value. A night course's road colour
       is chosen to sit behind the scenery, but used directly as a vertex
       colour it renders as near-black and the racing surface disappears. */
    const base = new THREE.Color(this.course.palette.road).lerp(new THREE.Color(0xffffff), 0.28);

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

  /**
   * Shortcut branches, drawn as their own ribbon.
   *
   * Tinted toward the course accent and slightly raised, so a shortcut reads
   * as an alternate ROUTE rather than scenery — a player should be able to see
   * the opportunity coming, which is the whole point of a risk/reward line.
   */
  private buildShortcuts() {
    for (const shortcut of this.course.shortcuts) {
      if (shortcut.points.length < 2) continue;

      const samples = shortcut.points.length * SAMPLES_PER_POINT;
      const positions: number[] = [];
      const indices: number[] = [];

      for (let i = 0; i <= samples; i += 1) {
        const u = i / samples;
        const point = sampleShortcut(shortcut, u);
        const step = 1 / (samples * 2);
        const ahead = sampleShortcut(shortcut, Math.min(1, u + step));
        const behind = sampleShortcut(shortcut, Math.max(0, u - step));
        const dx = ahead.x - behind.x;
        const dz = ahead.z - behind.z;
        const len = Math.hypot(dx, dz) || 1;
        const px = -(dz / len);
        const pz = dx / len;
        const half = point.width / 2;

        for (const side of [-1, 1]) {
          positions.push(point.x + px * half * side, point.y + 0.04, point.z + pz * half * side);
        }
        if (i < samples) {
          const a = i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }

      const geometry = this.track(new THREE.BufferGeometry());
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const material = this.track(new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.course.palette.road).lerp(new THREE.Color(this.course.palette.accent), 0.35),
        roughness: 0.5,
        metalness: 0.05,
      }));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // A lit arch at the mouth, so the entrance is findable at speed.
      const mouth = sampleShortcut(shortcut, 0);
      const gate = new THREE.Mesh(
        this.track(new THREE.TorusGeometry(mouth.width * 0.55, 0.3, 8, 20, Math.PI)),
        this.track(new THREE.MeshStandardMaterial({
          color: this.course.palette.accent,
          emissive: new THREE.Color(this.course.palette.accent).multiplyScalar(0.6),
          roughness: 0.35,
        })),
      );
      const next = sampleShortcut(shortcut, 0.05);
      gate.position.set(mouth.x, mouth.y, mouth.z);
      gate.rotation.y = Math.atan2(next.x - mouth.x, next.z - mouth.z);
      this.scene.add(gate);
    }
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
      /* A wedge, not a tilted box. A box rotated about X still presents its
         full height as a wall to an approaching kart — it reads as a barrier
         across the track rather than something to launch off. The wedge rises
         from nothing at the near edge to `height` at the lip. */
      const mesh = new THREE.Mesh(
        this.track(rampGeometry(ramp.width, ramp.height, ramp.length)),
        this.track(new THREE.MeshStandardMaterial({
          color: this.course.palette.accent, roughness: 0.5,
        })),
      );
      mesh.position.set(at.x, at.y, at.z);
      mesh.rotation.y = at.yaw;
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
    const parts = this.kartParts;

    /* Two painted materials per kart: the shell and a darkened accent for the
       parts that should read as trim rather than bodywork. */
    const shell = this.track(new THREE.MeshStandardMaterial({
      color, roughness: 0.28, metalness: 0.3,
    }));
    const accent = this.track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.62),
      roughness: 0.42,
      metalness: 0.2,
    }));

    /* `body` is a GROUP now, so the lean tips the whole car — hull, driver and
       spoiler together. Leaning only the hull left the driver standing
       bolt-upright through every corner. */
    const body = new THREE.Group();
    body.name = "body";
    group.add(body);

    const chassis = new THREE.Mesh(parts.chassis, shell);
    chassis.castShadow = true;
    body.add(chassis);

    const nose = new THREE.Mesh(parts.nose, shell);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.5, 1.52);
    nose.castShadow = true;
    body.add(nose);

    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(parts.pod, accent);
      pod.position.set(side * 0.7, 0.44, 0.05);
      pod.castShadow = true;
      body.add(pod);

      const exhaust = new THREE.Mesh(parts.exhaust, parts.trim);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(side * 0.26, 0.6, -1.32);
      body.add(exhaust);
    }

    // Rear wing: the clearest silhouette cue that this is a kart from behind.
    const spoiler = new THREE.Mesh(parts.spoiler, accent);
    spoiler.position.set(0, 0.98, -1.16);
    spoiler.castShadow = true;
    body.add(spoiler);
    for (const side of [-1, 1]) {
      const stay = new THREE.Mesh(parts.stay, parts.trim);
      stay.position.set(side * 0.44, 0.77, -1.16);
      body.add(stay);
    }

    // Roll hoop behind the seat.
    const hoop = new THREE.Mesh(parts.hoop, parts.trim);
    hoop.position.set(0, 0.86, -0.62);
    hoop.castShadow = true;
    body.add(hoop);

    /* The driver. Still hidden wholesale when a companion sprite takes over,
       which is why it stays one named object. */
    const driver = new THREE.Group();
    driver.name = "driver";
    driver.position.set(0, 0.68, -0.18);
    body.add(driver);

    const suit = this.track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5),
      roughness: 0.6,
    }));
    const torso = new THREE.Mesh(parts.torso, suit);
    torso.position.y = 0.28;
    torso.rotation.x = -0.18;
    torso.castShadow = true;
    driver.add(torso);

    const helmet = new THREE.Mesh(parts.helmet, parts.trim);
    helmet.position.set(0, 0.72, 0.02);
    helmet.castShadow = true;
    driver.add(helmet);

    const visor = new THREE.Mesh(parts.visor, parts.glass);
    visor.position.copy(helmet.position);
    visor.rotation.y = -Math.PI / 2;
    driver.add(visor);

    // Arms reaching forward to the wheel, so the pose reads as driving.
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(parts.arm, suit);
      arm.position.set(side * 0.21, 0.34, 0.26);
      arm.rotation.set(1.15, 0, side * -0.22);
      driver.add(arm);
    }

    /* Wheels: a tyre plus a bright rim, grouped so the pair can spin with
       road speed and the front pair can steer. YXZ order keeps the steer
       outside the spin — with the default order the two fight each other. */
    const wheels: THREE.Group[] = [];
    for (const [wx, wz] of [[-0.82, 0.9], [0.82, 0.9], [-0.86, -0.92], [0.86, -0.92]]) {
      const wheel = new THREE.Group();
      wheel.rotation.order = "YXZ";
      wheel.position.set(wx, 0.42, wz);

      const tyre = new THREE.Mesh(this.wheelAsset.geometry, this.wheelAsset.material);
      tyre.rotation.z = Math.PI / 2;
      tyre.castShadow = true;
      wheel.add(tyre);

      const rim = new THREE.Mesh(parts.rim, parts.trim);
      rim.rotation.z = Math.PI / 2;
      wheel.add(rim);

      group.add(wheel);
      wheels.push(wheel);
    }
    // Front pair first, so the steering update does not have to search.
    group.userData.wheels = wheels;

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

  /**
   * Put the selected companion in the kart as a small billboarded driver.
   * The generated companion cutouts keep their authored silhouettes and
   * transparent backgrounds; the generic capsule remains a safe fallback
   * while a texture is loading or when a guest has no companion payload yet.
   */
  private syncCompanion(rig: THREE.Group, companion: RacerCompanion | undefined) {
    const visualKey = companion
      ? `${companion.speciesId}:${companion.toneId}:${companion.accessory}`
      : null;
    const speciesId = companion?.speciesId ?? null;
    if (rig.userData.companionVisualKey === visualKey) return;

    const previous = rig.getObjectByName("companion");
    if (previous) {
      rig.remove(previous);
      const material = (previous as THREE.Sprite).material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }

    const driver = rig.getObjectByName("driver");
    if (driver) driver.visible = !speciesId;
    rig.userData.companionVisualKey = visualKey;
    if (!speciesId) return;

    const addSprite = (texture: THREE.Texture) => {
      // A race can be remounted while an image is still loading. Do not add
      // an old companion to a new or changed rig.
      if (!rig.parent || rig.userData.companionVisualKey !== visualKey) return;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = "companion";
      sprite.position.set(0, 1.34, -0.22);
      const image = texture.image as { width?: number; height?: number } | undefined;
      const aspect = image?.width && image?.height ? image.width / image.height : 1;
      sprite.scale.set(0.95 * aspect, 0.95, 1);
      sprite.renderOrder = 2;
      rig.add(sprite);
    };

    const cached = this.companionTextures.get(speciesId);
    if (cached) {
      addSprite(cached);
      return;
    }

    this.companionTextureLoader.load(
      companionArtAsset(speciesId),
      (texture) => {
        this.companionTextures.set(speciesId, texture);
        addSprite(texture);
      },
      undefined,
      () => {
        // Keep the capsule driver visible if an optional companion asset is
        // unavailable. The race itself must remain playable.
        if (rig.userData.companionVisualKey === visualKey) rig.userData.companionVisualKey = null;
        if (driver) driver.visible = true;
      },
    );
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
      this.syncCompanion(rig, view.companion);

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
        // Robust against a heading that has wound past +/-3PI; the naive
        // modulo form escapes the +/-PI range and spins the kart.
        const delta = angleDelta(view.heading, rig.rotation.y);
        rig.rotation.y += delta * k;
      }

      /* Wheels roll with the distance actually covered, so they never spin
         while the kart is stopped and never slide while it moves. Taking it
         from the rig's own movement rather than a reported speed means remote
         karts, which are damped toward their pose, stay consistent too. */
      const wheels = rig.userData.wheels as THREE.Group[] | undefined;
      if (wheels) {
        const previous = rig.userData.prevPos as THREE.Vector3 | undefined;
        const travelled = previous ? rig.position.distanceTo(previous) : 0;
        if (previous) previous.copy(rig.position);
        else rig.userData.prevPos = rig.position.clone();

        // Rolling without slipping: one radius of travel is one radian.
        const roll = travelled / WHEEL_RADIUS;
        // lean is driftSide, or steer scaled — positive is a left turn, and a
        // positive Y rotation aims the wheel at world +X, which is left.
        const steer = Math.max(-1, Math.min(1, view.lean)) * 0.5;
        for (let i = 0; i < wheels.length; i += 1) {
          // Wrapped so a long race cannot grind the angle's precision away.
          wheels[i].rotation.x = (wheels[i].rotation.x + roll) % (Math.PI * 2);
          // The first two are the front pair; only they steer.
          if (i < 2) wheels[i].rotation.y = steer;
        }
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
        /* This pulsed at sin(t * 30) — about 4.8 flashes a second, past the
           three-per-second ceiling WCAG 2.3.1 sets for photosensitivity. The
           charge is already legible from the spark's COLOUR tiering, so the
           flicker was decoration with a real cost. Slowed for everyone and
           held steady under reduced motion. */
        const pulse = this.reducedMotion ? 1 : 1 + Math.sin(snapshot.raceTime * 12) * 0.2;
        spark.scale.setScalar((0.6 + view.driftCharge) * pulse);
      }

      const flame = rig.getObjectByName("flame") as THREE.Mesh | undefined;
      if (flame) {
        flame.visible = view.boosting;
        // Likewise ~4Hz; eased to a steadier flicker.
        flame.scale.setScalar(this.reducedMotion ? 1 : 1 + Math.sin(snapshot.raceTime * 12) * 0.18);
      }

      if (view.spinning) rig.rotation.y += dt * 9;
      rig.visible = !view.finished || view.local;
    }

    for (const [id, rig] of this.kartRigs) {
      if (seen.has(id)) continue;
      this.scene.remove(rig);
      const companion = rig.getObjectByName("companion");
      if (companion) {
        const material = (companion as THREE.Sprite).material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
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

    /* Hazard motion comes from `hazardPosition` in track.ts, the same
       function the collision test uses, so what you see is exactly what can
       hit you. It is a pure function of race time, hence no network traffic. */
    for (const { mesh, spec } of this.hazardMeshes) {
      const at = hazardPosition(this.course, spec, snapshot.raceTime);
      mesh.position.set(at.x, at.y, at.z);
      mesh.rotation.y += dt * 1.2;
    }
  }

  private readonly shotMeshes = new Map<number, THREE.Mesh>();

  /** Projectiles and traps, pooled by id so they appear and vanish cleanly. */
  private syncShots(snapshot: RacingSnapshot) {
    const shots = snapshot.shots ?? [];
    const seen = new Set<number>();
    for (const shot of shots) {
      seen.add(shot.id);
      let mesh = this.shotMeshes.get(shot.id);
      if (!mesh) {
        /* Shared geometry and material, not per-shot. Allocating them per
           projectile pushed a fresh pair into the disposal registry every
           time an item was fired and never released it until the whole
           renderer tore down — a race throws 20-40 items, and a rematch
           loop grew that without bound. The mesh is cheap; the buffers are
           not. */
        const pooled = shot.trap ? this.trapAsset : this.projectileAsset;
        mesh = new THREE.Mesh(pooled.geometry, pooled.material);
        mesh.castShadow = !shot.trap;
        this.scene.add(mesh);
        this.shotMeshes.set(shot.id, mesh);
      }
      mesh.position.set(shot.x, shot.trap ? 0.12 : 0.65, shot.z);
    }
    for (const [id, mesh] of this.shotMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.shotMeshes.delete(id);
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

    /* The speed-rush FOV punch is the single most nausea-inducing thing a
       chase camera does, so reduced motion keeps the field of view fixed
       rather than merely softening it. Boost still reads clearly through the
       exhaust flame, the HUD chip and the sound. */
    const boostPunch = this.reducedMotion ? 0 : 9;
    const leanPunch = this.reducedMotion ? 0 : 3;
    const wantedFov = this.baseFov + (follow.boosting ? boostPunch : 0) + Math.abs(follow.lean) * leanPunch;
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
    this.syncShots(snapshot);
    this.syncFeatures(snapshot, dt);
    this.updateCamera(snapshot, dt);
  }

  dispose() {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.kartRigs.clear();
    this.itemBoxMeshes.length = 0;
    this.hazardMeshes.length = 0;
    this.shotMeshes.clear();
    for (const texture of this.companionTextures.values()) texture.dispose();
    this.companionTextures.clear();
    this.scene.clear();
  }
}
