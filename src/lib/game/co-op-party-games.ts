import type { GameMoveRecord, GameSessionSeat } from "@/lib/game/use-game-session";

export type CoopGameKey = "moonbeam-bakeoff" | "firefly-grove" | "moonlight-melody";

export type CoopActionId =
  | "mix"
  | "sprinkle"
  | "frost"
  | "bake"
  | "net"
  | "lantern"
  | "breeze"
  | "release"
  | "tap"
  | "hold"
  | "chime"
  | "rest";

export type CoopGameAction = {
  id: CoopActionId;
  label: string;
  shortLabel: string;
  description: string;
  className: string;
};

export type CoopGameStep = {
  id: string;
  label: string;
  prompt: string;
  actionId: CoopActionId;
  points: number;
  flourish: string;
  lane: number;
  targetValue?: number;
  tolerance?: number;
  routeId?: string;
  routeLabel?: string;
  beat?: number;
};

export type CoopGameDefinition = {
  gameKey: CoopGameKey;
  title: string;
  kicker: string;
  href: string;
  lobbyMode: string;
  status: string;
  rewardLabel: string;
  description: string;
  longDescription: string;
  maxPlayers: number;
  maxTurns: number;
  missLimit: number;
  theme: "bakeoff" | "grove" | "melody";
  backdropClassName: string;
  accentClassName: string;
  actions: CoopGameAction[];
  steps: CoopGameStep[];
};

export type CoopHistoryEntry = {
  moveIndex: number;
  seatIndex: number;
  playerName: string;
  actionId: CoopActionId;
  actionLabel: string;
  expectedLabel: string;
  stepLabel: string;
  correct: boolean;
  scoreDelta: number;
  comboAfter: number;
  detail: string;
  accuracy: number;
  submittedValue: string;
  expectedValue: string;
};

export type CoopReducedState = {
  currentStepIndex: number;
  currentSeat: number;
  score: number;
  combo: number;
  misses: number;
  countedMoves: number;
  gameOver: boolean;
  success: boolean;
  finalScore: number;
  progress: number;
  seatScores: number[];
  history: CoopHistoryEntry[];
  lastEntry: CoopHistoryEntry | null;
  specialMeters: Record<string, number>;
  resultTitle: string;
  resultCopy: string;
};

const bakeoffActions: CoopGameAction[] = [
  {
    id: "mix",
    label: "Whisk",
    shortLabel: "Whisk",
    description: "Stir the batter until it turns glossy.",
    className: "border-honey-500/35 bg-honey-100 text-honey-800",
  },
  {
    id: "sprinkle",
    label: "Sprinkle",
    shortLabel: "Sprinkle",
    description: "Drop toppings exactly where the recipe asks.",
    className: "border-lavender-300 bg-lavender-100 text-lavender-700",
  },
  {
    id: "frost",
    label: "Frost",
    shortLabel: "Frost",
    description: "Pipe soft icing curls and heart details.",
    className: "border-blush-300 bg-blush-100 text-blush-800",
  },
  {
    id: "bake",
    label: "Bake",
    shortLabel: "Bake",
    description: "Time the oven so the mooncake rises.",
    className: "border-orange-200 bg-orange-100 text-orange-800",
  },
];

const groveActions: CoopGameAction[] = [
  {
    id: "net",
    label: "Sweep Net",
    shortLabel: "Net",
    description: "Catch drifting fireflies without startling them.",
    className: "border-sky-200 bg-sky-100 text-sky-800",
  },
  {
    id: "lantern",
    label: "Light Lantern",
    shortLabel: "Lantern",
    description: "Wake a lantern node so the route stays bright.",
    className: "border-honey-500/35 bg-honey-100 text-honey-800",
  },
  {
    id: "breeze",
    label: "Guide Breeze",
    shortLabel: "Breeze",
    description: "Push the swarm through curved garden paths.",
    className: "border-garden-300 bg-garden-100 text-garden-800",
  },
  {
    id: "release",
    label: "Open Jar",
    shortLabel: "Release",
    description: "Release gathered fireflies into the next glow ring.",
    className: "border-lavender-300 bg-lavender-100 text-lavender-700",
  },
];

const melodyActions: CoopGameAction[] = [
  {
    id: "tap",
    label: "Tap",
    shortLabel: "Tap",
    description: "A quick bell note on the beat.",
    className: "border-blush-300 bg-blush-100 text-blush-800",
  },
  {
    id: "hold",
    label: "Hold",
    shortLabel: "Hold",
    description: "Sustain the note until the phrase settles.",
    className: "border-lavender-300 bg-lavender-100 text-lavender-700",
  },
  {
    id: "chime",
    label: "Chime",
    shortLabel: "Chime",
    description: "Ring the bright counter-melody.",
    className: "border-honey-500/35 bg-honey-100 text-honey-800",
  },
  {
    id: "rest",
    label: "Rest",
    shortLabel: "Rest",
    description: "Leave a tiny silence so the duet can breathe.",
    className: "border-garden-300 bg-garden-100 text-garden-800",
  },
];

export const coOpPartyGames: Record<CoopGameKey, CoopGameDefinition> = {
  "moonbeam-bakeoff": {
    gameKey: "moonbeam-bakeoff",
    title: "Moonbeam Bake-Off",
    kicker: "Co-op kitchen",
    href: "/app/moonbeam-bakeoff",
    lobbyMode: "2-4 baker team",
    status: "Co-op party",
    rewardLabel: "Moonbeam Bake-Off",
    description: "Bake one shared mooncake by whisking, sprinkling, frosting, and timing the oven together.",
    longDescription:
      "A shared kitchen game with recipe stations. Each seated player handles the next prep card, building a mooncake from batter to oven glow without burning the combo.",
    maxPlayers: 4,
    maxTurns: 20,
    missLimit: 5,
    theme: "bakeoff",
    backdropClassName: "from-[#fff6df] via-[#fde8ed] to-[#efe6f7]",
    accentClassName: "bg-blush-100 text-blush-800 border-blush-300",
    actions: bakeoffActions,
    steps: [
      { id: "batter", label: "Cloud Batter", prompt: "Whisk cloud batter until the bowl shines.", actionId: "mix", points: 115, flourish: "the batter turns silky", lane: 0, targetValue: 62, tolerance: 12 },
      { id: "berries", label: "Moonberries", prompt: "Sprinkle moonberries in a crescent pattern.", actionId: "sprinkle", points: 130, flourish: "berries dot the batter like stars", lane: 1, targetValue: 38, tolerance: 10 },
      { id: "fold", label: "Soft Fold", prompt: "Whisk once more to fold the berries in.", actionId: "mix", points: 125, flourish: "purple ribbons swirl through the bowl", lane: 0, targetValue: 46, tolerance: 9 },
      { id: "oven-warm", label: "Warm Oven", prompt: "Bake just long enough for the cake to rise.", actionId: "bake", points: 145, flourish: "the oven window glows honey", lane: 2, targetValue: 74, tolerance: 8 },
      { id: "cream", label: "Heart Cream", prompt: "Frost the first heart curl before it cools.", actionId: "frost", points: 155, flourish: "icing curls into a tiny heart", lane: 3, targetValue: 57, tolerance: 11 },
      { id: "sugar", label: "Lavender Sugar", prompt: "Sprinkle lavender sugar over the frosting.", actionId: "sprinkle", points: 150, flourish: "lavender sparkles drift down", lane: 1, targetValue: 31, tolerance: 9 },
      { id: "final-bake", label: "Moonbeam Set", prompt: "Bake the glaze until it catches moonlight.", actionId: "bake", points: 175, flourish: "the glaze flashes gold", lane: 2, targetValue: 82, tolerance: 7 },
      { id: "rose-finish", label: "Rose Finish", prompt: "Frost the final rose on top.", actionId: "frost", points: 200, flourish: "the finished cake blooms", lane: 3, targetValue: 69, tolerance: 10 },
    ],
  },
  "firefly-grove": {
    gameKey: "firefly-grove",
    title: "Firefly Grove",
    kicker: "Lantern co-op",
    href: "/app/firefly-grove",
    lobbyMode: "2-6 glow team",
    status: "Co-op party",
    rewardLabel: "Firefly Grove",
    description: "Route a firefly swarm across a lantern map using nets, breezes, jars, and glowing checkpoints.",
    longDescription:
      "A spatial routing game. The party lights a garden path node by node, choosing how to catch, guide, and release the swarm without losing the trail.",
    maxPlayers: 6,
    maxTurns: 20,
    missLimit: 6,
    theme: "grove",
    backdropClassName: "from-[#edf6e7] via-[#fff6df] to-[#e5f3f7]",
    accentClassName: "bg-garden-100 text-garden-800 border-garden-300",
    actions: groveActions,
    steps: [
      { id: "gate-net", label: "Gate Drift", prompt: "Sweep the net at the garden gate.", actionId: "net", points: 105, flourish: "the first swarm gathers", lane: 0, routeId: "stone-gate", routeLabel: "Stone Gate" },
      { id: "gate-light", label: "Gate Lantern", prompt: "Light the gate lantern so they know where to land.", actionId: "lantern", points: 115, flourish: "a warm dot opens the route", lane: 1, routeId: "stone-gate", routeLabel: "Stone Gate" },
      { id: "bridge-breeze", label: "Bridge Bend", prompt: "Guide a breeze across the stepping stones.", actionId: "breeze", points: 135, flourish: "fireflies arc over the bridge", lane: 2, routeId: "willow-bridge", routeLabel: "Willow Bridge" },
      { id: "jar-crossing", label: "Glass Jar", prompt: "Open the jar at the crossing.", actionId: "release", points: 140, flourish: "captured sparks rejoin the swarm", lane: 3, routeId: "willow-bridge", routeLabel: "Willow Bridge" },
      { id: "pond-net", label: "Pond Loop", prompt: "Sweep the net near the pond reeds.", actionId: "net", points: 145, flourish: "blue sparks whirl low", lane: 4, routeId: "lily-pond", routeLabel: "Lily Pond" },
      { id: "tree-light", label: "Honey Tree", prompt: "Light the lantern tucked in the tree hollow.", actionId: "lantern", points: 160, flourish: "the canopy flickers gold", lane: 5, routeId: "honey-tree", routeLabel: "Honey Tree" },
      { id: "moon-breeze", label: "Moon Ring", prompt: "Guide a breeze around the moon ring.", actionId: "breeze", points: 180, flourish: "the swarm forms a halo", lane: 6, routeId: "moon-ring", routeLabel: "Moon Ring" },
      { id: "final-release", label: "Grove Release", prompt: "Open the jar and let the grove glow.", actionId: "release", points: 205, flourish: "every lantern answers", lane: 7, routeId: "moon-ring", routeLabel: "Moon Ring" },
    ],
  },
  "moonlight-melody": {
    gameKey: "moonlight-melody",
    title: "Moonlight Melody",
    kicker: "Duet rhythm",
    href: "/app/moonlight-melody",
    lobbyMode: "2-4 duet band",
    status: "Co-op party",
    rewardLabel: "Moonlight Melody",
    description: "Play a duet phrase together with taps, holds, chimes, and rests on a glowing music staff.",
    longDescription:
      "A rhythm phrase game. The melody passes around the party, asking for quick taps, sustained holds, bell chimes, and intentional rests to keep the song breathing.",
    maxPlayers: 4,
    maxTurns: 22,
    missLimit: 5,
    theme: "melody",
    backdropClassName: "from-[#efe6f7] via-[#fde8ed] to-[#e5f3f7]",
    accentClassName: "bg-lavender-100 text-lavender-800 border-lavender-300",
    actions: melodyActions,
    steps: [
      { id: "first-tap", label: "Opening Tap", prompt: "Tap the bell on the first beat.", actionId: "tap", points: 110, flourish: "a blush note pops open", lane: 1, beat: 1 },
      { id: "soft-hold", label: "Soft Hold", prompt: "Hold the lavender note through the moonbar.", actionId: "hold", points: 130, flourish: "the note stretches into moonlight", lane: 2, beat: 3 },
      { id: "gold-chime", label: "Gold Chime", prompt: "Chime on the bright echo.", actionId: "chime", points: 140, flourish: "gold notes ripple outward", lane: 0, beat: 2 },
      { id: "leaf-rest", label: "Leaf Rest", prompt: "Rest for one tiny garden breath.", actionId: "rest", points: 135, flourish: "the staff exhales softly", lane: 3, beat: 4 },
      { id: "double-tap", label: "Double Tap", prompt: "Tap the returning heartbeat.", actionId: "tap", points: 150, flourish: "two heart notes bounce", lane: 1, beat: 2 },
      { id: "long-hold", label: "Long Hold", prompt: "Hold the harmony while the duet turns.", actionId: "hold", points: 165, flourish: "the harmony braids together", lane: 2, beat: 4 },
      { id: "moon-chime", label: "Moon Chime", prompt: "Chime the moonlit counter melody.", actionId: "chime", points: 185, flourish: "silver bells sparkle", lane: 0, beat: 1 },
      { id: "final-rest", label: "Final Rest", prompt: "Rest at the finale so the last note lands.", actionId: "rest", points: 210, flourish: "the whole garden listens", lane: 3, beat: 3 },
    ],
  },
};

export function getCoOpPartyGame(gameKey: CoopGameKey) {
  return coOpPartyGames[gameKey];
}

export function isCoopActionId(value: unknown): value is CoopActionId {
  return (
    value === "mix" ||
    value === "sprinkle" ||
    value === "frost" ||
    value === "bake" ||
    value === "net" ||
    value === "lantern" ||
    value === "breeze" ||
    value === "release" ||
    value === "tap" ||
    value === "hold" ||
    value === "chime" ||
    value === "rest"
  );
}

function seatName(seats: GameSessionSeat[], seatIndex: number) {
  return seats.find((seat) => seat.seat_index === seatIndex)?.display_name ?? `Seat ${seatIndex + 1}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function payloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatBakeoffRange(step: CoopGameStep) {
  const target = step.targetValue ?? 50;
  const tolerance = step.tolerance ?? 10;
  return `${target}% ± ${tolerance}`;
}

function initialSpecialMeters(theme: CoopGameDefinition["theme"]): Record<string, number> {
  if (theme === "bakeoff") {
    return { texture: 24, toppings: 0, oven: 35, frosting: 0 };
  }
  if (theme === "grove") {
    return { swarm: 18, lanterns: 0, drift: 12, route: 0 };
  }
  return { timing: 30, harmony: 18, silence: 0, phrase: 0 };
}

function evaluateCoopMove(
  definition: CoopGameDefinition,
  step: CoopGameStep,
  actionId: CoopActionId,
  payload: Record<string, unknown>,
  combo: number,
) {
  const actionCorrect = actionId === step.actionId;
  let correct = actionCorrect;
  let accuracy = actionCorrect ? 1 : 0;
  let submittedValue = "";
  let expectedValue = "";
  let detail = step.flourish;
  let missPenalty = 35;

  if (definition.theme === "bakeoff") {
    const target = step.targetValue ?? 50;
    const tolerance = step.tolerance ?? 10;
    const submitted = payloadNumber(payload, "value");
    const safeSubmitted = submitted === null ? -1 : clamp(Math.round(submitted), 0, 100);
    const diff = submitted === null ? 100 : Math.abs(safeSubmitted - target);
    const near = clamp(1 - diff / Math.max(1, tolerance * 2.4), 0, 1);

    correct = actionCorrect && diff <= tolerance;
    accuracy = actionCorrect ? (correct ? clamp(0.62 + near * 0.38, 0.62, 1) : clamp(near * 0.55, 0, 0.45)) : 0;
    submittedValue = submitted === null ? "no timing" : `${safeSubmitted}%`;
    expectedValue = formatBakeoffRange(step);
    detail = correct
      ? `${step.flourish} at ${safeSubmitted}%`
      : actionCorrect
        ? `${safeSubmitted}% missed the ${expectedValue} sweet spot`
        : `wrong station; needed ${expectedValue}`;
    missPenalty = actionCorrect ? Math.round(28 + Math.min(42, diff * 0.7)) : 50;
  } else if (definition.theme === "grove") {
    const routeId = payloadString(payload, "routeId");
    const routeMatches = routeId === step.routeId;

    correct = actionCorrect && routeMatches;
    accuracy = correct ? 1 : actionCorrect || routeMatches ? 0.35 : 0;
    submittedValue = routeId ?? "no path";
    expectedValue = step.routeLabel ?? step.routeId ?? "the lit route";
    detail = correct
      ? `${step.flourish} through ${expectedValue}`
      : actionCorrect
        ? `right tool, wrong path; aim for ${expectedValue}`
        : routeMatches
          ? `right path, wrong tool; needed ${step.label}`
          : `lost the swarm before ${expectedValue}`;
    missPenalty = actionCorrect || routeMatches ? 40 : 55;
  } else {
    const beat = payloadNumber(payload, "beat");
    const safeBeat = beat === null ? null : clamp(Math.round(beat), 1, 4);
    const beatMatches = safeBeat === step.beat;

    correct = actionCorrect && beatMatches;
    accuracy = correct ? 1 : actionCorrect || beatMatches ? 0.38 : 0;
    submittedValue = safeBeat === null ? "no beat" : `Beat ${safeBeat}`;
    expectedValue = `Beat ${step.beat ?? 1}`;
    detail = correct
      ? `${step.flourish} on ${expectedValue}`
      : actionCorrect
        ? `right note, wrong beat; land on ${expectedValue}`
        : beatMatches
          ? `right beat, wrong note; needed ${step.label}`
          : `the phrase drifted from ${expectedValue}`;
    missPenalty = actionCorrect || beatMatches ? 38 : 52;
  }

  const scoreDelta = correct ? Math.round(step.points * accuracy + combo * 28) : -missPenalty;

  return {
    correct,
    accuracy,
    scoreDelta,
    detail,
    submittedValue,
    expectedValue,
  };
}

function updateSpecialMeters(
  definition: CoopGameDefinition,
  meters: Record<string, number>,
  step: CoopGameStep,
  evaluation: ReturnType<typeof evaluateCoopMove>,
) {
  const boost = evaluation.correct ? 16 + Math.round(evaluation.accuracy * 10) : -10;
  if (definition.theme === "bakeoff") {
    const key =
      step.actionId === "mix"
        ? "texture"
        : step.actionId === "sprinkle"
          ? "toppings"
          : step.actionId === "bake"
            ? "oven"
            : "frosting";
    meters[key] = clamp((meters[key] ?? 0) + boost, 0, 100);
    return;
  }

  if (definition.theme === "grove") {
    meters.route = clamp((meters.route ?? 0) + (evaluation.correct ? 14 : -7), 0, 100);
    meters.swarm = clamp((meters.swarm ?? 0) + (step.actionId === "net" || step.actionId === "release" ? boost : Math.round(boost * 0.55)), 0, 100);
    meters.lanterns = clamp((meters.lanterns ?? 0) + (step.actionId === "lantern" && evaluation.correct ? 24 : evaluation.correct ? 8 : -8), 0, 100);
    meters.drift = clamp((meters.drift ?? 0) + (evaluation.correct ? -6 : 18), 0, 100);
    return;
  }

  meters.timing = clamp((meters.timing ?? 0) + (evaluation.correct ? 18 : -12), 0, 100);
  meters.harmony = clamp((meters.harmony ?? 0) + (evaluation.correct ? 14 + Math.round(evaluation.accuracy * 8) : -9), 0, 100);
  meters.silence = clamp((meters.silence ?? 0) + (step.actionId === "rest" && evaluation.correct ? 28 : evaluation.correct ? 4 : -5), 0, 100);
  meters.phrase = clamp((meters.phrase ?? 0) + (evaluation.correct ? 12 : 2), 0, 100);
}

export function reduceCoopGameState(
  definition: CoopGameDefinition,
  moves: GameMoveRecord[],
  seats: GameSessionSeat[],
): CoopReducedState {
  const playerCount = Math.max(1, seats.length || 1);
  const seatScores = Array.from({ length: playerCount }, () => 0);
  const history: CoopHistoryEntry[] = [];
  const specialMeters = initialSpecialMeters(definition.theme);
  let currentStepIndex = 0;
  let currentSeat = 0;
  let score = 0;
  let combo = 0;
  let misses = 0;
  let countedMoves = 0;
  let gameOver = false;

  const orderedMoves = [...moves].sort((a, b) => a.move_index - b.move_index);
  for (const move of orderedMoves) {
    if (move.move_type !== "coop-action") continue;
    if (move.payload.gameKey !== definition.gameKey) continue;
    if (gameOver) continue;
    if (move.seat_index !== currentSeat) continue;

    const actionId = move.payload.actionId;
    if (!isCoopActionId(actionId)) continue;

    const step = definition.steps[currentStepIndex];
    if (!step) {
      gameOver = true;
      break;
    }

    const action = definition.actions.find((candidate) => candidate.id === actionId) ?? definition.actions[0];
    const expected = definition.actions.find((candidate) => candidate.id === step.actionId) ?? definition.actions[0];
    const evaluation = evaluateCoopMove(definition, step, actionId, move.payload, combo);
    const { correct, scoreDelta } = evaluation;

    if (correct) {
      score += scoreDelta;
      seatScores[currentSeat] = (seatScores[currentSeat] ?? 0) + scoreDelta;
      combo += 1;
      currentStepIndex += 1;
    } else {
      misses += 1;
      combo = 0;
      score = Math.max(0, score + scoreDelta);
    }
    updateSpecialMeters(definition, specialMeters, step, evaluation);

    countedMoves += 1;
    history.push({
      moveIndex: move.move_index,
      seatIndex: currentSeat,
      playerName: seatName(seats, currentSeat),
      actionId,
      actionLabel: action.shortLabel,
      expectedLabel: expected.shortLabel,
      stepLabel: step.label,
      correct,
      scoreDelta,
      comboAfter: combo,
      detail: evaluation.detail,
      accuracy: evaluation.accuracy,
      submittedValue: evaluation.submittedValue,
      expectedValue: evaluation.expectedValue,
    });

    gameOver =
      currentStepIndex >= definition.steps.length ||
      countedMoves >= definition.maxTurns ||
      misses >= definition.missLimit;
    currentSeat = (currentSeat + 1) % playerCount;
  }

  const success = currentStepIndex >= definition.steps.length;
  const finalScore = Math.max(0, score + (success ? 250 + combo * 20 : 0));
  const progress = Math.min(1, currentStepIndex / definition.steps.length);
  const lastEntry = history.at(-1) ?? null;

  return {
    currentStepIndex,
    currentSeat,
    score,
    combo,
    misses,
    countedMoves,
    gameOver,
    success,
    finalScore,
    progress,
    seatScores,
    history: history.toReversed(),
    lastEntry,
    specialMeters,
    resultTitle: success ? `${definition.title} complete` : "Round finished",
    resultCopy: success
      ? "Your team finished every step together."
      : "The team ran out of chances. Try a cleaner combo next round.",
  };
}
