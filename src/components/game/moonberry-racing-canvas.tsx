"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MoonberryRacingRenderer, kartColor, type KartView, type RacingSnapshot } from "@/lib/game/moonberry-racing/renderer";
import { KART, NO_KART_INPUT, applyBoostPad, chargeBand, stepKart, type KartInput } from "@/lib/game/moonberry-racing/kart";
import { Race, COUNTDOWN_MS, type RacerReport } from "@/lib/game/moonberry-racing/race";
import { sampleCourse, surfaceAt, VERGE_LIMIT, type Course } from "@/lib/game/moonberry-racing/track";
import { cn } from "@/lib/utils";

/**
 * Moonberry Racing — canvas, input and HUD.
 *
 * The seam between React and the simulation. It owns the frame loop, reads
 * the keyboard, steps the LOCAL kart, and hands the renderer a snapshot.
 * Rules live in `race.ts`, handling in `kart.ts`, geometry in `track.ts`;
 * none of it is duplicated here.
 *
 * Only the local kart is simulated. Remote karts are positioned from the
 * reports the transport feeds into `Race`, and the renderer damps toward
 * those poses, so a dropped packet looks like smoothing rather than a jump.
 */

export type RacingSeat = { id: string; name: string; seat: number; local: boolean };

type Props = {
  course: Course;
  seats: RacingSeat[];
  localId: string;
  isHost: boolean;
  /** Shared race-start stamp from the host; null until the host starts. */
  startAt: number | null;
  /** Called ~20x/sec with the local kart's pose, for broadcasting. */
  onReport?: (report: RacerReport) => void;
  /** Reports arriving from other players. */
  subscribeRemote?: (handler: (report: RacerReport) => void) => () => void;
  onFinish?: (ms: number, position: number) => void;
  onError?: (message: string) => void;
};

const REPORT_HZ = 20;

export function MoonberryRacingCanvas({
  course,
  seats,
  localId,
  isHost,
  startAt,
  onReport,
  subscribeRemote,
  onFinish,
  onError,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const startAtRef = useRef(startAt);
  const callbacksRef = useRef({ onReport, onFinish });
  const [hud, setHud] = useState({
    position: 1, field: seats.length, lap: 1, laps: course.laps,
    timeMs: 0, charge: 0, band: "none" as string, boosting: false,
    countdown: null as number | null, wrongWay: false, finalLap: false, message: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { startAtRef.current = startAt; }, [startAt]);
  useEffect(() => { callbacksRef.current = { onReport, onFinish }; }, [onReport, onFinish]);

  const seatsKey = seats.map((s) => `${s.id}:${s.seat}`).join(",");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let webgl: THREE.WebGLRenderer;
    try {
      webgl = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      const message = "Moonberry Racing needs WebGL, and this browser refused to start it.";
      queueMicrotask(() => { setError(message); onError?.(message); });
      return;
    }
    webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    webgl.shadowMap.enabled = true;
    webgl.shadowMap.type = THREE.PCFShadowMap;
    webgl.toneMapping = THREE.ACESFilmicToneMapping;
    webgl.toneMappingExposure = 1.0;
    webgl.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(webgl.domElement);

    let renderer: MoonberryRacingRenderer;
    let race: Race;
    try {
      renderer = new MoonberryRacingRenderer(course);
      race = new Race(course, isHost);
      for (const seat of seats) race.join(seat.id, seat.name, seat.seat, seat.id === localId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Moonberry Racing could not build the course.";
      queueMicrotask(() => { setError(message); onError?.(message); });
      webgl.dispose();
      mount.removeChild(webgl.domElement);
      return;
    }

    const unsubscribe = subscribeRemote?.((report) => {
      if (report.racerId === localId) return;
      race.applyRacerReport(report);
    });

    /* -- input -- */
    const held = new Set<string>();
    const input: KartInput = { ...NO_KART_INPUT };
    let rearView = false;
    const readInput = () => {
      const left = held.has("a") || held.has("arrowleft");
      const right = held.has("d") || held.has("arrowright");
      input.steer = Number(right) - Number(left);
      input.throttle = held.has("w") || held.has("arrowup") ? 1 : 0;
      input.brake = held.has("s") || held.has("arrowdown") ? 1 : 0;
      input.drift = held.has("shift");
      input.action = held.has(" ");
      input.item = held.has("e");
      rearView = held.has("r");
    };
    const isTyping = () => {
      const el = document.activeElement;
      if (!el) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping()) return;
      const key = event.key === " " ? " " : event.key.toLowerCase();
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
      held.add(key);
      readInput();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      held.delete(event.key === " " ? " " : event.key.toLowerCase());
      readInput();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const resize = () => {
      const width = mount.clientWidth || 960;
      const height = Math.max(400, Math.round(width * 0.5625));
      webgl.setSize(width, height, true);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const takenBoxes = new Set<number>();
    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let reportTimer = 0;
    let hudTimer = 0;
    let surfaceHint: number | undefined;
    let reportedFinish = false;
    let lastPadIndex = -1;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Adopt the host's start stamp so every client counts down together.
      const shared = startAtRef.current;
      if (shared !== null && race.startAt !== shared) race.adoptStart(shared);
      race.tick(Date.now(), dt);

      const me = race.racers.get(localId);
      const racing = race.phase === "racing";

      if (me && !me.spectator) {
        // Fixed-step the local kart so handling is identical at any frame rate.
        accumulator += dt;
        let steps = 0;
        while (accumulator >= KART.STEP && steps < 20) {
          accumulator -= KART.STEP;
          steps += 1;
          const surface = surfaceAt(course, me.kart.x, me.kart.z, surfaceHint);
          surfaceHint = surface.t;
          stepKart(me.kart, racing && !me.finishedAt ? input : NO_KART_INPUT, surface, KART.STEP);

          // Off the map, or fallen: recover at the last checkpoint.
          if (surface.edgeOverrun > VERGE_LIMIT || me.kart.y < -30) {
            race.respawn(localId);
            renderer.resetCamera();
            surfaceHint = undefined;
          }
        }

        // Boost pads: crossing one is a position test, not a collision.
        course.boostPads.forEach((pad, index) => {
          if (index === lastPadIndex) return;
          const at = sampleCourse(course, pad.t);
          if (Math.hypot(me.kart.x - at.x, me.kart.z - at.z) < pad.width * 0.6) {
            applyBoostPad(me.kart, pad.strength ?? 1);
            lastPadIndex = index;
          }
        });

        // Item boxes.
        course.itemBoxes.forEach((box, index) => {
          if (takenBoxes.has(index)) return;
          const at = sampleCourse(course, box.t);
          const bx = at.x + -0 + box.offset * 0;
          if (Math.hypot(me.kart.x - bx, me.kart.z - at.z) < 2.4) takenBoxes.add(index);
        });

        if (racing) race.advanceProgress(me);

        if (me.finishedAt !== null && !reportedFinish) {
          reportedFinish = true;
          callbacksRef.current.onFinish?.(me.finishedAt, me.position);
        }

        reportTimer += dt;
        if (reportTimer >= 1 / REPORT_HZ) {
          reportTimer = 0;
          callbacksRef.current.onReport?.({
            racerId: localId,
            x: Number(me.kart.x.toFixed(2)),
            y: Number(me.kart.y.toFixed(2)),
            z: Number(me.kart.z.toFixed(2)),
            heading: Number(me.kart.heading.toFixed(3)),
            speed: Number(me.kart.speed.toFixed(2)),
            driftCharge: Number(me.kart.driftCharge.toFixed(3)),
            boosting: me.kart.boostTimer > 0,
          });
        }
      }

      const karts: KartView[] = [...race.racers.values()].map((racer) => ({
        id: racer.id,
        seat: racer.seat,
        name: racer.name,
        x: racer.kart.x,
        y: racer.kart.y,
        z: racer.kart.z,
        heading: racer.kart.heading,
        lean: racer.kart.driftSide !== 0 ? racer.kart.driftSide : input.steer * 0.4,
        driftSide: racer.kart.driftSide,
        driftCharge: racer.kart.driftCharge,
        boosting: racer.kart.boostTimer > 0,
        airborne: racer.kart.airborne,
        spinning: racer.kart.spinTimer > 0,
        local: racer.id === localId,
        position: racer.position,
        finished: racer.finishedAt !== null,
      }));

      const snapshot: RacingSnapshot = {
        karts,
        raceTime: race.raceTime,
        followId: localId,
        rearView,
        itemBoxesTaken: takenBoxes,
      };

      const size = new THREE.Vector2();
      webgl.getSize(size);
      renderer.update(snapshot, size.x / Math.max(1, size.y), dt);
      webgl.render(renderer.scene, renderer.camera);

      // The HUD is React, so refresh it at 12Hz rather than every frame.
      hudTimer += dt;
      if (hudTimer > 1 / 12) {
        hudTimer = 0;
        const countdown = race.phase === "countdown" && race.startAt !== null
          ? Math.max(0, Math.ceil((race.startAt - Date.now()) / 1000))
          : null;
        setHud({
          position: me?.position ?? 1,
          field: race.contenders.length,
          lap: Math.min(course.laps, (me?.progress.lap ?? 0) + 1),
          laps: course.laps,
          timeMs: Math.round(race.raceTime * 1000),
          charge: me?.kart.driftCharge ?? 0,
          band: chargeBand(me?.kart.driftCharge ?? 0),
          boosting: (me?.kart.boostTimer ?? 0) > 0,
          countdown,
          wrongWay: Boolean(me?.progress.wrongWay),
          finalLap: (me?.progress.lap ?? 0) === course.laps - 1,
          message: me?.spectator
            ? "Spectating — you joined after the lights went out."
            : race.phase === "finished"
              ? "Race complete."
              : "",
        });
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      unsubscribe?.();
      renderer.dispose();
      webgl.dispose();
      if (webgl.domElement.parentNode === mount) mount.removeChild(webgl.domElement);
    };
    // Rebuilt only when the course or the field changes; per-frame data
    // arrives through refs so this never tears down mid-race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, seatsKey, localId, isHost]);

  const formatTime = useCallback((ms: number) => {
    const total = Math.max(0, ms);
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const h = Math.floor((total % 1000) / 10);
    return `${m}:${String(s).padStart(2, "0")}.${String(h).padStart(2, "0")}`;
  }, []);

  if (error) {
    return (
      <p className="rounded-lg border border-blush-300/50 bg-blush-100/70 p-4 text-sm font-extrabold text-blush-700">
        {error}
      </p>
    );
  }

  const bandColor =
    hud.band === "sweet" ? "bg-honey-400" : hud.band === "over" ? "bg-blush-500" : "bg-sky-400";

  return (
    <div className="relative overflow-hidden rounded-lg border border-cream-300 bg-ink-900 shadow-sm">
      <div ref={mountRef} className="aspect-video w-full" />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 select-none">
        <div className="absolute left-3 top-3 flex items-baseline gap-1 rounded-lg bg-ink-900/70 px-3 py-1.5">
          <span className="font-display text-3xl leading-none text-cream-50">{hud.position}</span>
          <span className="text-xs font-black text-cream-200/80">/ {hud.field}</span>
        </div>

        <div className="absolute right-3 top-3 grid gap-1 text-right">
          <span className="rounded-lg bg-ink-900/70 px-3 py-1 text-sm font-black text-cream-50">
            LAP {hud.lap}/{hud.laps}
          </span>
          <span className="rounded-lg bg-ink-900/70 px-3 py-1 font-mono text-sm font-bold text-cream-100">
            {formatTime(hud.timeMs)}
          </span>
        </div>

        {/* Drift charge: the sweet spot must be readable at a glance. */}
        {hud.charge > 0.01 && (
          <div className="absolute bottom-4 left-1/2 w-56 -translate-x-1/2">
            <div className="relative h-3 overflow-hidden rounded-full bg-ink-900/70">
              <span
                className={cn("block h-full transition-[width] duration-75", bandColor)}
                style={{ width: `${Math.min(100, hud.charge * 74)}%` }}
              />
              {/* Sweet-spot window markers at 0.45 and 0.85 of the meter. */}
              <span className="absolute inset-y-0 left-[33%] w-px bg-cream-50/70" />
              <span className="absolute inset-y-0 left-[63%] w-px bg-cream-50/70" />
            </div>
            <p className="mt-1 text-center text-[11px] font-black uppercase tracking-wide text-cream-100">
              {hud.band === "sweet" ? "release now" : hud.band === "over" ? "let go!" : "charging"}
            </p>
          </div>
        )}

        {hud.boosting && (
          <p className="absolute bottom-4 right-4 rounded-full bg-honey-400/90 px-3 py-1 text-xs font-black uppercase text-ink-900">
            Boost
          </p>
        )}

        {hud.countdown !== null && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="font-display text-8xl text-cream-50 drop-shadow-lg">
              {hud.countdown === 0 ? "GO!" : hud.countdown}
            </p>
          </div>
        )}

        {hud.wrongWay && (
          <p className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-blush-500/90 px-4 py-1.5 text-sm font-black uppercase text-cream-50">
            Wrong way
          </p>
        )}

        {hud.finalLap && hud.countdown === null && (
          <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-honey-400/90 px-4 py-1 text-xs font-black uppercase text-ink-900">
            Final lap
          </p>
        )}

        {hud.message && (
          <p className="absolute inset-x-0 bottom-16 text-center text-sm font-black text-cream-50">
            {hud.message}
          </p>
        )}

        {/* Minimap: the course centreline plus every kart. */}
        <Minimap course={course} />
      </div>

      <p className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-cream-200/50">
        WASD drive · Shift drift · Space boost/hop · R rear view
      </p>
    </div>
  );
}

/** Static course outline. Kart dots are drawn by the canvas overlay. */
function Minimap({ course }: { course: Course }) {
  const samples = 160;
  const points: Array<[number, number]> = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i <= samples; i += 1) {
    const p = sampleCourse(course, i / samples);
    points.push([p.x, p.z]);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const spanX = maxX - minX || 1;
  const spanZ = maxZ - minZ || 1;
  const path = points
    .map(([x, z], i) => `${i === 0 ? "M" : "L"}${((x - minX) / spanX) * 88 + 6},${((z - minZ) / spanZ) * 88 + 6}`)
    .join(" ");

  return (
    <svg className="absolute bottom-3 left-3 size-24 rounded-lg bg-ink-900/60" viewBox="0 0 100 100" aria-hidden="true">
      <path d={path} fill="none" stroke={`#${course.palette.accent.toString(16).padStart(6, "0")}`} strokeWidth={3} strokeLinejoin="round" />
    </svg>
  );
}

export { kartColor };
