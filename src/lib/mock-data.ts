import type { CatalogItem } from "@/lib/game/types";
import { starterCatalog } from "@/lib/catalog";

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
  trait: "Guardian of the starter garden",
};

export const inventoryItems = starterCatalog.map((item, index) => ({
  id: `inventory-${item.id}`,
  item,
  quantity: index < 4 ? 1 : 3,
  equipped: index < 2,
}));

export const gardenPlots = [
  { id: "plot-moonberry", name: "Moonberry", stage: "Blooming", progress: 64, accent: "#F4B5BE", status: "Watered" },
  { id: "plot-honey-clover", name: "Honey Clover", stage: "Sprout", progress: 31, accent: "#D9A53E", status: "Needs sun" },
  { id: "plot-lavender-star", name: "Lavender Star", stage: "Growing", progress: 48, accent: "#8E70BD", status: "Watered" },
  { id: "plot-sky-mint", name: "Sky Mint", stage: "Seed", progress: 12, accent: "#5E94B0", status: "New" },
];

export const partnerGardenPlots = [
  { id: "ng-rose", name: "Distance Rose", stage: "Blooming", progress: 88, accent: "#F4B5BE", status: "Shared" },
  { id: "ng-prayer-lily", name: "Prayer Lily", stage: "Growing", progress: 72, accent: "#FAE3A8", status: "Shared" },
  { id: "ng-casper-tree", name: "Casper Tree", stage: "Guardian", progress: 100, accent: "#C0A8DC", status: "Protected" },
];

export const loveNotes = [
  {
    id: "note-1",
    from: "Nicholas",
    to: "Gianna",
    subject: "For when finals feel heavy",
    body: "I tucked a little reminder here: one step, one breath, one prayer at a time.",
    scheduledFor: "Tonight, 8:30 PM",
    read: false,
  },
  {
    id: "note-2",
    from: "Gianna",
    to: "Nicholas",
    subject: "Saved for a hard day",
    body: "You are loved in the ordinary moments too.",
    scheduledFor: "Delivered yesterday",
    read: true,
  },
];

export const memoryPages = [
  {
    id: "memory-1",
    title: "The virtual date that felt real",
    date: "Private page",
    excerpt: "A page for a night that lived somewhere between a screen and a real place.",
    tone: "blush",
  },
  {
    id: "memory-2",
    title: "365th saved message",
    date: "Achievement draft",
    excerpt: "A keepsake page for the moment the saved messages became a little archive of us.",
    tone: "lavender",
  },
  {
    id: "memory-3",
    title: "Almost two years",
    date: "Quest draft",
    excerpt: "A quiet milestone page with room for photos, letters, prayers, and favorite details.",
    tone: "garden",
  },
] as const;

export const miniGames = [
  {
    id: "memory-match",
    title: "Memory Match",
    reward: "80 coins",
    description: "Flip cozy keepsake cards and find matching pairs before the lantern fades.",
    status: "Phase 4",
  },
  {
    id: "garden-catch",
    title: "Garden Catch",
    reward: "Seed bundle",
    description: "Catch falling seeds, petals, and moonberries to feed your garden loop.",
    status: "Phase 4",
  },
];

export const friendInvite = {
  code: "HH-LOVE-365",
  title: "Invite a trusted friend",
  description: "Share a code, open a room session, and let friends visit once multiplayer presence is enabled.",
};

export function getCatalogItem(id: string): CatalogItem | undefined {
  return starterCatalog.find((item) => item.id === id);
}
