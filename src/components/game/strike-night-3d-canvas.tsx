"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { ChevronLeft, ChevronRight, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  computeBowlingState,
  selectBowlingKnockedPinIds,
  type BowlingRoll,
} from "@/lib/game/bowling-scoring";
import { cn } from "@/lib/utils";

type StrikeNight3DCanvasProps = {
  rolls: BowlingRoll[];
  mySeatIndex: number | null;
  seatCount: number;
  seatNames: string[];
  onRoll: (details: { aim: number; power: number }) => Promise<{ ok: boolean; reason?: string }>;
  rollLocked?: boolean;
};

type LaneVisual = {
  index: number;
  group: THREE.Group;
  ball: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  pins: THREE.Group[];
  visiblePins: Set<number>;
  character: THREE.Group;
};

type RollAnimation = {
  lane: LaneVisual;
  roll: BowlingRoll;
  knocked: number[];
  startedAt: number;
  duration: number;
  hitAt: boolean;
};

type SceneController = {
  setControls: (aim: number, power: number, spin: number, canAim: boolean) => void;
  setActiveSeat: (seat: number) => void;
  syncRolls: (rolls: BowlingRoll[]) => void;
  dispose: () => void;
};

const COLORS = ["#e47d91", "#9a7bd0", "#e0a53e", "#6fa25a", "#5d96b9", "#d883ad", "#cf845e", "#7b7ed1"];
const LANE_COUNT = 8;
const LANE_WIDTH = 3.8;
const LANE_GAP = 0.48;
const LANE_LENGTH = 25;
const PIN_Z = -19.5;
const BALL_Z = 9.8;
const PIN_LAYOUT = [
  [0, 0],
  [-0.34, -0.62], [0.34, -0.62],
  [-0.68, -1.24], [0, -1.24], [0.68, -1.24],
  [-1.02, -1.86], [-0.34, -1.86], [0.34, -1.86], [1.02, -1.86],
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function laneX(index: number) {
  return (index - (LANE_COUNT - 1) / 2) * (LANE_WIDTH + LANE_GAP);
}

function makeLabelSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 251, 240, .92)";
  ctx.roundRect(10, 18, 492, 92, 32);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = "#3e2a2f";
  ctx.font = "800 42px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 18), 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(2.8, 0.7, 1);
  return sprite;
}

function makeCharacter(color: string) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.56, 0.72, 5, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.64 }),
  );
  body.position.y = 1.08;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 18, 14),
    new THREE.MeshStandardMaterial({ color: "#f5c29c", roughness: 0.82 }),
  );
  head.position.y = 2.05;
  head.castShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.51, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.48),
    new THREE.MeshStandardMaterial({ color: "#50352f", roughness: 0.88 }),
  );
  hair.position.set(0, 2.23, -0.02);
  group.add(hair);

  const shoeMaterial = new THREE.MeshStandardMaterial({ color: "#6d4e61", roughness: 0.7 });
  for (const x of [-0.22, 0.22]) {
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), shoeMaterial);
    shoe.scale.set(1.15, 0.55, 1.55);
    shoe.position.set(x, 0.27, 0.08);
    shoe.castShadow = true;
    group.add(shoe);
  }

  const star = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.13, 0),
    new THREE.MeshStandardMaterial({ color: "#f6cc6b", emissive: "#8d5624", emissiveIntensity: 0.22 }),
  );
  star.position.set(0, 1.12, -0.58);
  group.add(star);
  return group;
}

function createPin() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: "#fff8eb", roughness: 0.38 });
  const red = new THREE.MeshStandardMaterial({ color: "#d96e83", roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.54, 5, 10), white);
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.035, 8, 18), red);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = 0.52;
  group.add(stripe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), white);
  head.position.y = 0.88;
  head.castShadow = true;
  group.add(head);
  return group;
}

function makeBall(color: string) {
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 20, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.19, metalness: 0.08 }),
  );
  ball.castShadow = true;
  return ball;
}

function createLane(index: number, seatName: string) {
  const group = new THREE.Group();
  group.position.x = laneX(index);

  const wood = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_WIDTH, 0.16, LANE_LENGTH),
    new THREE.MeshStandardMaterial({ color: "#d39a5d", roughness: 0.36 }),
  );
  wood.position.set(0, 0.12, -3.2);
  wood.receiveShadow = true;
  group.add(wood);

  const finish = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_WIDTH - 0.12, 0.018, 0.35),
    new THREE.MeshStandardMaterial({ color: "#fff1c8", roughness: 0.45 }),
  );
  finish.position.set(0, 0.22, -19.2);
  group.add(finish);

  const gutterMaterial = new THREE.MeshStandardMaterial({ color: "#7b5263", roughness: 0.5 });
  for (const side of [-1, 1]) {
    const gutter = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, LANE_LENGTH), gutterMaterial);
    gutter.position.set(side * (LANE_WIDTH / 2 + 0.2), -0.01, -3.2);
    gutter.receiveShadow = true;
    group.add(gutter);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.5, LANE_LENGTH),
      new THREE.MeshStandardMaterial({ color: "#9e6b48", roughness: 0.45 }),
    );
    rail.position.set(side * (LANE_WIDTH / 2 + 0.46), 0.28, -3.2);
    rail.castShadow = true;
    group.add(rail);
  }

  const pins: THREE.Group[] = [];
  PIN_LAYOUT.forEach(([x, z], id) => {
    const pin = createPin();
    pin.position.set(x, 0.22, PIN_Z + z);
    pin.userData.pinId = id;
    group.add(pin);
    pins.push(pin);
  });

  const ball = makeBall(COLORS[index]);
  ball.position.set(0, 0.52, BALL_Z);
  group.add(ball);

  const character = makeCharacter(COLORS[index]);
  character.position.set(0, 0, 12.2);
  group.add(character);
  const label = makeLabelSprite(seatName || `Lane ${index + 1}`, COLORS[index]);
  if (label) {
    label.position.set(0, 3.2, 12.1);
    group.add(label);
  }

  const activeGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE_WIDTH - 0.25, LANE_LENGTH - 0.5),
    new THREE.MeshBasicMaterial({ color: COLORS[index], transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  activeGlow.rotation.x = -Math.PI / 2;
  activeGlow.position.y = 0.22;
  activeGlow.position.z = -3.2;
  group.add(activeGlow);
  group.userData.activeGlow = activeGlow;

  return { index, group, ball, pins, visiblePins: new Set(PIN_LAYOUT.map((_, pinId) => pinId)), character } satisfies LaneVisual;
}

function buildScene(mount: HTMLDivElement, seatNames: string[], seatCount: number, onFeedback: (message: string) => void): SceneController {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f4ead8");
  scene.fog = new THREE.Fog("#f4ead8", 24, 70);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 8.5, 19);
  const target = new THREE.Vector3(0, 1.8, -7.5);
  camera.lookAt(target);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  mount.replaceChildren(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  scene.add(new THREE.HemisphereLight("#fff8ed", "#8b6272", 2.1));
  const key = new THREE.DirectionalLight("#fff3ca", 4.8);
  key.position.set(-8, 18, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const pink = new THREE.PointLight("#ef9bb0", 12, 23, 2);
  pink.position.set(0, 5, -13);
  scene.add(pink);
  const purple = new THREE.PointLight("#aa8ae2", 9, 18, 2);
  purple.position.set(12, 4, 3);
  scene.add(purple);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 55),
    new THREE.MeshStandardMaterial({ color: "#c99581", roughness: 0.82 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(38, 9, 0.45),
    new THREE.MeshStandardMaterial({ color: "#b97989", roughness: 0.7 }),
  );
  backWall.position.set(0, 4, -21.1);
  backWall.receiveShadow = true;
  scene.add(backWall);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(12, 1.9, 0.28),
    new THREE.MeshStandardMaterial({ color: "#f7d56f", emissive: "#815a28", emissiveIntensity: 0.25, roughness: 0.42 }),
  );
  sign.position.set(0, 6.5, -20.75);
  scene.add(sign);
  const signLabel = makeLabelSprite("STRIKE NIGHT", "#dc8094");
  if (signLabel) {
    signLabel.position.set(0, 6.52, -20.55);
    signLabel.scale.set(6.3, 1.2, 1);
    scene.add(signLabel);
  }

  const lanes = Array.from({ length: LANE_COUNT }, (_, index) => createLane(index, seatNames[index] ?? `Lane ${index + 1}`));
  lanes.forEach((lane) => scene.add(lane.group));

  let animation: RollAnimation | null = null;
  let pending: RollAnimation[] = [];
  let renderedRollCount = 0;
  let controls = { aim: 0, power: 0, spin: 0, canAim: false };
  let lastTime = performance.now();
  let raf = 0;
  let destroyed = false;

  function resize() {
    const width = Math.max(320, mount.clientWidth);
    const height = Math.max(300, mount.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function setActiveLane() {
    lanes.forEach((lane) => {
      const glow = lane.group.userData.activeGlow as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      const isActive = lane.index === Math.min(seatCount - 1, Math.max(0, Number(scene.userData.currentSeat ?? 0)));
      glow.material.opacity = isActive ? 0.12 : 0;
      lane.character.position.y = isActive ? Math.sin(performance.now() / 430) * 0.025 : 0;
    });
  }

  function applyRollToLane(roll: BowlingRoll, prefix: BowlingRoll[], animate: boolean) {
    const lane = lanes[roll.seat % LANE_COUNT];
    if (!lane) return;
    const before = computeBowlingState(prefix, Math.max(1, seatCount));
    if (before.currentSeat === roll.seat && before.standingPins === 10 && before.ballInFrame === 0) {
      lane.pins.forEach((pin) => {
        pin.visible = true;
        pin.rotation.set(0, 0, 0);
        pin.position.y = 0.22;
      });
      lane.visiblePins = new Set(PIN_LAYOUT.map((_, pinId) => pinId));
    }
    const standing = [...lane.visiblePins];
    const knocked = selectBowlingKnockedPinIds(standing, roll);
    if (animate) {
      pending.push({ lane, roll, knocked, startedAt: 0, duration: 1150, hitAt: false });
    } else {
      knocked.forEach((id) => {
        const pin = lane.pins[id];
        if (!pin) return;
        pin.visible = false;
        lane.visiblePins.delete(id);
      });
    }
  }

  function syncRolls(nextRolls: BowlingRoll[]) {
    if (nextRolls.length < renderedRollCount) {
      lanes.forEach((lane) => {
        lane.visiblePins = new Set(PIN_LAYOUT.map((_, pinId) => pinId));
        lane.pins.forEach((pin) => {
          pin.visible = true;
          pin.rotation.set(0, 0, 0);
          pin.position.y = 0.22;
        });
      });
      renderedRollCount = 0;
      pending = [];
      animation = null;
    }
    if (renderedRollCount === 0 && nextRolls.length > 0) {
      nextRolls.forEach((roll, index) => applyRollToLane(roll, nextRolls.slice(0, index), false));
      renderedRollCount = nextRolls.length;
      return;
    }
    if (nextRolls.length > renderedRollCount) {
      for (let index = renderedRollCount; index < nextRolls.length; index += 1) {
        applyRollToLane(nextRolls[index], nextRolls.slice(0, index), true);
      }
      renderedRollCount = nextRolls.length;
    }
  }

  function startNextRoll(now: number) {
    if (animation || pending.length === 0) return;
    animation = pending.shift()!;
    animation.startedAt = now;
    animation.lane.ball.visible = true;
    animation.lane.ball.position.set(0, 0.52, BALL_Z);
    animation.lane.ball.rotation.set(0, 0, 0);
  }

  function tick(now: number) {
    const delta = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    startNextRoll(now);
    setActiveLane();

    const active = animation;
    if (active) {
      const progress = clamp((now - active.startedAt) / active.duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 2.2);
      const rollAim = active.roll.aim ?? 0;
      const rollPower = active.roll.power ?? 0;
      const curve = Math.sin(progress * Math.PI) * rollAim * 0.75;
      const laneOffset = rollAim * 0.72;
      active.lane.ball.position.x = laneOffset * eased + curve;
      active.lane.ball.position.y = 0.52 + Math.sin(progress * Math.PI * 11) * 0.035;
      active.lane.ball.position.z = BALL_Z + (PIN_Z - BALL_Z) * eased;
      active.lane.ball.rotation.x -= delta * 13;
      active.lane.ball.rotation.z += (rollAim + rollPower * 0.1) * delta * 3;

      if (!active.hitAt && progress >= 0.68) {
        active.hitAt = true;
        active.knocked.forEach((id, offset) => {
          const pin = active.lane.pins[id];
          if (!pin) return;
          pin.visible = false;
          active.lane.visiblePins.delete(id);
          pin.rotation.z = (offset % 2 === 0 ? 1 : -1) * 0.9;
        });
        const label = active.roll.pins === 10 ? "STRIKE!" : active.roll.pins > 0 ? `${active.roll.pins} pins` : "GUTTER";
        onFeedback(label);
      }
      if (progress >= 1) {
        active.lane.ball.position.set(0, 0.52, BALL_Z);
        animation = null;
      }
    }

    camera.position.x += (laneX(Number(scene.userData.currentSeat ?? 0)) * 0.18 - camera.position.x) * 0.04;
    target.x += (laneX(Number(scene.userData.currentSeat ?? 0)) * 0.18 - target.x) * 0.04;
    camera.lookAt(target);
    renderer.render(scene, camera);
    if (!destroyed) raf = window.requestAnimationFrame(tick);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(mount);
  resize();
  raf = window.requestAnimationFrame(tick);

  return {
    setControls(aim, power, spin, canAim) {
      controls = { aim, power, spin, canAim };
      scene.userData.controls = controls;
      const lane = lanes[Math.min(seatCount - 1, Math.max(0, Number(scene.userData.currentSeat ?? 0)))];
      if (lane && canAim) {
        lane.ball.position.x = clamp(aim, -1, 1) * 0.55;
      }
    },
    setActiveSeat(seat) {
      scene.userData.currentSeat = clamp(Math.floor(seat), 0, LANE_COUNT - 1);
    },
    syncRolls,
    dispose() {
      destroyed = true;
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else if (mesh.material) mesh.material.dispose();
      });
      renderer.dispose();
      mount.replaceChildren();
    },
  };
}

function aimName(aim: number) {
  if (aim < -0.08) return `${Math.round(Math.abs(aim) * 100)}% left`;
  if (aim > 0.08) return `${Math.round(aim * 100)}% right`;
  return "Center line";
}

export function StrikeNight3DCanvas({
  rolls,
  mySeatIndex,
  seatCount,
  seatNames,
  onRoll,
  rollLocked = false,
}: StrikeNight3DCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneController | null>(null);
  const rollsRef = useRef(rolls);
  const chargeFrameRef = useRef<number | null>(null);
  const chargingRef = useRef(false);
  const chargeStartedRef = useRef(0);
  const [aim, setAim] = useState(0);
  const [power, setPower] = useState(0);
  const [spin, setSpin] = useState(0);
  const [charging, setCharging] = useState(false);
  const [feedback, setFeedback] = useState("Pick a line and hold to charge your throw.");
  const [busy, setBusy] = useState(false);
  const state = useMemo(() => computeBowlingState(rolls, Math.max(1, seatCount)), [rolls, seatCount]);
  const isMyTurn = mySeatIndex === null ? !state.gameOver : state.currentSeat === mySeatIndex && !state.gameOver;
  const canAim = isMyTurn && !rollLocked && !busy;

  useEffect(() => {
    rollsRef.current = rolls;
    sceneRef.current?.syncRolls(rolls);
  }, [rolls]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const controller = buildScene(mount, seatNames, Math.max(1, seatCount), setFeedback);
    sceneRef.current = controller;
    controller.syncRolls(rollsRef.current);
    return () => {
      controller.dispose();
      sceneRef.current = null;
    };
  }, [seatCount, seatNames]);

  useEffect(() => {
    sceneRef.current?.setControls(aim, power, spin, canAim);
  }, [aim, power, spin, canAim]);

  useEffect(() => {
    sceneRef.current?.setActiveSeat(state.currentSeat < 0 ? 0 : state.currentSeat);
  }, [state.currentSeat]);

  useEffect(() => {
    function stopCharge() {
      if (chargeFrameRef.current !== null) cancelAnimationFrame(chargeFrameRef.current);
      chargeFrameRef.current = null;
    }
    async function keyUp(event: KeyboardEvent) {
      if (event.code !== "Space") return;
      event.preventDefault();
      if (!chargingRef.current) return;
      chargingRef.current = false;
      setCharging(false);
      stopCharge();
      await throwBall();
    }
    function keyDown(event: KeyboardEvent) {
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        event.preventDefault();
        if (canAim) setAim((value) => clamp(value - 0.035, -1, 1));
      }
      if (event.code === "ArrowRight" || event.code === "KeyD") {
        event.preventDefault();
        if (canAim) setAim((value) => clamp(value + 0.035, -1, 1));
      }
      if (event.code === "KeyQ" && canAim) setSpin((value) => clamp(value - 0.08, -1, 1));
      if (event.code === "KeyE" && canAim) setSpin((value) => clamp(value + 0.08, -1, 1));
      if (event.code === "Space") {
        event.preventDefault();
        if (!chargingRef.current && canAim) {
          chargingRef.current = true;
          chargeStartedRef.current = performance.now();
          setCharging(true);
          const animateCharge = (now: number) => {
            const elapsed = (now - chargeStartedRef.current) / 1000;
            const cycle = Math.min(1, elapsed / 1.8);
            setPower(cycle < 1 ? 0.1 + cycle * 0.9 : 1);
            if (chargingRef.current) chargeFrameRef.current = requestAnimationFrame(animateCharge);
          };
          chargeFrameRef.current = requestAnimationFrame(animateCharge);
        }
      }
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      stopCharge();
    };
  });

  async function throwBall() {
    if (!canAim || power < 0.12) {
      setFeedback("Hold a little longer so the ball reaches the pins.");
      return;
    }
    setBusy(true);
    setFeedback("Sending your throw to the official lane...");
    const effectiveAim = clamp(aim + spin * 0.08, -1, 1);
    const result = await onRoll({ aim: effectiveAim, power });
    setBusy(false);
    if (!result.ok) {
      setFeedback(result.reason ?? "That throw was not accepted. Try again.");
      return;
    }
    setPower(0);
    setSpin(0);
    setFeedback("Roll accepted. Watch the shared pin result.");
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canAim) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    chargingRef.current = true;
    chargeStartedRef.current = performance.now();
    setCharging(true);
    setPower(0.1);
    const startY = event.clientY;
    const onMove = (move: PointerEvent) => {
      if (!chargingRef.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setAim(clamp(((move.clientX - rect.left) / rect.width - 0.5) * 1.8, -1, 1));
      const dragPower = clamp((startY - move.clientY) / Math.max(80, rect.height * 0.65), 0, 1);
      setPower(Math.max(0.1, dragPower));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!chargingRef.current) return;
      chargingRef.current = false;
      setCharging(false);
      void throwBall();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-ink-900/10 bg-[#4a303d] shadow-xl">
      <div
        className="relative h-[min(68vh,640px)] min-h-[400px] w-full touch-none select-none"
        onPointerDown={onPointerDown}
        ref={mountRef}
      >
        <div className="pointer-events-none absolute inset-x-4 top-4 z-10 flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-xl border border-white/25 bg-[#fff8ed]/90 px-3 py-2 text-[#3e2a2f] shadow-lg backdrop-blur-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#a55d75]">Strike Night 3D</p>
            <p className="mt-1 text-sm font-black">{isMyTurn ? "Your lane is live" : "Spectating the active bowler"}</p>
            <p className="text-xs font-bold text-[#6f5056]">Frame {Math.min(10, state.currentFrame + 1)} · roll {Math.min(3, state.ballInFrame + 1)}</p>
          </div>
          <div className="rounded-xl border border-white/25 bg-[#fff8ed]/90 px-3 py-2 text-right text-[#3e2a2f] shadow-lg backdrop-blur-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#a55d75]">{aimName(aim)}</p>
            <p className="mt-1 text-sm font-black">Power {Math.round(power * 100)}%</p>
            <p className="text-xs font-bold text-[#6f5056]">Spin {spin < -0.05 ? "left" : spin > 0.05 ? "right" : "neutral"}</p>
          </div>
        </div>
        {feedback && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/30 bg-[#fff8ed]/92 px-4 py-2 text-center text-xs font-black text-[#3e2a2f] shadow-lg">
            <Sparkles className="mr-1 inline size-3.5 text-[#d97891]" /> {feedback}
          </div>
        )}
        {!isMyTurn && !state.gameOver && (
          <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-[#3b2637]/12">
            <span className="rounded-full bg-[#fff8ed]/90 px-4 py-2 text-sm font-black text-[#3e2a2f] shadow-lg">Watch the throw, then your lane will glow.</span>
          </div>
        )}
      </div>
      <div className="grid gap-3 border-t border-white/15 bg-[#fff8ed] p-3 text-[#3e2a2f] sm:grid-cols-[1fr_auto] sm:items-center sm:p-4">
        <div>
          <p className="text-sm font-black">{charging ? "Release to throw" : isMyTurn ? "Hold the lane, then release" : "Waiting for the active bowler"}</p>
          <p className="text-xs font-bold text-[#76565d]">A/D or arrows aim · Q/E add spin · Space or drag to charge</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button disabled={!canAim} onClick={() => setAim((value) => clamp(value - 0.08, -1, 1))} size="sm" variant="secondary">
            <ChevronLeft /> Aim
          </Button>
          <Button disabled={!canAim} onClick={() => setAim((value) => clamp(value + 0.08, -1, 1))} size="sm" variant="secondary">
            Aim <ChevronRight />
          </Button>
          <Button disabled={!canAim} onClick={() => setSpin((value) => value === 0 ? -0.35 : 0)} size="sm" variant="secondary">
            <RotateCcw /> Spin
          </Button>
        </div>
      </div>
      <div className={cn("h-1 transition-colors", canAim ? "bg-[#e18a9d]" : "bg-[#9a7bd0]")} />
    </section>
  );
}
