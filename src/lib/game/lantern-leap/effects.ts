/**
 * Lantern Leap — procedural surfaces and particle juice.
 *
 * Every texture in the game is generated here at runtime from deterministic
 * noise: no image assets ship, every theme gets bespoke rock, moss and glow,
 * and a level looks identical on every client and in every screenshot.
 *
 * The particle system is one InstancedMesh of additive billboards with a
 * fixed pool — a whole screen of dust, sparks and sparkle costs one draw
 * call and zero allocations per frame.
 */

import * as THREE from "three";

/* ------------------------------------------------------------------ */
/* Deterministic noise                                                 */
/* ------------------------------------------------------------------ */

const fract = (v: number) => v - Math.floor(v);
const wrap = (v: number, n: number) => ((v % n) + n) % n;

const hash2 = (x: number, y: number, seed: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7 + seed * 57.31) * 43758.5453);

/** Tiling value noise: `period` cells before it repeats, so textures seam. */
function valueNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = wrap(xi, period);
  const x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period);
  const y1 = wrap(yi + 1, period);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* Surface textures                                                    */
/* ------------------------------------------------------------------ */

function dataTexture(data: Uint8Array, size: number, srgb: boolean) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export type SurfaceOptions = {
  size?: number;
  seed?: number;
  /** Lit colour of the surface, and the colour down in the crevices. */
  color: number;
  shade: number;
  /** Sprinkled second colour: moss on rock, mineral in a cave wall. */
  patch?: number;
  patchAmount?: number;
  /** Horizontal sedimentary banding, 0..1. */
  strata?: number;
  /** Density of the dark fracture lines. */
  crack?: number;
  grain?: number;
  roughLow?: number;
  roughHigh?: number;
  /** Height-to-normal gain. Higher reads as deeper relief. */
  bump?: number;
  /** Noise frequency in texture repeats. */
  detail?: number;
};

export type Surface = {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
};

/**
 * One coherent height field turned into albedo + roughness + normal, so the
 * three maps agree: crevices are dark, rough, and actually indented.
 */
export function surfaceTextures(options: SurfaceOptions): Surface {
  const size = options.size ?? 256;
  const seed = options.seed ?? 7;
  const period = 8;
  const detail = options.detail ?? 1;
  const strata = options.strata ?? 0;
  const crack = options.crack ?? 0.5;
  const grain = options.grain ?? 0.1;
  const roughLow = options.roughLow ?? 0.45;
  const roughHigh = options.roughHigh ?? 0.95;
  const bump = options.bump ?? 3.4;
  const patchAmount = options.patchAmount ?? 0;

  const height = new Float32Array(size * size);
  const patchField = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * period * detail;
      const v = (y / size) * period * detail;
      let h = fbm(u, v, period * detail, 5, seed);
      if (strata > 0) {
        const band = 0.5 + 0.5 * Math.sin(v * Math.PI * 1.5 + (fbm(u * 0.4, v * 0.4, period * detail, 2, seed + 91) - 0.5) * 5);
        h = mix(h, h * 0.55 + band * 0.45, strata);
      }
      // A fracture is where a second noise field crosses its midpoint.
      const ridge = Math.abs(fbm(u * 0.55, v * 0.55, period * detail, 3, seed + 41) * 2 - 1);
      if (ridge < 0.09) h -= (1 - ridge / 0.09) ** 2 * crack;
      h += (hash2(x, y, seed + 5) - 0.5) * grain;
      height[y * size + x] = clamp01(h);
      patchField[y * size + x] = fbm(u * 0.35, v * 0.35, Math.max(2, Math.round(period * detail * 0.35)), 3, seed + 131);
    }
  }

  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);

  const cr = (options.color >> 16) & 255;
  const cg = (options.color >> 8) & 255;
  const cb = options.color & 255;
  const sr = (options.shade >> 16) & 255;
  const sg = (options.shade >> 8) & 255;
  const sb = options.shade & 255;
  const patch = options.patch ?? options.color;
  const pr = (patch >> 16) & 255;
  const pg = (patch >> 8) & 255;
  const pb = patch & 255;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const h = height[i];
      const t = clamp01(h * 1.25 - 0.12);
      let r = mix(sr, cr, t);
      let g = mix(sg, cg, t);
      let b = mix(sb, cb, t);
      if (patchAmount > 0) {
        const p = clamp01((patchField[i] - 0.52) * 5) * patchAmount * (0.35 + t * 0.65);
        r = mix(r, pr, p);
        g = mix(g, pg, p);
        b = mix(b, pb, p);
      }
      albedo[i * 4] = r;
      albedo[i * 4 + 1] = g;
      albedo[i * 4 + 2] = b;
      albedo[i * 4 + 3] = 255;

      const rv = clamp01(mix(roughHigh, roughLow, t) + (hash2(x, y, seed + 17) - 0.5) * 0.12);
      rough[i * 4] = 255;
      rough[i * 4 + 1] = rv * 255;
      rough[i * 4 + 2] = 255;
      rough[i * 4 + 3] = 255;

      // Central differences on the wrapped height field.
      const hx = height[y * size + wrap(x + 1, size)] - height[y * size + wrap(x - 1, size)];
      const hy = height[wrap(y + 1, size) * size + x] - height[wrap(y - 1, size) * size + x];
      let nx = -hx * bump;
      let ny = -hy * bump;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      normal[i * 4] = (nx * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normal[i * 4 + 3] = 255;
    }
  }

  return {
    map: dataTexture(albedo, size, true),
    normalMap: dataTexture(normal, size, false),
    roughnessMap: dataTexture(rough, size, false),
  };
}

/**
 * Reproject a material's maps onto world XY instead of per-instance UVs, so
 * a run of tiles reads as one continuous rock face rather than a grid of
 * identical stamps. This is the single biggest thing separating "instanced
 * boxes" from "carved landmass".
 */
export function worldProjectMaps(material: THREE.Material, scale: number) {
  const key = scale.toFixed(4);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      {
        #ifdef USE_INSTANCING
          vec4 llWorld = modelMatrix * instanceMatrix * vec4( position, 1.0 );
        #else
          vec4 llWorld = modelMatrix * vec4( position, 1.0 );
        #endif
        vec2 llUv = llWorld.xy * ${key};
        #ifdef USE_MAP
          vMapUv = llUv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = llUv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = llUv;
        #endif
      }`,
    );
  };
  material.customProgramCacheKey = () => `lantern-worlduv-${key}`;
}

/* ------------------------------------------------------------------ */
/* Sprite textures                                                     */
/* ------------------------------------------------------------------ */

/** Soft round blob: particles, glows, contact shadows. */
export function radialTexture(hardness = 0.35, size = 64) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c) / c;
      let a = clamp01(1 - d);
      a = a ** (1 / Math.max(0.05, hardness)) * (1 - clamp01((d - 0.9) * 10));
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = clamp01(a) * 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** A four-point star flare — what a coin's specular glint wants to be. */
export function glintTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x - c) / c;
      const dy = Math.abs(y - c) / c;
      const d = Math.hypot(dx, dy);
      const core = clamp01(1 - d) ** 3;
      const spikes = clamp01(1 - dx * 7) * clamp01(1 - dy) ** 2 + clamp01(1 - dy * 7) * clamp01(1 - dx) ** 2;
      const a = clamp01(core + spikes * 0.75);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a * 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Drooping blades, drawn once and instanced along every ledge. Terrain stops
 * reading as a rectangle the moment its top edge is irregular.
 */
export function bladeTexture(width = 128, height = 96, seed = 3, droop = true) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Lantern Leap could not rasterise its foliage.");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  const blades = 22;
  for (let i = 0; i < blades; i += 1) {
    const t = (i + 0.5) / blades;
    const x = t * width + (hash2(i, 1, seed) - 0.5) * 6;
    const len = height * (0.3 + hash2(i, 2, seed) * 0.62);
    const half = 2.2 + hash2(i, 3, seed) * 3.4;
    const lean = (hash2(i, 4, seed) - 0.5) * 16;
    // Rows run top-down in canvas space; the texture is flipped by the
    // material's UVs when it is used as an upward tuft instead of a fringe.
    const y0 = droop ? 0 : height;
    const dir = droop ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(x - half, y0);
    ctx.quadraticCurveTo(x + lean * 0.4, y0 + dir * len * 0.6, x + lean, y0 + dir * len);
    ctx.quadraticCurveTo(x + lean * 0.4 + half * 0.5, y0 + dir * len * 0.6, x + half, y0);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

/** Soft-edged wedge for god rays. */
export function shaftTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const across = 1 - Math.abs(u * 2 - 1);
      const along = clamp01(1 - v);
      const a = clamp01(across ** 2.2) * (along ** 1.6) * clamp01(v * 6);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a * 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Particles                                                           */
/* ------------------------------------------------------------------ */

type Particle = {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rot: number; spin: number;
  age: number; ttl: number;
  size0: number; size1: number;
  r: number; g: number; b: number;
  gravity: number; drag: number;
  /** 0 = fade out linearly, 1 = flash bright then die. */
  flash: number;
};

export type EmitOptions = {
  x: number;
  y: number;
  z?: number;
  count?: number;
  color: number;
  /** Optional second colour; particles pick somewhere between the two. */
  color2?: number;
  /** Emission direction in radians (0 = +X) and the arc around it. */
  angle?: number;
  spread?: number;
  speed?: number;
  speedJitter?: number;
  size?: number;
  sizeEnd?: number;
  ttl?: number;
  ttlJitter?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  flash?: number;
  /** Spawn positions are jittered inside this radius. */
  radius?: number;
};

/**
 * One additive billboard pool. Fixed capacity, swap-removal, no allocation
 * in the hot path, one draw call for the entire screen's juice.
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly pool: Particle[] = [];
  private count = 0;
  private cursor = 0;
  private seed = 0x2f6e2b1;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.Texture;

  constructor(readonly capacity = 480) {
    this.texture = radialTexture(0.5, 64);
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    for (let i = 0; i < capacity; i += 1) {
      this.pool.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, spin: 0,
        age: 0, ttl: 1, size0: 0.2, size1: 0, r: 1, g: 1, b: 1, gravity: 0, drag: 1, flash: 0,
      });
    }
  }

  private rand() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private range(a: number, b: number) {
    return a + (b - a) * this.rand();
  }

  emit(options: EmitOptions) {
    const count = options.count ?? 8;
    const color = new THREE.Color(options.color);
    const color2 = options.color2 !== undefined ? new THREE.Color(options.color2) : color;
    const angle = options.angle ?? Math.PI / 2;
    const spread = options.spread ?? Math.PI;
    const speed = options.speed ?? 3;
    const jitter = options.speedJitter ?? 0.55;
    const ttl = options.ttl ?? 0.6;
    const ttlJitter = options.ttlJitter ?? 0.4;
    const radius = options.radius ?? 0.12;

    for (let i = 0; i < count; i += 1) {
      // Overwrite the oldest slot rather than dropping the newest: a burst
      // the player just caused always shows.
      const particle = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.capacity;
      const a = angle + (this.rand() - 0.5) * spread;
      const v = speed * (1 - jitter + this.rand() * jitter * 2);
      const t = this.rand();
      particle.alive = true;
      particle.x = options.x + (this.rand() - 0.5) * radius * 2;
      particle.y = options.y + (this.rand() - 0.5) * radius * 2;
      particle.z = (options.z ?? 0.4) + (this.rand() - 0.5) * 0.35;
      particle.vx = Math.cos(a) * v;
      particle.vy = Math.sin(a) * v;
      particle.vz = (this.rand() - 0.5) * 0.5;
      particle.rot = this.rand() * Math.PI * 2;
      particle.spin = (this.rand() - 0.5) * (options.spin ?? 5);
      particle.age = 0;
      particle.ttl = ttl * (1 - ttlJitter + this.rand() * ttlJitter * 2);
      particle.size0 = (options.size ?? 0.26) * this.range(0.7, 1.35);
      particle.size1 = options.sizeEnd ?? 0.01;
      particle.r = mix(color.r, color2.r, t);
      particle.g = mix(color.g, color2.g, t);
      particle.b = mix(color.b, color2.b, t);
      particle.gravity = options.gravity ?? -2;
      particle.drag = options.drag ?? 2.2;
      particle.flash = options.flash ?? 0;
    }
  }

  /* -- named bursts, so call sites read as intent -- */

  landingDust(x: number, y: number, power: number, color: number) {
    this.emit({
      x, y: y + 0.06, count: Math.round(6 + power * 10), color, color2: 0xffffff,
      angle: 0, spread: Math.PI * 2, speed: 2.2 + power * 2.4, size: 0.3 + power * 0.2,
      ttl: 0.42, gravity: -3.5, drag: 5.5, radius: 0.3, flash: 0,
    });
    this.emit({
      x, y: y + 0.1, count: 3, color: 0xffffff, angle: Math.PI / 2, spread: 0.9,
      speed: 1.4, size: 0.18, ttl: 0.3, gravity: -1, drag: 4,
    });
  }

  runDust(x: number, y: number, facing: number, color: number) {
    this.emit({
      x: x - facing * 0.24, y: y + 0.08, count: 2, color, color2: 0xffffff,
      angle: Math.PI - (facing > 0 ? 0 : Math.PI), spread: 0.9, speed: 1.5,
      size: 0.2, ttl: 0.34, gravity: -1.2, drag: 4.5, radius: 0.1,
    });
  }

  sparkle(x: number, y: number, color: number, count = 14) {
    this.emit({
      x, y, count, color, color2: 0xffffff, angle: Math.PI / 2, spread: Math.PI * 2,
      speed: 3.4, size: 0.22, ttl: 0.62, gravity: -1.4, drag: 3.4, radius: 0.18, flash: 1, spin: 9,
    });
  }

  pop(x: number, y: number, color: number) {
    this.emit({
      x, y, count: 16, color, color2: 0xfff2d0, angle: Math.PI / 2, spread: Math.PI * 2,
      speed: 4.2, size: 0.26, ttl: 0.5, gravity: -6, drag: 2.6, radius: 0.2, flash: 1,
    });
  }

  spark(x: number, y: number, angle: number, color: number, count = 4) {
    this.emit({
      x, y, count, color, color2: 0xffffff, angle, spread: 0.8, speed: 4.5,
      size: 0.13, ttl: 0.3, gravity: -9, drag: 1.4, radius: 0.06, flash: 1,
    });
  }

  update(dt: number) {
    if (dt > 0.1) dt = 0.1;
    let visible = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      const p = this.pool[i];
      if (!p.alive) continue;
      if (dt > 0) {
        p.age += dt;
        if (p.age >= p.ttl) {
          p.alive = false;
          continue;
        }
        const damp = 1 / (1 + p.drag * dt);
        p.vx *= damp;
        p.vy = (p.vy + p.gravity * dt) * damp;
        p.vz *= damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.rot += p.spin * dt;
      }
      const life = p.age / p.ttl;
      const size = mix(p.size0, p.size1, life * life);
      // Additive: dimming to black *is* the fade.
      const brightness = p.flash > 0
        ? mix(1.9, 0, life) * (1 - life * life * 0.25)
        : (1 - life) * (1 - life * 0.45);
      this.position.set(p.x, p.y, p.z);
      this.quat.setFromAxisAngle(this.axis, p.rot);
      this.scale.set(size, size, size);
      this.matrix.compose(this.position, this.quat, this.scale);
      this.mesh.setMatrixAt(visible, this.matrix);
      this.color.setRGB(p.r * brightness, p.g * brightness, p.b * brightness);
      this.mesh.setColorAt(visible, this.color);
      visible += 1;
    }
    this.mesh.count = visible;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Ambient motes                                                       */
/* ------------------------------------------------------------------ */

/**
 * Drifting dust in the air. Positions are a pure function of time, so they
 * animate even when the harness redraws a frozen frame, and they always fill
 * whatever the camera happens to be looking at.
 */
export class AmbientMotes {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.Texture;
  private readonly color = new THREE.Color();
  private readonly tint: THREE.Color;

  constructor(readonly count = 90, tint = 0xffe6b8) {
    this.texture = radialTexture(0.6, 32);
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 28;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.tint = new THREE.Color(tint);
  }

  update(time: number, camX: number, camY: number, halfWidth: number, halfHeight: number) {
    const w = halfWidth * 2.2;
    const h = halfHeight * 2.2;
    for (let i = 0; i < this.count; i += 1) {
      const seedX = hash2(i, 11, 3);
      const seedY = hash2(i, 23, 3);
      const seedZ = hash2(i, 37, 3);
      const drift = 0.25 + seedZ * 0.7;
      // Wrap through the view box so the field is endless without state.
      const x = camX - halfWidth * 1.1 + wrap(seedX * w + time * drift, w);
      const y = camY - halfHeight * 1.1 + wrap(seedY * h + time * drift * 0.32 + Math.sin(time * 0.6 + i) * 0.4, h);
      const z = -3 + seedZ * 7;
      const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * (1.1 + seedX * 2.2) + i * 2.4));
      const size = (0.045 + seedY * 0.075) * (1 + twinkle * 0.5);
      this.matrix.makeScale(size, size, size);
      this.matrix.setPosition(x, y, z);
      this.mesh.setMatrixAt(i, this.matrix);
      this.color.copy(this.tint).multiplyScalar(twinkle * 0.55);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }
}

export { fbm, hash2, clamp01, mix };
