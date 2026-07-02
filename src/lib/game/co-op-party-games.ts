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
      { id: "batter", label: "Cloud Batter", prompt: "Whisk cloud batter until the bowl shines.", actionId: "mix", points: 115, flourish: "the batter turns silky", lane: 0 },
      { id: "berries", label: "Moonberries", prompt: "Sprinkle moonberries in a crescent pattern.", actionId: "sprinkle", points: 130, flourish: "berries dot the batter like stars", lane: 1 },
      { id: "fold", label: "Soft Fold", prompt: "Whisk once more to fold the berries in.", actionId: "mix", points: 125, flourish: "purple ribbons swirl through the bowl", lane: 0 },
      { id: "oven-warm", label: "Warm Oven", prompt: "Bake just long enough for the cake to rise.", actionId: "bake", points: 145, flourish: "the oven window glows honey", lane: 2 },
      { id: "cream", label: "Heart Cream", prompt: "Frost the first heart curl before it cools.", actionId: "frost", points: 155, flourish: "icing curls into a tiny heart", lane: 3 },
      { id: "sugar", label: "Lavender Sugar", prompt: "Sprinkle lavender sugar over the frosting.", actionId: "sprinkle", points: 150, flourish: "lavender sparkles drift down", lane: 1 },
      { id: "final-bake", label: "Moonbeam Set", prompt: "Bake the glaze until it catches moonlight.", actionId: "bake", points: 175, flourish: "the glaze flashes gold", lane: 2 },
      { id: "rose-finish", label: "Rose Finish", prompt: "Frost the final rose on top.", actionId: "frost", points: 200, flourish: "the finished cake blooms", lane: 3 },
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
      { id: "gate-net", label: "Gate Drift", prompt: "Sweep the net at the garden gate.", actionId: "net", points: 105, flourish: "the first swarm gathers", lane: 0 },
      { id: "gate-light", label: "Gate Lantern", prompt: "Light the gate lantern so they know where to land.", actionId: "lantern", points: 115, flourish: "a warm dot opens the route", lane: 1 },
      { id: "bridge-breeze", label: "Bridge Bend", prompt: "Guide a breeze across the stepping stones.", actionId: "breeze", points: 135, flourish: "fireflies arc over the bridge", lane: 2 },
      { id: "jar-crossing", label: "Glass Jar", prompt: "Open the jar at the crossing.", actionId: "release", points: 140, flourish: "captured sparks rejoin the swarm", lane: 3 },
      { id: "pond-net", label: "Pond Loop", prompt: "Sweep the net near the pond reeds.", actionId: "net", points: 145, flourish: "blue sparks whirl low", lane: 4 },
      { id: "tree-light", label: "Honey Tree", prompt: "Light the lantern tucked in the tree hollow.", actionId: "lantern", points: 160, flourish: "the canopy flickers gold", lane: 5 },
      { id: "moon-breeze", label: "Moon Ring", prompt: "Guide a breeze around the moon ring.", actionId: "breeze", points: 180, flourish: "the swarm forms a halo", lane: 6 },
      { id: "final-release", label: "Grove Release", prompt: "Open the jar and let the grove glow.", actionId: "release", points: 205, flourish: "every lantern answers", lane: 7 },
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
      { id: "first-tap", label: "Opening Tap", prompt: "Tap the bell on the first beat.", actionId: "tap", points: 110, flourish: "a blush note pops open", lane: 1 },
      { id: "soft-hold", label: "Soft Hold", prompt: "Hold the lavender note through the moonbar.", actionId: "hold", points: 130, flourish: "the note stretches into moonlight", lane: 2 },
      { id: "gold-chime", label: "Gold Chime", prompt: "Chime on the bright echo.", actionId: "chime", points: 140, flourish: "gold notes ripple outward", lane: 0 },
      { id: "leaf-rest", label: "Leaf Rest", prompt: "Rest for one tiny garden breath.", actionId: "rest", points: 135, flourish: "the staff exhales softly", lane: 3 },
      { id: "double-tap", label: "Double Tap", prompt: "Tap the returning heartbeat.", actionId: "tap", points: 150, flourish: "two heart notes bounce", lane: 1 },
      { id: "long-hold", label: "Long Hold", prompt: "Hold the harmony while the duet turns.", actionId: "hold", points: 165, flourish: "the harmony braids together", lane: 2 },
      { id: "moon-chime", label: "Moon Chime", prompt: "Chime the moonlit counter melody.", actionId: "chime", points: 185, flourish: "silver bells sparkle", lane: 0 },
      { id: "final-rest", label: "Final Rest", prompt: "Rest at the finale so the last note lands.", actionId: "rest", points: 210, flourish: "the whole garden listens", lane: 3 },
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

export function reduceCoopGameState(
  definition: CoopGameDefinition,
  moves: GameMoveRecord[],
  seats: GameSessionSeat[],
): CoopReducedState {
  const playerCount = Math.max(1, seats.length || 1);
  const seatScores = Array.from({ length: playerCount }, () => 0);
  const history: CoopHistoryEntry[] = [];
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
    const correct = actionId === step.actionId;
    const scoreDelta = correct ? step.points + combo * 25 : -35;

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
    resultTitle: success ? `${definition.title} complete` : "Round finished",
    resultCopy: success
      ? "Your team finished every step together."
      : "The team ran out of chances. Try a cleaner combo next round.",
  };
}
