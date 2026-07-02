import type { CatalogItem } from "@/lib/game/types";
import { marketCatalog, seasonalCatalog, starterCatalog } from "@/lib/catalog";

// TODO: Replace these mock arrays with Supabase reads once persistence is enabled.
export const playerWallet = {
  coins: 1240,
  hearts: 18,
};

export const activePet = {
  id: "pet-casper",
  name: "Casper",
  species: "Cloud Fox",
  tone: "cream",
  happiness: 92,
  hunger: 28,
  trait: "Guardian of the moonberry beds",
};

const mockInventoryCatalog = [...starterCatalog, ...seasonalCatalog];

export const inventoryItems = mockInventoryCatalog.map((item, index) => ({
  id: `inventory-${item.id}`,
  item,
  quantity: item.tags.includes("seasonal") ? 1 : index < 4 ? 1 : 3,
  equipped: index < 2,
}));

export const gardenPlots = [
  { id: "plot-moonberry", name: "Moonberry", stage: "Blooming", progress: 64, accent: "#F4B5BE", status: "Watered" },
  { id: "plot-honey-clover", name: "Honey Clover", stage: "Sprout", progress: 31, accent: "#D9A53E", status: "Needs sun" },
  { id: "plot-lavender-star", name: "Lavender Star", stage: "Growing", progress: 48, accent: "#8E70BD", status: "Watered" },
  { id: "plot-sky-mint", name: "Sky Mint", stage: "Seed", progress: 12, accent: "#5E94B0", status: "New" },
];

export const partnerGardenPlots = [
  { id: "shared-rose", name: "Distance Rose", stage: "Blooming", progress: 88, accent: "#F4B5BE", status: "Shared" },
  { id: "shared-lily", name: "Promise Lily", stage: "Growing", progress: 72, accent: "#FAE3A8", status: "Shared" },
  { id: "shared-tree", name: "Casper Tree", stage: "Guardian", progress: 100, accent: "#C0A8DC", status: "Protected" },
];

export const loveNotes = [
  {
    id: "note-1",
    from: "Avery",
    to: "Riley",
    subject: "For a heavy day",
    body: "I tucked a little reminder here: one step, one breath, one kind thought at a time.",
    scheduledFor: "Tonight, 8:30 PM",
    read: false,
  },
  {
    id: "note-2",
    from: "Riley",
    to: "Avery",
    subject: "Saved for a hard day",
    body: "You are loved in the ordinary moments too.",
    scheduledFor: "Delivered yesterday",
    read: true,
  },
];

export const memoryPages = [
  {
    id: "memory-1",
    title: "A favorite visit",
    date: "Private page",
    excerpt: "A page for a warm shared moment that should stay private until an account unlocks it.",
    tone: "blush",
  },
  {
    id: "memory-2",
    title: "Saved message milestone",
    date: "Achievement draft",
    excerpt: "A keepsake page for the moment small notes became a little shared archive.",
    tone: "lavender",
  },
  {
    id: "memory-3",
    title: "Shared milestone",
    date: "Quest draft",
    excerpt: "A quiet milestone page with room for photos, letters, and favorite details.",
    tone: "garden",
  },
] as const;

export const miniGames = [
  {
    id: "memory-match",
    title: "Memory Match",
    reward: "Coins + hearts",
    description: "Flip cozy keepsake cards in couple-vs-couple or party mode.",
    status: "Couple + party",
    href: "/app/memory-match",
  },
  {
    id: "petal-catch",
    title: "Petal Catch",
    reward: "Coins + hearts",
    description: "Catch falling petals and hearts, avoid thorns, and build a combo before the timer runs out.",
    status: "Playable",
    href: "/app/petal-catch",
  },
  {
    id: "moonberry-bowling",
    title: "Moonberry Bowling",
    reward: "Coins + hearts",
    description: "Roll a moonberry ball down Casper's cozy lane and knock heart pins for wallet rewards.",
    status: "Playable",
    href: "/app/bowling",
  },
  {
    id: "moonberry-pool",
    title: "Moonberry Pool",
    reward: "Coins + hearts",
    description: "Aim, pull back, and pocket cozy moonberry balls on a soft garden arcade table.",
    status: "Playable party",
    href: "/app/pool",
  },
  {
    id: "garden-four",
    title: "Garden Four",
    reward: "Coins + hearts",
    description: "Drop keepsakes into a shared arbor and connect four in a pass-and-play party board game.",
    status: "Playable party",
    href: "/app/garden-four",
  },
  {
    id: "moonbeam-bakeoff",
    title: "Moonbeam Bake-Off",
    reward: "Coins + hearts",
    description: "Take turns adding the right cozy ingredient and finish a glowing mooncake together.",
    status: "Co-op party",
    href: "/app/moonbeam-bakeoff",
  },
  {
    id: "firefly-grove",
    title: "Firefly Grove",
    reward: "Coins + hearts",
    description: "Guide fireflies into lanterns as a shared glow-chain puzzle.",
    status: "Co-op party",
    href: "/app/firefly-grove",
  },
  {
    id: "moonlight-melody",
    title: "Moonlight Melody",
    reward: "Coins + hearts",
    description: "Pass a garden melody around the party and keep the combo alive.",
    status: "Co-op party",
    href: "/app/moonlight-melody",
  },
  {
    id: "rock-paper-scissors",
    title: "Moonstone RPS",
    reward: "Coins + hearts",
    description: "Secret-pick rock paper scissors with real turn switching, round history, and best-of-five rewards.",
    status: "Playable party",
    href: "/app/rock-paper-scissors",
  },
  {
    id: "fashion-show",
    title: "Fashion Show",
    reward: "Coins + hearts",
    description: "Style your keeper and companion for themed runway rounds with judges, poses, and rewards.",
    status: "Playable",
    href: "/app/fashion-show",
  },
];

export const partyGames = [
  {
    id: "memory-match-party",
    title: "Memory Match",
    mode: "2 couples or 6 guests",
    href: "/app/memory-match",
    description: "Pass turns around a keepsake board, score pairs, and award the winning couple or party guest.",
  },
  {
    id: "garden-four-party",
    title: "Garden Four",
    mode: "2 teams or couples",
    href: "/app/garden-four",
    description: "A cozy connect-four style party table with animated keepsake drops, win detection, and wallet rewards.",
  },
  {
    id: "moonstone-rps-party",
    title: "Moonstone RPS",
    mode: "2 players or teams",
    href: "/app/rock-paper-scissors",
    description: "Secret-pick rock paper scissors with enforced pass-and-play turns, round reveals, and best-of-five rewards.",
  },
  {
    id: "petal-catch-party",
    title: "Petal Catch Relay",
    mode: "solo now, co-op next",
    href: "/app/petal-catch",
    description: "Catch petals and hearts in a timed arcade round. The next version can share a basket between players.",
  },
  {
    id: "moonberry-bowling-party",
    title: "Moonberry Bowling",
    mode: "2-player party lane",
    href: "/app/bowling",
    description: "A cozy two-player bowling lane with alternating turns, frame scoring, pin collisions, and Casper cheering each round.",
  },
  {
    id: "moonberry-pool-party",
    title: "Moonberry Pool",
    mode: "2-player table",
    href: "/app/pool",
    description: "A date-night garden table with shared turns, synced ball positions, score, scratches, and cozy rewards.",
  },
  {
    id: "moonbeam-bakeoff-party",
    title: "Moonbeam Bake-Off",
    mode: "2-4 baker team",
    href: "/app/moonbeam-bakeoff",
    description: "A co-op kitchen game where friends pass ingredient cues, build combo, and finish a glowing mooncake.",
  },
  {
    id: "firefly-grove-party",
    title: "Firefly Grove",
    mode: "2-6 glow team",
    href: "/app/firefly-grove",
    description: "Guide fireflies through a shared lantern path. Every player gets turns to keep the grove glowing.",
  },
  {
    id: "moonlight-melody-party",
    title: "Moonlight Melody",
    mode: "2-4 duet band",
    href: "/app/moonlight-melody",
    description: "A soft rhythm duet where party seats pass the next color note and build one shared melody score.",
  },
  {
    id: "lantern-relay",
    title: "Lantern Relay",
    mode: "solo arcade",
    href: "/app/lantern-relay",
    description: "Light lanterns along the garden path in a timed solo arcade round. Shared relay turns are still a future sync pass.",
  },
  {
    id: "heart-hunt",
    title: "Heart Hunt",
    mode: "solo hunt",
    href: "/app/heart-hunt",
    description: "Search a cozy room for hidden keepsakes in a solo timed hunt. Room-party clue sync is still a future pass.",
  },
  {
    id: "fashion-show-party",
    title: "Fashion Show",
    mode: "solo runway",
    href: "/app/fashion-show",
    description: "A runway stage with outfit choices, pet poses, judging rounds, and wallet rewards. Shared judging is still a future pass.",
  },
];

export const parkGames = [
  {
    id: "park-petal-catch",
    title: "Petal Catch Stall",
    mode: "solo arcade",
    href: "/app/petal-catch",
    description: "A flower-cart mini-game kiosk beside the lantern path.",
  },
  {
    id: "park-bowling",
    title: "Moonberry Bowling Lane",
    mode: "two-player lane",
    href: "/app/bowling",
    description: "A cozy party lane tucked next to Casper's snack stand.",
  },
  {
    id: "park-pool",
    title: "Moonberry Pool Table",
    mode: "solo arcade",
    href: "/app/pool",
    description: "A soft felt table for date-night bank shots and cozy pocket combos.",
  },
  {
    id: "park-garden-four",
    title: "Garden Four Table",
    mode: "couples table",
    href: "/app/garden-four",
    description: "A board-game table for turn-based couples and parties.",
  },
  {
    id: "park-moonbeam-bakeoff",
    title: "Moonbeam Bake-Off Cart",
    mode: "co-op kitchen",
    href: "/app/moonbeam-bakeoff",
    description: "A picnic bakery cart for shared ingredient timing games.",
  },
  {
    id: "park-firefly-grove",
    title: "Firefly Grove Ring",
    mode: "co-op lanterns",
    href: "/app/firefly-grove",
    description: "A lantern-circle game where friends guide fireflies together.",
  },
  {
    id: "park-moonlight-melody",
    title: "Moonlight Melody Stand",
    mode: "co-op rhythm",
    href: "/app/moonlight-melody",
    description: "A little bandstand for shared garden melodies and combos.",
  },
  {
    id: "park-fashion-show",
    title: "Fashion Show Stage",
    mode: "runway stage",
    href: "/app/fashion-show",
    description: "A dress-up runway with animated character and pet poses.",
  },
  {
    id: "park-heart-hunt",
    title: "Heart Hunt Trail",
    mode: "party search",
    href: "/app/heart-hunt",
    description: "A little trailhead for keepsake hunts and friend clues.",
  },
];

export const partySeats = [
  { id: "seat-avery", name: "Avery", role: "Host", ready: true, team: "Blush" },
  { id: "seat-riley", name: "Riley", role: "Partner", ready: true, team: "Blush" },
  { id: "seat-alex", name: "Alex", role: "Guest", ready: false, team: "Lavender" },
  { id: "seat-maya", name: "Maya", role: "Guest", ready: false, team: "Lavender" },
  { id: "seat-open-1", name: "Open seat", role: "Invite", ready: false, team: "Garden" },
  { id: "seat-open-2", name: "Open seat", role: "Invite", ready: false, team: "Garden" },
  { id: "seat-open-3", name: "Open seat", role: "Invite", ready: false, team: "Honey" },
  { id: "seat-open-4", name: "Open seat", role: "Invite", ready: false, team: "Sky" },
];

export const friendInvite = {
  code: "HH-GARDEN-247",
  title: "Invite a trusted friend",
  description: "Share a code, open a room session, and let friends visit once multiplayer presence is enabled.",
};

export function getCatalogItem(id: string): CatalogItem | undefined {
  return marketCatalog.find((item) => item.id === id);
}
