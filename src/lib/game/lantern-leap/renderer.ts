/**
 * Lantern Leap — three.js presentation layer.
 *
 * Owns EVERYTHING visual and nothing else: no input, no rules, no netcode.
 * The simulation hands it a read-only snapshot each frame and it draws.
 * That split is what lets the look be reworked without risking the feel.
 *
 * Rendering approach: 2.5D. Real geometry and real lights on a flat play
 * plane, orthographic camera pitched a few degrees down so terrain reads as
 * carved landmass instead of wallpaper. Tiles are drawn with InstancedMesh —
 * a handful of draw calls for a whole level — and every texture is generated
 * procedurally at load (see `effects.ts`), so the look costs no assets.
 *
 * Post-processing lives here too. `renderWith(renderer)` runs the composer
 * (bloom, grade, vignette, SMAA); `scene`/`camera` stay valid so a caller
 * that just does `renderer.render(view.scene, view.camera)` still works,
 * only without the grade.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { TILE, isFloor, isSlope, tileAt } from "./physics";
import type { Level } from "./level";
import {
  AmbientMotes,
  ParticleSystem,
  bladeTexture,
  glintTexture,
  hash2,
  radialTexture,
  shaftTexture,
  surfaceTextures,
  worldProjectMaps,
} from "./effects";

export type RenderPlayer = {
  id: string;
  name: string;
  seat: number;
  x: number;
  y: number;
  facing: 1 | -1;
  motion: string;
  /** Squash/stretch, 1 = neutral. */
  squash: number;
  bubbled: boolean;
  local: boolean;
};

export type RenderPickup = { id: number; kind: string; x: number; y: number; taken: boolean };
export type RenderEnemy = { id: number; kind: string; x: number; y: number; facing: 1 | -1; dead: boolean };

export type RenderSnapshot = {
  players: RenderPlayer[];
  pickups: RenderPickup[];
  enemies: RenderEnemy[];
  /** Seconds since the level started, for animation phase. */
  time: number;
  camera: { x: number; y: number; zoom: number };
};

/* ------------------------------------------------------------------ */
/* Themes                                                              */
/* ------------------------------------------------------------------ */

type SurfaceSpec = Parameters<typeof surfaceTextures>[0];

type ThemeSpec = {
  sky: readonly [number, number, number];
  /** Painted horizon glow behind the hills. */
  horizon: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  key: number;
  keyPower: number;
  fill: number;
  fillPower: number;
  ground: number;
  rim: number;
  rimPower: number;
  ambient: number;
  ambientPower: number;
  rock: SurfaceSpec;
  crust: SurfaceSpec;
  /** Ledge fringe + tuft tint. */
  foliage: number;
  foliageAmount: number;
  accent: number;
  /** Back-to-front silhouette colours. */
  ridge: readonly [number, number, number];
  skyline: "hills" | "trees" | "spires";
  stars: number;
  moon: number | null;
  shaft: { color: number; power: number; count: number; tilt: number };
  bloom: { strength: number; radius: number; threshold: number };
  grade: { lift: [number, number, number]; gain: [number, number, number]; sat: number; contrast: number; vignette: number };
  motes: number;
  dust: number;
};

const THEMES: Record<"dusk" | "grove" | "cavern", ThemeSpec> = {
  dusk: {
    sky: [0x1a1136, 0x5b2f6d, 0xf2916f],
    horizon: 0xffb977,
    fog: 0x3b2455,
    fogNear: 40,
    fogFar: 150,
    key: 0xffc98f,
    keyPower: 3.1,
    fill: 0x8fb0ff,
    fillPower: 0.85,
    ground: 0x40284f,
    rim: 0xff9ad0,
    rimPower: 1.7,
    ambient: 0x5b4a7a,
    ambientPower: 0.5,
    rock: {
      color: 0x5c4478, shade: 0x241733, patch: 0x8a6aa8, patchAmount: 0.55,
      strata: 0.35, crack: 0.55, grain: 0.09, roughLow: 0.55, roughHigh: 0.98, bump: 3.6, detail: 1.15,
    },
    crust: {
      color: 0xa87ec6, shade: 0x4a2f66, patch: 0xffc98f, patchAmount: 0.3,
      strata: 0.1, crack: 0.35, grain: 0.16, roughLow: 0.5, roughHigh: 0.95, bump: 2.6, detail: 2.4, size: 128,
    },
    foliage: 0xb98ad6,
    foliageAmount: 0.85,
    accent: 0xffbe63,
    ridge: [0x2b1b48, 0x22143a, 0x180e2b],
    skyline: "hills",
    stars: 0.55,
    moon: 0xffe6c0,
    shaft: { color: 0xffc98f, power: 0.16, count: 5, tilt: 0.28 },
    bloom: { strength: 0.62, radius: 0.55, threshold: 0.6 },
    grade: { lift: [0.012, 0.004, 0.022], gain: [1.04, 0.99, 1.03], sat: 1.14, contrast: 1.07, vignette: 1.15 },
    motes: 0xffd9a0,
    dust: 0xc9a7e0,
  },
  grove: {
    sky: [0x0d3242, 0x2b8a8c, 0xd8f0cf],
    horizon: 0xfff0b8,
    fog: 0x2b6a63,
    fogNear: 40,
    fogFar: 150,
    key: 0xfff2c8,
    keyPower: 3.3,
    fill: 0x9ce8d6,
    fillPower: 0.9,
    ground: 0x2c4a3a,
    rim: 0x8fffd6,
    rimPower: 1.5,
    ambient: 0x527a6e,
    ambientPower: 0.55,
    rock: {
      color: 0x4e6b4e, shade: 0x1d2c26, patch: 0x7ba05a, patchAmount: 0.6,
      strata: 0.22, crack: 0.6, grain: 0.1, roughLow: 0.6, roughHigh: 1, bump: 3.8, detail: 1.15,
    },
    crust: {
      color: 0x8fc766, shade: 0x2f5233, patch: 0xd8ec8a, patchAmount: 0.45,
      strata: 0.05, crack: 0.25, grain: 0.2, roughLow: 0.6, roughHigh: 1, bump: 2.8, detail: 2.6, size: 128,
    },
    foliage: 0x8ccf62,
    foliageAmount: 1,
    accent: 0xffe08a,
    ridge: [0x1d5560, 0x14424c, 0x0d2c35],
    skyline: "trees",
    stars: 0,
    moon: null,
    shaft: { color: 0xfff3c0, power: 0.22, count: 6, tilt: 0.34 },
    bloom: { strength: 0.5, radius: 0.5, threshold: 0.68 },
    grade: { lift: [0.006, 0.014, 0.01], gain: [1.02, 1.03, 0.99], sat: 1.12, contrast: 1.06, vignette: 1.05 },
    motes: 0xeaffc0,
    dust: 0xbfe0a0,
  },
  cavern: {
    sky: [0x090717, 0x1e1440, 0x4a2f6b],
    horizon: 0x7a4bb0,
    fog: 0x150f2c,
    fogNear: 34,
    fogFar: 130,
    key: 0xc9a6ff,
    keyPower: 2.2,
    fill: 0x6f7dff,
    fillPower: 0.8,
    ground: 0x241a3d,
    rim: 0x7ce8ff,
    rimPower: 1.9,
    ambient: 0x3a2f5e,
    ambientPower: 0.45,
    rock: {
      color: 0x453862, shade: 0x150f26, patch: 0x6f5aa0, patchAmount: 0.5,
      strata: 0.45, crack: 0.7, grain: 0.08, roughLow: 0.5, roughHigh: 1, bump: 4.2, detail: 1.1,
    },
    crust: {
      color: 0x7b64b8, shade: 0x2b1f4a, patch: 0x9ce8ff, patchAmount: 0.4,
      strata: 0.15, crack: 0.4, grain: 0.14, roughLow: 0.35, roughHigh: 0.9, bump: 3, detail: 2.2, size: 128,
    },
    foliage: 0x9ce8ff,
    foliageAmount: 0.5,
    accent: 0x9ce8ff,
    ridge: [0x1d1338, 0x160e2b, 0x0d0820],
    skyline: "spires",
    stars: 0.25,
    moon: null,
    shaft: { color: 0xb08cff, power: 0.2, count: 4, tilt: 0.2 },
    bloom: { strength: 0.78, radius: 0.6, threshold: 0.5 },
    grade: { lift: [0.008, 0.006, 0.03], gain: [1, 0.98, 1.08], sat: 1.16, contrast: 1.1, vignette: 1.3 },
    motes: 0xa8d8ff,
    dust: 0x8c7ac0,
  },
};

export type LanternTheme = keyof typeof THEMES;

const SEAT_COLORS = [
  0xf07f9a, 0x7fc4f0, 0xf6c66a, 0x9ad98b,
  0xc79af0, 0xf09a6a, 0x6ad9c4, 0xe86a8f,
];
export const seatColor = (seat: number) => SEAT_COLORS[Math.abs(seat) % SEAT_COLORS.length];

/* ------------------------------------------------------------------ */
/* Scene constants                                                     */
/* ------------------------------------------------------------------ */

/** Terrain slab thickness, and where its front face sits. */
const TILE_DEPTH = 1.7;
const TILE_Z = -0.55;
const FRONT_Z = TILE_Z + TILE_DEPTH / 2;
/** Characters and pickups ride just proud of the terrain face. */
const ENTITY_Z = FRONT_Z + 0.22;
/** Camera pitch. Small, but it is what turns flat boxes into ledges. */
const TILT = 0.115;
const CAM_DISTANCE = 60;

const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * Math.max(dt, 0)));

/** Vertical gradient sky with painted haze and stars. */
function makeSky(theme: ThemeSpec) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Lantern Leap could not create its sky gradient.");
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, hex(theme.sky[0]));
  gradient.addColorStop(0.42, hex(theme.sky[1]));
  gradient.addColorStop(1, hex(theme.sky[2]));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 512);

  if (theme.stars > 0) {
    for (let i = 0; i < 260; i += 1) {
      const x = hash2(i, 1, 17) * 128;
      const y = hash2(i, 2, 17) ** 1.7 * 380;
      const r = 0.4 + hash2(i, 3, 17) * 1.1;
      const a = (0.25 + hash2(i, 4, 17) * 0.75) * theme.stars * (1 - y / 460);
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // A warm band just above the horizon: the cheapest depth cue in painting.
  const glow = ctx.createLinearGradient(0, 300, 0, 512);
  glow.addColorStop(0, `${hex(theme.horizon)}00`);
  glow.addColorStop(1, `${hex(theme.horizon)}88`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 300, 128, 212);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A continuous silhouette ridgeline, built as one polygon. Overlapping
 * circles read as overlapping circles; a real ridge reads as landscape.
 */
function ridgeGeometry(span: number, style: ThemeSpec["skyline"], seed: number, amplitude: number, base: number) {
  const points: THREE.Vector2[] = [];
  const step = style === "trees" ? 0.6 : 1.1;
  const columns = Math.ceil(span / step);
  for (let i = 0; i <= columns; i += 1) {
    const x = i * step;
    const n =
      Math.sin(x * 0.09 + seed) * 0.5 +
      Math.sin(x * 0.23 + seed * 2.3) * 0.3 +
      Math.sin(x * 0.61 + seed * 4.1) * 0.16;
    let y = base + n * amplitude;
    if (style === "trees") {
      // Conifer teeth on top of the ridge.
      const tooth = i % 2 === 0 ? 1 : 0;
      const height = (0.5 + hash2(i, seed, 5) * 1.4) * amplitude * 0.55;
      y += tooth ? height : 0;
    } else if (style === "spires") {
      const spike = hash2(i, seed, 9) > 0.66 ? (0.6 + hash2(i, seed, 11)) * amplitude * 0.9 : 0;
      y += spike;
    }
    points.push(new THREE.Vector2(x, y));
  }
  const shape = new THREE.Shape();
  shape.moveTo(0, -60);
  for (const point of points) shape.lineTo(point.x, point.y);
  shape.lineTo(span, -60);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/* ------------------------------------------------------------------ */

type Rig = {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  hips: THREE.Group;
  armFront: THREE.Group;
  armBack: THREE.Group;
  legFront: THREE.Group;
  legBack: THREE.Group;
  lantern: THREE.Group;
  light: THREE.PointLight;
  glow: THREE.Mesh;
  eyes: THREE.Group;
  bubble: THREE.Mesh;
  shadow: THREE.Mesh;
  motion: string;
  lean: number;
  cycle: number;
  bob: number;
};

type EnemyNode = {
  root: THREE.Group;
  spin?: THREE.Object3D;
  wings?: THREE.Object3D[];
  feet?: THREE.Object3D[];
  eyes?: THREE.Object3D;
  glow?: THREE.Mesh;
  shadow?: THREE.Mesh;
  dead: boolean;
  fade: number;
};

type PickupNode = {
  root: THREE.Group;
  spin: THREE.Object3D;
  glow: THREE.Mesh;
  glint?: THREE.Mesh;
  light?: THREE.PointLight;
  kind: string;
  taken: boolean;
  pop: number;
};

export class LanternRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private readonly theme: ThemeSpec;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly playerRigs = new Map<string, Rig>();
  private readonly pickupNodes = new Map<number, PickupNode>();
  private readonly enemyNodes = new Map<number, EnemyNode>();
  private readonly parallax: THREE.Object3D[] = [];
  private readonly geometryCache = new Map<string, THREE.BufferGeometry>();
  private readonly fx = new ParticleSystem(520);
  private readonly motes: AmbientMotes;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly shadowGeometry: THREE.PlaneGeometry;
  private readonly glowTexture: THREE.Texture;
  private readonly glintMap: THREE.Texture;
  private sky?: THREE.Mesh;
  private keyLight?: THREE.DirectionalLight;
  private goalBeacon?: { root: THREE.Group; rings: THREE.Object3D[]; orb: THREE.Mesh; shaft: THREE.Mesh; light: THREE.PointLight };
  private shafts: THREE.Object3D[] = [];
  private pulsers: Array<{ material: THREE.MeshStandardMaterial; base: number; rate: number; depth: number }> = [];
  private lastTime = 0;
  private frameDt = 0;

  /* -- post -- */
  private composer?: EffectComposer;
  private bloomPass?: UnrealBloomPass;
  private composerSize = new THREE.Vector2();

  /** Visible world height in tiles. Width follows the aspect ratio. */
  viewHeight = 15;

  constructor(private readonly level: Level) {
    this.theme = THEMES[level.theme];
    this.camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 400);
    this.camera.position.set(0, 0, CAM_DISTANCE);

    this.scene.fog = new THREE.Fog(this.theme.fog, this.theme.fogNear, this.theme.fogFar);
    this.glowTexture = this.track(radialTexture(0.9, 128));
    this.glintMap = this.track(glintTexture(96));
    this.shadowGeometry = this.track(new THREE.PlaneGeometry(1, 1));
    this.shadowMaterial = this.track(new THREE.MeshBasicMaterial({
      map: this.track(radialTexture(1.1, 64)),
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
    }));
    this.motes = new AmbientMotes(90, this.theme.motes);

    this.buildSky();
    this.buildLights();
    this.buildParallax();
    this.buildShafts();
    this.buildTerrain();
    this.buildGoal();
    this.scene.add(this.motes.mesh);
    this.scene.add(this.fx.mesh);
  }

  private track<T extends { dispose: () => void }>(item: T) {
    this.disposables.push(item);
    return item;
  }

  private geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    const cached = this.geometryCache.get(key);
    if (cached) return cached as T;
    const created = this.track(make());
    this.geometryCache.set(key, created);
    return created;
  }

  /* ---------------------------------------------------------------- */
  /* Sky, backdrop, lights                                             */
  /* ---------------------------------------------------------------- */

  private buildSky() {
    const texture = this.track(makeSky(this.theme));
    const geometry = this.track(new THREE.PlaneGeometry(1, 1));
    const material = this.track(new THREE.MeshBasicMaterial({ map: texture, depthWrite: false, fog: false }));
    this.sky = new THREE.Mesh(geometry, material);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  private buildLights() {
    const theme = this.theme;
    this.scene.add(new THREE.AmbientLight(theme.ambient, theme.ambientPower));
    // Hemisphere fill: sky above, bounce below. Reads far less flat than a
    // single ambient term because it gives surfaces a top-to-bottom ramp.
    this.scene.add(new THREE.HemisphereLight(theme.fill, theme.ground, theme.fillPower));

    const key = new THREE.DirectionalLight(theme.key, theme.keyPower);
    key.position.set(-16, 26, 34);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 140;
    key.shadow.camera.left = -30;
    key.shadow.camera.right = 30;
    key.shadow.camera.top = 22;
    key.shadow.camera.bottom = -22;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.035;
    key.shadow.radius = 3;
    this.scene.add(key);
    this.scene.add(key.target);
    this.keyLight = key;

    // Cool rim from behind picks silhouettes off the background.
    const rim = new THREE.DirectionalLight(theme.rim, theme.rimPower);
    rim.position.set(18, 6, -26);
    this.scene.add(rim);

    // A soft warm bounce from below-front, so the underside of ledges and
    // the character's chin never go pure black.
    const bounce = new THREE.DirectionalLight(theme.accent, 0.45);
    bounce.position.set(6, -14, 20);
    this.scene.add(bounce);
  }

  private buildParallax() {
    const theme = this.theme;
    const span = this.level.grid.width + 140;
    const layers = [
      { z: -46, speed: 0.08, color: theme.ridge[0], amplitude: 9, base: 2, opacity: 1 },
      { z: -30, speed: 0.22, color: theme.ridge[1], amplitude: 6.5, base: -1, opacity: 1 },
      { z: -16, speed: 0.42, color: theme.ridge[2], amplitude: 4.5, base: -3.5, opacity: 1 },
    ];

    layers.forEach((layer, index) => {
      const group = new THREE.Group();
      group.position.z = layer.z;
      group.userData.speed = layer.speed;
      const material = this.track(new THREE.MeshBasicMaterial({
        color: layer.color, fog: false, transparent: layer.opacity < 1, opacity: layer.opacity,
      }));
      const geometry = this.track(ridgeGeometry(span, theme.skyline, index * 3.7 + 1.2, layer.amplitude, layer.base));
      const ridge = new THREE.Mesh(geometry, material);
      ridge.position.x = -70;
      ridge.frustumCulled = false;
      group.add(ridge);
      this.scene.add(group);
      this.parallax.push(group);
    });

    if (theme.moon !== null) {
      const group = new THREE.Group();
      group.position.z = -52;
      group.userData.speed = 0.03;
      const disc = new THREE.Mesh(
        this.track(new THREE.CircleGeometry(2.6, 40)),
        this.track(new THREE.MeshBasicMaterial({ color: theme.moon, fog: false })),
      );
      const halo = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(18, 18)),
        this.track(new THREE.MeshBasicMaterial({
          map: this.glowTexture, color: theme.moon, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5,
        })),
      );
      group.add(halo, disc);
      group.position.x = 16;
      group.position.y = 13;
      this.scene.add(group);
      this.parallax.push(group);
    }
  }

  /** Cheap god rays: big soft additive wedges drifting behind the play plane. */
  private buildShafts() {
    const spec = this.theme.shaft;
    const texture = this.track(shaftTexture(64));
    const material = this.track(new THREE.MeshBasicMaterial({
      map: texture, color: spec.color, transparent: true, opacity: spec.power,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    const geometry = this.track(new THREE.PlaneGeometry(6, 46));
    for (let i = 0; i < spec.count; i += 1) {
      const shaft = new THREE.Mesh(geometry, material);
      shaft.position.set(i * 13 - 20, 12, -12 - (i % 3) * 4);
      shaft.rotation.z = spec.tilt + (hash2(i, 3, 21) - 0.5) * 0.14;
      shaft.scale.set(0.6 + hash2(i, 5, 21) * 1.1, 1, 1);
      shaft.frustumCulled = false;
      shaft.renderOrder = -20;
      this.scene.add(shaft);
      this.shafts.push(shaft);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Terrain                                                           */
  /* ---------------------------------------------------------------- */

  private rockMaterial(spec: SurfaceSpec, worldScale: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const surface = surfaceTextures(spec);
    this.track(surface.map);
    this.track(surface.normalMap);
    this.track(surface.roughnessMap);
    const material = this.track(new THREE.MeshStandardMaterial({
      map: surface.map,
      normalMap: surface.normalMap,
      roughnessMap: surface.roughnessMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      metalness: 0.05,
      roughness: 1,
      ...extra,
    }));
    if (worldScale > 0) worldProjectMaps(material, worldScale);
    return material;
  }

  private buildTerrain() {
    const { grid } = this.level;
    const solid: Array<{ x: number; y: number }> = [];
    const ice: Array<{ x: number; y: number }> = [];
    const oneway: Array<{ x: number; y: number }> = [];
    const bounce: Array<{ x: number; y: number }> = [];
    const hazard: Array<{ x: number; y: number }> = [];
    const slopes: Array<{ x: number; y: number; id: number }> = [];

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const id = tileAt(grid, x, y);
        if (id === TILE.EMPTY) continue;
        if (id === TILE.SOLID) solid.push({ x, y });
        else if (id === TILE.ICE) ice.push({ x, y });
        else if (id === TILE.ONEWAY) oneway.push({ x, y });
        else if (id === TILE.BOUNCE) bounce.push({ x, y });
        else if (id === TILE.HAZARD) hazard.push({ x, y });
        else if (isSlope(id)) slopes.push({ x, y, id });
      }
    }

    const rock = this.rockMaterial(this.theme.rock, 0.34);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const open = (x: number, y: number) => {
      const id = tileAt(grid, x, y);
      return id === TILE.EMPTY || id === TILE.ONEWAY || id === TILE.HAZARD || isSlope(id);
    };

    /* -- the mass -- */
    if (solid.length > 0) {
      const body = new THREE.InstancedMesh(
        this.geo("tile-body", () => {
          const g = new THREE.BoxGeometry(1, 1, TILE_DEPTH);
          g.translate(0, 0, TILE_Z);
          return g;
        }),
        rock,
        solid.length,
      );
      solid.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y + 0.5, 0);
        body.setMatrixAt(index, matrix);
        // Buried tiles go dark: the mass gains an interior instead of
        // reading as one flat wall of identical bricks.
        const exposed = open(cell.x - 1, cell.y) || open(cell.x + 1, cell.y)
          || open(cell.x, cell.y - 1) || open(cell.x, cell.y + 1);
        const deep = !exposed && !(open(cell.x - 2, cell.y) || open(cell.x + 2, cell.y)
          || open(cell.x, cell.y - 2) || open(cell.x, cell.y + 2));
        const shade = deep ? 0.45 : exposed ? 1 : 0.72;
        const variance = 0.9 + hash2(cell.x, cell.y, 3) * 0.2;
        color.setScalar(shade * variance);
        body.setColorAt(index, color);
      });
      body.instanceMatrix.needsUpdate = true;
      body.castShadow = true;
      body.receiveShadow = true;
      this.scene.add(body);
    }

    /* -- crust: the lit band along every exposed ledge -- */
    const caps = solid.filter((cell) => tileAt(grid, cell.x, cell.y + 1) === TILE.EMPTY);
    const iceCaps = ice.filter((cell) => tileAt(grid, cell.x, cell.y + 1) === TILE.EMPTY);
    if (caps.length > 0) {
      const crust = this.rockMaterial(this.theme.crust, 0, { roughness: 0.95 });
      const mesh = new THREE.InstancedMesh(
        this.geo("tile-crust", () => {
          const g = new THREE.BoxGeometry(1.02, 0.36, TILE_DEPTH + 0.05);
          g.translate(0, -0.18, TILE_Z);
          return g;
        }),
        crust,
        caps.length,
      );
      caps.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y + 1, 0);
        mesh.setMatrixAt(index, matrix);
        const variance = 0.85 + hash2(cell.x, cell.y, 12) * 0.3;
        color.setScalar(variance);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      this.buildFringe(caps);
      this.buildScatter(caps);
    }
    if (iceCaps.length > 0) this.buildIceCaps(iceCaps);

    /* -- ice -- */
    if (ice.length > 0) {
      const mesh = new THREE.InstancedMesh(
        this.geo("tile-body", () => {
          const g = new THREE.BoxGeometry(1, 1, TILE_DEPTH);
          g.translate(0, 0, TILE_Z);
          return g;
        }),
        this.rockMaterial(
          { color: 0xbfe8ff, shade: 0x5f8fc4, patch: 0xffffff, patchAmount: 0.5, strata: 0.5, crack: 0.9, grain: 0.05, roughLow: 0.02, roughHigh: 0.3, bump: 2.4, detail: 1.4 },
          0.34,
          { metalness: 0.25, transparent: true, opacity: 0.92, emissive: 0x2a5f8a, emissiveIntensity: 0.35 },
        ),
        ice.length,
      );
      ice.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y + 0.5, 0);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    /* -- slopes -- */
    if (slopes.length > 0) {
      const geometry = this.geo("tile-slope", () => {
        const shape = new THREE.Shape();
        shape.moveTo(-0.5, -0.5);
        shape.lineTo(0.5, -0.5);
        shape.lineTo(0.5, 0.5);
        shape.closePath();
        const g = new THREE.ExtrudeGeometry(shape, { depth: TILE_DEPTH, bevelEnabled: false });
        g.translate(0, 0, TILE_Z - TILE_DEPTH / 2);
        return g;
      });
      const mesh = new THREE.InstancedMesh(geometry, rock, slopes.length);
      slopes.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y + 0.5, 0);
        if (cell.id === TILE.SLOPE_L) matrix.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
        mesh.setMatrixAt(index, matrix);
        color.setScalar(0.95 + hash2(cell.x, cell.y, 8) * 0.15);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // Bright edge along the walkable face.
      const crust = this.rockMaterial(this.theme.crust, 0, { roughness: 0.95 });
      const edge = new THREE.InstancedMesh(
        this.geo("slope-crust", () => {
          const g = new THREE.BoxGeometry(1.45, 0.3, TILE_DEPTH + 0.05);
          g.translate(0, 0, TILE_Z);
          return g;
        }),
        crust,
        slopes.length,
      );
      const quaternion = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3(1, 1, 1);
      slopes.forEach((cell, index) => {
        const right = cell.id === TILE.SLOPE_R;
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), right ? Math.PI / 4 : -Math.PI / 4);
        position.set(cell.x + 0.5 + (right ? -0.09 : 0.09), cell.y + 0.5 + 0.09, 0);
        matrix.compose(position, quaternion, scale);
        edge.setMatrixAt(index, matrix);
      });
      edge.instanceMatrix.needsUpdate = true;
      edge.castShadow = true;
      edge.receiveShadow = true;
      this.scene.add(edge);
    }

    /* -- one-way planks -- */
    if (oneway.length > 0) {
      const plank = this.rockMaterial(
        { color: 0xb98a52, shade: 0x5a3a22, patch: 0xd8a86a, patchAmount: 0.5, strata: 0.75, crack: 0.5, grain: 0.14, roughLow: 0.5, roughHigh: 0.95, bump: 2.6, detail: 1.6, size: 128 },
        0.5,
        { metalness: 0.02 },
      );
      const mesh = new THREE.InstancedMesh(
        this.geo("tile-oneway", () => {
          const g = new THREE.BoxGeometry(1.0, 0.3, TILE_DEPTH * 0.72);
          g.translate(0, -0.15, TILE_Z * 0.5);
          return g;
        }),
        plank,
        oneway.length,
      );
      oneway.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y + 1, 0);
        mesh.setMatrixAt(index, matrix);
        color.setScalar(0.86 + hash2(cell.x, cell.y, 22) * 0.28);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // Bolted end caps so a plank run has ends instead of just stopping.
      const ends = oneway.filter((cell) => tileAt(grid, cell.x - 1, cell.y) !== TILE.ONEWAY || tileAt(grid, cell.x + 1, cell.y) !== TILE.ONEWAY);
      if (ends.length > 0) {
        const capMaterial = this.track(new THREE.MeshStandardMaterial({
          color: 0x6a4a30, roughness: 0.45, metalness: 0.55, emissive: this.theme.accent, emissiveIntensity: 0.12,
        }));
        const capMesh = new THREE.InstancedMesh(
          this.geo("plank-end", () => {
            const g = new THREE.CylinderGeometry(0.09, 0.09, 0.42, 10);
            g.rotateX(Math.PI / 2);
            return g;
          }),
          capMaterial,
          ends.length * 2,
        );
        let i = 0;
        for (const cell of ends) {
          for (const side of [-0.38, 0.38]) {
            matrix.makeTranslation(cell.x + 0.5 + side, cell.y + 0.85, TILE_Z * 0.5 + 0.5);
            capMesh.setMatrixAt(i, matrix);
            i += 1;
          }
        }
        capMesh.count = i;
        capMesh.instanceMatrix.needsUpdate = true;
        capMesh.castShadow = true;
        this.scene.add(capMesh);
      }
    }

    /* -- hazards -- */
    if (hazard.length > 0) {
      const spikeMaterial = this.track(new THREE.MeshStandardMaterial({
        color: 0xd8dae8, roughness: 0.22, metalness: 0.85,
        emissive: 0xff4f7a, emissiveIntensity: 0.35,
      }));
      const perTile = 3;
      const mesh = new THREE.InstancedMesh(
        this.geo("spike", () => new THREE.ConeGeometry(0.16, 0.72, 6)),
        spikeMaterial,
        hazard.length * perTile,
      );
      const quaternion = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      let i = 0;
      for (const cell of hazard) {
        for (let s = 0; s < perTile; s += 1) {
          const jx = (s - 1) * 0.3 + (hash2(cell.x, s, 4) - 0.5) * 0.08;
          const h = 0.78 + hash2(cell.x, s, 6) * 0.42;
          quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (hash2(cell.x, s, 7) - 0.5) * 0.22);
          position.set(cell.x + 0.5 + jx, cell.y + 0.36 * h, TILE_Z + 0.35 + (hash2(cell.x, s, 8) - 0.5) * 0.5);
          scale.set(1, h, 1);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(i, matrix);
          i += 1;
        }
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      const baseMaterial = this.track(new THREE.MeshStandardMaterial({
        color: 0x3a2438, roughness: 0.8, metalness: 0.1,
      }));
      const base = new THREE.InstancedMesh(
        this.geo("spike-base", () => {
          const g = new THREE.BoxGeometry(1.02, 0.22, TILE_DEPTH);
          g.translate(0, 0.11, TILE_Z);
          return g;
        }),
        baseMaterial,
        hazard.length,
      );
      hazard.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y, 0);
        base.setMatrixAt(index, matrix);
      });
      base.instanceMatrix.needsUpdate = true;
      base.receiveShadow = true;
      this.scene.add(base);
    }

    /* -- bounce pads -- */
    if (bounce.length > 0) {
      const padMaterial = this.track(new THREE.MeshStandardMaterial({
        color: 0xff8fb8, roughness: 0.3, metalness: 0.1,
        emissive: 0xff2f7a, emissiveIntensity: 0.6,
      }));
      this.pulsers.push({ material: padMaterial, base: 0.6, rate: 2.4, depth: 0.45 });
      const mesh = new THREE.InstancedMesh(
        this.geo("bounce", () => {
          const g = new THREE.SphereGeometry(0.52, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
          g.scale(1, 0.85, 1);
          g.translate(0, 0.42, TILE_Z + 0.3);
          return g;
        }),
        padMaterial,
        bounce.length,
      );
      bounce.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y, 0);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      const stalk = new THREE.InstancedMesh(
        this.geo("bounce-stalk", () => {
          const g = new THREE.CylinderGeometry(0.2, 0.3, 0.46, 14);
          g.translate(0, 0.23, TILE_Z + 0.3);
          return g;
        }),
        this.track(new THREE.MeshStandardMaterial({ color: 0xf2d8c0, roughness: 0.7 })),
        bounce.length,
      );
      bounce.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y, 0);
        stalk.setMatrixAt(index, matrix);
      });
      stalk.instanceMatrix.needsUpdate = true;
      stalk.castShadow = true;
      this.scene.add(stalk);
    }
  }

  /** Grass/moss hanging over every ledge, plus tufts standing on top. */
  private buildFringe(caps: Array<{ x: number; y: number }>) {
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    const hang = new THREE.InstancedMesh(
      this.geo("fringe", () => {
        const g = new THREE.PlaneGeometry(1.06, 0.5);
        g.translate(0, -0.22, FRONT_Z + 0.012);
        return g;
      }),
      this.track(new THREE.MeshStandardMaterial({
        map: this.track(bladeTexture(128, 96, 3, true)),
        color: this.theme.foliage,
        roughness: 0.9,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
      })),
      caps.length,
    );
    caps.forEach((cell, index) => {
      matrix.makeTranslation(cell.x + 0.5, cell.y + 1.02, 0);
      hang.setMatrixAt(index, matrix);
      color.setScalar(0.72 + hash2(cell.x, cell.y, 15) * 0.5);
      hang.setColorAt(index, color);
    });
    hang.instanceMatrix.needsUpdate = true;
    hang.castShadow = true;
    hang.receiveShadow = true;
    this.scene.add(hang);

    const tufts = caps.filter((cell) => hash2(cell.x, cell.y, 19) < this.theme.foliageAmount * 0.55);
    if (tufts.length === 0) return;
    const stand = new THREE.InstancedMesh(
      this.geo("tuft", () => {
        const g = new THREE.PlaneGeometry(0.8, 0.42);
        g.translate(0, 0.19, TILE_Z + 0.25);
        return g;
      }),
      this.track(new THREE.MeshStandardMaterial({
        map: this.track(bladeTexture(96, 96, 8, false)),
        color: this.theme.foliage,
        roughness: 0.9,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
      })),
      tufts.length,
    );
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    tufts.forEach((cell, index) => {
      const s = 0.7 + hash2(cell.x, cell.y, 23) * 0.7;
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (hash2(cell.x, cell.y, 27) - 0.5) * 0.5);
      position.set(cell.x + 0.5 + (hash2(cell.x, cell.y, 29) - 0.5) * 0.4, cell.y + 0.98, 0);
      scale.set(s, s, s);
      matrix.compose(position, quaternion, scale);
      stand.setMatrixAt(index, matrix);
      color.setScalar(0.8 + hash2(cell.x, cell.y, 31) * 0.45);
      stand.setColorAt(index, color);
    });
    stand.instanceMatrix.needsUpdate = true;
    stand.castShadow = true;
    this.scene.add(stand);
  }

  /** Loose rock on the ledges and drips under the overhangs. */
  private buildScatter(caps: Array<{ x: number; y: number }>) {
    const { grid } = this.level;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    const material = this.rockMaterial(this.theme.rock, 0.34, { roughness: 0.95 });

    const rocks = caps.filter((cell) => hash2(cell.x, cell.y, 33) > 0.52);
    if (rocks.length > 0) {
      const mesh = new THREE.InstancedMesh(
        this.geo("chunk", () => new THREE.IcosahedronGeometry(0.24, 0)),
        material,
        rocks.length,
      );
      rocks.forEach((cell, index) => {
        const s = 0.5 + hash2(cell.x, cell.y, 37) * 0.85;
        euler.set(hash2(cell.x, cell.y, 41) * 6.28, hash2(cell.x, cell.y, 43) * 6.28, hash2(cell.x, cell.y, 47) * 6.28);
        quaternion.setFromEuler(euler);
        position.set(
          cell.x + 0.5 + (hash2(cell.x, cell.y, 51) - 0.5) * 0.7,
          cell.y + 1.02 + s * 0.08,
          TILE_Z + 0.15 + (hash2(cell.x, cell.y, 53) - 0.5) * 0.7,
        );
        scale.set(s, s * 0.8, s);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        color.setScalar(0.9 + hash2(cell.x, cell.y, 57) * 0.35);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // Undersides: stalactites, roots, whatever the theme calls them.
    const drips: Array<{ x: number; y: number }> = [];
    for (let y = 1; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (tileAt(grid, x, y) !== TILE.SOLID) continue;
        if (tileAt(grid, x, y - 1) !== TILE.EMPTY) continue;
        if (hash2(x, y, 61) < 0.45) continue;
        drips.push({ x, y });
      }
    }
    if (drips.length > 0) {
      const mesh = new THREE.InstancedMesh(
        this.geo("drip", () => {
          const g = new THREE.ConeGeometry(0.13, 1, 6);
          g.translate(0, -0.5, 0);
          return g;
        }),
        material,
        drips.length,
      );
      drips.forEach((cell, index) => {
        const len = 0.25 + hash2(cell.x, cell.y, 63) * 0.55;
        position.set(cell.x + 0.5 + (hash2(cell.x, cell.y, 67) - 0.5) * 0.5, cell.y, TILE_Z + 0.2);
        quaternion.identity();
        scale.set(0.7 + hash2(cell.x, cell.y, 69) * 0.6, len, 0.7);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        color.setScalar(0.7 + hash2(cell.x, cell.y, 71) * 0.35);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      this.scene.add(mesh);
    }
  }

  private buildIceCaps(caps: Array<{ x: number; y: number }>) {
    const matrix = new THREE.Matrix4();
    const material = this.track(new THREE.MeshStandardMaterial({
      color: 0xe8faff, roughness: 0.05, metalness: 0.3,
      emissive: 0x6fc8ff, emissiveIntensity: 0.5, transparent: true, opacity: 0.85,
    }));
    const mesh = new THREE.InstancedMesh(
      this.geo("ice-cap", () => {
        const g = new THREE.BoxGeometry(1.04, 0.16, TILE_DEPTH + 0.08);
        g.translate(0, -0.06, TILE_Z);
        return g;
      }),
      material,
      caps.length,
    );
    caps.forEach((cell, index) => {
      matrix.makeTranslation(cell.x + 0.5, cell.y + 1, 0);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  /* ---------------------------------------------------------------- */
  /* Goal beacon                                                       */
  /* ---------------------------------------------------------------- */

  private buildGoal() {
    const { goal } = this.level;
    const root = new THREE.Group();
    root.position.set(goal.x, goal.y, ENTITY_Z - 0.15);

    const post = new THREE.Mesh(
      this.geo("goal-post", () => {
        const g = new THREE.CylinderGeometry(0.07, 0.11, 2.1, 10);
        g.translate(0, 1.05, 0);
        return g;
      }),
      this.track(new THREE.MeshStandardMaterial({ color: 0x4a3a52, roughness: 0.55, metalness: 0.5 })),
    );
    post.castShadow = true;
    root.add(post);

    const orb = new THREE.Mesh(
      this.geo("goal-orb", () => new THREE.IcosahedronGeometry(0.42, 1)),
      this.track(new THREE.MeshStandardMaterial({
        color: this.theme.accent, emissive: this.theme.accent, emissiveIntensity: 2.6,
        roughness: 0.25, metalness: 0.1, flatShading: true,
      })),
    );
    orb.position.y = 2.35;
    root.add(orb);

    const halo = new THREE.Mesh(
      this.geo("goal-halo", () => new THREE.PlaneGeometry(4.2, 4.2)),
      this.track(new THREE.MeshBasicMaterial({
        map: this.glowTexture, color: this.theme.accent, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.8,
      })),
    );
    halo.position.y = 2.35;
    halo.position.z = -0.2;
    root.add(halo);

    const rings: THREE.Object3D[] = [];
    for (let i = 0; i < 2; i += 1) {
      const ring = new THREE.Mesh(
        this.geo(`goal-ring-${i}`, () => new THREE.TorusGeometry(0.62 + i * 0.22, 0.035, 8, 36)),
        this.track(new THREE.MeshStandardMaterial({
          color: 0xffffff, emissive: this.theme.accent, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.7,
        })),
      );
      ring.position.y = 2.35;
      ring.rotation.x = 0.9 + i * 0.5;
      rings.push(ring);
      root.add(ring);
    }

    const shaft = new THREE.Mesh(
      this.geo("goal-shaft", () => {
        const g = new THREE.PlaneGeometry(2.6, 12);
        g.translate(0, 6, 0);
        return g;
      }),
      this.track(new THREE.MeshBasicMaterial({
        map: this.track(shaftTexture(64)), color: this.theme.accent, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.28,
      })),
    );
    shaft.position.set(0, 1.4, -0.6);
    shaft.rotation.z = Math.PI;
    root.add(shaft);

    const light = new THREE.PointLight(this.theme.accent, 14, 14, 1.8);
    light.position.y = 2.35;
    root.add(light);

    this.scene.add(root);
    this.goalBeacon = { root, rings, orb, shaft, light };
  }

  /* ---------------------------------------------------------------- */
  /* Characters                                                        */
  /* ---------------------------------------------------------------- */

  private makeRig(player: RenderPlayer): Rig {
    const coat = new THREE.Color(seatColor(player.seat));
    const coatDark = coat.clone().multiplyScalar(0.55);
    const coatLight = coat.clone().lerp(new THREE.Color(0xffffff), 0.35);

    const cloth = this.track(new THREE.MeshStandardMaterial({ color: coat, roughness: 0.72, metalness: 0.02 }));
    const clothDark = this.track(new THREE.MeshStandardMaterial({ color: coatDark, roughness: 0.8 }));
    const trim = this.track(new THREE.MeshStandardMaterial({ color: coatLight, roughness: 0.55 }));
    const skin = this.track(new THREE.MeshStandardMaterial({ color: 0xf7d9b8, roughness: 0.62 }));
    const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x2a1f30, roughness: 0.5 }));

    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    /* legs */
    const hips = new THREE.Group();
    hips.position.y = 0.46;
    body.add(hips);
    const makeLeg = (side: number) => {
      const leg = new THREE.Group();
      leg.position.set(side * 0.12, 0, side * 0.06);
      const thigh = new THREE.Mesh(this.geo("limb-leg", () => new THREE.CapsuleGeometry(0.088, 0.2, 4, 10)), clothDark);
      thigh.position.y = -0.16;
      thigh.castShadow = true;
      leg.add(thigh);
      const boot = new THREE.Mesh(this.geo("boot", () => {
        const g = new THREE.SphereGeometry(0.12, 12, 8);
        g.scale(0.9, 0.7, 1.35);
        return g;
      }), dark);
      boot.position.set(0, -0.36, 0.05);
      boot.castShadow = true;
      leg.add(boot);
      hips.add(leg);
      return leg;
    };
    const legFront = makeLeg(1);
    const legBack = makeLeg(-1);

    /* torso */
    const torso = new THREE.Group();
    torso.position.y = 0.46;
    body.add(torso);

    const chest = new THREE.Mesh(this.geo("chest", () => {
      const g = new THREE.CapsuleGeometry(0.23, 0.26, 6, 16);
      g.scale(1, 1, 0.86);
      return g;
    }), cloth);
    chest.position.y = 0.22;
    chest.castShadow = true;
    torso.add(chest);

    const skirt = new THREE.Mesh(
      this.geo("skirt", () => new THREE.CylinderGeometry(0.2, 0.33, 0.34, 16, 1, true)),
      clothDark,
    );
    skirt.position.y = 0.03;
    skirt.castShadow = true;
    torso.add(skirt);

    const scarf = new THREE.Mesh(this.geo("scarf", () => new THREE.TorusGeometry(0.16, 0.055, 8, 20)), trim);
    scarf.position.y = 0.44;
    scarf.rotation.x = Math.PI / 2;
    scarf.castShadow = true;
    torso.add(scarf);

    const tail = new THREE.Mesh(this.geo("scarf-tail", () => {
      const g = new THREE.BoxGeometry(0.1, 0.34, 0.05);
      g.translate(0, -0.17, 0);
      return g;
    }), trim);
    tail.position.set(-0.06, 0.44, -0.16);
    tail.rotation.z = -0.25;
    torso.add(tail);

    /* arms */
    const makeArm = (side: number) => {
      const arm = new THREE.Group();
      arm.position.set(side * 0.235, 0.4, side * 0.05);
      const upper = new THREE.Mesh(this.geo("limb-arm", () => new THREE.CapsuleGeometry(0.068, 0.19, 4, 10)), cloth);
      upper.position.y = -0.12;
      upper.castShadow = true;
      arm.add(upper);
      const hand = new THREE.Mesh(this.geo("hand", () => new THREE.SphereGeometry(0.082, 10, 8)), skin);
      hand.position.y = -0.27;
      hand.castShadow = true;
      arm.add(hand);
      torso.add(arm);
      return arm;
    };
    const armFront = makeArm(1);
    const armBack = makeArm(-1);

    /* head */
    const head = new THREE.Group();
    head.position.y = 0.56;
    torso.add(head);

    const skull = new THREE.Mesh(this.geo("skull", () => {
      const g = new THREE.SphereGeometry(0.235, 20, 16);
      g.scale(1, 1.02, 0.94);
      return g;
    }), skin);
    skull.position.y = 0.16;
    skull.castShadow = true;
    head.add(skull);

    const hood = new THREE.Mesh(this.geo("hood", () => {
      const g = new THREE.SphereGeometry(0.262, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.66);
      g.scale(1, 1.06, 1);
      return g;
    }), cloth);
    hood.position.y = 0.17;
    hood.rotation.x = -0.16;
    hood.castShadow = true;
    head.add(hood);

    const tip = new THREE.Mesh(this.geo("hood-tip", () => {
      const g = new THREE.ConeGeometry(0.085, 0.34, 10);
      g.translate(0, 0.17, 0);
      return g;
    }), cloth);
    tip.position.set(0, 0.3, -0.1);
    tip.rotation.x = 0.85;
    tip.castShadow = true;
    head.add(tip);

    const bobble = new THREE.Mesh(this.geo("bobble", () => new THREE.SphereGeometry(0.06, 10, 8)), trim);
    bobble.position.set(0, 0.53, -0.36);
    head.add(bobble);

    const eyes = new THREE.Group();
    eyes.position.set(0, 0.15, 0.19);
    head.add(eyes);
    for (const side of [-0.082, 0.082]) {
      const eye = new THREE.Mesh(this.geo("eye", () => {
        const g = new THREE.SphereGeometry(0.048, 12, 10);
        g.scale(1, 1, 0.65);
        return g;
      }), dark);
      eye.position.set(side, 0, 0);
      eyes.add(eye);
      const spark = new THREE.Mesh(
        this.geo("eye-spark", () => new THREE.SphereGeometry(0.017, 8, 6)),
        this.track(new THREE.MeshBasicMaterial({ color: 0xffffff })),
      );
      spark.position.set(side + 0.017, 0.017, 0.036);
      eyes.add(spark);
    }
    const blush = this.track(new THREE.MeshBasicMaterial({ color: 0xff9aa8, transparent: true, opacity: 0.35 }));
    for (const side of [-0.15, 0.15]) {
      const cheek = new THREE.Mesh(this.geo("cheek", () => new THREE.CircleGeometry(0.045, 12)), blush);
      cheek.position.set(side, 0.1, 0.185);
      head.add(cheek);
    }

    /* the lantern itself */
    const lantern = new THREE.Group();
    lantern.position.set(0, -0.3, 0.04);
    armFront.add(lantern);

    const handle = new THREE.Mesh(this.geo("lantern-handle", () => new THREE.TorusGeometry(0.055, 0.012, 6, 14)), dark);
    handle.position.y = -0.04;
    lantern.add(handle);

    const cage = new THREE.Mesh(
      this.geo("lantern-cage", () => new THREE.CylinderGeometry(0.082, 0.092, 0.17, 8, 1, true)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide })),
    );
    cage.position.y = -0.19;
    lantern.add(cage);

    const roof = new THREE.Mesh(this.geo("lantern-roof", () => new THREE.ConeGeometry(0.105, 0.09, 8)), dark);
    roof.position.y = -0.09;
    lantern.add(roof);

    const flameMaterial = this.track(new THREE.MeshStandardMaterial({
      color: this.theme.accent, emissive: this.theme.accent, emissiveIntensity: 3.2, roughness: 0.2,
    }));
    const flame = new THREE.Mesh(this.geo("lantern-flame", () => {
      const g = new THREE.SphereGeometry(0.058, 12, 10);
      g.scale(1, 1.25, 1);
      return g;
    }), flameMaterial);
    flame.position.y = -0.19;
    lantern.add(flame);

    const glow = new THREE.Mesh(
      this.geo("lantern-glow", () => new THREE.PlaneGeometry(1.4, 1.4)),
      this.track(new THREE.MeshBasicMaterial({
        map: this.glowTexture, color: this.theme.accent, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.65,
      })),
    );
    glow.position.set(0, -0.19, 0.1);
    lantern.add(glow);

    const light = new THREE.PointLight(this.theme.accent, 7, 11, 1.9);
    light.position.set(0, -0.19, 0.5);
    lantern.add(light);

    /* the rescue bubble */
    const bubble = new THREE.Mesh(
      this.geo("bubble", () => new THREE.SphereGeometry(0.78, 24, 18)),
      this.track(new THREE.MeshPhysicalMaterial({
        color: 0xbfe8ff, roughness: 0.05, metalness: 0, transmission: 0.85,
        transparent: true, opacity: 0.4, thickness: 0.2,
        iridescence: 1, iridescenceIOR: 1.6, side: THREE.DoubleSide,
      })),
    );
    bubble.position.y = 0.72;
    bubble.visible = false;
    root.add(bubble);

    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.renderOrder = 2;
    this.scene.add(shadow);

    this.scene.add(root);
    return {
      root, body, torso, head, hips, armFront, armBack, legFront, legBack,
      lantern, light, glow, eyes, bubble, shadow,
      motion: player.motion, lean: 0, cycle: 0, bob: 0,
    };
  }

  /** Ground height under a point, for contact shadows and dust. */
  private groundBelow(x: number, y: number) {
    const { grid } = this.level;
    const tx = Math.floor(x);
    for (let ty = Math.floor(y + 0.02); ty >= 0; ty -= 1) {
      if (isFloor(tileAt(grid, tx, ty))) return ty + 1;
    }
    return Number.NEGATIVE_INFINITY;
  }

  private poseRig(rig: Rig, player: RenderPlayer, time: number, dt: number) {
    const motion = player.motion;
    const grounded = motion === "idle" || motion === "walk" || motion === "run" || motion === "skid" || motion === "duck";
    const running = motion === "run";

    // The walk cycle is driven by distance travelled, so feet never skate
    // and every client agrees on the pose from position alone.
    const stride = running ? 3.0 : 3.6;
    if (grounded && (motion === "walk" || motion === "run")) rig.cycle = player.x * stride;
    const swing = Math.sin(rig.cycle);
    const swing2 = Math.sin(rig.cycle * 2);

    let leanTarget = 0;
    let armFront = 0;
    let armBack = 0;
    let legFront = 0;
    let legBack = 0;
    let bodyY = 0;
    let torsoTilt = 0;
    let headTilt = 0;
    let crouch = 1;

    switch (motion) {
      case "run":
        leanTarget = 0.3 * player.facing;
        armFront = -swing * 1.15 - 0.25;
        armBack = swing * 1.15 - 0.25;
        legFront = swing * 0.95;
        legBack = -swing * 0.95;
        bodyY = Math.abs(swing2) * 0.075 - 0.02;
        torsoTilt = 0.12;
        headTilt = -0.16;
        break;
      case "walk":
        leanTarget = 0.12 * player.facing;
        armFront = -swing * 0.62;
        armBack = swing * 0.62;
        legFront = swing * 0.62;
        legBack = -swing * 0.62;
        bodyY = Math.abs(swing2) * 0.04;
        torsoTilt = 0.04;
        break;
      case "skid":
        leanTarget = -0.42 * player.facing;
        armFront = -1.5;
        armBack = 0.9;
        legFront = -0.55;
        legBack = 0.5;
        torsoTilt = -0.2;
        headTilt = 0.18;
        break;
      case "jump":
        leanTarget = 0.16 * player.facing;
        armFront = -2.1;
        armBack = -1.5;
        legFront = -0.5;
        legBack = 0.7;
        torsoTilt = -0.12;
        bodyY = 0.03;
        break;
      case "fall":
        leanTarget = 0.1 * player.facing;
        armFront = -2.5;
        armBack = -2.1;
        legFront = 0.55;
        legBack = -0.35;
        torsoTilt = 0.16;
        headTilt = -0.12;
        break;
      case "wallslide":
        leanTarget = -0.3 * player.facing;
        armFront = -2.6;
        armBack = -0.4;
        legFront = 0.35;
        legBack = -0.6;
        torsoTilt = 0.1;
        break;
      case "duck":
        crouch = 0.62;
        armFront = -0.5;
        armBack = -0.5;
        legFront = 0.9;
        legBack = 0.9;
        torsoTilt = 0.3;
        headTilt = -0.2;
        break;
      case "pound":
        leanTarget = 0;
        crouch = 0.8;
        armFront = -2.9;
        armBack = -2.9;
        legFront = 1.2;
        legBack = 1.2;
        torsoTilt = 0.5;
        break;
      default: {
        // idle: breathing, a little lantern sway, the odd blink
        const breathe = Math.sin(time * 1.9);
        armFront = -0.16 + breathe * 0.07;
        armBack = 0.1 - breathe * 0.07;
        bodyY = breathe * 0.018;
        torsoTilt = breathe * 0.03;
        headTilt = Math.sin(time * 0.8) * 0.06;
        break;
      }
    }

    const rate = 16;
    rig.lean = damp(rig.lean, leanTarget, rate, dt);
    rig.bob = damp(rig.bob, bodyY, rate * 1.4, dt);
    rig.armFront.rotation.x = damp(rig.armFront.rotation.x, armFront, rate, dt);
    rig.armBack.rotation.x = damp(rig.armBack.rotation.x, armBack, rate, dt);
    rig.legFront.rotation.x = damp(rig.legFront.rotation.x, legFront, rate, dt);
    rig.legBack.rotation.x = damp(rig.legBack.rotation.x, legBack, rate, dt);
    rig.torso.rotation.x = damp(rig.torso.rotation.x, torsoTilt, rate, dt);
    rig.head.rotation.x = damp(rig.head.rotation.x, headTilt, rate, dt);
    rig.hips.scale.y = damp(rig.hips.scale.y, crouch, rate, dt);
    rig.torso.position.y = damp(rig.torso.position.y, 0.46 * crouch, rate, dt);

    rig.body.rotation.z = -rig.lean;
    rig.body.position.y = rig.bob;

    // Squash/stretch about the feet, plus the facing turn.
    const squash = player.squash;
    rig.root.scale.set(2 - squash, squash, 2 - squash);
    rig.root.rotation.y = damp(rig.root.rotation.y, player.facing === 1 ? 0.5 : -0.5, 12, dt);

    // Blink on a slow irregular beat.
    const blink = Math.sin(time * 1.7) * Math.sin(time * 0.41 + 1.3);
    rig.eyes.scale.y = blink > 0.985 ? 0.12 : 1;

    // Lantern swings against the body's motion, and its light breathes.
    const sway = Math.sin(time * 3.1 + player.x * 0.6) * (running ? 0.34 : 0.13);
    rig.lantern.rotation.z = damp(rig.lantern.rotation.z, -rig.armFront.rotation.x * 0.35 + sway, 10, dt);
    const flicker = 0.86 + Math.sin(time * 11.3) * 0.06 + Math.sin(time * 4.1) * 0.08;
    rig.light.intensity = 7 * flicker;
    rig.glow.scale.setScalar(0.9 + flicker * 0.2);
  }

  private syncPlayers(snapshot: RenderSnapshot) {
    const seen = new Set<string>();
    const dt = this.frameDt;
    for (const player of snapshot.players) {
      seen.add(player.id);
      let rig = this.playerRigs.get(player.id);
      if (!rig) {
        rig = this.makeRig(player);
        this.playerRigs.set(player.id, rig);
        rig.root.position.set(player.x, player.y, ENTITY_Z);
      }

      if (player.local) rig.root.position.set(player.x, player.y, ENTITY_Z);
      else rig.root.position.lerp(new THREE.Vector3(player.x, player.y, ENTITY_Z), 0.35);

      const wasAirborne = rig.motion === "jump" || rig.motion === "fall" || rig.motion === "pound";
      const nowGrounded = player.motion === "idle" || player.motion === "walk"
        || player.motion === "run" || player.motion === "skid" || player.motion === "duck";
      if (dt > 0) {
        if (wasAirborne && nowGrounded) {
          this.fx.landingDust(player.x, player.y, rig.motion === "pound" ? 1.5 : 0.7, this.theme.dust);
        }
        if (!wasAirborne && player.motion === "jump") {
          this.fx.emit({
            x: player.x, y: player.y + 0.05, count: 6, color: this.theme.dust, color2: 0xffffff,
            angle: Math.PI / 2, spread: Math.PI * 1.4, speed: 1.6, size: 0.22, ttl: 0.32, gravity: -2, drag: 5,
          });
        }
        if (player.motion === "run" && Math.sin(player.x * 3.0) > 0.86) {
          this.fx.runDust(player.x, player.y, player.facing, this.theme.dust);
        }
        if (player.motion === "skid") {
          this.fx.spark(player.x - player.facing * 0.3, player.y + 0.05, player.facing > 0 ? Math.PI * 0.85 : Math.PI * 0.15, this.theme.accent, 2);
        }
        if (player.motion === "wallslide") {
          this.fx.spark(player.x + player.facing * 0.34, player.y + 0.6, Math.PI * 0.5 - player.facing * 0.5, this.theme.rim, 1);
        }
      }
      rig.motion = player.motion;

      this.poseRig(rig, player, snapshot.time, dt);

      rig.bubble.visible = player.bubbled;
      rig.root.visible = true;
      if (player.bubbled) {
        rig.bubble.scale.setScalar(1 + Math.sin(snapshot.time * 3 + player.seat) * 0.05);
        rig.body.position.y = Math.sin(snapshot.time * 2.2 + player.seat) * 0.06 + 0.15;
      }

      // Contact shadow: a soft ellipse pressed against the ledge face.
      const ground = this.groundBelow(player.x, player.y);
      const height = player.y - ground;
      if (Number.isFinite(ground) && height < 6 && !player.bubbled) {
        const fade = Math.max(0, 1 - height / 5);
        rig.shadow.visible = true;
        rig.shadow.position.set(player.x, ground + 0.1, FRONT_Z + 0.03);
        const spread = 0.85 + height * 0.12;
        rig.shadow.scale.set(spread, spread * 0.55, 1);
        (rig.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5;
        rig.shadow.renderOrder = 2;
        rig.shadow.visible = fade > 0.02;
        rig.shadow.scale.multiplyScalar(0.6 + fade * 0.6);
      } else {
        rig.shadow.visible = false;
      }
    }

    for (const [id, rig] of this.playerRigs) {
      if (seen.has(id)) continue;
      this.scene.remove(rig.root);
      this.scene.remove(rig.shadow);
      this.playerRigs.delete(id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Pickups                                                           */
  /* ---------------------------------------------------------------- */

  private makeCoin(): PickupNode {
    const root = new THREE.Group();
    const spin = new THREE.Group();
    root.add(spin);

    const gold = this.track(new THREE.MeshStandardMaterial({
      color: 0xffcf5c, roughness: 0.22, metalness: 0.95,
      emissive: 0xff9c2a, emissiveIntensity: 0.85,
    }));
    const goldDeep = this.track(new THREE.MeshStandardMaterial({
      color: 0xffe9a8, roughness: 0.3, metalness: 0.9,
      emissive: 0xffb43a, emissiveIntensity: 1.15,
    }));
    this.pulsers.push({ material: gold, base: 0.85, rate: 3.4, depth: 0.35 });

    const disc = new THREE.Mesh(this.geo("coin-disc", () => {
      const g = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 26);
      g.rotateX(Math.PI / 2);
      return g;
    }), gold);
    disc.castShadow = true;
    spin.add(disc);

    const rim = new THREE.Mesh(this.geo("coin-rim", () => {
      const g = new THREE.TorusGeometry(0.29, 0.035, 8, 28);
      return g;
    }), goldDeep);
    spin.add(rim);

    const boss = new THREE.Mesh(this.geo("coin-boss", () => {
      const g = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 16);
      g.rotateX(Math.PI / 2);
      return g;
    }), goldDeep);
    spin.add(boss);

    const glow = new THREE.Mesh(
      this.geo("pickup-glow", () => new THREE.PlaneGeometry(1.5, 1.5)),
      this.track(new THREE.MeshBasicMaterial({
        map: this.glowTexture, color: 0xffb43a, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.55,
      })),
    );
    glow.position.z = -0.15;
    root.add(glow);

    const glint = new THREE.Mesh(
      this.geo("pickup-glint", () => new THREE.PlaneGeometry(0.9, 0.9)),
      this.track(new THREE.MeshBasicMaterial({
        map: this.glintMap, color: 0xfff3d0, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })),
    );
    glint.position.z = 0.25;
    root.add(glint);

    this.scene.add(root);
    return { root, spin, glow, glint, kind: "coin", taken: false, pop: 0 };
  }

  private makeGem(): PickupNode {
    const root = new THREE.Group();
    const spin = new THREE.Group();
    root.add(spin);

    const shell = this.track(new THREE.MeshPhysicalMaterial({
      color: 0x8ff0ff, roughness: 0.08, metalness: 0.1, transmission: 0.6,
      thickness: 0.5, transparent: true, opacity: 0.92,
      emissive: 0x1f9ad0, emissiveIntensity: 1.1, flatShading: true,
      iridescence: 0.8, iridescenceIOR: 1.9,
    }));
    const gem = new THREE.Mesh(this.geo("gem", () => {
      const g = new THREE.OctahedronGeometry(0.34, 0);
      g.scale(0.78, 1.12, 0.78);
      return g;
    }), shell);
    gem.castShadow = true;
    spin.add(gem);

    const coreMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0xdcffff }));
    const core = new THREE.Mesh(this.geo("gem-core", () => new THREE.OctahedronGeometry(0.15, 0)), coreMaterial);
    spin.add(core);

    const glow = new THREE.Mesh(
      this.geo("pickup-glow", () => new THREE.PlaneGeometry(1.5, 1.5)),
      this.track(new THREE.MeshBasicMaterial({
        map: this.glowTexture, color: 0x6fdcff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.7,
      })),
    );
    glow.position.z = -0.15;
    glow.scale.setScalar(1.25);
    root.add(glow);

    const light = new THREE.PointLight(0x6fdcff, 2.4, 4.5, 2);
    root.add(light);

    this.scene.add(root);
    return { root, spin, glow, light, kind: "gem", taken: false, pop: 0 };
  }

  private makeCheckpoint(): PickupNode {
    const root = new THREE.Group();
    const spin = new THREE.Group();
    root.add(spin);

    const iron = this.track(new THREE.MeshStandardMaterial({ color: 0x4c3f52, roughness: 0.5, metalness: 0.65 }));
    const post = new THREE.Mesh(this.geo("cp-post", () => {
      const g = new THREE.CylinderGeometry(0.055, 0.09, 1.5, 10);
      g.translate(0, -0.35, 0);
      return g;
    }), iron);
    post.castShadow = true;
    root.add(post);

    const arm = new THREE.Mesh(this.geo("cp-arm", () => {
      const g = new THREE.TorusGeometry(0.2, 0.028, 6, 16, Math.PI);
      return g;
    }), iron);
    arm.position.y = 0.4;
    arm.rotation.z = 0;
    root.add(arm);

    const cage = new THREE.Mesh(
      this.geo("cp-cage", () => new THREE.CylinderGeometry(0.16, 0.19, 0.34, 8, 1, true)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x4c3f52, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide })),
    );
    cage.position.y = 0.24;
    root.add(cage);

    const roof = new THREE.Mesh(this.geo("cp-roof", () => new THREE.ConeGeometry(0.23, 0.18, 8)), iron);
    roof.position.y = 0.5;
    root.add(roof);

    const flameMaterial = this.track(new THREE.MeshStandardMaterial({
      color: this.theme.accent, emissive: this.theme.accent, emissiveIntensity: 0.15, roughness: 0.2,
    }));
    const flame = new THREE.Mesh(this.geo("cp-flame", () => {
      const g = new THREE.SphereGeometry(0.11, 14, 12);
      g.scale(1, 1.3, 1);
      return g;
    }), flameMaterial);
    flame.position.y = 0.24;
    spin.add(flame);

    const glow = new THREE.Mesh(
      this.geo("cp-glow", () => new THREE.PlaneGeometry(2.4, 2.4)),
      this.track(new THREE.MeshBasicMaterial({
        map: this.glowTexture, color: this.theme.accent, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0,
      })),
    );
    glow.position.set(0, 0.24, -0.1);
    root.add(glow);

    const light = new THREE.PointLight(this.theme.accent, 0, 9, 1.8);
    light.position.y = 0.24;
    root.add(light);

    this.scene.add(root);
    return { root, spin, glow, light, kind: "lantern", taken: false, pop: 0 };
  }

  private syncPickups(snapshot: RenderSnapshot) {
    const dt = this.frameDt;
    for (const pickup of snapshot.pickups) {
      let node = this.pickupNodes.get(pickup.id);
      if (!node) {
        node = pickup.kind === "gem" ? this.makeGem()
          : pickup.kind === "lantern" ? this.makeCheckpoint()
          : this.makeCoin();
        node.root.position.set(pickup.x, pickup.y, ENTITY_Z);
        this.pickupNodes.set(pickup.id, node);
      }

      if (pickup.taken && !node.taken && dt > 0) {
        node.pop = 1;
        if (pickup.kind === "lantern") {
          this.fx.sparkle(pickup.x, pickup.y + 0.3, this.theme.accent, 26);
        } else {
          const tint = pickup.kind === "gem" ? 0x8ff0ff : 0xffcf5c;
          this.fx.sparkle(pickup.x, pickup.y, tint, pickup.kind === "gem" ? 30 : 16);
          this.fx.emit({
            x: pickup.x, y: pickup.y, count: 8, color: 0xffffff, angle: Math.PI / 2, spread: 1.4,
            speed: 4.5, size: 0.18, ttl: 0.45, gravity: 2, drag: 3, flash: 1,
          });
        }
      }
      node.taken = pickup.taken;

      const phase = snapshot.time + pickup.id * 1.37;
      if (pickup.kind === "lantern") {
        // Checkpoints never vanish; they light up.
        const lit = pickup.taken ? 1 : 0;
        const flicker = 0.85 + Math.sin(phase * 9) * 0.1 + Math.sin(phase * 3.3) * 0.05;
        const material = (node.spin.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = lerp(0.12, 3.4 * flicker, lit);
        (node.glow.material as THREE.MeshBasicMaterial).opacity = lit * 0.75 * flicker;
        if (node.light) node.light.intensity = lit * 9 * flicker;
        node.root.position.y = pickup.y;
        node.spin.position.y = Math.sin(phase * 2.4) * 0.015;
        if (lit > 0 && dt > 0 && Math.sin(phase * 6) > 0.93) {
          this.fx.emit({
            x: pickup.x, y: pickup.y + 0.35, count: 1, color: this.theme.accent,
            angle: Math.PI / 2, spread: 0.6, speed: 0.8, size: 0.12, ttl: 0.9, gravity: 0.6, drag: 1.2, flash: 1,
          });
        }
        continue;
      }

      if (node.pop > 0 && dt > 0) node.pop = Math.max(0, node.pop - dt * 3.2);
      const popping = node.pop > 0;
      node.root.visible = !pickup.taken || popping;
      if (!node.root.visible) continue;

      const rise = popping ? (1 - node.pop) * 0.9 : 0;
      const scale = popping ? Math.max(0.001, node.pop * 1.3) : 1;
      node.root.position.y = pickup.y + Math.sin(phase * 2.4) * 0.1 + rise;
      node.root.scale.setScalar(scale);
      node.spin.rotation.y = phase * (pickup.kind === "gem" ? 1.6 : 3.1);
      if (pickup.kind === "gem") {
        node.spin.rotation.z = Math.sin(phase * 0.9) * 0.25;
        if (node.light) node.light.intensity = 2.4 * (0.75 + Math.sin(phase * 3) * 0.25);
      }
      const face = Math.abs(Math.cos(node.spin.rotation.y));
      node.glow.scale.setScalar(0.85 + face * 0.35);
      if (node.glint) {
        // The flare only fires as the coin turns face-on to the camera.
        const flare = Math.max(0, face - 0.86) / 0.14;
        node.glint.scale.setScalar(0.4 + flare * 1.5);
        (node.glint.material as THREE.MeshBasicMaterial).opacity = flare * 0.85;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Enemies                                                           */
  /* ---------------------------------------------------------------- */

  private makeEnemy(kind: string): EnemyNode {
    const root = new THREE.Group();
    const eyeWhite = this.track(new THREE.MeshStandardMaterial({ color: 0xfdf6ef, roughness: 0.35 }));
    const pupil = this.track(new THREE.MeshBasicMaterial({ color: 0x24172c }));

    if (kind === "flyer") {
      const spin = new THREE.Group();
      root.add(spin);
      const bodyMaterial = this.track(new THREE.MeshStandardMaterial({
        color: 0xffd9a0, roughness: 0.5, emissive: 0xff8a3c, emissiveIntensity: 0.9,
      }));
      const body = new THREE.Mesh(this.geo("flyer-body", () => {
        const g = new THREE.CapsuleGeometry(0.16, 0.2, 6, 14);
        g.rotateZ(Math.PI / 2);
        return g;
      }), bodyMaterial);
      body.castShadow = true;
      spin.add(body);

      const wings: THREE.Object3D[] = [];
      const wingMaterial = this.track(new THREE.MeshStandardMaterial({
        color: 0xffe9c4, roughness: 0.4, transparent: true, opacity: 0.75,
        emissive: 0xffb265, emissiveIntensity: 0.5, side: THREE.DoubleSide,
      }));
      for (const side of [-1, 1]) {
        for (const row of [0, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set(side * 0.06, 0.08, row === 0 ? 0.04 : -0.06);
          const wing = new THREE.Mesh(this.geo("flyer-wing", () => {
            const g = new THREE.CircleGeometry(0.3, 14, 0, Math.PI);
            g.scale(1, 0.62, 1);
            g.rotateX(Math.PI / 2);
            g.translate(0, 0, 0);
            return g;
          }), wingMaterial);
          wing.position.x = side * 0.26;
          wing.scale.setScalar(row === 0 ? 1 : 0.72);
          pivot.add(wing);
          pivot.userData.side = side;
          pivot.userData.row = row;
          spin.add(pivot);
          wings.push(pivot);
        }
      }

      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(this.geo("flyer-eye", () => new THREE.SphereGeometry(0.045, 10, 8)), pupil);
        eye.position.set(0.13, 0.05, side * 0.08);
        spin.add(eye);
      }

      const glow = new THREE.Mesh(
        this.geo("enemy-glow", () => new THREE.PlaneGeometry(2, 2)),
        this.track(new THREE.MeshBasicMaterial({
          map: this.glowTexture, color: 0xffa85c, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.6,
        })),
      );
      glow.position.z = -0.2;
      root.add(glow);
      root.add(new THREE.PointLight(0xffa85c, 3, 5, 2));
      this.scene.add(root);
      return { root, spin, wings, glow, dead: false, fade: 0 };
    }

    if (kind === "spinner") {
      const spin = new THREE.Group();
      root.add(spin);
      const shellMaterial = this.track(new THREE.MeshStandardMaterial({
        color: 0x7a5a9c, roughness: 0.35, metalness: 0.7, flatShading: true,
        emissive: 0x6a2f8c, emissiveIntensity: 0.5,
      }));
      const shell = new THREE.Mesh(this.geo("spinner-shell", () => new THREE.IcosahedronGeometry(0.3, 0)), shellMaterial);
      shell.castShadow = true;
      spin.add(shell);

      const spikeMaterial = this.track(new THREE.MeshStandardMaterial({
        color: 0xffd7f0, roughness: 0.2, metalness: 0.9, emissive: 0xff4f9a, emissiveIntensity: 0.7,
      }));
      const spikeGeometry = this.geo("spinner-spike", () => {
        const g = new THREE.ConeGeometry(0.08, 0.28, 5);
        g.translate(0, 0.28, 0);
        return g;
      });
      for (let i = 0; i < 8; i += 1) {
        const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
        const a = (i / 8) * Math.PI * 2;
        spike.rotation.z = -a;
        spike.position.set(Math.sin(a) * 0.16, Math.cos(a) * 0.16, 0);
        spin.add(spike);
      }

      const core = new THREE.Mesh(
        this.geo("spinner-core", () => new THREE.SphereGeometry(0.12, 12, 10)),
        this.track(new THREE.MeshBasicMaterial({ color: 0xffb0e0 })),
      );
      spin.add(core);

      const ring = new THREE.Mesh(
        this.geo("spinner-ring", () => new THREE.TorusGeometry(0.46, 0.022, 6, 30)),
        this.track(new THREE.MeshStandardMaterial({
          color: 0xffffff, emissive: 0xff4f9a, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.6,
        })),
      );
      ring.rotation.x = 1.1;
      root.add(ring);

      const glow = new THREE.Mesh(
        this.geo("enemy-glow", () => new THREE.PlaneGeometry(2, 2)),
        this.track(new THREE.MeshBasicMaterial({
          map: this.glowTexture, color: 0xff5fa8, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5,
        })),
      );
      glow.position.z = -0.2;
      root.add(glow);
      this.scene.add(root);
      return { root, spin, glow, dead: false, fade: 0 };
    }

    /* walker: a grumpy little shell-backed critter */
    const spin = new THREE.Group();
    root.add(spin);
    const bodyMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0xf0a8b8, roughness: 0.55 }));
    const shellMaterial = this.track(new THREE.MeshStandardMaterial({
      color: 0xa8465f, roughness: 0.35, metalness: 0.25,
    }));

    const belly = new THREE.Mesh(this.geo("walker-body", () => {
      const g = new THREE.SphereGeometry(0.34, 20, 16);
      g.scale(1, 0.86, 0.92);
      return g;
    }), bodyMaterial);
    belly.position.y = 0.32;
    belly.castShadow = true;
    spin.add(belly);

    const shell = new THREE.Mesh(this.geo("walker-shell", () => {
      const g = new THREE.SphereGeometry(0.36, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
      g.scale(1.02, 0.95, 0.96);
      return g;
    }), shellMaterial);
    shell.position.y = 0.32;
    shell.rotation.x = -0.22;
    shell.castShadow = true;
    spin.add(shell);

    const ridge = new THREE.Mesh(
      this.geo("walker-ridge", () => new THREE.TorusGeometry(0.24, 0.035, 6, 20, Math.PI)),
      shellMaterial,
    );
    ridge.position.set(0, 0.5, -0.02);
    ridge.rotation.set(Math.PI / 2, 0, 0);
    spin.add(ridge);

    const eyes = new THREE.Group();
    eyes.position.set(0, 0.36, 0.24);
    spin.add(eyes);
    for (const side of [-0.12, 0.12]) {
      const white = new THREE.Mesh(this.geo("walker-eye", () => {
        const g = new THREE.SphereGeometry(0.095, 12, 10);
        g.scale(1, 1.05, 0.7);
        return g;
      }), eyeWhite);
      white.position.set(side, 0, 0);
      eyes.add(white);
      const dot = new THREE.Mesh(this.geo("walker-pupil", () => new THREE.SphereGeometry(0.045, 10, 8)), pupil);
      dot.position.set(side + 0.012, -0.008, 0.055);
      eyes.add(dot);
      const brow = new THREE.Mesh(this.geo("walker-brow", () => new THREE.BoxGeometry(0.14, 0.035, 0.04)), shellMaterial);
      brow.position.set(side, 0.1, 0.055);
      brow.rotation.z = side > 0 ? -0.42 : 0.42;
      eyes.add(brow);
    }

    const feet: THREE.Object3D[] = [];
    const footMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0x7a2f45, roughness: 0.6 }));
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(this.geo("walker-foot", () => {
        const g = new THREE.SphereGeometry(0.12, 10, 8);
        g.scale(1, 0.62, 1.25);
        return g;
      }), footMaterial);
      foot.position.set(side * 0.17, 0.07, 0.05);
      foot.castShadow = true;
      spin.add(foot);
      feet.push(foot);
    }

    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.renderOrder = 2;
    this.scene.add(shadow);

    this.scene.add(root);
    return { root, spin, feet, eyes, shadow, dead: false, fade: 0 };
  }

  private syncEnemies(snapshot: RenderSnapshot) {
    const dt = this.frameDt;
    for (const enemy of snapshot.enemies) {
      let node = this.enemyNodes.get(enemy.id);
      if (!node) {
        node = this.makeEnemy(enemy.kind);
        this.enemyNodes.set(enemy.id, node);
      }

      if (enemy.dead && !node.dead && dt > 0) {
        this.fx.pop(enemy.x, enemy.y + 0.35, enemy.kind === "walker" ? 0xf0a8b8 : 0xffc07a);
        this.fx.sparkle(enemy.x, enemy.y + 0.35, 0xffffff, 8);
      }
      if (dt > 0) node.fade = enemy.dead ? Math.min(1, node.fade + dt * 3.5) : 0;
      node.dead = enemy.dead;
      if (node.fade >= 1) {
        node.root.visible = false;
        if (node.shadow) node.shadow.visible = false;
        continue;
      }
      node.root.visible = true;

      const phase = snapshot.time;
      switch (enemy.kind) {
        case "flyer": {
          node.root.position.set(enemy.x, enemy.y + 0.4, ENTITY_Z);
          node.root.rotation.y = enemy.facing === 1 ? 0 : Math.PI;
          if (node.spin) node.spin.rotation.z = Math.sin(phase * 4) * 0.14;
          for (const wing of node.wings ?? []) {
            const side = wing.userData.side as number;
            const row = wing.userData.row as number;
            const flap = Math.sin(phase * 26 + row * 0.7) * 0.85;
            wing.rotation.z = side * (0.35 + flap * 0.6);
            wing.rotation.y = side * 0.2;
          }
          if (node.glow) node.glow.scale.setScalar(0.9 + Math.sin(phase * 5) * 0.12);
          if (dt > 0 && Math.sin(phase * 9) > 0.9) {
            this.fx.emit({
              x: enemy.x, y: enemy.y + 0.4, count: 1, color: 0xffa85c, angle: -Math.PI / 2,
              spread: 1.2, speed: 0.5, size: 0.14, ttl: 0.7, gravity: -0.5, drag: 2, flash: 1,
            });
          }
          break;
        }
        case "spinner": {
          node.root.position.set(enemy.x, enemy.y + 0.35, ENTITY_Z);
          if (node.spin) {
            node.spin.rotation.z = -phase * 3.4;
            node.spin.rotation.x = Math.sin(phase * 1.3) * 0.3;
          }
          node.root.children.forEach((child) => {
            if (child instanceof THREE.Mesh && child.geometry.type === "TorusGeometry") {
              child.rotation.y = phase * 2.1;
              child.rotation.x = 1.1 + Math.sin(phase * 0.9) * 0.4;
            }
          });
          break;
        }
        default: {
          node.root.position.set(enemy.x, enemy.y, ENTITY_Z);
          node.root.rotation.y = enemy.facing === 1 ? 0.45 : -0.45;
          const step = enemy.x * 5.5;
          if (node.spin) {
            node.spin.position.y = Math.abs(Math.sin(step)) * 0.06;
            node.spin.rotation.z = Math.sin(step) * 0.07;
            node.spin.scale.set(1 + Math.abs(Math.sin(step)) * 0.05, 1 - Math.abs(Math.sin(step)) * 0.06, 1);
          }
          (node.feet ?? []).forEach((foot, index) => {
            const p = step + index * Math.PI;
            foot.position.y = 0.07 + Math.max(0, Math.sin(p)) * 0.1;
            foot.position.z = 0.05 + Math.cos(p) * 0.08;
          });
          if (node.eyes) node.eyes.rotation.y = Math.sin(phase * 1.7) * 0.12;
          if (node.shadow) {
            const ground = this.groundBelow(enemy.x, enemy.y);
            const visible = Number.isFinite(ground) && !enemy.dead;
            node.shadow.visible = visible;
            if (visible) {
              node.shadow.position.set(enemy.x, ground + 0.09, FRONT_Z + 0.03);
              node.shadow.scale.set(0.8, 0.4, 1);
            }
          }
          break;
        }
      }

      if (node.fade > 0) {
        const squash = 1 - node.fade;
        node.root.scale.set(1 + node.fade * 0.5, Math.max(0.05, squash * 0.8), 1);
        node.root.position.y -= node.fade * 0.15;
      } else {
        node.root.scale.set(1, 1, 1);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                             */
  /* ---------------------------------------------------------------- */

  /** Draw one frame from a snapshot. Never mutates the snapshot. */
  update(snapshot: RenderSnapshot, aspect: number) {
    this.frameDt = Math.min(0.1, Math.max(0, snapshot.time - this.lastTime));
    this.lastTime = snapshot.time;

    const halfHeight = this.viewHeight / 2 / snapshot.camera.zoom / Math.cos(TILT);
    const halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    const cx = snapshot.camera.x;
    const cy = snapshot.camera.y;
    this.camera.position.set(cx, cy + Math.sin(TILT) * CAM_DISTANCE, Math.cos(TILT) * CAM_DISTANCE);
    this.camera.lookAt(cx, cy, 0);
    this.camera.updateProjectionMatrix();

    if (this.sky) {
      this.sky.position.set(cx, cy, 0).addScaledVector(
        this.camera.getWorldDirection(new THREE.Vector3()), 120,
      );
      this.sky.quaternion.copy(this.camera.quaternion);
      this.sky.scale.set(halfWidth * 2.3, halfHeight * 2.3, 1);
    }
    for (const layer of this.parallax) {
      const speed = layer.userData.speed as number;
      layer.position.x = cx * (1 - speed);
      layer.position.y = cy * (1 - speed) - 2;
    }
    for (const shaft of this.shafts) {
      shaft.position.x = (shaft.userData.baseX ??= shaft.position.x) + cx * 0.55;
      shaft.position.y = cy * 0.7 + 10;
    }
    if (this.keyLight) {
      this.keyLight.position.set(cx - 16, cy + 26, 34);
      this.keyLight.target.position.set(cx, cy, 0);
      this.keyLight.target.updateMatrixWorld();
    }

    for (const pulser of this.pulsers) {
      pulser.material.emissiveIntensity = pulser.base * (1 + Math.sin(snapshot.time * pulser.rate) * pulser.depth);
    }

    if (this.goalBeacon) {
      const { rings, orb, shaft, light } = this.goalBeacon;
      const pulse = 0.8 + Math.sin(snapshot.time * 2.2) * 0.2;
      rings.forEach((ring, index) => {
        ring.rotation.y = snapshot.time * (0.9 + index * 0.6);
        ring.rotation.z = Math.sin(snapshot.time * 0.7 + index) * 0.4;
      });
      orb.rotation.y = snapshot.time * 0.7;
      orb.position.y = 2.35 + Math.sin(snapshot.time * 1.6) * 0.08;
      (orb.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.2 + pulse;
      (shaft.material as THREE.MeshBasicMaterial).opacity = 0.2 + pulse * 0.12;
      light.intensity = 12 * pulse;
      if (this.frameDt > 0 && Math.sin(snapshot.time * 5) > 0.8) {
        this.fx.emit({
          x: this.level.goal.x + (Math.sin(snapshot.time * 3) * 0.5), y: this.level.goal.y + 1.6,
          count: 1, color: this.theme.accent, angle: Math.PI / 2, spread: 0.8, speed: 0.9,
          size: 0.16, ttl: 1.1, gravity: 0.4, drag: 1.1, flash: 1,
        });
      }
    }

    this.syncPlayers(snapshot);
    this.syncPickups(snapshot);
    this.syncEnemies(snapshot);

    this.motes.update(snapshot.time, cx, cy, halfWidth, halfHeight);
    this.fx.update(this.frameDt);
  }

  /**
   * Render through the post chain: bloom, grade, vignette, SMAA.
   *
   * Optional — `scene`/`camera` remain valid for a plain
   * `renderer.render(view.scene, view.camera)` — but the game is graded for
   * this path and looks noticeably flatter without it.
   */
  renderWith(renderer: THREE.WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.composer) this.buildComposer(renderer, size);
    if (!this.composerSize.equals(size)) {
      this.composerSize.copy(size);
      this.composer!.setSize(size.x, size.y);
    }
    this.composer!.render();
  }

  private buildComposer(renderer: THREE.WebGLRenderer, size: THREE.Vector2) {
    const composer = new EffectComposer(renderer);
    composer.setSize(size.x, size.y);
    this.composerSize.copy(size);
    composer.addPass(new RenderPass(this.scene, this.camera));

    const bloomSpec = this.theme.bloom;
    const bloom = new UnrealBloomPass(size.clone(), bloomSpec.strength, bloomSpec.radius, bloomSpec.threshold);
    composer.addPass(bloom);
    this.bloomPass = bloom;

    composer.addPass(new OutputPass());

    const grade = this.theme.grade;
    composer.addPass(new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uLift: { value: new THREE.Vector3(...grade.lift) },
        uGain: { value: new THREE.Vector3(...grade.gain) },
        uSat: { value: grade.sat },
        uContrast: { value: grade.contrast },
        uVignette: { value: grade.vignette },
        uAberration: { value: 0.0022 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec3 uLift;
        uniform vec3 uGain;
        uniform float uSat;
        uniform float uContrast;
        uniform float uVignette;
        uniform float uAberration;
        varying vec2 vUv;
        void main() {
          vec2 offset = ( vUv - 0.5 );
          float r2 = dot( offset, offset );
          vec3 color;
          color.r = texture2D( tDiffuse, vUv + offset * uAberration ).r;
          color.g = texture2D( tDiffuse, vUv ).g;
          color.b = texture2D( tDiffuse, vUv - offset * uAberration ).b;
          color = ( color - 0.5 ) * uContrast + 0.5;
          float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
          color = mix( vec3( luma ), color, uSat );
          color = color * uGain + uLift;
          float vig = smoothstep( 0.9, 0.08, r2 * uVignette );
          color *= mix( 0.6, 1.0, vig );
          gl_FragColor = vec4( clamp( color, 0.0, 1.0 ), 1.0 );
        }`,
    }));

    composer.addPass(new SMAAPass());
    this.composer = composer;
  }

  dispose() {
    this.composer?.dispose();
    this.bloomPass?.dispose();
    this.fx.dispose();
    this.motes.dispose();
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.geometryCache.clear();
    this.scene.clear();
    this.playerRigs.clear();
    this.pickupNodes.clear();
    this.enemyNodes.clear();
  }
}
