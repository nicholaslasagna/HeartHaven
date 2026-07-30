import * as THREE from "three";
import {
  createAlleyMaterials,
  createBallMaterial,
  createPinGeometry,
  createPinMaterial,
  disposeAlleyMaterials,
  type AlleyMaterials,
} from "./materials";
import {
  BALL_RADIUS,
  BOWLING,
  HEAD_PIN_Z,
  LANE_LENGTH,
  LANE_WIDTH,
} from "./physics";
import { seatColor, type BowlingSnapshot, type CameraShot, type PinView } from "./types";

const VENUE_LANES = 7;
const LANE_SPACING = 1.48;
const RELEASE_Z = 0;
const APPROACH_DEPTH = 6.4;
const CAMERA_NEAR = 0.05;
const CAMERA_FAR = 80;

type AvatarRig = {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  head: THREE.Group;
  seat: number;
};

type Spark = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
};

function damp(current: number, target: number, lambda: number, dt: number) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function createCanvasSprite(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Moonberry Bowling could not create its display board.");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  return { canvas, context, texture, material, sprite };
}

function createAvatar(seat: number): AvatarRig {
  const color = seatColor(seat);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const shirtMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.02,
  });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf3bf96, roughness: 0.82 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x382b36, roughness: 0.78 });
  const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xfff7e8, roughness: 0.65 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.42, 5, 12), shirtMaterial);
  torso.position.y = 0.86;
  torso.castShadow = true;
  body.add(torso);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.09, 0.035), whiteMaterial);
  stripe.position.set(0, 0.89, -0.285);
  body.add(stripe);

  const head = new THREE.Group();
  head.position.y = 1.55;
  body.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.29, 20, 16), skinMaterial);
  face.castShadow = true;
  head.add(face);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.305, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
    darkMaterial,
  );
  hair.position.y = 0.08;
  hair.rotation.x = 0.08;
  head.add(hair);
  for (const x of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), darkMaterial);
    eye.position.set(x, 0.01, -0.27);
    head.add(eye);
  }

  const armGeometry = new THREE.CapsuleGeometry(0.075, 0.34, 4, 8);
  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  for (const [arm, x] of [[leftArm, -0.37], [rightArm, 0.37]] as const) {
    arm.position.set(x, 1.08, 0);
    const sleeve = new THREE.Mesh(armGeometry, shirtMaterial);
    sleeve.position.y = -0.16;
    sleeve.castShadow = true;
    arm.add(sleeve);
    body.add(arm);
  }

  const legGeometry = new THREE.CapsuleGeometry(0.085, 0.28, 4, 8);
  for (const x of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(legGeometry, darkMaterial);
    leg.position.set(x, 0.29, 0);
    leg.castShadow = true;
    body.add(leg);
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), whiteMaterial);
    shoe.scale.set(1, 0.55, 1.4);
    shoe.position.set(x, 0.08, -0.035);
    shoe.castShadow = true;
    body.add(shoe);
  }

  const badge = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.075),
    new THREE.MeshStandardMaterial({
      color: 0xffd56f,
      emissive: 0x6f4314,
      emissiveIntensity: 0.25,
      roughness: 0.35,
    }),
  );
  badge.position.set(0, 0.94, -0.31);
  badge.rotation.z = Math.PI / 4;
  body.add(badge);

  root.scale.setScalar(0.92);
  return { root, body, leftArm, rightArm, head, seat };
}

function createSeatBench() {
  const group = new THREE.Group();
  const cushionMaterial = new THREE.MeshStandardMaterial({ color: 0xb97189, roughness: 0.65 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x4d3545, roughness: 0.48, metalness: 0.18 });
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.28, 0.7), cushionMaterial);
  cushion.position.y = 0.63;
  cushion.castShadow = true;
  group.add(cushion);
  const back = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.8, 0.2), cushionMaterial);
  back.position.set(0, 1.02, 0.31);
  back.castShadow = true;
  group.add(back);
  for (const x of [-2.1, 2.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.65, 0.13), frameMaterial);
    leg.position.set(x, 0.31, 0);
    group.add(leg);
  }
  return group;
}

function createBallReturn() {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 1.5, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x5a4055, roughness: 0.34, metalness: 0.28 }),
  );
  shell.rotation.z = Math.PI / 2;
  shell.position.y = 0.48;
  shell.castShadow = true;
  group.add(shell);
  const opening = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: 0x17151d, roughness: 0.45 }),
  );
  opening.rotation.x = Math.PI / 2;
  opening.position.set(-0.72, 0.52, -0.29);
  group.add(opening);
  return group;
}

function createLane(
  materials: AlleyMaterials,
  x: number,
  active: boolean,
) {
  const group = new THREE.Group();
  group.position.x = x;

  const laneMaterial = active ? materials.lane : materials.lane.clone();
  if (!active) {
    laneMaterial.color.setHex(0x76644f);
    laneMaterial.emissive.setHex(0x100b0d);
  }
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(LANE_WIDTH, LANE_LENGTH), laneMaterial);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0, LANE_LENGTH / 2);
  lane.receiveShadow = true;
  group.add(lane);

  const gutterGeometry = new THREE.CylinderGeometry(0.13, 0.13, LANE_LENGTH, 18, 1, false, 0, Math.PI);
  for (const side of [-1, 1]) {
    const gutter = new THREE.Mesh(gutterGeometry, materials.gutter);
    gutter.rotation.set(Math.PI / 2, 0, side < 0 ? Math.PI : 0);
    gutter.position.set(side * (LANE_WIDTH / 2 + 0.13), -0.03, LANE_LENGTH / 2);
    gutter.receiveShadow = true;
    group.add(gutter);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.16, LANE_LENGTH + 0.5),
      new THREE.MeshStandardMaterial({ color: active ? 0x7a4e61 : 0x3e3440, roughness: 0.5 }),
    );
    cap.position.set(side * (LANE_WIDTH / 2 + 0.29), 0.04, LANE_LENGTH / 2);
    cap.castShadow = true;
    group.add(cap);
  }

  const foul = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH, 0.018, 0.055), materials.foulLine);
  foul.position.set(0, 0.018, 0);
  group.add(foul);
  return group;
}

export class MoonberryRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, CAMERA_NEAR, CAMERA_FAR);

  private readonly seatCount: number;
  private readonly materials: AlleyMaterials;
  private readonly ball: THREE.Mesh;
  private readonly pinRoots: THREE.Group[] = [];
  private readonly avatars: AvatarRig[] = [];
  private readonly aimLine: THREE.Line;
  private readonly aimMarker: THREE.Mesh;
  private readonly scoreboard = createCanvasSprite(1024, 256);
  private readonly maskingArt = createCanvasSprite(1024, 180);
  private readonly callout = createCanvasSprite(768, 220);
  private readonly lookAt = new THREE.Vector3(0, 0.45, 8);
  private readonly desiredLook = new THREE.Vector3(0, 0.45, 8);
  private readonly desiredCamera = new THREE.Vector3(2.8, 2.6, -5.3);
  private readonly scratchColor = new THREE.Color();
  private readonly pinLookup = new Map<number, PinView>();
  private readonly sparkles: Spark[] = [];
  private readonly venueLights = new THREE.Group();
  private readonly activeSpot: THREE.SpotLight;
  private readonly activeSpotTarget = new THREE.Object3D();
  private readonly deckGlow: THREE.PointLight;
  private scoreboardKey = "";
  private calloutKey = "";
  private calloutAge = 99;
  private elapsed = 0;
  private disposed = false;

  constructor(seatCount: number) {
    this.seatCount = Math.max(1, Math.min(8, Math.floor(seatCount)));
    this.materials = createAlleyMaterials();

    this.scene.background = new THREE.Color(0x242234);
    this.scene.fog = new THREE.Fog(0x242234, 23, 48);

    const hemisphere = new THREE.HemisphereLight(0xfff3dc, 0x2c2033, 2.15);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xffe6bd, 3.8);
    key.position.set(-5, 11, -2);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 24;
    key.shadow.camera.bottom = -5;
    this.scene.add(key);

    this.activeSpot = new THREE.SpotLight(seatColor(0), 24, 22, 0.34, 0.55, 1.5);
    this.activeSpot.position.set(0, 7.8, -1.5);
    this.activeSpot.target = this.activeSpotTarget;
    this.activeSpotTarget.position.set(0, 0, 7);
    this.scene.add(this.activeSpot, this.activeSpotTarget);
    this.deckGlow = new THREE.PointLight(0xf08ca7, 9, 8, 2);
    this.deckGlow.position.set(0, 1.5, HEAD_PIN_Z);
    this.scene.add(this.deckGlow);

    this.buildArchitecture();
    this.buildPins();
    this.paintMaskingArt();

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 28, 20),
      createBallMaterial(seatColor(0)),
    );
    this.ball.position.set(0, BALL_RADIUS + 0.025, RELEASE_Z);
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    const aimGeometry = new THREE.BufferGeometry();
    aimGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.025, 0.2, 0, 0.025, 7], 3));
    this.aimLine = new THREE.Line(
      aimGeometry,
      new THREE.LineBasicMaterial({ color: 0xffe19a, transparent: true, opacity: 0.92 }),
    );
    this.scene.add(this.aimLine);
    this.aimMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.135, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe19a, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
    );
    this.aimMarker.rotation.x = -Math.PI / 2;
    this.aimMarker.position.set(0, 0.03, 7);
    this.scene.add(this.aimMarker);

    this.scoreboard.sprite.position.set(0, 4.55, HEAD_PIN_Z + 2.55);
    this.scoreboard.sprite.scale.set(8.7, 2.18, 1);
    this.scene.add(this.scoreboard.sprite);
    this.maskingArt.sprite.position.set(0, 2.3, BOWLING.PIT_Z + 1.04);
    this.maskingArt.sprite.scale.set(10.15, 1.4, 1);
    this.scene.add(this.maskingArt.sprite);
    this.callout.sprite.position.set(0, 2.65, 11);
    this.callout.sprite.scale.set(5.6, 1.6, 1);
    this.callout.sprite.visible = false;
    this.scene.add(this.callout.sprite);

    this.camera.position.copy(this.desiredCamera);
    this.camera.lookAt(this.lookAt);
  }

  private paintMaskingArt() {
    const { context, canvas, texture } = this.maskingArt;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#8f6ed1");
    gradient.addColorStop(0.5, "#d8759b");
    gradient.addColorStop(1, "#e5aa4c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.globalAlpha = 0.2;
    context.fillStyle = "#fff8e9";
    for (let index = 0; index < 24; index += 1) {
      const x = 24 + ((index * 137) % 976);
      const y = 18 + ((index * 47) % 144);
      const radius = 3 + (index % 4);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;

    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#fff8e9";
    context.font = "950 58px system-ui, sans-serif";
    context.fillText("MOONBERRY LANES", canvas.width / 2, 72);
    context.font = "800 26px system-ui, sans-serif";
    context.fillStyle = "#fff1c7";
    context.fillText("BOWL BRIGHT  ·  CHEER LOUD", canvas.width / 2, 128);
    texture.needsUpdate = true;
  }

  private buildArchitecture() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 38),
      new THREE.MeshStandardMaterial({ color: 0x6e4e5e, roughness: 0.84 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.12, 7);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const approach = new THREE.Mesh(
      new THREE.PlaneGeometry(7.3, APPROACH_DEPTH),
      this.materials.approach,
    );
    approach.rotation.x = -Math.PI / 2;
    approach.position.set(0, -0.005, -APPROACH_DEPTH / 2);
    approach.receiveShadow = true;
    this.scene.add(approach);

    for (let index = 0; index < VENUE_LANES; index += 1) {
      const offset = index - Math.floor(VENUE_LANES / 2);
      this.scene.add(createLane(this.materials, offset * LANE_SPACING, offset === 0));
    }

    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(BOWLING.DECK_HALF_WIDTH * 2, BOWLING.PIT_Z - LANE_LENGTH),
      this.materials.deck,
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, 0.008, (LANE_LENGTH + BOWLING.PIT_Z) / 2);
    deck.receiveShadow = true;
    this.scene.add(deck);

    const pit = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 0.5, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x101017, roughness: 0.7 }),
    );
    pit.position.set(0, -0.22, BOWLING.PIT_Z + 0.55);
    this.scene.add(pit);

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(15, 6.6, 0.35), this.materials.backWall);
    backWall.position.set(0, 3, BOWLING.PIT_Z + 1.55);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const maskingUnit = new THREE.Mesh(
      new THREE.BoxGeometry(10.4, 1.5, 0.3),
      this.materials.maskingUnit,
    );
    maskingUnit.position.set(0, 2.3, BOWLING.PIT_Z + 1.24);
    maskingUnit.castShadow = true;
    this.scene.add(maskingUnit);

    const crown = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.095, 12, 48, Math.PI),
      new THREE.MeshStandardMaterial({
        color: 0xf5b2c4,
        emissive: 0xa52c59,
        emissiveIntensity: 1.1,
        roughness: 0.3,
      }),
    );
    crown.position.set(0, 4.1, BOWLING.PIT_Z + 1.32);
    crown.rotation.z = Math.PI;
    this.scene.add(crown);

    const returnMachine = createBallReturn();
    returnMachine.position.set(-3.45, 0, -3.15);
    returnMachine.rotation.y = -0.2;
    returnMachine.scale.setScalar(0.72);
    this.scene.add(returnMachine);

    const bench = createSeatBench();
    bench.position.set(2.25, 0, -4.3);
    bench.rotation.y = -0.12;
    this.scene.add(bench);

    for (let seat = 0; seat < this.seatCount; seat += 1) {
      const avatar = createAvatar(seat);
      avatar.root.position.set(
        2.1 + (seat % 4) * 0.62,
        0,
        -3.95 - Math.floor(seat / 4) * 0.72,
      );
      avatar.root.rotation.y = Math.PI;
      this.avatars.push(avatar);
      this.scene.add(avatar.root);
    }

    const ceilingRailMaterial = new THREE.MeshStandardMaterial({
      color: 0x2c2634,
      roughness: 0.38,
      metalness: 0.45,
    });
    for (const z of [-0.5, 7, 14, 20]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(14, 0.09, 0.11), ceilingRailMaterial);
      rail.position.set(0, 5.6, z);
      this.venueLights.add(rail);
      for (let x = -5.6; x <= 5.6; x += 2.8) {
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 10, 8),
          new THREE.MeshStandardMaterial({
            color: 0xffe4ad,
            emissive: 0xffb34f,
            emissiveIntensity: 3.4,
            roughness: 0.2,
          }),
        );
        bulb.position.set(x, 5.48, z);
        this.venueLights.add(bulb);
      }
    }
    this.scene.add(this.venueLights);
  }

  private buildPins() {
    const geometry = createPinGeometry();
    const material = createPinMaterial();
    for (let id = 0; id < 10; id += 1) {
      const root = new THREE.Group();
      const pin = new THREE.Mesh(geometry, material);
      pin.castShadow = true;
      pin.receiveShadow = true;
      root.add(pin);
      root.userData.pinId = id;
      this.pinRoots.push(root);
      this.scene.add(root);
    }
  }

  update(snapshot: BowlingSnapshot, aspect: number, dt: number) {
    if (this.disposed) return;
    this.elapsed += dt;
    this.camera.aspect = Math.max(0.5, aspect);
    this.camera.updateProjectionMatrix();

    this.updateBall(snapshot);
    this.updatePins(snapshot.lane.pins);
    this.updateAim(snapshot);
    this.updateAvatars(snapshot, dt);
    this.updateCamera(snapshot.lane.shot, snapshot, dt);
    this.updateScoreboard(snapshot);
    this.updateCallout(snapshot.callout, dt);
    this.updateSparkles(dt);

    this.scratchColor.set(seatColor(snapshot.lane.seat));
    this.activeSpot.color.lerp(this.scratchColor, 1 - Math.exp(-dt * 5));
    this.deckGlow.color.lerp(this.scratchColor, 1 - Math.exp(-dt * 3));
    this.deckGlow.intensity = 7.5 + Math.sin(this.elapsed * 2.2) * 1.2;
    this.venueLights.position.y = Math.sin(this.elapsed * 0.55) * 0.015;
  }

  private updateBall(snapshot: BowlingSnapshot) {
    const { ball } = snapshot.lane;
    const finite = Number.isFinite(ball.x) && Number.isFinite(ball.z);
    this.ball.visible = finite && ball.z < BOWLING.PIT_Z + 1.5;
    if (!this.ball.visible) return;
    const material = this.ball.material as THREE.MeshPhysicalMaterial;
    material.color.lerp(this.scratchColor.set(seatColor(snapshot.lane.seat)), 0.18);
    const guide = snapshot.lane.aimGuide;
    if (guide) {
      const bowlerX = guide.x * (LANE_WIDTH / 2 - BALL_RADIUS);
      this.ball.position.set(bowlerX + 0.28, 0.72, -1.23);
      this.ball.rotation.y = this.elapsed * 0.35;
      return;
    }
    this.ball.position.set(
      ball.x,
      ball.inGutter ? -0.015 : BALL_RADIUS + 0.025,
      ball.z,
    );
    this.ball.rotation.x = -ball.roll;
    this.ball.rotation.z = ball.x * 0.65;
  }

  private updatePins(pins: PinView[]) {
    this.pinLookup.clear();
    for (const pin of pins) this.pinLookup.set(pin.id, pin);
    for (let id = 0; id < this.pinRoots.length; id += 1) {
      const root = this.pinRoots[id];
      const pin = this.pinLookup.get(id);
      const visible = Boolean(
        pin
        && Number.isFinite(pin.x)
        && Number.isFinite(pin.z)
        && Math.abs(pin.x) < 8
        && pin.z < BOWLING.PIT_Z + 1.6,
      );
      root.visible = visible;
      if (!pin || !visible) continue;
      root.position.set(pin.x, 0.012, pin.z);
      const fall = Math.max(0, Math.min(1, pin.tilt)) * Math.PI * 0.5;
      root.rotation.set(
        Math.cos(pin.tiltAxis) * fall,
        pin.spin * 0.08,
        -Math.sin(pin.tiltAxis) * fall,
        "YXZ",
      );
    }
  }

  private updateAim(snapshot: BowlingSnapshot) {
    const guide = snapshot.lane.aimGuide;
    this.aimLine.visible = Boolean(guide);
    this.aimMarker.visible = Boolean(guide);
    if (!guide) return;
    const startX = guide.x * (LANE_WIDTH / 2 - BALL_RADIUS);
    const endX = startX + guide.spin * 0.42;
    const positions = this.aimLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    positions.setXYZ(0, startX, 0.028, 0.18);
    positions.setXYZ(1, endX, 0.028, 7.2);
    positions.needsUpdate = true;
    this.aimMarker.position.set(endX, 0.032, 7.2);
  }

  private updateAvatars(snapshot: BowlingSnapshot, dt: number) {
    const activeSeat = snapshot.lane.seat;
    for (const avatar of this.avatars) {
      const active = avatar.seat === activeSeat;
      const targetX = active ? snapshot.lane.aimGuide?.x ?? snapshot.lane.ball.x : 2.1 + (avatar.seat % 4) * 0.62;
      const targetZ = active ? -1.45 : -3.95 - Math.floor(avatar.seat / 4) * 0.72;
      avatar.root.position.x = damp(avatar.root.position.x, targetX, 6, dt);
      avatar.root.position.z = damp(avatar.root.position.z, targetZ, 6, dt);
      avatar.root.rotation.y = damp(avatar.root.rotation.y, active ? 0 : Math.PI, 7, dt);

      const bowling = active && (snapshot.lane.shot === "aim" || snapshot.lane.shot === "follow");
      const celebrating = active && snapshot.lane.shot === "result" && Boolean(snapshot.callout);
      const step = Math.sin(this.elapsed * 10);
      avatar.body.position.y = bowling ? Math.abs(step) * 0.025 : Math.sin(this.elapsed * 1.8 + avatar.seat) * 0.012;
      avatar.leftArm.rotation.x = bowling ? -0.55 + step * 0.18 : celebrating ? -1.75 : 0;
      avatar.rightArm.rotation.x = bowling ? 0.7 - step * 0.22 : celebrating ? -1.75 : 0;
      avatar.head.rotation.z = celebrating ? Math.sin(this.elapsed * 8) * 0.08 : 0;
    }
  }

  private updateCamera(shot: CameraShot, snapshot: BowlingSnapshot, dt: number) {
    const ball = snapshot.lane.ball;
    let fov = 42;
    switch (shot) {
      case "idle":
        this.desiredCamera.set(-2.35, 3.05, -6.8);
        this.desiredLook.set(0, 0.5, 7.2);
        fov = 44;
        break;
      case "aim":
        this.desiredCamera.set(-1.35, 2.05, -4.7);
        this.desiredLook.set(ball.x * 0.22, 0.32, 8);
        fov = 42;
        break;
      case "follow":
        this.desiredCamera.set(ball.x * 0.65 - 1.05, 1.25, Math.max(-1.7, ball.z - 3.6));
        this.desiredLook.set(ball.x, 0.2, Math.min(HEAD_PIN_Z, ball.z + 4.2));
        fov = 36;
        break;
      case "pins":
        this.desiredCamera.set(-2.3, 1.2, HEAD_PIN_Z - 3.2);
        this.desiredLook.set(0, 0.24, HEAD_PIN_Z + 0.25);
        fov = 33;
        break;
      case "result":
        this.desiredCamera.set(-3.8, 2.9, HEAD_PIN_Z - 4.8);
        this.desiredLook.set(0, 0.38, HEAD_PIN_Z + 0.45);
        fov = 40;
        break;
    }
    const narrow = THREE.MathUtils.clamp((1.18 - this.camera.aspect) / 0.5, 0, 1);
    this.desiredCamera.x *= THREE.MathUtils.lerp(1, 0.62, narrow);
    this.desiredCamera.z -= narrow * 1.25;
    this.desiredCamera.y += narrow * 0.25;
    const speed = shot === "follow" ? 6.8 : 4.2;
    this.camera.position.lerp(this.desiredCamera, 1 - Math.exp(-dt * speed));
    this.lookAt.lerp(this.desiredLook, 1 - Math.exp(-dt * speed));
    this.camera.fov = damp(this.camera.fov, fov + narrow * 5, 4.5, dt);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.lookAt);
  }

  private updateScoreboard(snapshot: BowlingSnapshot) {
    const key = JSON.stringify(snapshot.scores.map((score) => [score.name, score.total, score.active]));
    if (key === this.scoreboardKey) return;
    this.scoreboardKey = key;
    const { context, canvas, texture } = this.scoreboard;
    context.clearRect(0, 0, canvas.width, canvas.height);
    roundedRect(context, 8, 8, canvas.width - 16, canvas.height - 16, 34);
    context.fillStyle = "rgba(25, 24, 36, .96)";
    context.fill();
    context.strokeStyle = "#f2b5c4";
    context.lineWidth = 8;
    context.stroke();
    context.fillStyle = "#ffe8a9";
    context.font = "900 42px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("MOONBERRY BOWLING", canvas.width / 2, 65);

    const columns = Math.min(4, Math.max(1, snapshot.scores.length));
    const cellWidth = 920 / columns;
    snapshot.scores.slice(0, 8).forEach((score, index) => {
      const row = index >= 4 ? 1 : 0;
      const column = index % 4;
      const x = 48 + column * (920 / Math.min(4, Math.max(1, snapshot.scores.length)));
      const y = 126 + row * 70;
      context.fillStyle = score.active ? "#ffe29a" : "#fff8ed";
      context.font = score.active ? "900 30px system-ui, sans-serif" : "700 27px system-ui, sans-serif";
      context.textAlign = "left";
      context.fillText(`${score.name.slice(0, 12)}  ${score.total}`, x, y, cellWidth - 12);
    });
    texture.needsUpdate = true;
  }

  private updateCallout(text: string | null, dt: number) {
    this.calloutAge += dt;
    const key = text ?? "";
    if (key && key !== this.calloutKey) {
      this.calloutKey = key;
      this.calloutAge = 0;
      const { context, canvas, texture } = this.callout;
      context.clearRect(0, 0, canvas.width, canvas.height);
      roundedRect(context, 18, 18, canvas.width - 36, canvas.height - 36, 70);
      context.fillStyle = "rgba(255, 248, 232, .96)";
      context.fill();
      context.strokeStyle = key.includes("STRIKE") ? "#f0a83d" : "#d87e99";
      context.lineWidth = 12;
      context.stroke();
      context.fillStyle = "#3f2d39";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "950 88px system-ui, sans-serif";
      context.fillText(key, canvas.width / 2, canvas.height / 2 + 4);
      texture.needsUpdate = true;
      this.callout.sprite.visible = true;
      this.emitSparkles(key.includes("STRIKE") ? 34 : 20);
    }
    if (!text && this.calloutAge > 0.35) this.calloutKey = "";
    const opacity = this.calloutAge < 1.4 ? Math.min(1, this.calloutAge * 6) : Math.max(0, 1 - (this.calloutAge - 1.4) * 2);
    this.callout.material.opacity = opacity;
    const pulse = 1 + Math.sin(Math.min(1, this.calloutAge * 3) * Math.PI) * 0.09;
    this.callout.sprite.scale.set(5.6 * pulse, 1.6 * pulse, pulse);
    if (opacity <= 0.01) this.callout.sprite.visible = false;
  }

  private emitSparkles(count: number) {
    for (let index = 0; index < count; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? 0xffd86f : index % 3 === 1 ? 0xf28ca8 : 0xb49bea,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.05 + (index % 4) * 0.012), material);
      mesh.position.set((index % 7 - 3) * 0.22, 0.5 + (index % 5) * 0.12, HEAD_PIN_Z + ((index * 3) % 9 - 4) * 0.09);
      this.scene.add(mesh);
      this.sparkles.push({
        mesh,
        velocity: new THREE.Vector3(
          ((index * 37) % 17 - 8) * 0.045,
          1.1 + ((index * 19) % 8) * 0.11,
          ((index * 23) % 13 - 6) * 0.035,
        ),
        life: 0,
        maxLife: 0.85 + (index % 6) * 0.08,
      });
    }
  }

  private updateSparkles(dt: number) {
    for (let index = this.sparkles.length - 1; index >= 0; index -= 1) {
      const spark = this.sparkles[index];
      spark.life += dt;
      spark.velocity.y -= 1.75 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.rotation.x += dt * 4;
      spark.mesh.rotation.y += dt * 5;
      const material = spark.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, 1 - spark.life / spark.maxLife);
      if (spark.life < spark.maxLife) continue;
      this.scene.remove(spark.mesh);
      spark.mesh.geometry.dispose();
      material.dispose();
      this.sparkles.splice(index, 1);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const spark of this.sparkles) {
      spark.mesh.geometry.dispose();
      (spark.mesh.material as THREE.Material).dispose();
    }
    this.sparkles.length = 0;
    disposeObject(this.scene);
    disposeAlleyMaterials();
  }
}
