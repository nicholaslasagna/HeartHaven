"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MoonberryRacingRenderer, kartColor, type KartView, type RacingSnapshot } from "@/lib/game/moonberry-racing/renderer";
import { KART, NO_KART_INPUT, applyBoostPad, chargeBand, stepKart, type KartInput } from "@/lib/game/moonberry-racing/kart";
import { Race, type RacerReport } from "@/lib/game/moonberry-racing/race";
import { Arena, type CombatRacer } from "@/lib/game/moonberry-racing/combat";
import type { PowerUp, PowerUpId } from "@/lib/game/moonberry-racing/powerups";
import { sampleCourse, surfaceAt, VERGE_LIMIT, type Course } from "@/lib/game/moonberry-racing/track";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { cn } from "@/lib/utils";

/**
 * Item traffic. Poses are fire-and-forget, but a pickup or a use changes
 * state every client must agree on, so these carry the pose they happened at
 * rather than letting each machine guess from a stale copy.
 */
export type ItemEvent =
  | { kind: "pickup"; racerId: string; box: number; item: PowerUpId; at: number }
  | { kind: "use"; racerId: string; item: PowerUpId; x: number; z: number; heading: number };

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
  /** Item pickups and uses, which must replicate or multiplayer items desync. */
  onItemEvent?: (event: ItemEvent) => void;
  subscribeItems?: (handler: (event: ItemEvent) => void) => () => void;
  onFinish?: (ms: number, position: number) => void;
  onError?: (message: string) => void;
  /** Lobby setting: crates and items off for a clean race. */
  itemsEnabled?: boolean;
};

const REPORT_HZ = 20;

/** Nearest crate to a position, so a pickup can name which one it took. */
function crateIndexFor(course: Course, x: number, z: number) {
  let best = 0;
  let bestDistance = Infinity;
  course.itemBoxes.forEach((box, index) => {
    const at = sampleCourse(course, box.t);
    const distance = Math.hypot(x - at.x, z - at.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

export function MoonberryRacingCanvas({
  course,
  seats,
  localId,
  isHost,
  startAt,
  onReport,
  subscribeRemote,
  onItemEvent,
  subscribeItems,
  onFinish,
  onError,
  itemsEnabled = true,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const startAtRef = useRef(startAt);
  const callbacksRef = useRef({ onReport, onFinish, onItemEvent });
  const [hud, setHud] = useState({
    position: 1, field: seats.length, lap: 1, laps: course.laps,
    timeMs: 0, charge: 0, band: "none" as string, boosting: false,
    countdown: null as number | null, wrongWay: false, finalLap: false,
    item: null as string | null, itemColor: null as string | null, message: "",
    chain: 0,
    blips: [] as Array<{ id: string; x: number; z: number; seat: number; local: boolean }>,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { startAtRef.current = startAt; }, [startAt]);
  useEffect(() => {
    callbacksRef.current = { onReport, onFinish, onItemEvent };
  }, [onReport, onFinish, onItemEvent]);

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
    let arena: Arena;
    try {
      renderer = new MoonberryRacingRenderer(course);
      race = new Race(course, isHost);
      arena = new Arena(course, itemsEnabled);
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

    const unsubscribeItems = subscribeItems?.((event) => {
      // Our own events already applied locally; replaying them would double up.
      if (event.racerId === localId) return;
      const racer = race.racers.get(event.racerId) as CombatRacer | undefined;
      if (event.kind === "pickup") arena.applyRemotePickup(racer, event.box, event.item, event.at);
      else arena.applyRemoteUse(racer, event.racerId, event.item, event);
    });

    /* -- input -- */
    const held = new Set<string>();
    const input: KartInput = { ...NO_KART_INPUT };
    let rearView = false;
    const readInput = () => {
      const left = held.has("a") || held.has("arrowleft");
      const right = held.has("d") || held.has("arrowright");
      /* Left is POSITIVE steer, which looks backwards until you follow it
         through. The simulation turns toward world +X as heading increases,
         and the chase camera puts world +X on the LEFT of the screen — so
         positive steer is a left turn on screen. The physics convention is
         self-consistent and the autopilot depends on it, so the translation
         from "player pressed D" to a steer value belongs here, at the input
         boundary, rather than by flipping a sign inside stepKart. */
      input.steer = Number(left) - Number(right);
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

    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let reportTimer = 0;
    let hudTimer = 0;
    let surfaceHint: number | undefined;
    let reportedFinish = false;
    let lastPadIndex = -1;
    let itemHeld = false;
    let heldItem: PowerUp | null = null;
    let lastLap = 0;
    let lastCountdownTick = -1;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Adopt the host's start stamp so every client counts down together.
      const shared = startAtRef.current;
      if (shared !== null && race.startAt !== shared) race.adoptStart(shared);
      race.tick(Date.now(), dt);

      if (race.phase === "countdown" && race.startAt !== null) {
        const tick = Math.max(0, Math.ceil((race.startAt - Date.now()) / 1000));
        if (tick !== lastCountdownTick) {
          lastCountdownTick = tick;
          playCozyCue(tick === 0 ? "lightsOut" : "countdown");
        }
      }

      const me = race.racers.get(localId);
      const racing = race.phase === "racing";

      if (me && !me.spectator) {
        // Fixed-step the local kart so handling is identical at any frame rate.
        accumulator += dt;
        let steps = 0;
        while (accumulator >= KART.STEP && steps < 20) {
          accumulator -= KART.STEP;
          steps += 1;
          const surface = surfaceAt(course, me.kart.x, me.kart.z, surfaceHint, me.kart.y);
          surfaceHint = surface.t;
          const wasDrifting = me.kart.driftSide !== 0;
          stepKart(
            me.kart,
            racing && !me.finishedAt ? input : NO_KART_INPUT,
            surface,
            KART.STEP,
            Arena.speedFactor(me),
          );

          /* Audio is driven off the physics events rather than the input, so
             what you hear is what actually happened to the kart. */
          for (const event of me.kart.events) {
            if (event === "boost-sweet") playCozyCue("boost");
            else if (event === "boost-early") playCozyCue("boostFail");
            else if (event === "spinout") playCozyCue("spinout");
            else if (event === "land") playCozyCue("landing");
            else if (event === "collide") playCozyCue("bump");
            else if (event === "pad") playCozyCue("boost");
            // Landing a real jump pays a boost, so it should sound like one.
            else if (event === "air-boost") playCozyCue("boost");
          }
          // A scrub loop would retrigger every step, so throttle it.
          if (me.kart.driftSide !== 0 && !wasDrifting) playCozyCue("drift");

          if (racing) {
            // Fire on the rising edge only, so holding the key is one use.
            if (input.item && !itemHeld && me.item) {
              const fired = arena.useItem(me as CombatRacer, []);
              if (fired) {
                callbacksRef.current.onItemEvent?.({
                  kind: "use",
                  racerId: localId,
                  item: fired.item,
                  x: fired.pose.x,
                  z: fired.pose.z,
                  heading: fired.pose.heading,
                });
              }
            }
            itemHeld = input.item;

            const combatants = [...race.racers.values()] as CombatRacer[];
            for (const event of arena.step(combatants, race.raceTime, KART.STEP)) {
              if (event.type === "hazard" && event.racerId === localId) playCozyCue("spinout");
              if (event.racerId !== localId) continue;
              if (event.type === "used") playCozyCue("itemUse");
              if (event.type === "hit") playCozyCue("bump");
              // A shield eating a hit is a win, and needs to sound unlike one.
              if (event.type === "blocked") playCozyCue("combo");
              if (event.type === "pickup") {
                heldItem = me.item;
                playCozyCue("itemGet");
                // Tell everyone which crate went, so it hides on their screen too.
                callbacksRef.current.onItemEvent?.({
                  kind: "pickup",
                  racerId: localId,
                  box: crateIndexFor(course, me.kart.x, me.kart.z),
                  item: event.item,
                  at: race.raceTime,
                });
              }
              if (event.type === "used") heldItem = null;
            }
          }

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

        if (racing) race.advanceProgress(me);

        if (me.progress.lap > lastLap) {
          lastLap = me.progress.lap;
          // The final lap gets its own fanfare; earlier laps a checkpoint ping.
          playCozyCue(me.progress.lap === course.laps - 1 ? "finalLap" : "checkpoint");
        }

        if (me.finishedAt !== null && !reportedFinish) {
          reportedFinish = true;
          playCozyCue("finish");
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
        itemBoxesTaken: arena.takenBoxes(race.raceTime),
        shots: [
          ...arena.projectiles.map((shot) => ({ id: shot.id, kind: shot.kind, x: shot.x, z: shot.z, trap: false })),
          ...arena.traps.map((trap) => ({ id: trap.id, kind: trap.kind, x: trap.x, z: trap.z, trap: true })),
        ],
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
          band: chargeBand(me?.kart.driftCharge ?? 0, me?.kart.driftChain ?? 0),
          chain: me?.kart.driftChain ?? 0,
          boosting: (me?.kart.boostTimer ?? 0) > 0,
          countdown,
          wrongWay: Boolean(me?.progress.wrongWay),
          finalLap: (me?.progress.lap ?? 0) === course.laps - 1,
          blips: karts.map((k) => ({ id: k.id, x: k.x, z: k.z, seat: k.seat, local: k.local })),
          item: heldItem?.name ?? null,
          itemColor: heldItem ? `#${heldItem.color.toString(16).padStart(6, "0")}` : null,
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
      unsubscribeItems?.();
      arena.dispose();
      renderer.dispose();
      webgl.dispose();
      if (webgl.domElement.parentNode === mount) mount.removeChild(webgl.domElement);
    };
    // Rebuilt only when the course or the field changes; per-frame data
    // arrives through refs so this never tears down mid-race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, seatsKey, localId, isHost, itemsEnabled]);

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
            <p className="mt-1 flex items-center justify-center gap-2 text-[11px] font-black uppercase tracking-wide text-cream-100">
              <span>{hud.band === "sweet" ? "release now" : hud.band === "over" ? "let go!" : "charging"}</span>
              {/* Pips for the chain: three links per slide, each stronger. */}
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    className={cn("block size-1.5 rounded-full", i < hud.chain ? "bg-honey-300" : "bg-cream-100/30")}
                    key={i}
                  />
                ))}
              </span>
            </p>
          </div>
        )}

        {/* Held item: colour and name, so it is identifiable at a glance. */}
        {hud.item && (
          <div
            className="absolute right-3 top-24 rounded-lg border-2 bg-ink-900/75 px-3 py-1.5 text-center"
            style={{ borderColor: hud.itemColor ?? "#fff" }}
          >
            <p className="text-[10px] font-black uppercase tracking-wide text-cream-200/80">Item · E</p>
            <p className="text-xs font-black" style={{ color: hud.itemColor ?? "#fff" }}>{hud.item}</p>
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
        <Minimap blips={hud.blips} course={course} />
      </div>

      <p className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-cream-200/50">
        WASD drive · Shift drift · Space boost/hop · R rear view
      </p>
    </div>
  );
}

/** Course outline with a live dot per kart, so the field is readable. */
function Minimap({
  blips,
  course,
}: {
  blips: Array<{ id: string; x: number; z: number; seat: number; local: boolean }>;
  course: Course;
}) {
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
  // Uniform scale on both axes, or a long circuit would be squashed into a
  // square and stop resembling the track you are driving.
  const scale = 88 / Math.max(spanX, spanZ);
  const offsetX = 6 + (88 - spanX * scale) / 2;
  const offsetZ = 6 + (88 - spanZ * scale) / 2;
  const toMap = (x: number, z: number) => [
    (x - minX) * scale + offsetX,
    (z - minZ) * scale + offsetZ,
  ] as const;

  const path = points
    .map(([x, z], i) => {
      const [mx, mz] = toMap(x, z);
      return `${i === 0 ? "M" : "L"}${mx.toFixed(1)},${mz.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="absolute bottom-3 left-3 size-28 rounded-lg bg-ink-900/65" viewBox="0 0 100 100" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={`#${course.palette.accent.toString(16).padStart(6, "0")}`}
        strokeWidth={3}
        strokeLinejoin="round"
        opacity={0.85}
      />
      {blips.map((blip) => {
        const [mx, mz] = toMap(blip.x, blip.z);
        const colour = `#${kartColor(blip.seat).toString(16).padStart(6, "0")}`;
        return (
          <circle
            cx={mx}
            cy={mz}
            fill={colour}
            key={blip.id}
            // The local racer reads larger and outlined, so you can find
            // yourself instantly in an eight-kart field.
            r={blip.local ? 4 : 2.8}
            stroke={blip.local ? "#fffaf0" : "none"}
            strokeWidth={blip.local ? 1.4 : 0}
          />
        );
      })}
    </svg>
  );
}

export { kartColor };
