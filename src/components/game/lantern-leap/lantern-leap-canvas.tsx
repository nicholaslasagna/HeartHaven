"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { LanternGame, type GameEvent } from "@/lib/game/lantern-leap/game";
import { levelById } from "@/lib/game/lantern-leap/levels";
import { LanternRenderer, type RenderSnapshot } from "@/lib/game/lantern-leap/renderer";
import type { PlayerInput } from "@/lib/game/lantern-leap/physics";

/**
 * Glue: owns the canvas, the input, and the frame loop. Rules live in
 * `LanternGame`, pixels live in `LanternRenderer`, and this file is the only
 * place that knows both exist.
 */

export type LanternLeapCanvasProps = {
  levelId: string;
  /** Stable id for the local player. */
  playerId: string;
  playerName: string;
  seatIndex: number;
  /** Remote players, fed in by the netcode layer. */
  remotes?: Array<{ id: string; name: string; seat: number; x: number; y: number; facing: 1 | -1; motion: string; bubbled: boolean }>;
  onLocalState?: (state: { x: number; y: number; facing: 1 | -1; motion: string; bubbled: boolean }) => void;
  onEvent?: (event: GameEvent) => void;
  onError?: (message: string) => void;
  paused?: boolean;
  /** Dev only: extra simulated keepers, to exercise 2-8 player co-op
      without needing that many signed-in browsers. Ignored in production. */
  devBots?: number;
};

const KEY_MAP: Record<string, keyof PlayerInput | "left" | "right"> = {
  arrowleft: "left", a: "left",
  arrowright: "right", d: "right",
  arrowup: "jump", w: "jump", " ": "jump",
  arrowdown: "duck", s: "duck",
  shift: "run",
};

export function LanternLeapCanvas({
  levelId,
  playerId,
  playerName,
  seatIndex,
  remotes,
  onLocalState,
  onEvent,
  onError,
  paused = false,
  devBots = 0,
}: LanternLeapCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const remotesRef = useRef(remotes);
  const callbacksRef = useRef({ onLocalState, onEvent });
  const pausedRef = useRef(paused);

  useEffect(() => { remotesRef.current = remotes; }, [remotes]);
  useEffect(() => { callbacksRef.current = { onLocalState, onEvent }; }, [onLocalState, onEvent]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      onError?.("Lantern Leap needs WebGL, and this browser refused to start it.");
      return;
    }

    let disposed = false;
    let game: LanternGame;
    let view: LanternRenderer;
    try {
      const level = levelById(levelId);
      game = new LanternGame(level);
      view = new LanternRenderer(level);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Lantern Leap could not build the level.");
      renderer.dispose();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    game.addPlayer(playerId, playerName, seatIndex, true);

    /* Simulated co-op partners. They run the same physics through the same
       code path as a real player, so what you see is genuinely the
       multiplayer sim — shared camera, shared pickups, bubbles and all —
       rather than a mock-up of it. */
    const bots: Array<{ id: string; input: PlayerInput; flip: number }> = [];
    if (process.env.NODE_ENV !== "production" && devBots > 0) {
      for (let i = 0; i < Math.min(devBots, 7); i += 1) {
        const id = `bot-${i}`;
        game.addPlayer(id, `Keeper ${i + 2}`, seatIndex + i + 1, true);
        bots.push({ id, input: { moveX: 1, jump: false, run: i % 2 === 0, duck: false, pound: false }, flip: 0 });
      }
    }
    const driveBots = (dt: number) => {
      for (const bot of bots) {
        const player = game.players.get(bot.id);
        if (!player) continue;
        bot.flip += dt;
        // Amble rightward, hop regularly, and turn around now and then so
        // the group spreads out and the shared camera has to work for it.
        bot.input.moveX = Math.sin(bot.flip * 0.35) > -0.6 ? 1 : -1;
        bot.input.jump = player.body.grounded && Math.sin(bot.flip * 2.3) > 0.55;
        game.setInput(bot.id, bot.input);
      }
    };

    /* -- input -- */
    const held = new Set<string>();
    const input: PlayerInput = { moveX: 0, jump: false, run: false, duck: false, pound: false };
    const readInput = () => {
      const left = held.has("left");
      const right = held.has("right");
      input.moveX = Number(right) - Number(left);
      input.jump = held.has("jump");
      input.run = held.has("run");
      input.duck = held.has("duck");
      // Down while airborne is a ground pound.
      input.pound = held.has("duck");
    };
    const isTyping = () => {
      const el = document.activeElement;
      if (!el) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping()) return;
      const action = KEY_MAP[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      held.add(action);
      readInput();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const action = KEY_MAP[event.key.toLowerCase()];
      if (!action) return;
      held.delete(action);
      readInput();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    /* -- sizing -- */
    let aspect = 16 / 9;
    const resize = () => {
      const width = mount.clientWidth || 960;
      const height = Math.max(360, Math.round(width * 0.5625));
      renderer.setSize(width, height, true);
      aspect = width / height;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    /* -- loop -- */
    let frame = 0;
    let last = performance.now();
    let broadcastTimer = 0;
    const snapshot: RenderSnapshot = {
      players: [], pickups: [], enemies: [], time: 0, camera: { x: 0, y: 0, zoom: 1 },
    };

    /* One frame of simulate-then-draw. Split out from the rAF callback so a
       dev harness can drive it at an exact dt — headless browsers report the
       page as hidden and throttle rAF to nothing, which would otherwise make
       the game impossible to screenshot or review. */
    const frameStep = (dt: number, simulate = true) => {
      if (simulate && !pausedRef.current) {
        game.setInput(playerId, input);
        driveBots(dt);
        // Remote players are positioned, not simulated: their own client is
        // authoritative over their body, exactly like HeartRush.
        for (const remote of remotesRef.current ?? []) {
          const player = game.addPlayer(remote.id, remote.name, remote.seat, false);
          player.body.x = remote.x;
          player.body.y = remote.y;
          player.body.facing = remote.facing;
          player.body.motion = remote.motion as typeof player.body.motion;
          player.bubbled = remote.bubbled;
        }
        game.advance(dt);
        for (const event of game.drainEvents()) callbacksRef.current.onEvent?.(event);
      }

      const camera = game.cameraFor(aspect, view.viewHeight);
      snapshot.time = game.time;
      snapshot.camera = camera;
      snapshot.players = [...game.players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        x: player.body.x,
        y: player.body.y,
        facing: player.body.facing,
        motion: player.body.motion,
        squash: player.squash,
        bubbled: player.bubbled,
        local: player.local,
      }));
      snapshot.pickups = game.pickups;
      snapshot.enemies = game.enemies;

      view.update(snapshot, aspect);
      renderer.render(view.scene, view.camera);

      broadcastTimer += dt;
      if (broadcastTimer >= 1 / 20) {
        broadcastTimer = 0;
        const me = game.players.get(playerId);
        if (me) {
          callbacksRef.current.onLocalState?.({
            x: Number(me.body.x.toFixed(2)),
            y: Number(me.body.y.toFixed(2)),
            facing: me.body.facing,
            motion: me.body.motion,
            bubbled: me.bubbled,
          });
        }
      }
    };

    const loop = () => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      frameStep(dt);
    };
    frame = requestAnimationFrame(loop);

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __lanternLeap?: unknown }).__lanternLeap = {
        game,
        view,
        /** Advance `seconds` of game time in 60Hz frames, then draw. */
        tick(seconds: number, hold: Partial<PlayerInput> = {}) {
          Object.assign(input, { moveX: 0, jump: false, run: false, duck: false, pound: false }, hold);
          const frames = Math.max(1, Math.round(seconds * 60));
          for (let i = 0; i < frames; i += 1) frameStep(1 / 60);
          return { x: +game.players.get(playerId)!.body.x.toFixed(2), y: +game.players.get(playerId)!.body.y.toFixed(2) };
        },
        /** Redraw without advancing, for screenshots. */
        draw() { frameStep(0, false); },
      };
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      view.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // Level and identity are fixed for the life of a mount; rebuilding the
    // scene on every prop tick would throw away the whole world each frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId, playerId, playerName, seatIndex, devBots]);

  return <div className="w-full overflow-hidden rounded-lg bg-[#1b1430]" ref={mountRef} />;
}
