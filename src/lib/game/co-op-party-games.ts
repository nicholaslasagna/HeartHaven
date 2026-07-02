import type { GameMoveRecord, GameSessionSeat } from "@/lib/game/use-game-session";

export type CoopGameKey = "moonbeam-bakeoff" | "firefly-grove" | "moonlight-melody";

export type CoopActionId = "rose" | "honey" | "lavender" | "garden";

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

const sharedActions: CoopGameAction[] = [
  {
    id: "rose",
    label: "Rose Pulse",
    shortLabel: "Rose",
    description: "A warm timing cue for blush-colored tasks.",
    className: "border-blush-300 bg-blush-100 text-blush-800",
  },
  {
    id: "honey",
    label: "Honey Tap",
    shortLabel: "Honey",
    description: "A golden cue for steady, careful moments.",
    className: "border-honey-500/35 bg-honey-100 text-honey-800",
  },
  {
    id: "lavender",
    label: "Lavender Swirl",
    shortLabel: "Lavender",
    description: "A soft purple cue for dreamy magic steps.",
    className: "border-lavender-300 bg-lavender-100 text-lavender-700",
  },
  {
    id: "garden",
    label: "Garden Glow",
    shortLabel: "Garden",
    description: "A green cue for living, growing actions.",
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
    description: "Take turns adding the right cozy ingredient before the mooncake cools.",
    longDescription:
      "A shared kitchen rhythm game. Each seated player gets the next prep step, keeps the combo alive, and sends the cake from mixing bowl to glowing oven.",
    maxPlayers: 4,
    maxTurns: 18,
    missLimit: 5,
    theme: "bakeoff",
    backdropClassName: "from-[#fff6df] via-[#fde8ed] to-[#efe6f7]",
    accentClassName: "bg-blush-100 text-blush-800 border-blush-300",
    actions: sharedActions,
    steps: [
      { id: "berries", label: "Moonberries", prompt: "Fold moonberries into the batter.", actionId: "rose", points: 120, flourish: "berries tumble into the bowl" },
      { id: "honey", label: "Honey Glaze", prompt: "Pour the honey glaze slowly.", actionId: "honey", points: 130, flourish: "golden glaze ribbons over the spoon" },
      { id: "lavender", label: "Lavender Sugar", prompt: "Dust lavender sugar across the top.", actionId: "lavender", points: 125, flourish: "lavender sparkles drift over the cake" },
      { id: "mint", label: "Garden Mint", prompt: "Press fresh mint into the frosting.", actionId: "garden", points: 135, flourish: "mint leaves brighten the plate" },
      { id: "stir", label: "Soft Stir", prompt: "Stir until the batter shines.", actionId: "honey", points: 140, flourish: "the bowl glows warm" },
      { id: "oven", label: "Moon Oven", prompt: "Open the moon oven at the perfect moment.", actionId: "lavender", points: 155, flourish: "the oven window turns violet" },
      { id: "heart", label: "Heart Icing", prompt: "Pipe the heart icing before it sets.", actionId: "rose", points: 160, flourish: "icing curls into a tiny heart" },
      { id: "sprig", label: "Garden Finish", prompt: "Set the final sprig on top.", actionId: "garden", points: 180, flourish: "the cake blooms on the tray" },
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
    description: "Guide fireflies into lanterns in order and keep the whole grove glowing.",
    longDescription:
      "A shared grove puzzle. Players take turns choosing the right glow cue to guide fireflies through lantern circles without breaking the chain.",
    maxPlayers: 6,
    maxTurns: 20,
    missLimit: 6,
    theme: "grove",
    backdropClassName: "from-[#edf6e7] via-[#fff6df] to-[#e5f3f7]",
    accentClassName: "bg-garden-100 text-garden-800 border-garden-300",
    actions: sharedActions,
    steps: [
      { id: "gate", label: "Gate Lantern", prompt: "Wake the gate lantern with a garden glow.", actionId: "garden", points: 105, flourish: "the first lantern opens" },
      { id: "bridge", label: "Bridge Spark", prompt: "Send a honey spark across the bridge.", actionId: "honey", points: 120, flourish: "fireflies cross in a ribbon" },
      { id: "rose-bed", label: "Rose Bed", prompt: "Call the rose-bed fireflies home.", actionId: "rose", points: 125, flourish: "pink fireflies gather low" },
      { id: "violet-arch", label: "Violet Arch", prompt: "Spin lavender light through the arch.", actionId: "lavender", points: 130, flourish: "the arch lights from left to right" },
      { id: "pond", label: "Pond Glow", prompt: "Reflect garden light on the pond stones.", actionId: "garden", points: 145, flourish: "the water mirrors the lanterns" },
      { id: "honey-tree", label: "Honey Tree", prompt: "Pulse honey light in the tree hollow.", actionId: "honey", points: 155, flourish: "gold dots rise into the leaves" },
      { id: "moon-ring", label: "Moon Ring", prompt: "Finish with a lavender moon ring.", actionId: "lavender", points: 175, flourish: "the ring blooms violet" },
      { id: "heart-path", label: "Heart Path", prompt: "Seal the path with rose light.", actionId: "rose", points: 190, flourish: "the path glows like a trail of hearts" },
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
    description: "Play a soft garden melody together by hitting each color note in sequence.",
    longDescription:
      "A turn-based rhythm duet for parties. Players pass the melody around, hit the next note, and build a shared combo without losing the beat.",
    maxPlayers: 4,
    maxTurns: 22,
    missLimit: 5,
    theme: "melody",
    backdropClassName: "from-[#efe6f7] via-[#fde8ed] to-[#e5f3f7]",
    accentClassName: "bg-lavender-100 text-lavender-800 border-lavender-300",
    actions: sharedActions,
    steps: [
      { id: "intro", label: "Opening Note", prompt: "Start the melody with lavender.", actionId: "lavender", points: 110, flourish: "a violet note floats upward" },
      { id: "echo", label: "Honey Echo", prompt: "Answer with honey on the second beat.", actionId: "honey", points: 120, flourish: "golden notes ripple across the staff" },
      { id: "pulse", label: "Rose Pulse", prompt: "Tap rose when the heart beat arrives.", actionId: "rose", points: 130, flourish: "a blush note pops in time" },
      { id: "leaf", label: "Leaf Rest", prompt: "Hold the garden note softly.", actionId: "garden", points: 125, flourish: "green notes sway like leaves" },
      { id: "harmony", label: "Lavender Harmony", prompt: "Bring the harmony back with lavender.", actionId: "lavender", points: 150, flourish: "two notes braid together" },
      { id: "bridge", label: "Honey Bridge", prompt: "Carry the bridge with honey.", actionId: "honey", points: 155, flourish: "the bridge glows gold" },
      { id: "chorus", label: "Rose Chorus", prompt: "Lift the chorus with rose.", actionId: "rose", points: 170, flourish: "heart notes fill the air" },
      { id: "finale", label: "Garden Finale", prompt: "Finish on the garden note.", actionId: "garden", points: 200, flourish: "the whole staff blooms" },
    ],
  },
};

export function getCoOpPartyGame(gameKey: CoopGameKey) {
  return coOpPartyGames[gameKey];
}

export function isCoopActionId(value: unknown): value is CoopActionId {
  return value === "rose" || value === "honey" || value === "lavender" || value === "garden";
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
