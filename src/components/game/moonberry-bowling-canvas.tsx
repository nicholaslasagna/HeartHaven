"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { MoonberryRenderer } from "@/lib/game/moonberry-bowling/renderer";
import {
  createPins,
  HEAD_PIN_Z,
  simulateThrow,
  type ThrowResult,
} from "@/lib/game/moonberry-bowling/physics";
import { resolveMatch, throwSeed, type LoggedThrow } from "@/lib/game/moonberry-bowling/match";
import {
  describeResult,
  seatCss,
  type BowlingSnapshot,
  type CameraShot,
  type PinView,
} from "@/lib/game/moonberry-bowling/types";
import { cn } from "@/lib/utils";

/**
 * Moonberry Bowling — canvas and input.
 *
 * Owns the seam between React and the scene: it mounts the renderer, turns
 * the logged throws into playback, and reads the swipe. Rules live in
 * `match.ts`, visuals in `renderer.ts`; neither is duplicated here.
 *
 * Playback is driven by the LOG, never by local input, so every player
 * watches the same ball take the same line — the same reason the pool table
 * replays an opponent's shot rather than teleporting the balls.
 */

/* Swipe feel. Measured in fractions of the canvas, not pixels, so the same
   flick works on a phone and a desktop. These are the calibration knobs. */
const SWIPE_MIN_TRAVEL = 0.14;
const SWIPE_MIN_SPEED = 0.5;
const SWIPE_MAX_SPEED = 2.8;
/** Sideways drift at release that maps to full hook. */
const SWIPE_SPIN_SPAN = 0.16;
const SWIPE_WINDOW_MS = 120;

type Sample = { x: number; y: number; t: number };

export type MoonberryThrow = { aim: number; power: number; spin: number };

type Props = {
  throws: LoggedThrow[];
  seatCount: number;
  seatNames: string[];
  mySeatIndex: number | null;
  currentSeat: number;
  sessionId: string | null;
  gameOver: boolean;
  submitting?: boolean;
  onThrow: (details: MoonberryThrow) => Promise<{ ok: boolean; reason?: string }>;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Turn a finished swipe into a throw. Null when it was a tap, not a roll. */
function readSwipe(start: Sample, tail: Sample[], width: number, height: number): MoonberryThrow | null {
  const last = tail[tail.length - 1];
  if (!last || width <= 0 || height <= 0) return null;

  const travel = (start.y - last.y) / height;
  if (travel < SWIPE_MIN_TRAVEL) return null;

  // Velocity from the tail only: the throw is the flick at the end, not a
  // slow drag with a twitch on top.
  const cutoff = last.t - SWIPE_WINDOW_MS;
  const from = tail.find((s) => s.t >= cutoff) ?? start;
  const seconds = Math.max(0.016, (last.t - from.t) / 1000);
  const speed = ((from.y - last.y) / height) / seconds;

  return {
    // Where you started the swipe across the lane is your line.
    aim: clamp((start.x / width) * 2 - 1, -1, 1),
    power: clamp((speed - SWIPE_MIN_SPEED) / (SWIPE_MAX_SPEED - SWIPE_MIN_SPEED), 0, 1),
    // How much the flick curved sideways at release becomes the hook.
    spin: clamp(((last.x - from.x) / width) / SWIPE_SPIN_SPAN, -1, 1),
  };
}

export function MoonberryBowlingCanvas({
  throws,
  seatCount,
  seatNames,
  mySeatIndex,
  currentSeat,
  sessionId,
  gameOver,
  submitting = false,
  onThrow,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<MoonberryRenderer | null>(null);
  const snapshotRef = useRef<BowlingSnapshot | null>(null);
  const swipeRef = useRef<{ pointerId: number; start: Sample; tail: Sample[] } | null>(null);

  const [status, setStatus] = useState("Swipe up the lane to bowl.");
  const [preview, setPreview] = useState<MoonberryThrow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackBusy, setPlaybackBusy] = useState(false);

  const isMyTurn = mySeatIndex === null || currentSeat === mySeatIndex;
  const canBowl = isMyTurn && !gameOver && !submitting && !playbackBusy;

  const match = useMemo(
    () => resolveMatch(throws, seatCount, sessionId),
    [throws, seatCount, sessionId],
  );
  const liveRef = useRef({ match, canBowl, currentSeat, preview, seatNames });
  useEffect(() => {
    liveRef.current = { match, canBowl, currentSeat, preview, seatNames };
  }, [match, canBowl, currentSeat, preview, seatNames]);

  /* Playback queue. Move indexes are stable across polling hydrations, so a
     server roll can enter this queue once and only once. */
  const playbackRef = useRef({
    initialized: false,
    lastMoveIndex: -1,
    sessionId: null as string | null,
  });
  const queueRef = useRef<Array<{ result: ThrowResult; callout: string | null; seat: number }>>([]);

  useEffect(() => {
    const playback = playbackRef.current;
    if (playback.sessionId !== sessionId) {
      playback.initialized = false;
      playback.lastMoveIndex = -1;
      playback.sessionId = sessionId;
      queueRef.current = [];
      setPlaybackBusy(false);
    }

    if (!playback.initialized) {
      playback.initialized = true;
      playback.lastMoveIndex = throws.reduce(
        (highest, entry, index) => Math.max(highest, entry.moveIndex ?? index),
        -1,
      );
      return;
    }

    for (let index = 0; index < match.resolved.length; index += 1) {
      const moveIndex = throws[index]?.moveIndex ?? index;
      if (moveIndex <= playback.lastMoveIndex) continue;
      const entry = match.resolved[index];
      queueRef.current.push({
        result: entry.result,
        seat: entry.roll.seat,
        callout: describeResult(
          entry.result.pinCount,
          entry.standingBefore.length,
          entry.result.standing,
          entry.ballBefore as 0 | 1 | 2,
        ),
      });
      playback.lastMoveIndex = moveIndex;
      setPlaybackBusy(true);
    }
  }, [match.resolved, sessionId, throws]);

  /* -- scene -- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let webgl: THREE.WebGLRenderer;
    try {
      webgl = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      queueMicrotask(() => {
        setError("Moonberry Bowling needs WebGL, and this browser refused to start it.");
      });
      return;
    }
    webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    webgl.shadowMap.enabled = true;
    webgl.shadowMap.type = THREE.PCFShadowMap;
    // The renderer authors its lights for physical tone mapping.
    webgl.toneMapping = THREE.ACESFilmicToneMapping;
    webgl.toneMappingExposure = 1.05;
    webgl.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(webgl.domElement);

    let scene: MoonberryRenderer;
    try {
      scene = new MoonberryRenderer(seatCount);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Moonberry Bowling could not build the alley.";
      queueMicrotask(() => setError(message));
      webgl.dispose();
      mount.removeChild(webgl.domElement);
      return;
    }
    rendererRef.current = scene;

    const resize = () => {
      const width = mount.clientWidth || 960;
      const height = Math.max(360, Math.round(width * 0.58));
      webgl.setSize(width, height, true);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let raf = 0;
    let last = performance.now();
    let time = 0;
    let playing: { result: ThrowResult; callout: string | null; seat: number } | null = null;
    let playHead = 0;
    let settleHold = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;

      if (!playing && queueRef.current.length > 0) {
        playing = queueRef.current.shift()!;
        playHead = 0;
        settleHold = 0;
      }

      let shot: CameraShot = "idle";
      const live = liveRef.current;
      let pins = restingRack(live.match);
      let ball = { x: 0, z: 0, roll: 0, inGutter: false };
      let callout: string | null = null;

      if (playing) {
        playHead += dt;
        const frames = playing.result.frames;
        const index = Math.min(frames.length - 1, Math.floor(playHead * 60));
        const frame = frames[index];
        ball = frame.ball;
        pins = frame.pins;
        const laneProgress = clamp(frame.ball.z / HEAD_PIN_Z, 0, 1);
        const resultWindow = index >= Math.max(0, frames.length - 70);
        shot = laneProgress < 0.05
          ? "aim"
          : laneProgress < 0.82
            ? "follow"
            : resultWindow
              ? "result"
              : "pins";
        callout = resultWindow ? playing.callout : null;

        if (index >= frames.length - 1) {
          settleHold += dt;
          if (settleHold > 1.8) {
            playing = null;
            if (queueRef.current.length === 0) setPlaybackBusy(false);
          }
        }
      } else if (live.canBowl) {
        shot = "aim";
      }
      const displaySeat = playing?.seat ?? live.currentSeat;

      const snapshot: BowlingSnapshot = {
        lane: {
          ball,
          pins,
          aimGuide: !playing && live.canBowl
            ? { x: live.preview?.aim ?? 0, spin: live.preview?.spin ?? 0 }
            : null,
          shot,
          seat: displaySeat,
          seatName: live.seatNames[displaySeat] ?? `Player ${displaySeat + 1}`,
        },
        scores: live.match.state.players.map((player, seat) => ({
          seat,
          name: live.seatNames[seat] ?? `Player ${seat + 1}`,
          total: player.total,
          frames: player.frames.map((f) => ({ rolls: f.rolls, running: f.cumulative })),
          active: seat === displaySeat,
        })),
        time,
        callout,
      };
      snapshotRef.current = snapshot;

      const size = new THREE.Vector2();
      webgl.getSize(size);
      scene.update(snapshot, size.x / Math.max(1, size.y), dt);
      webgl.render(scene.scene, scene.camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.dispose();
      rendererRef.current = null;
      webgl.dispose();
      if (webgl.domElement.parentNode === mount) mount.removeChild(webgl.domElement);
    };
    // The alley is rebuilt only when the lane count changes; per-frame data
    // arrives through refs so this never tears down mid-throw.
  }, [seatCount]);

  /* -- swipe -- */
  const sampleAt = useCallback((event: ReactPointerEvent<HTMLDivElement>): Sample => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, t: performance.now() };
  }, []);

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canBowl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const sample = sampleAt(event);
    swipeRef.current = { pointerId: event.pointerId, start: sample, tail: [sample] };
    setStatus("Flick up the lane, curve it to hook.");
  };

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const sample = sampleAt(event);
    swipe.tail.push(sample);
    if (swipe.tail.length > 32) swipe.tail.splice(0, swipe.tail.length - 32);
    const rect = event.currentTarget.getBoundingClientRect();
    setPreview(readSwipe(swipe.start, swipe.tail, rect.width, rect.height));
  };

  const onUp = async (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    swipeRef.current = null;
    const rect = event.currentTarget.getBoundingClientRect();
    swipe.tail.push(sampleAt(event));
    const result = readSwipe(swipe.start, swipe.tail, rect.width, rect.height);
    setPreview(null);

    if (!result) {
      setStatus("That was a tap, not a throw. Swipe up the lane.");
      return;
    }
    if (result.power < 0.1) {
      setStatus("Too gentle — flick quicker to get it down the lane.");
      return;
    }
    setStatus("Sending your throw to the lane...");
    const outcome = await onThrow(result);
    setStatus(outcome.ok ? "Throw away!" : outcome.reason ?? "That throw could not be saved.");
  };

  if (error) {
    return (
      <p className="rounded-lg border border-blush-300/50 bg-blush-100/70 p-4 text-sm font-extrabold text-blush-700">
        {error}
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="relative overflow-hidden rounded-lg border border-cream-300 bg-ink-900 shadow-sm">
        <div ref={mountRef} className="aspect-[16/9] w-full" />

        <div
          className={cn(
            "absolute inset-0 touch-none select-none",
            canBowl ? "cursor-grab active:cursor-grabbing" : "pointer-events-none",
          )}
          onPointerCancel={onUp}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          {preview && (
            <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-56 rounded-full bg-white/90 px-3 py-1.5 text-center shadow">
              <span className="text-xs font-black text-ink-800">
                {Math.round(preview.power * 100)}% ·{" "}
                {Math.abs(preview.spin) < 0.12
                  ? "straight"
                  : `${Math.round(Math.abs(preview.spin) * 100)}% hook ${preview.spin > 0 ? "right" : "left"}`}
              </span>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-cream-200">
                <span
                  className="block h-full rounded-full transition-[width]"
                  style={{ width: `${Math.round(preview.power * 100)}%`, backgroundColor: seatCss(currentSeat) }}
                />
              </span>
            </div>
          )}

          {canBowl && !preview && (
            <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs font-black uppercase tracking-normal text-white/75">
              Swipe up to bowl · curve the flick to hook
            </p>
          )}
        </div>
      </div>

      <p aria-live="polite" className="rounded-lg border border-honey-500/30 bg-honey-100/60 px-3 py-2 text-sm font-bold text-ink-700">
        {gameOver
          ? "Match complete."
          : isMyTurn
            ? status
            : `${seatNames[currentSeat] ?? `Player ${currentSeat + 1}`} is up.`}
      </p>
    </div>
  );
}

function restingRack(match: ReturnType<typeof resolveMatch>): PinView[] {
  const freshRack = match.state.ballInFrame === 0 || match.state.standingPins === 10;
  const standing = freshRack
    ? new Set(Array.from({ length: 10 }, (_, id) => id))
    : new Set(match.resolved[match.resolved.length - 1]?.result.standing ?? []);
  return createPins()
    .filter((pin) => standing.has(pin.id))
    .map((pin) => ({
      id: pin.id,
      x: pin.x,
      z: pin.z,
      tilt: 0,
      tiltAxis: 0,
      spin: 0,
    }));
}

export { throwSeed, simulateThrow };
