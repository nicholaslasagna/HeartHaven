"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { MoonberryRenderer } from "@/lib/game/moonberry-bowling/renderer";
import { simulateThrow, type ThrowResult } from "@/lib/game/moonberry-bowling/physics";
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

  const isMyTurn = mySeatIndex === null || currentSeat === mySeatIndex;
  const canBowl = isMyTurn && !gameOver && !submitting;

  const match = useMemo(
    () => resolveMatch(throws, seatCount, sessionId),
    [throws, seatCount, sessionId],
  );

  /* Playback queue. A throw that lands in the log while we are watching the
     previous one waits its turn rather than cutting it short. */
  const playedRef = useRef(0);
  const queueRef = useRef<Array<{ result: ThrowResult; callout: string | null }>>([]);

  useEffect(() => {
    const resolved = match.resolved;
    if (resolved.length < playedRef.current) {
      // Log shrank (a reset): drop everything and show the fresh rack.
      playedRef.current = 0;
      queueRef.current = [];
      return;
    }
    for (let i = playedRef.current; i < resolved.length; i += 1) {
      const entry = resolved[i];
      const ball = (match.rolls[i]?.pins ?? 0) === 10 && entry.standingBefore.length === 10 ? 0 : 1;
      queueRef.current.push({
        result: entry.result,
        callout: describeResult(
          entry.result.pinCount,
          entry.standingBefore.length,
          entry.result.standing,
          ball as 0 | 1,
        ),
      });
    }
    playedRef.current = resolved.length;
  }, [match]);

  /* -- scene -- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let webgl: THREE.WebGLRenderer;
    try {
      webgl = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError("Moonberry Bowling needs WebGL, and this browser refused to start it.");
      return;
    }
    webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    webgl.shadowMap.enabled = true;
    webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    // The renderer authors its lights for physical tone mapping.
    webgl.toneMapping = THREE.ACESFilmicToneMapping;
    webgl.toneMappingExposure = 1.05;
    webgl.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(webgl.domElement);

    let scene: MoonberryRenderer;
    try {
      scene = new MoonberryRenderer(seatCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moonberry Bowling could not build the alley.");
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

    const idlePins: PinView[] = Array.from({ length: 10 }, (_, id) => ({
      id, x: 0, z: 0, tilt: 0, tiltAxis: 0, spin: 0,
    }));

    let raf = 0;
    let last = performance.now();
    let time = 0;
    let playing: { result: ThrowResult; callout: string | null } | null = null;
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
      let pins = idlePins;
      let ball = { x: 0, z: 0, roll: 0, inGutter: false };
      let callout: string | null = null;

      if (playing) {
        playHead += dt;
        const frames = playing.result.frames;
        const index = Math.min(frames.length - 1, Math.floor(playHead * 60));
        const frame = frames[index];
        ball = frame.ball;
        pins = frame.pins;
        const progress = index / Math.max(1, frames.length - 1);
        shot = progress < 0.12 ? "aim" : progress < 0.62 ? "follow" : progress < 0.9 ? "pins" : "result";
        callout = progress > 0.82 ? playing.callout : null;

        if (index >= frames.length - 1) {
          settleHold += dt;
          if (settleHold > 1.8) playing = null;
        }
      } else if (canBowl) {
        shot = "aim";
      }

      const snapshot: BowlingSnapshot = {
        lane: {
          ball,
          pins,
          aimGuide: !playing && canBowl ? { x: preview?.aim ?? 0, spin: preview?.spin ?? 0 } : null,
          shot,
          seat: currentSeat,
          seatName: seatNames[currentSeat] ?? `Player ${currentSeat + 1}`,
        },
        scores: match.state.players.map((player, seat) => ({
          seat,
          name: seatNames[seat] ?? `Player ${seat + 1}`,
          total: player.total,
          frames: player.frames.map((f) => ({ rolls: f.rolls, running: f.cumulative })),
          active: seat === currentSeat,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

export { throwSeed, simulateThrow };
