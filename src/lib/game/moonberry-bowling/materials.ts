/**
 * Moonberry Bowling — procedural materials.
 *
 * A strict CSP blocks every external asset load, so there is no texture
 * file anywhere in this module: every map below is painted at runtime onto
 * a `CanvasTexture` from deterministic noise. Same seed in, same pixels out
 * on every client — which matters here for the same reason it matters in
 * `physics.ts`: the scene has to look identical for everyone watching it.
 *
 * The lane's oil gradient is not an independent art decision: it reads
 * `laneFriction` from the physics model directly, so the point on the
 * boards where the finish turns from wet to matte is the exact point where
 * a thrown ball actually starts to hook. Camera and simulation agree.
 *
 * Everything allocated here (textures, materials, geometry) is pushed onto
 * one module-level registry and torn down together by
 * `disposeAlleyMaterials()`. Call it when the bowling route unmounts;
 * calling any of the `create*` functions again afterwards builds fresh
 * resources from scratch.
 */

import * as THREE from "three";
import { BOWLING, LANE_LENGTH, LANE_WIDTH, PIN_HEIGHT, PIN_RADIUS, laneFriction } from "./physics";

/* ------------------------------------------------------------------ */
/* Deterministic noise                                                 */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (v: number, n: number) => ((v % n) + n) % n;

/** Cheap deterministic hash, [0,1). No Math.random and no clock anywhere in
    this file — the only input that ever varies is a seed we chose. */
function hash(x: number, y: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Value noise that tiles every `period` units, so a texture that gets
    RepeatWrapping (the approach, the deck, the ball) has no seam. */
function valueNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const x0 = wrap(xi, period);
  const x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period);
  const y1 = wrap(yi + 1, period);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

function fbm(x: number, y: number, period: number, octaves: number, seed: number) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * freq, y * freq, period * freq, seed + i * 13) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ */
/* Disposal registry                                                   */
/* ------------------------------------------------------------------ */

type Disposable = { dispose: () => void };
let registry: Disposable[] = [];

function track<T extends Disposable>(item: T): T {
  registry.push(item);
  return item;
}

/** Cached so every seat's ball shares one set of textures instead of eight
    near-identical copies; cleared by disposeAlleyMaterials so the next
    call after a teardown rebuilds instead of reusing disposed GPU objects. */
let ballMaps: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } | null = null;

/* ------------------------------------------------------------------ */
/* Canvas plumbing                                                     */
/* ------------------------------------------------------------------ */

function canvas2d(width: number, height: number) {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("Moonberry Bowling could not open a 2D canvas context.");
  return { el, ctx };
}

/** Colour goes through sRGB — three.js expects albedo gamma-encoded and
    un-gammas it before lighting. */
function colorTexture(el: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = track(new THREE.CanvasTexture(el));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 16;
  return texture;
}

/** Normal and roughness maps are data, not colour. Tagging them sRGB would
    silently gamma-decode values that were never gamma-encoded in the first
    place — a bug that only shows up as "the lighting looks a bit off". */
function linearTexture(el: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = track(new THREE.CanvasTexture(el));
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 16;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Wood boards — shared by the lane, the approach and the deck          */
/* ------------------------------------------------------------------ */

const LANE_BOARDS = 39;
const BOARD_WIDTH = LANE_WIDTH / LANE_BOARDS;

type BoardMapOptions = {
  width: number;
  height: number;
  /** Boards across the full image width. */
  boardCount: number;
  seed: number;
  /** Colour of a board face at its lightest, and down in the seam/grain. */
  lit: number;
  shade: number;
  grain?: number;
  seamDepth?: number;
  /** 0 at the near edge of the image, 1 at the far edge. */
  roughnessAt: (travel: number) => number;
  /** Colour multiplier by the same travel coordinate — used once, for the
      oiled head of the lane reading a shade richer than the dry back end. */
  tintAt?: (travel: number) => number;
  /** Per-pixel speckle looks right on a one-off image (the lane) but is not
      periodic, so it seams the moment the same canvas is repeated with
      RepeatWrapping. Leave off for anything that tiles. */
  fleck?: boolean;
};

type BoardMaps = {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  /** So the lane can paint arrows and dots on top before the first frame. */
  colorCanvas: HTMLCanvasElement;
};

/**
 * One coherent height field turned into albedo + roughness + normal, in the
 * same spirit as a real plank floor: board seams are grooves (dark AND
 * physically indented), and the grain that tints a board is the same grain
 * that bumps its normal.
 */
function boardMaps(opts: BoardMapOptions): BoardMaps {
  const { width, height, boardCount, seed } = opts;
  const grainAmt = opts.grain ?? 0.5;
  const seamDepth = opts.seamDepth ?? 0.6;
  const fleck = opts.fleck ?? false;

  const { el: colorCanvas, ctx: colorCtx } = canvas2d(width, height);
  const { el: normalCanvas, ctx: normalCtx } = canvas2d(width, height);
  const { el: roughCanvas, ctx: roughCtx } = canvas2d(width, height);
  const colorImg = colorCtx.createImageData(width, height);
  const normalImg = normalCtx.createImageData(width, height);
  const roughImg = roughCtx.createImageData(width, height);

  const litR = (opts.lit >> 16) & 255, litG = (opts.lit >> 8) & 255, litB = opts.lit & 255;
  const shR = (opts.shade >> 16) & 255, shG = (opts.shade >> 8) & 255, shB = opts.shade & 255;

  // Height first, independent of colour, so every other map agrees with it.
  const heightField = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const v = y / height;
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const board = Math.floor(u * boardCount);
      const boardU = u * boardCount - board;
      const edge = Math.min(boardU, 1 - boardU);
      const seam = (1 - clamp01(edge / 0.05)) ** 2;

      // Each board gets its own noise phase so neighbours don't share grain.
      const boardSeed = seed + board * 17.3;
      const grain = fbm(boardU * 3 + boardSeed, v * 48, 8, 3, boardSeed);
      const speck = fleck ? (hash(x, y, seed + 9) - 0.5) * 0.06 : 0;

      heightField[y * width + x] = clamp01(0.5 + (grain - 0.5) * grainAmt + speck - seam * seamDepth);
    }
  }

  for (let y = 0; y < height; y += 1) {
    const travel = 1 - y / (height - 1); // v=0 (near edge) is the bottom row
    const rough = opts.roughnessAt(travel);
    const tint = opts.tintAt ? opts.tintAt(travel) : 1;
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const ci = i * 4;
      const h = heightField[i];

      colorImg.data[ci] = Math.min(255, lerp(shR, litR, h) * tint);
      colorImg.data[ci + 1] = Math.min(255, lerp(shG, litG, h) * tint);
      colorImg.data[ci + 2] = Math.min(255, lerp(shB, litB, h) * tint);
      colorImg.data[ci + 3] = 255;

      const jitter = fleck ? (hash(x, y, seed + 31) - 0.5) * 0.08 : 0;
      const rv = clamp01(rough + jitter) * 255;
      roughImg.data[ci] = 255; roughImg.data[ci + 1] = rv; roughImg.data[ci + 2] = 255; roughImg.data[ci + 3] = 255;

      // Wrapped neighbours, not clamped — so a tiled copy's normal map has
      // no lighting seam at the join even though the height field does.
      const xp = heightField[y * width + wrap(x + 1, width)];
      const xm = heightField[y * width + wrap(x - 1, width)];
      const yp = heightField[wrap(y + 1, height) * width + x];
      const ym = heightField[wrap(y - 1, height) * width + x];
      let nx = -(xp - xm) * 6;
      let ny = -(yp - ym) * 6;
      const len = Math.hypot(nx, ny, 1);
      nx /= len; ny /= len;
      normalImg.data[ci] = (nx * 0.5 + 0.5) * 255;
      normalImg.data[ci + 1] = (ny * 0.5 + 0.5) * 255;
      normalImg.data[ci + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normalImg.data[ci + 3] = 255;
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  normalCtx.putImageData(normalImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  return {
    map: colorTexture(colorCanvas),
    normalMap: linearTexture(normalCanvas),
    roughnessMap: linearTexture(roughCanvas),
    colorCanvas,
  };
}

/** Board width is fixed by LANE_WIDTH, so a tile that repeats `boardsPerTile`
    boards can be scaled onto any real-world span and still match the
    lane's own board width. */
function tileRepeat(worldWidth: number, worldDepth: number, boardsPerTile: number) {
  const tile = boardsPerTile * BOARD_WIDTH;
  return new THREE.Vector2(worldWidth / tile, worldDepth / tile);
}

/** Same smoothstep the ball actually skids through, expressed as 0 (oiled)
    to 1 (dry) instead of a friction coefficient — so the sheen and the
    hook are the same curve, not two tuned separately. */
function oilRamp(travel: number): number {
  const mu = laneFriction(travel * LANE_LENGTH);
  return (mu - BOWLING.OIL_FRICTION) / (BOWLING.DRY_FRICTION - BOWLING.OIL_FRICTION);
}

/* ------------------------------------------------------------------ */
/* Lane                                                                 */
/* ------------------------------------------------------------------ */

/** Range-finder arrows sit at boards 5/10/15/20/25/30/35, about 15ft out. */
const ARROW_BOARDS = [5, 10, 15, 20, 25, 30, 35];
const ARROW_DISTANCE = 4.572;
/** Lay-down dots just past the foul line. */
const DOT_BOARDS = [10, 15, 20, 25, 30];
const DOT_DISTANCE = 1.0;

function paintLaneMarkings(el: HTMLCanvasElement, width: number, height: number) {
  const ctx = el.getContext("2d");
  if (!ctx) return;
  const travelY = (travel: number) => (1 - travel) * height;

  const arrowY = travelY(ARROW_DISTANCE / LANE_LENGTH);
  const arrowSize = height * 0.02;
  ctx.fillStyle = "rgba(22, 19, 26, 0.55)";
  for (const board of ARROW_BOARDS) {
    const cx = ((board + 0.5) / LANE_BOARDS) * width;
    ctx.beginPath();
    ctx.moveTo(cx, arrowY - arrowSize);
    ctx.lineTo(cx - arrowSize * 0.55, arrowY + arrowSize * 0.7);
    ctx.lineTo(cx + arrowSize * 0.55, arrowY + arrowSize * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  const dotY = travelY(DOT_DISTANCE / LANE_LENGTH);
  const dotR = height * 0.007;
  ctx.fillStyle = "rgba(22, 19, 26, 0.6)";
  for (const board of DOT_BOARDS) {
    const cx = ((board + 0.5) / LANE_BOARDS) * width;
    ctx.beginPath();
    ctx.arc(cx, dotY, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function laneMaterial(): THREE.MeshStandardMaterial {
  const width = 512, height = 1024;
  const { map, normalMap, roughnessMap, colorCanvas } = boardMaps({
    width, height, boardCount: LANE_BOARDS, seed: 401,
    lit: 0xe6c592, shade: 0x9c7440,
    grain: 0.55, seamDepth: 0.65, fleck: true,
    // The wet-looking front and the matte back are the exact same ramp
    // that decides where the ball's path breaks — see oilRamp().
    roughnessAt: (travel) => lerp(0.16, 0.42, oilRamp(travel)),
    tintAt: (travel) => lerp(0.93, 1.0, oilRamp(travel)),
  });

  paintLaneMarkings(colorCanvas, width, height);
  map.needsUpdate = true;

  return track(new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, metalness: 0 }));
}

function approachMaterial(): THREE.MeshStandardMaterial {
  const boardsPerTile = 6;
  const size = 256;
  const { map, normalMap, roughnessMap } = boardMaps({
    width: size, height: size, boardCount: boardsPerTile, seed: 733,
    lit: 0xac8055, shade: 0x6e4c2c, // a shade darker than the lane — foot-worn approach wood
    grain: 0.5, seamDepth: 0.6,
    roughnessAt: () => 0.36,
  });
  const repeat = tileRepeat(LANE_WIDTH, ARROW_DISTANCE, boardsPerTile);
  map.repeat.copy(repeat); normalMap.repeat.copy(repeat); roughnessMap.repeat.copy(repeat);
  return track(new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, metalness: 0 }));
}

function deckMaterial(): THREE.MeshStandardMaterial {
  const boardsPerTile = 6;
  const size = 256;
  const { map, normalMap, roughnessMap } = boardMaps({
    width: size, height: size, boardCount: boardsPerTile, seed: 557,
    lit: 0xe9cd9c, shade: 0xa9825a, // unoiled maple, same family as the dry end of the lane
    grain: 0.5, seamDepth: 0.55,
    roughnessAt: () => 0.4,
  });
  const deckWidth = BOWLING.DECK_HALF_WIDTH * 2;
  const deckDepth = BOWLING.PIT_Z - LANE_LENGTH;
  const repeat = tileRepeat(deckWidth, deckDepth, boardsPerTile);
  map.repeat.copy(repeat); normalMap.repeat.copy(repeat); roughnessMap.repeat.copy(repeat);
  return track(new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, metalness: 0 }));
}

/* ------------------------------------------------------------------ */
/* Flat surfaces — gutter, back wall, masking unit                     */
/* ------------------------------------------------------------------ */

type FlatMapOptions = {
  size?: number;
  seed: number;
  color: number;
  shade: number;
  bump?: number;
};

/** A softer cousin of boardMaps for surfaces with no boards to speak of —
    just enough noise that a flat colour doesn't read as a flat colour. */
function flatNoiseMaps(opts: FlatMapOptions) {
  const size = opts.size ?? 128;
  const bump = opts.bump ?? 1.2;
  const period = 8;
  const { el: colorCanvas, ctx: colorCtx } = canvas2d(size, size);
  const { el: normalCanvas, ctx: normalCtx } = canvas2d(size, size);
  const colorImg = colorCtx.createImageData(size, size);
  const normalImg = normalCtx.createImageData(size, size);

  const cr = (opts.color >> 16) & 255, cg = (opts.color >> 8) & 255, cb = opts.color & 255;
  const sr = (opts.shade >> 16) & 255, sg = (opts.shade >> 8) & 255, sb = opts.shade & 255;

  const heightField = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      heightField[y * size + x] = fbm((x / size) * period, (y / size) * period, period, 3, opts.seed);
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x, ci = i * 4;
      const h = heightField[i];
      colorImg.data[ci] = lerp(sr, cr, h);
      colorImg.data[ci + 1] = lerp(sg, cg, h);
      colorImg.data[ci + 2] = lerp(sb, cb, h);
      colorImg.data[ci + 3] = 255;

      const xp = heightField[y * size + wrap(x + 1, size)];
      const xm = heightField[y * size + wrap(x - 1, size)];
      const yp = heightField[wrap(y + 1, size) * size + x];
      const ym = heightField[wrap(y - 1, size) * size + x];
      let nx = -(xp - xm) * bump;
      let ny = -(yp - ym) * bump;
      const len = Math.hypot(nx, ny, 1);
      nx /= len; ny /= len;
      normalImg.data[ci] = (nx * 0.5 + 0.5) * 255;
      normalImg.data[ci + 1] = (ny * 0.5 + 0.5) * 255;
      normalImg.data[ci + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normalImg.data[ci + 3] = 255;
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  normalCtx.putImageData(normalImg, 0, 0);
  return { map: colorTexture(colorCanvas), normalMap: linearTexture(normalCanvas) };
}

function gutterMaterial(): THREE.MeshStandardMaterial {
  const { map, normalMap } = flatNoiseMaps({ seed: 811, color: 0x232228, shade: 0x121114, bump: 2.0 });
  map.repeat.set(2, 8); normalMap.repeat.copy(map.repeat);
  return track(new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.22, metalness: 0.4 }));
}

function backWallMaterial(): THREE.MeshStandardMaterial {
  const { map, normalMap } = flatNoiseMaps({ seed: 902, color: 0x2c2f3a, shade: 0x1c1e26, bump: 0.8 });
  map.repeat.set(3, 2); normalMap.repeat.copy(map.repeat);
  return track(new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.85, metalness: 0 }));
}

function maskingUnitMaterial(): THREE.MeshStandardMaterial {
  const { map, normalMap } = flatNoiseMaps({ seed: 955, color: 0xfff7e8, shade: 0xe9dcc0, bump: 0.5 });
  return track(new THREE.MeshStandardMaterial({
    map, normalMap, roughness: 0.3, metalness: 0,
    emissive: 0xfff2cf, emissiveIntensity: 0.9, // backlit acrylic, not painted panel
  }));
}

function foulLineMaterial(): THREE.MeshStandardMaterial {
  // A painted stripe, not a physical surface — a texture would cost more
  // than it would ever show for a strip this thin.
  return track(new THREE.MeshStandardMaterial({ color: 0xcf3b3b, roughness: 0.4, metalness: 0.05 }));
}

/* ------------------------------------------------------------------ */
/* Pins                                                                 */
/* ------------------------------------------------------------------ */

/** [heightFraction, radiusFraction-of-belly] control points, base to apex.
    Evenly re-sampled by createPinGeometry so the lathe's v coordinate lands
    exactly on height fraction — which is what lets the stripe texture below
    line up with the actual neck and dome instead of an index-spaced guess. */
const PIN_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.000, 0.42], [0.035, 0.55], [0.090, 0.75], [0.170, 0.92],
  [0.300, 1.00], // belly — the regulation-widest point, PIN_RADIUS itself
  [0.400, 0.90], [0.480, 0.70], [0.560, 0.46],
  [0.620, 0.40], // neck — narrowest
  [0.660, 0.46], [0.700, 0.58], [0.760, 0.62], // head, widest just below the dome
  [0.840, 0.55], [0.920, 0.35], [1.000, 0.00], // dome tapering to the apex
];

function pinRadiusAt(hf: number): number {
  for (let i = 1; i < PIN_PROFILE.length; i += 1) {
    const [h0, r0] = PIN_PROFILE[i - 1];
    const [h1, r1] = PIN_PROFILE[i];
    if (hf <= h1 || i === PIN_PROFILE.length - 1) {
      const t = smooth(clamp01((hf - h0) / (h1 - h0)));
      return lerp(r0, r1, t) * PIN_RADIUS;
    }
  }
  return 0;
}

/** Lathe profile of a regulation ten-pin, height 0.381m, belly radius 0.0605m. */
export function createPinGeometry(): THREE.BufferGeometry {
  const heightSamples = 32;
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < heightSamples; i += 1) {
    const hf = i / (heightSamples - 1);
    points.push(new THREE.Vector2(pinRadiusAt(hf), hf * PIN_HEIGHT));
  }
  return track(new THREE.LatheGeometry(points, 28));
}

function pinColorMap(): THREE.CanvasTexture {
  const width = 32, height = 512;
  const { el, ctx } = canvas2d(width, height);
  // Slightly warm off-white — a stark #fff reads as chalk under tonemapping,
  // a hair of cream reads as glossy coated wood.
  ctx.fillStyle = "#f4efe2";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#c22a2a";
  const hfToY = (hf: number) => Math.round((1 - hf) * height);
  const band = (h0: number, h1: number) => ctx.fillRect(0, hfToY(h1), width, hfToY(h0) - hfToY(h1));
  band(0.64, 0.685); // two regulation neck stripes
  band(0.72, 0.76);
  band(0.93, 1.0);   // crown

  return colorTexture(el);
}

export function createPinMaterial(): THREE.MeshStandardMaterial {
  return track(new THREE.MeshStandardMaterial({ map: pinColorMap(), roughness: 0.15, metalness: 0 }));
}

/* ------------------------------------------------------------------ */
/* Ball                                                                 */
/* ------------------------------------------------------------------ */

/** Finger holes as [u, v, radius] in equirectangular UV, clustered off to
    one side the way a real drilled ball is, not spread evenly over the
    sphere: thumb, then two finger holes. */
const FINGER_HOLES: ReadonlyArray<readonly [number, number, number]> = [
  [0.47, 0.24, 0.052],
  [0.565, 0.225, 0.036],
  [0.565, 0.30, 0.036],
];

function buildBallMaps() {
  const width = 512, height = 256;
  const { el: colorCanvas, ctx: colorCtx } = canvas2d(width, height);
  const { el: normalCanvas, ctx: normalCtx } = canvas2d(width, height);
  const { el: roughCanvas, ctx: roughCtx } = canvas2d(width, height);
  const colorImg = colorCtx.createImageData(width, height);
  const normalImg = normalCtx.createImageData(width, height);
  const roughImg = roughCtx.createImageData(width, height);

  // Height combines the marble swirl with a crater subtracted at each
  // finger hole, so the normal map's dimples fall out of the same central
  // differences as everything else instead of a separate special case.
  const heightField = new Float32Array(width * height);
  const holeField = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const v = y / height;
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      // u-frequency is an exact multiple of the noise period so u=0 and
      // u=1 sample identically — required here, not optional, since the
      // ball wraps all the way around and any mismatch is a visible seam.
      const warp = fbm(u * 8, v * 4, 8, 3, 5) - 0.5;
      const stripe = Math.sin((v * 7 + warp * 2.2) * Math.PI * 2);
      const cloud = fbm(u * 8 + 0.37, v * 6, 8, 3, 17);
      let h = clamp01(0.55 + stripe * 0.1 + (cloud - 0.5) * 0.16);

      let hole = 0;
      for (const [hu, hv, hr] of FINGER_HOLES) {
        const dx = u - hu;
        const dy = (v - hv) * (height / width);
        const t = clamp01(1 - Math.hypot(dx, dy) / hr);
        hole = Math.max(hole, smooth(t));
      }
      h -= hole * 0.6;

      heightField[y * width + x] = clamp01(h);
      holeField[y * width + x] = hole;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x, ci = i * 4;
      const hole = holeField[i];

      // Neutral grey-white: MeshPhysicalMaterial.color tints this per seat,
      // so one texture serves every player instead of eight baked copies.
      const marble = clamp01(heightField[i] + hole * 0.6); // undo the crater for colour purposes
      let g = lerp(205, 245, marble);
      g = lerp(g, 55, hole * 0.7); // dark hollow inside the drilled holes
      colorImg.data[ci] = g; colorImg.data[ci + 1] = g; colorImg.data[ci + 2] = g; colorImg.data[ci + 3] = 255;

      const rough = lerp(lerp(0.07, 0.11, heightField[i]), 0.55, hole);
      roughImg.data[ci] = 255; roughImg.data[ci + 1] = rough * 255; roughImg.data[ci + 2] = 255; roughImg.data[ci + 3] = 255;

      const xp = heightField[y * width + wrap(x + 1, width)];
      const xm = heightField[y * width + wrap(x - 1, width)];
      const yp = heightField[wrap(y + 1, height) * width + x];
      const ym = heightField[wrap(y - 1, height) * width + x];
      let nx = -(xp - xm) * 4;
      let ny = -(yp - ym) * 4;
      const len = Math.hypot(nx, ny, 1);
      nx /= len; ny /= len;
      normalImg.data[ci] = (nx * 0.5 + 0.5) * 255;
      normalImg.data[ci + 1] = (ny * 0.5 + 0.5) * 255;
      normalImg.data[ci + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normalImg.data[ci + 3] = 255;
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  normalCtx.putImageData(normalImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  return {
    map: colorTexture(colorCanvas),
    normalMap: linearTexture(normalCanvas),
    roughnessMap: linearTexture(roughCanvas),
  };
}

export function createBallMaterial(seatColor: number): THREE.MeshPhysicalMaterial {
  if (!ballMaps) ballMaps = buildBallMaps();
  return track(new THREE.MeshPhysicalMaterial({
    map: ballMaps.map,
    normalMap: ballMaps.normalMap,
    roughnessMap: ballMaps.roughnessMap,
    color: seatColor,
    roughness: 1, // the map supplies the real value; this is just its multiplier
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  }));
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export type AlleyMaterials = {
  lane: THREE.MeshStandardMaterial;
  approach: THREE.MeshStandardMaterial;
  gutter: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  backWall: THREE.MeshStandardMaterial;
  maskingUnit: THREE.MeshStandardMaterial;
  foulLine: THREE.MeshStandardMaterial;
};

export function createAlleyMaterials(): AlleyMaterials {
  return {
    lane: laneMaterial(),
    approach: approachMaterial(),
    gutter: gutterMaterial(),
    deck: deckMaterial(),
    backWall: backWallMaterial(),
    maskingUnit: maskingUnitMaterial(),
    foulLine: foulLineMaterial(),
  };
}

export function disposeAlleyMaterials(): void {
  for (const item of registry) item.dispose();
  registry = [];
  ballMaps = null;
}
