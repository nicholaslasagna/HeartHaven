export type PoolBallKind = "cue" | "object";

export type PoolBall = {
  id: string;
  kind: PoolBallKind;
  number: number | null;
  label: string;
  color: string;
  stripe?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  potted: boolean;
};

export type PoolPocket = {
  id: string;
  x: number;
  y: number;
  radius: number;
};

export type PoolStepResult = {
  pottedIds: string[];
  scratched: boolean;
  moving: boolean;
};

export type PoolShotScore = {
  scoreDelta: number;
  comboBonus: number;
  scratchPenalty: number;
  pottedObjectCount: number;
  finalBonus: number;
};

export type PoolShotSummary = PoolShotScore & {
  pottedIds: string[];
  scratched: boolean;
  allCleared: boolean;
  shotsTaken: number;
};

export type PoolSessionMetadata = {
  balls: PoolBall[];
  currentSeat: number;
  scores: number[];
  shotNumber: number;
  shotsRemaining: number;
  gameOver: boolean;
  finalScore: number;
  lastShot?: {
    seat: number;
    angle: number;
    power: number;
    pottedIds: string[];
    scratched: boolean;
    scoreDelta: number;
    message: string;
    submittedAt?: string;
  };
};

export const POOL_CANVAS_WIDTH = 960;
export const POOL_CANVAS_HEIGHT = 580;
export const POOL_MAX_SHOTS = 12;
export const POOL_BALL_RADIUS = 12;
export const POOL_CUE_START = { x: 270, y: 290 };
export const POOL_TABLE = {
  outer: { x: 30, y: 42, width: 900, height: 484, radius: 38 },
  felt: { x: 88, y: 96, width: 784, height: 376 },
};

export const POOL_POCKETS: PoolPocket[] = [
  { id: "top-left", x: POOL_TABLE.felt.x, y: POOL_TABLE.felt.y, radius: 27 },
  { id: "top-mid", x: POOL_TABLE.felt.x + POOL_TABLE.felt.width / 2, y: POOL_TABLE.felt.y - 2, radius: 25 },
  { id: "top-right", x: POOL_TABLE.felt.x + POOL_TABLE.felt.width, y: POOL_TABLE.felt.y, radius: 27 },
  { id: "bottom-left", x: POOL_TABLE.felt.x, y: POOL_TABLE.felt.y + POOL_TABLE.felt.height, radius: 27 },
  { id: "bottom-mid", x: POOL_TABLE.felt.x + POOL_TABLE.felt.width / 2, y: POOL_TABLE.felt.y + POOL_TABLE.felt.height + 2, radius: 25 },
  { id: "bottom-right", x: POOL_TABLE.felt.x + POOL_TABLE.felt.width, y: POOL_TABLE.felt.y + POOL_TABLE.felt.height, radius: 27 },
];

const BALLS: Array<Pick<PoolBall, "number" | "label" | "color" | "stripe">> = [
  { number: 1, label: "Rose", color: "#dc7f92" },
  { number: 2, label: "Honey", color: "#e7b64b" },
  { number: 3, label: "Lavender", color: "#9274c9" },
  { number: 4, label: "Mint", color: "#77aa66" },
  { number: 5, label: "Sky", color: "#6ca7c3" },
  { number: 6, label: "Cocoa", color: "#8b5748" },
  { number: 7, label: "Blush", color: "#e4a2ad" },
  { number: 8, label: "Moon", color: "#3c2d35", stripe: "#f6e4b8" },
  { number: 9, label: "Cream", color: "#f6d98e", stripe: "#b66a82" },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function speed(ball: PoolBall) {
  return Math.hypot(ball.vx, ball.vy);
}

export function createInitialPoolBalls(): PoolBall[] {
  const balls: PoolBall[] = [
    {
      id: "cue",
      kind: "cue",
      number: null,
      label: "Cue",
      color: "#fffdf5",
      x: POOL_CUE_START.x,
      y: POOL_CUE_START.y,
      vx: 0,
      vy: 0,
      radius: POOL_BALL_RADIUS,
      potted: false,
    },
  ];

  const rackX = 632;
  const rackY = 290;
  const centerDistance = POOL_BALL_RADIUS * 2.04;
  const xStep = Math.sqrt(3) * POOL_BALL_RADIUS * 1.02;
  const yStep = centerDistance;
  const diamond = [
    { number: 1, row: 0, offset: 0 },
    { number: 2, row: 1, offset: -0.5 },
    { number: 3, row: 1, offset: 0.5 },
    { number: 4, row: 2, offset: -1 },
    { number: 9, row: 2, offset: 0 },
    { number: 5, row: 2, offset: 1 },
    { number: 6, row: 3, offset: -0.5 },
    { number: 7, row: 3, offset: 0.5 },
    { number: 8, row: 4, offset: 0 },
  ];

  diamond.forEach((slot) => {
    const source = BALLS.find((candidate) => candidate.number === slot.number);
    if (!source) return;
    balls.push({
      id: `ball-${source.number}`,
      kind: "object",
      number: source.number,
      label: source.label,
      color: source.color,
      stripe: source.stripe,
      x: rackX + slot.row * xStep,
      y: rackY + slot.offset * yStep,
      vx: 0,
      vy: 0,
      radius: POOL_BALL_RADIUS,
      potted: false,
    });
  });

  return balls;
}

export function clonePoolBalls(balls: PoolBall[]) {
  return balls.map((ball) => ({ ...ball }));
}

export function getCueBall(balls: PoolBall[]) {
  return balls.find((ball) => ball.kind === "cue") ?? balls[0];
}

export function countRemainingObjectBalls(balls: PoolBall[]) {
  return balls.filter((ball) => ball.kind === "object" && !ball.potted).length;
}

export function createInitialPoolSessionMetadata(playerCount = 2): PoolSessionMetadata {
  const safePlayerCount = Math.max(1, Math.min(8, Math.floor(playerCount)));
  return {
    balls: createInitialPoolBalls(),
    currentSeat: 0,
    scores: Array.from({ length: safePlayerCount }, () => 0),
    shotNumber: 0,
    shotsRemaining: POOL_MAX_SHOTS,
    gameOver: false,
    finalScore: 0,
  };
}

function parseNumber(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function parsePoolBall(value: unknown, fallback?: PoolBall): PoolBall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback ? { ...fallback } : null;
  const source = value as Record<string, unknown>;
  const id = String(source.id ?? fallback?.id ?? "");
  if (!id) return null;
  const kind = source.kind === "cue" ? "cue" : "object";
  return {
    id,
    kind,
    number: source.number === null ? null : source.number === undefined ? fallback?.number ?? null : Number(source.number),
    label: String(source.label ?? fallback?.label ?? id),
    color: String(source.color ?? fallback?.color ?? "#f6d98e"),
    stripe: source.stripe === undefined ? fallback?.stripe : String(source.stripe),
    x: clamp(parseNumber(source.x, fallback?.x ?? POOL_CUE_START.x), POOL_TABLE.felt.x - 40, POOL_TABLE.felt.x + POOL_TABLE.felt.width + 40),
    y: clamp(parseNumber(source.y, fallback?.y ?? POOL_CUE_START.y), POOL_TABLE.felt.y - 40, POOL_TABLE.felt.y + POOL_TABLE.felt.height + 40),
    vx: parseNumber(source.vx, 0),
    vy: parseNumber(source.vy, 0),
    radius: clamp(parseNumber(source.radius, fallback?.radius ?? POOL_BALL_RADIUS), 8, 18),
    potted: Boolean(source.potted),
  };
}

export function parsePoolSessionMetadata(value: unknown, playerCount = 2): PoolSessionMetadata {
  const fallback = createInitialPoolSessionMetadata(playerCount);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const source = value as Record<string, unknown>;
  const rawBalls = Array.isArray(source.balls) ? source.balls : [];
  const fallbackById = new Map(fallback.balls.map((ball) => [ball.id, ball]));
  const parsedBalls = rawBalls
    .map((ball) => parsePoolBall(ball, fallbackById.get(String((ball as Record<string, unknown> | null)?.id ?? ""))))
    .filter((ball): ball is PoolBall => Boolean(ball));
  const ballsById = new Map(parsedBalls.map((ball) => [ball.id, ball]));
  const balls = fallback.balls.map((ball) => ballsById.get(ball.id) ?? { ...ball });
  const rawScores = Array.isArray(source.scores) ? source.scores : null;
  const scores = rawScores
    ? Array.from({ length: Math.max(1, playerCount) }, (_, index) => Math.max(0, Math.floor(Number(rawScores[index] ?? 0))))
    : fallback.scores;
  const shotNumber = Math.max(0, Math.floor(parseNumber(source.shotNumber, 0)));
  const gameOver = Boolean(source.gameOver);

  return {
    balls,
    currentSeat: clamp(Math.floor(parseNumber(source.currentSeat, 0)), 0, Math.max(0, playerCount - 1)),
    scores,
    shotNumber,
    shotsRemaining: Math.max(0, Math.floor(parseNumber(source.shotsRemaining, POOL_MAX_SHOTS - shotNumber))),
    gameOver,
    finalScore: Math.max(0, Math.floor(parseNumber(source.finalScore, Math.max(...scores, 0)))),
    lastShot:
      source.lastShot && typeof source.lastShot === "object" && !Array.isArray(source.lastShot)
        ? {
            seat: Math.floor(parseNumber((source.lastShot as Record<string, unknown>).seat, 0)),
            angle: parseNumber((source.lastShot as Record<string, unknown>).angle, 0),
            power: parseNumber((source.lastShot as Record<string, unknown>).power, 0),
            pottedIds: Array.isArray((source.lastShot as Record<string, unknown>).pottedIds)
              ? ((source.lastShot as Record<string, unknown>).pottedIds as unknown[]).map(String)
              : [],
            scratched: Boolean((source.lastShot as Record<string, unknown>).scratched),
            scoreDelta: Math.floor(parseNumber((source.lastShot as Record<string, unknown>).scoreDelta, 0)),
            message: String((source.lastShot as Record<string, unknown>).message ?? ""),
            submittedAt:
              (source.lastShot as Record<string, unknown>).submittedAt === undefined
                ? undefined
                : String((source.lastShot as Record<string, unknown>).submittedAt),
          }
        : undefined,
  };
}

export function resetCueBall(balls: PoolBall[]) {
  const cue = getCueBall(balls);
  cue.potted = false;
  cue.vx = 0;
  cue.vy = 0;
  cue.x = POOL_CUE_START.x;
  cue.y = POOL_CUE_START.y;

  const blockers = balls.filter((ball) => ball.id !== cue.id && !ball.potted);
  let attempts = 0;
  while (
    attempts < 12 &&
    blockers.some((ball) => Math.hypot(ball.x - cue.x, ball.y - cue.y) < cue.radius + ball.radius + 4)
  ) {
    cue.x = POOL_CUE_START.x - 20 + attempts * 12;
    cue.y = POOL_CUE_START.y + (attempts % 2 === 0 ? 18 : -18);
    attempts += 1;
  }
}

function isNearPocketMouth(ball: PoolBall) {
  return POOL_POCKETS.some((pocket) => Math.hypot(ball.x - pocket.x, ball.y - pocket.y) < pocket.radius + ball.radius * 0.9);
}

function maybePotBall(ball: PoolBall) {
  if (ball.potted) return false;
  return POOL_POCKETS.some((pocket) => Math.hypot(ball.x - pocket.x, ball.y - pocket.y) <= pocket.radius);
}

function resolveCushion(ball: PoolBall) {
  if (ball.potted || isNearPocketMouth(ball)) return;
  const felt = POOL_TABLE.felt;
  const minX = felt.x + ball.radius;
  const maxX = felt.x + felt.width - ball.radius;
  const minY = felt.y + ball.radius;
  const maxY = felt.y + felt.height - ball.radius;
  const bounce = 0.88;

  if (ball.x < minX) {
    ball.x = minX;
    ball.vx = Math.abs(ball.vx) * bounce;
  } else if (ball.x > maxX) {
    ball.x = maxX;
    ball.vx = -Math.abs(ball.vx) * bounce;
  }

  if (ball.y < minY) {
    ball.y = minY;
    ball.vy = Math.abs(ball.vy) * bounce;
  } else if (ball.y > maxY) {
    ball.y = maxY;
    ball.vy = -Math.abs(ball.vy) * bounce;
  }
}

function resolveBallCollision(a: PoolBall, b: PoolBall) {
  if (a.potted || b.potted) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const minDistance = a.radius + b.radius;
  if (distance <= 0 || distance >= minDistance) return;

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  const correction = overlap / 2 + 0.02;
  a.x -= nx * correction;
  a.y -= ny * correction;
  b.x += nx * correction;
  b.y += ny * correction;

  const relativeVx = b.vx - a.vx;
  const relativeVy = b.vy - a.vy;
  const velocityAlongNormal = relativeVx * nx + relativeVy * ny;
  if (velocityAlongNormal > 0) return;

  const restitution = 0.94;
  const impulse = (-(1 + restitution) * velocityAlongNormal) / 2;
  const impulseX = impulse * nx;
  const impulseY = impulse * ny;

  a.vx -= impulseX;
  a.vy -= impulseY;
  b.vx += impulseX;
  b.vy += impulseY;
}

export function launchCueBall(balls: PoolBall[], direction: { x: number; y: number }, power: number) {
  const cue = getCueBall(balls);
  if (!cue || cue.potted) return;
  const length = Math.hypot(direction.x, direction.y);
  if (length <= 0) return;
  const force = clamp(power, 0, 1) * 820;
  cue.vx = (direction.x / length) * force;
  cue.vy = (direction.y / length) * force;
}

export function arePoolBallsMoving(balls: PoolBall[]) {
  return balls.some((ball) => !ball.potted && speed(ball) > 6);
}

export function stepPoolPhysics(balls: PoolBall[], dtSeconds: number): PoolStepResult {
  const step = clamp(dtSeconds, 0, 1 / 24);
  const substeps = 4;
  const subDt = step / substeps;
  const pottedIds = new Set<string>();
  let scratched = false;

  for (let substep = 0; substep < substeps; substep += 1) {
    for (const ball of balls) {
      if (ball.potted) continue;
      ball.x += ball.vx * subDt;
      ball.y += ball.vy * subDt;

      if (maybePotBall(ball)) {
        ball.potted = true;
        ball.vx = 0;
        ball.vy = 0;
        pottedIds.add(ball.id);
        if (ball.kind === "cue") scratched = true;
        continue;
      }

      resolveCushion(ball);
    }

    for (let i = 0; i < balls.length; i += 1) {
      for (let j = i + 1; j < balls.length; j += 1) {
        resolveBallCollision(balls[i], balls[j]);
      }
    }

    for (const ball of balls) {
      if (ball.potted) continue;
      const friction = Math.pow(0.986, subDt * 60);
      ball.vx *= friction;
      ball.vy *= friction;
      if (Math.hypot(ball.vx, ball.vy) < 5.5) {
        ball.vx = 0;
        ball.vy = 0;
      }
    }
  }

  return {
    pottedIds: [...pottedIds],
    scratched,
    moving: arePoolBallsMoving(balls),
  };
}

export function scorePoolShot({
  pottedObjectCount,
  scratched,
  allCleared,
  shotsLeftAfterShot,
}: {
  pottedObjectCount: number;
  scratched: boolean;
  allCleared: boolean;
  shotsLeftAfterShot: number;
}): PoolShotScore {
  const comboBonus = pottedObjectCount > 1 ? 250 : 0;
  const scratchPenalty = scratched ? 100 : 0;
  const finalBonus = allCleared ? 500 + Math.max(0, shotsLeftAfterShot) * 50 : 0;
  const scoreDelta = pottedObjectCount * 100 + comboBonus + finalBonus - scratchPenalty;
  return {
    scoreDelta,
    comboBonus,
    scratchPenalty,
    pottedObjectCount,
    finalBonus,
  };
}
