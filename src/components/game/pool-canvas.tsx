"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { CircleDot, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  POOL_BALL_RADIUS,
  POOL_CANVAS_HEIGHT,
  POOL_CANVAS_WIDTH,
  POOL_MAX_SHOTS,
  POOL_OBJECT_BALL_COUNT,
  POOL_POCKETS,
  POOL_TABLE,
  clonePoolBalls,
  countRemainingObjectBalls,
  createInitialPoolBalls,
  getCueBall,
  launchCueBall,
  resetCueBall,
  scorePoolShot,
  stepPoolPhysics,
  type PoolBall,
  type PoolSessionMetadata,
  type PoolShotSummary,
} from "@/lib/game/pool-physics";
import { cn } from "@/lib/utils";

type PoolPhase = "ready" | "aiming" | "resolving" | "game-over";

type HudState = {
  phase: PoolPhase;
  score: number;
  shotsTaken: number;
  message: string;
  lastShot: string;
};

type DragState = {
  active: boolean;
  pointerId: number | null;
  x: number;
  y: number;
  power: number;
  direction: { x: number; y: number };
};

type ActiveShot = {
  angle: number;
  power: number;
} | null;

type SparkleEffect = {
  id: number;
  x: number;
  y: number;
  age: number;
  life: number;
  color: string;
  label?: string;
};

export type PoolSubmittedShot = {
  angle: number;
  power: number;
  settledBalls: PoolBall[];
  summary: PoolShotSummary;
};

type PoolCanvasProps = {
  roundKey: number;
  mode?: "solo" | "multiplayer";
  sessionState?: PoolSessionMetadata | null;
  mySeatIndex?: number | null;
  currentPlayerName?: string;
  submittingShot?: boolean;
  onSubmitShot?: (shot: PoolSubmittedShot) => Promise<{ ok: true } | { ok: false; reason: string }>;
  onRoundStart?: () => void;
  onGameOver?: (result: { score: number; shotsTaken: number; cleared: boolean }) => void;
};

const INITIAL_HUD: HudState = {
  phase: "ready",
  score: 0,
  shotsTaken: 0,
  message: "Drag back from the cue ball, aim, then release.",
  lastShot: "Power starts at zero. Pull farther for a stronger shot.",
};

const EMPTY_DRAG: DragState = {
  active: false,
  pointerId: null,
  x: 0,
  y: 0,
  power: 0,
  direction: { x: 1, y: 0 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function canonicalStateKey(state?: PoolSessionMetadata | null) {
  if (!state) return "solo";
  return JSON.stringify({
    balls: state.balls.map((ball) => ({
      id: ball.id,
      x: Math.round(ball.x * 10) / 10,
      y: Math.round(ball.y * 10) / 10,
      potted: ball.potted,
    })),
    currentSeat: state.currentSeat,
    scores: state.scores,
    shotNumber: state.shotNumber,
    shotsRemaining: state.shotsRemaining,
    gameOver: state.gameOver,
    finalScore: state.finalScore,
    lastShot: state.lastShot?.submittedAt ?? state.lastShot?.message ?? "",
  });
}

function canvasPoint(event: PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * POOL_CANVAS_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * POOL_CANVAS_HEIGHT,
  };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawTextWithShadow(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = "rgba(55, 38, 42, 0.18)";
  ctx.fillText(text, x + 1.5, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawPoolTable(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, POOL_CANVAS_WIDTH, POOL_CANVAS_HEIGHT);

  const room = ctx.createLinearGradient(0, 0, POOL_CANVAS_WIDTH, POOL_CANVAS_HEIGHT);
  room.addColorStop(0, "#fffaf0");
  room.addColorStop(0.55, "#fceef1");
  room.addColorStop(1, "#efe5fb");
  ctx.fillStyle = room;
  ctx.fillRect(0, 0, POOL_CANVAS_WIDTH, POOL_CANVAS_HEIGHT);

  for (let i = 0; i < 36; i += 1) {
    const x = 42 + ((i * 137) % 860);
    const y = 28 + ((i * 83) % 520);
    ctx.fillStyle = i % 3 === 0 ? "rgba(220,127,146,0.10)" : "rgba(146,116,201,0.08)";
    ctx.beginPath();
    ctx.ellipse(x, y, 2.5, 4.8, i * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const outer = POOL_TABLE.outer;
  ctx.save();
  ctx.shadowColor = "rgba(90, 57, 38, 0.23)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  const rail = ctx.createLinearGradient(outer.x, outer.y, outer.x, outer.y + outer.height);
  rail.addColorStop(0, "#f6dca2");
  rail.addColorStop(0.45, "#d39b42");
  rail.addColorStop(1, "#98642d");
  roundedRect(ctx, outer.x, outer.y, outer.width, outer.height, outer.radius);
  ctx.fillStyle = rail;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.62)";
  ctx.lineWidth = 5;
  roundedRect(ctx, outer.x + 9, outer.y + 9, outer.width - 18, outer.height - 18, outer.radius - 8);
  ctx.stroke();
  ctx.restore();

  const felt = POOL_TABLE.felt;
  const feltGradient = ctx.createLinearGradient(felt.x, felt.y, felt.x + felt.width, felt.y + felt.height);
  feltGradient.addColorStop(0, "#b8d9a2");
  feltGradient.addColorStop(0.42, "#85b978");
  feltGradient.addColorStop(1, "#5e965f");
  roundedRect(ctx, felt.x, felt.y, felt.width, felt.height, 30);
  ctx.fillStyle = feltGradient;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "#fff6d6";
  ctx.lineWidth = 1;
  for (let x = felt.x + 34; x < felt.x + felt.width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, felt.y + 18);
    ctx.lineTo(x - 70, felt.y + felt.height - 18);
    ctx.stroke();
  }
  ctx.restore();

  for (const pocket of POOL_POCKETS) {
    const glow = ctx.createRadialGradient(pocket.x, pocket.y, 8, pocket.x, pocket.y, pocket.radius + 14);
    glow.addColorStop(0, "rgba(55, 39, 48, 0.92)");
    glow.addColorStop(0.6, "rgba(55, 39, 48, 0.86)");
    glow.addColorStop(1, "rgba(244, 213, 150, 0.1)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pocket.x, pocket.y, pocket.radius + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  drawTextWithShadow(ctx, "Moonberry Pool", 58, 40, "700 24px serif", "#4a3638");
}

function drawBall(ctx: CanvasRenderingContext2D, ball: PoolBall) {
  if (ball.potted) return;
  ctx.save();
  ctx.shadowColor = "rgba(53, 37, 31, 0.24)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = "rgba(58, 42, 35, 0.16)";
  ctx.beginPath();
  ctx.ellipse(ball.x + 3, ball.y + ball.radius + 5, ball.radius * 0.95, ball.radius * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  const gradient = ctx.createRadialGradient(
    ball.x - ball.radius * 0.35,
    ball.y - ball.radius * 0.4,
    ball.radius * 0.18,
    ball.x,
    ball.y,
    ball.radius * 1.2,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.24, ball.kind === "cue" ? "#fffdf7" : "#fff1d6");
  gradient.addColorStop(0.5, ball.color);
  gradient.addColorStop(1, "#34262c");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  if (ball.stripe) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = ball.stripe;
    ctx.fillRect(ball.x - ball.radius, ball.y - 4, ball.radius * 2, 8);
    ctx.restore();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (ball.number) {
    ctx.fillStyle = "rgba(255, 252, 241, 0.92)";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 6.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4a3638";
    ctx.font = "800 8px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(ball.number), ball.x, ball.y + 0.5);
  }
  ctx.restore();
}

function drawAimGuide(ctx: CanvasRenderingContext2D, cue: PoolBall, drag: DragState) {
  ctx.save();
  const power = drag.active ? drag.power : 0;
  const direction = drag.active ? drag.direction : { x: 1, y: 0 };
  const lineLength = 140 + power * 230;
  const endX = cue.x + direction.x * lineLength;
  const endY = cue.y + direction.y * lineLength;

  ctx.setLineDash([10, 9]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = drag.active ? "rgba(255, 246, 212, 0.92)" : "rgba(255, 246, 212, 0.38)";
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = drag.active ? "rgba(255, 246, 212, 0.94)" : "rgba(255, 246, 212, 0.38)";
  ctx.beginPath();
  ctx.arc(endX, endY, 5 + power * 5, 0, Math.PI * 2);
  ctx.fill();

  if (drag.active) {
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(125, 78, 47, 0.86)";
    ctx.beginPath();
    ctx.moveTo(cue.x - direction.x * 24, cue.y - direction.y * 24);
    ctx.lineTo(drag.x, drag.y);
    ctx.stroke();

    const meterWidth = 190;
    const meterX = POOL_TABLE.felt.x + POOL_TABLE.felt.width - meterWidth - 24;
    const meterY = POOL_TABLE.felt.y + POOL_TABLE.felt.height - 32;
    roundedRect(ctx, meterX, meterY, meterWidth, 14, 8);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fill();
    roundedRect(ctx, meterX, meterY, meterWidth * power, 14, 8);
    const meter = ctx.createLinearGradient(meterX, meterY, meterX + meterWidth, meterY);
    meter.addColorStop(0, "#d9a53e");
    meter.addColorStop(0.6, "#df8094");
    meter.addColorStop(1, "#9274c9");
    ctx.fillStyle = meter;
    ctx.fill();
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.68)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cue.x, cue.y, cue.radius + 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSparkles(ctx: CanvasRenderingContext2D, effects: SparkleEffect[]) {
  for (const effect of effects) {
    const progress = clamp(effect.age / effect.life, 0, 1);
    const alpha = 1 - progress;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(effect.x, effect.y - progress * 24);
    ctx.fillStyle = effect.color;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      const radius = i % 2 === 0 ? 12 * (1 - progress * 0.35) : 4;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    if (effect.label) {
      ctx.font = "900 14px sans-serif";
      ctx.fillStyle = "#fffaf0";
      ctx.textAlign = "center";
      ctx.fillText(effect.label, 0, -17);
    }
    ctx.restore();
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  balls: PoolBall[],
  drag: DragState,
  effects: SparkleEffect[],
  phase: PoolPhase,
  canAim: boolean,
) {
  drawPoolTable(ctx);
  const cue = getCueBall(balls);
  if (canAim && cue && !cue.potted && phase !== "resolving" && phase !== "game-over") {
    drawAimGuide(ctx, cue, drag);
  }
  balls.forEach((ball) => drawBall(ctx, ball));
  drawSparkles(ctx, effects);
}

export function PoolCanvas({
  roundKey,
  mode = "solo",
  sessionState,
  mySeatIndex = null,
  currentPlayerName = "partner",
  submittingShot = false,
  onSubmitShot,
  onGameOver,
  onRoundStart,
}: PoolCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ballsRef = useRef<PoolBall[]>(createInitialPoolBalls());
  const dragRef = useRef<DragState>(EMPTY_DRAG);
  const activeShotRef = useRef<ActiveShot>(null);
  const pottedThisShotRef = useRef<Set<string>>(new Set());
  const scratchedThisShotRef = useRef(false);
  const settleFramesRef = useRef(0);
  const sparkleIdRef = useRef(0);
  const effectsRef = useRef<SparkleEffect[]>([]);
  const reportedGameOverRef = useRef(false);
  const lastCanonicalKeyRef = useRef<string | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const hudRef = useRef<HudState>(INITIAL_HUD);
  const [remainingBalls, setRemainingBalls] = useState(POOL_OBJECT_BALL_COUNT);
  const [powerPreview, setPowerPreview] = useState(0);
  const isMultiplayer = mode === "multiplayer";
  const canonicalKey = useMemo(() => canonicalStateKey(sessionState), [sessionState]);
  const isMyTurn = Boolean(
    isMultiplayer && sessionState && mySeatIndex !== null && sessionState.currentSeat === mySeatIndex,
  );
  const canShoot =
    !submittingShot &&
    hud.phase !== "resolving" &&
    hud.phase !== "game-over" &&
    (!isMultiplayer || (isMyTurn && !sessionState?.gameOver));

  const commitHud = useCallback((next: HudState) => {
    hudRef.current = next;
    setHud(next);
  }, []);

  const resetRound = useCallback(() => {
    if (isMultiplayer) return;
    ballsRef.current = createInitialPoolBalls();
    dragRef.current = EMPTY_DRAG;
    activeShotRef.current = null;
    pottedThisShotRef.current = new Set();
    scratchedThisShotRef.current = false;
    settleFramesRef.current = 0;
    effectsRef.current = [];
    reportedGameOverRef.current = false;
    setRemainingBalls(countRemainingObjectBalls(ballsRef.current));
    setPowerPreview(0);
    commitHud(INITIAL_HUD);
    onRoundStart?.();
  }, [commitHud, isMultiplayer, onRoundStart]);

  useEffect(() => {
    if (!isMultiplayer) resetRound();
  }, [isMultiplayer, roundKey, resetRound]);

  useEffect(() => {
    if (!isMultiplayer || !sessionState) return;
    if (lastCanonicalKeyRef.current === canonicalKey) return;
    lastCanonicalKeyRef.current = canonicalKey;

    ballsRef.current = clonePoolBalls(sessionState.balls);
    dragRef.current = EMPTY_DRAG;
    activeShotRef.current = null;
    pottedThisShotRef.current = new Set();
    scratchedThisShotRef.current = false;
    settleFramesRef.current = 0;
    setPowerPreview(0);
    setRemainingBalls(countRemainingObjectBalls(ballsRef.current));

    const score = mySeatIndex === null ? Math.max(...sessionState.scores, 0) : (sessionState.scores[mySeatIndex] ?? 0);
    const lastShot = sessionState.lastShot?.message
      || (isMyTurn ? "Your turn. Drag from the cue ball to shoot." : `Waiting for ${currentPlayerName}.`);
    commitHud({
      phase: sessionState.gameOver ? "game-over" : "ready",
      score,
      shotsTaken: sessionState.shotNumber,
      message: sessionState.gameOver
        ? "Shared table complete. Claim your reward when ready."
        : isMyTurn
          ? "Your turn. Aim and choose power."
          : `Waiting for ${currentPlayerName} to shoot.`,
      lastShot,
    });
  }, [canonicalKey, commitHud, currentPlayerName, isMultiplayer, isMyTurn, mySeatIndex, sessionState]);

  const addSparkle = useCallback((x: number, y: number, color: string, label?: string) => {
    sparkleIdRef.current += 1;
    effectsRef.current.push({
      id: sparkleIdRef.current,
      x,
      y,
      age: 0,
      life: 0.9,
      color,
      label,
    });
  }, []);

  const finishShot = useCallback(() => {
    const current = hudRef.current;
    const pottedIds = [...pottedThisShotRef.current];
    const pottedObjectCount = pottedIds.filter((id) => id !== "cue").length;
    const scratched = scratchedThisShotRef.current;
    const nextShotsTaken = current.shotsTaken + 1;
    const remainingAfterShot = countRemainingObjectBalls(ballsRef.current);
    const allCleared = remainingAfterShot === 0;
    const shotsLeftAfterShot = isMultiplayer && sessionState
      ? Math.max(0, sessionState.shotsRemaining - 1)
      : POOL_MAX_SHOTS - nextShotsTaken;
    const scoreDetails = scorePoolShot({
      pottedObjectCount,
      scratched,
      allCleared,
      shotsLeftAfterShot,
    });
    const nextScore = Math.max(0, current.score + scoreDetails.scoreDelta);

    if (scratched) {
      resetCueBall(ballsRef.current);
      addSparkle(POOL_TABLE.felt.x + 74, POOL_TABLE.felt.y + 60, "#df8094", "Scratch");
    }

    const gameOver = allCleared || shotsLeftAfterShot <= 0;
    const message = gameOver
      ? allCleared
        ? "Table cleared. Claim your cozy reward."
        : "Round complete. Claim your cozy reward."
      : pottedObjectCount > 1
        ? "Combo pocket! Line up the next shot."
        : pottedObjectCount === 1
          ? "Nice pocket. Take the next shot."
          : scratched
            ? "Scratch. Cue ball reset for your next shot."
            : "Balls settled. Try a softer angle or bank shot.";

    const lastShot = [
      pottedObjectCount > 0 ? `+${pottedObjectCount * 100} potted` : "No object balls potted",
      scoreDetails.comboBonus > 0 ? `+${scoreDetails.comboBonus} combo` : null,
      scoreDetails.finalBonus > 0 ? `+${scoreDetails.finalBonus} clear bonus` : null,
      scoreDetails.scratchPenalty > 0 ? `-${scoreDetails.scratchPenalty} scratch` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const summary: PoolShotSummary = {
      ...scoreDetails,
      pottedIds,
      scratched,
      allCleared,
      shotsTaken: nextShotsTaken,
    };

    if (isMultiplayer) {
      const activeShot = activeShotRef.current;
      if (activeShot && onSubmitShot) {
        const settledBalls = clonePoolBalls(ballsRef.current).map((ball) => ({ ...ball, vx: 0, vy: 0 }));
        commitHud({
          phase: "resolving",
          score: nextScore,
          shotsTaken: nextShotsTaken,
          message: "Saving the shared table...",
          lastShot,
        });
        setRemainingBalls(remainingAfterShot);
        setPowerPreview(0);
        pottedThisShotRef.current = new Set();
        scratchedThisShotRef.current = false;
        settleFramesRef.current = 0;

        void onSubmitShot({
          angle: activeShot.angle,
          power: activeShot.power,
          settledBalls,
          summary,
        }).then((result) => {
          if (!result.ok) {
            commitHud({
              phase: "ready",
              score: current.score,
              shotsTaken: current.shotsTaken,
              message: result.reason || "That shared shot could not be saved.",
              lastShot: "The table will resync from the latest server state.",
            });
          }
        });
      }
      activeShotRef.current = null;
      return;
    }

    commitHud({
      phase: gameOver ? "game-over" : "ready",
      score: nextScore,
      shotsTaken: nextShotsTaken,
      message,
      lastShot,
    });
    setRemainingBalls(remainingAfterShot);
    setPowerPreview(0);
    pottedThisShotRef.current = new Set();
    scratchedThisShotRef.current = false;
    settleFramesRef.current = 0;

    if (gameOver && !reportedGameOverRef.current) {
      reportedGameOverRef.current = true;
      onGameOver?.({ score: nextScore, shotsTaken: nextShotsTaken, cleared: allCleared });
    }
  }, [addSparkle, commitHud, isMultiplayer, onGameOver, onSubmitShot, sessionState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let animationFrame = 0;
    let previous = performance.now();

    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.floor(POOL_CANVAS_WIDTH * dpr);
      const targetHeight = Math.floor(POOL_CANVAS_HEIGHT * dpr);
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const dt = Math.min(0.05, (time - previous) / 1000);
      previous = time;
      effectsRef.current = effectsRef.current
        .map((effect) => ({ ...effect, age: effect.age + dt }))
        .filter((effect) => effect.age <= effect.life);

      if (hudRef.current.phase === "resolving") {
        const result = stepPoolPhysics(ballsRef.current, dt);
        for (const id of result.pottedIds) {
          if (!pottedThisShotRef.current.has(id)) {
            const pottedBall = ballsRef.current.find((ball) => ball.id === id);
            addSparkle(pottedBall?.x ?? POOL_CANVAS_WIDTH / 2, pottedBall?.y ?? POOL_CANVAS_HEIGHT / 2, id === "cue" ? "#df8094" : "#f6d98e", id === "cue" ? "Foul" : "+100");
          }
          pottedThisShotRef.current.add(id);
        }
        if (result.scratched) scratchedThisShotRef.current = true;

        if (result.moving) {
          settleFramesRef.current = 0;
        } else {
          settleFramesRef.current += 1;
          if (settleFramesRef.current >= 10) {
            finishShot();
          }
        }
      }

      drawFrame(ctx, ballsRef.current, dragRef.current, effectsRef.current, hudRef.current.phase, canShoot);
      animationFrame = window.requestAnimationFrame(draw);
    };

    animationFrame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [addSparkle, canShoot, finishShot]);

  const updateDrag = useCallback((point: { x: number; y: number }) => {
    const cue = getCueBall(ballsRef.current);
    const dx = cue.x - point.x;
    const dy = cue.y - point.y;
    const distance = Math.hypot(dx, dy);
    const power = clamp((distance - 8) / 190, 0, 1);
    const direction = distance > 0 ? { x: dx / distance, y: dy / distance } : dragRef.current.direction;
    dragRef.current = {
      ...dragRef.current,
      x: point.x,
      y: point.y,
      power,
      direction,
    };
    setPowerPreview(power);
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!canShoot) {
        if (isMultiplayer && !sessionState?.gameOver) {
          commitHud({
            ...hudRef.current,
            message: `Waiting for ${currentPlayerName} to finish the turn.`,
          });
        }
        return;
      }
      if (hudRef.current.phase === "resolving" || hudRef.current.phase === "game-over") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = canvasPoint(event, canvas);
      const felt = POOL_TABLE.felt;
      if (
        point.x < felt.x - 20 ||
        point.x > felt.x + felt.width + 20 ||
        point.y < felt.y - 20 ||
        point.y > felt.y + felt.height + 20
      ) {
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        x: point.x,
        y: point.y,
        power: 0,
        direction: dragRef.current.direction,
      };
      updateDrag(point);
      commitHud({ ...hudRef.current, phase: "aiming", message: "Release to send the cue ball." });
    },
    [canShoot, commitHud, currentPlayerName, isMultiplayer, sessionState?.gameOver, updateDrag],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !dragRef.current.active || dragRef.current.pointerId !== event.pointerId) return;
      updateDrag(canvasPoint(event, canvas));
    },
    [updateDrag],
  );

  const cancelDrag = useCallback(() => {
    dragRef.current = EMPTY_DRAG;
    activeShotRef.current = null;
    setPowerPreview(0);
    commitHud({ ...hudRef.current, phase: "ready", message: "Drag back from the cue ball, aim, then release." });
  }, [commitHud]);

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !dragRef.current.active || dragRef.current.pointerId !== event.pointerId) return;
      canvas.releasePointerCapture(event.pointerId);
      const shot = dragRef.current;
      dragRef.current = EMPTY_DRAG;
      setPowerPreview(0);
      if (shot.power < 0.08) {
        cancelDrag();
        return;
      }
      pottedThisShotRef.current = new Set();
      scratchedThisShotRef.current = false;
      settleFramesRef.current = 0;
      activeShotRef.current = {
        angle: Math.atan2(shot.direction.y, shot.direction.x),
        power: shot.power,
      };
      launchCueBall(ballsRef.current, shot.direction, shot.power);
      commitHud({
        ...hudRef.current,
        phase: "resolving",
        message: "Shot rolling — wait for the balls to settle.",
        lastShot: `Power ${Math.round(shot.power * 100)}%`,
      });
    },
    [cancelDrag, commitHud],
  );

  const onPointerCancel = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas && dragRef.current.pointerId === event.pointerId) {
        canvas.releasePointerCapture(event.pointerId);
      }
      cancelDrag();
    },
    [cancelDrag],
  );

  const shotsLeft = isMultiplayer && sessionState
    ? Math.max(0, sessionState.shotsRemaining)
    : Math.max(0, POOL_MAX_SHOTS - hud.shotsTaken);
  const showDebug =
    process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEBUG_MULTIPLAYER === "true";

  return (
    <section className="grid gap-4 rounded-2xl border border-garden-300/45 bg-white/82 p-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="overflow-hidden rounded-2xl border border-honey-500/30 bg-cream-50 shadow-inner">
        <canvas
          aria-label="Moonberry Pool table"
          className="block aspect-[48/29] w-full touch-none select-none"
          onPointerCancel={onPointerCancel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          ref={canvasRef}
          role="img"
        />
      </div>

      <aside className="grid content-start gap-3">
        <div className="rounded-xl border border-cream-300 bg-cream-50/85 p-4">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-garden-700">
            <CircleDot className="size-3.5" /> Table score
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-white/80 p-2">
              <p className="text-[10px] font-black uppercase text-ink-500">Score</p>
              <p className="font-display text-2xl text-ink-900">{hud.score}</p>
            </div>
            <div className="rounded-lg bg-white/80 p-2">
              <p className="text-[10px] font-black uppercase text-ink-500">Shots</p>
              <p className="font-display text-2xl text-ink-900">{shotsLeft}</p>
            </div>
            <div className="rounded-lg bg-white/80 p-2">
              <p className="text-[10px] font-black uppercase text-ink-500">Balls</p>
              <p className="font-display text-2xl text-ink-900">{remainingBalls}</p>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "rounded-xl border p-4 text-sm font-bold leading-5",
            hud.phase === "game-over"
              ? "border-honey-500/40 bg-honey-100/70 text-honey-900"
              : hud.phase === "resolving"
                ? "border-lavender-300/50 bg-lavender-100/70 text-lavender-900"
                : "border-garden-300/50 bg-garden-100/60 text-garden-900",
          )}
        >
          <p className="text-xs font-black uppercase tracking-normal opacity-75">
            {hud.phase === "aiming" ? "Aiming" : hud.phase === "resolving" ? "Balls settling" : hud.phase === "game-over" ? "Round complete" : "Ready"}
          </p>
          <p className="mt-1">{hud.message}</p>
          <p className="mt-2 text-xs text-ink-600">{hud.lastShot}</p>
        </div>

        <div className="rounded-xl border border-blush-300/45 bg-blush-100/55 p-4">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-normal text-blush-600">
            <Sparkles className="size-3.5" /> Power
          </p>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/90">
            <div
              className="h-full rounded-full bg-gradient-to-r from-honey-500 via-blush-500 to-lavender-500 transition-[width]"
              style={{ width: `${Math.round(powerPreview * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs font-bold text-ink-600">
            Drag backward from the cue ball. Release after choosing a power.
          </p>
        </div>

        {!isMultiplayer && (
          <Button onClick={resetRound} type="button" variant="secondary">
            <RotateCcw /> Rack again
          </Button>
        )}

        {showDebug && (
          <pre className="max-h-40 overflow-auto rounded-lg bg-ink-900 p-3 text-[10px] font-bold text-cream-50">
            {JSON.stringify(
              {
                phase: hud.phase,
                power: Number(powerPreview.toFixed(2)),
                remainingBalls,
                mode,
                mySeatIndex,
                currentSeat: sessionState?.currentSeat,
                shotNumber: sessionState?.shotNumber,
              },
              null,
              2,
            )}
          </pre>
        )}
      </aside>
    </section>
  );
}
