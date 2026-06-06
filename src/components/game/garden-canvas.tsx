"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import Image from "next/image";
import type Phaser from "phaser";
import {
  getKeeperHairColor,
  getKeeperSkinTone,
  getPetAccessory,
  getPetTone,
  gaitPhase,
  keeperFrame,
  keeperGaitPose,
  keeperHairFrame,
  keeperSkinFrame,
  isFlyingPetSpecies,
  KEEPER_CUSTOMIZATION_EVENT,
  normalizeRemoteCustomization,
  petAccessoryFrame,
  petFrame,
  petGaitPose,
  PET_CUSTOMIZATION_EVENT,
  readKeeperCustomization,
  readPetCustomization,
  type KeeperCustomization,
  type KeeperBodyId,
  type KeeperCharacterId,
  type KeeperHairColorId,
  type KeeperHairStyleId,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperPose,
  type KeeperSkinId,
  type PetCustomization,
  type PetAccessoryId,
  type PetPose,
  type PetSpeciesId,
  type PetToneId,
} from "@/lib/game/avatar-customization";
import { recordActivity } from "@/lib/game/activity";
import { playCozyCue, setHeroicCompanionTheme } from "@/lib/game/cozy-audio";
import {
  PET_VITALS_EVENT,
  getPetBehavior,
  getPetMood,
  getPetVitals,
  startPetNap,
  type PetBehavior,
  type PetMood,
} from "@/lib/game/pet-state";
import { ZONE_DISCOVERIES, isItemFound, markDiscoveryFound, nearestHidden } from "@/lib/game/discoveries-store";
import type { GardenChatMessage } from "@/lib/game/chat-moderation";
import { getGardenDecorArt } from "@/lib/game/item-art";
import type { FacingDirection, RealtimeRoomPlayer } from "@/lib/game/types";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";

type GardenPlotState = {
  id: string;
  name: string;
  stage: string;
  progress: number;
  accent: string;
  status: string;
};

type GardenCanvasProps = {
  remotePlayers?: RealtimeRoomPlayer[];
  variant: "personal" | "partner" | "park";
  plots: GardenPlotState[];
  decor?: GardenDecorPlacement[];
  pendingDecorIds?: string[];
  canEditGarden?: boolean;
  onAvatarMove?: (position: {
    x: number;
    y: number;
    facing: FacingDirection;
    petX?: number;
    petY?: number;
    petFacing?: FacingDirection;
    controlMode?: "keeper" | "companion";
  }) => void;
  onNavigate?: (href: string) => void;
  onDecorChange?: (decor: GardenDecorPlacement[]) => void;
  onPlotCare?: (plotId: string, action: "water" | "harvest") => void;
};

export type GardenDecorKind =
  | "gazebo"
  | "swing"
  | "picnic"
  | "bbq"
  | "fountain"
  | "lanternArch"
  | "fashionStage"
  | "arcadeKiosk"
  | "bowlingKiosk"
  | "greenhouse"
  | "memoryTree"
  | "flowerStand";

export type GardenDecorPlacement = {
  id: string;
  kind: GardenDecorKind;
  label: string;
  href?: string;
  x: number;
  y: number;
  rotation: number;
};

type RemoteGardenAvatarObject = {
  container: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Sprite;
  skinSprite: Phaser.GameObjects.Sprite;
  hairSprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  /** Each visiting keeper brings their own customized pet. */
  petContainer: Phaser.GameObjects.Container;
  petShadow: Phaser.GameObjects.Ellipse;
  petSprite: Phaser.GameObjects.Sprite;
  petAccessorySprite: Phaser.GameObjects.Sprite;
  /** Cached customization so frames only rebuild when it actually changes. */
  characterId: KeeperCharacterId;
  bodyId: KeeperBodyId;
  skinId: KeeperSkinId;
  hairStyleId: KeeperHairStyleId;
  hairColorId: KeeperHairColorId;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  petSpeciesId: PetSpeciesId;
  petToneId: PetToneId;
  petAccessoryId: PetAccessoryId;
  facing: FacingDirection;
  /** Remote pet facing — independent of the keeper facing now that the
   *  pet can be driven separately in companion mode. */
  petFacing: FacingDirection;
  /** Whether the remote keeper is currently driving themselves or their
   *  pet. Used to dim the inactive sprite so the viewer can tell at a
   *  glance who's actually being controlled. */
  controlMode: "keeper" | "companion";
  movingUntil: number;
};

type GardenPetMood = "idle" | "follow" | "sit" | "happy";
type KeeperAfkAnimation = "idle" | "sit" | "wave" | "heart" | "yoyo";
type GardenTimeOfDay = "morning" | "noon" | "night";

const gardenTimeOfDayCopy: Record<
  GardenTimeOfDay,
  { label: string; hint: string; selectedClass: string }
> = {
  morning: {
    label: "Morning",
    hint: "Golden dew",
    selectedClass: "border-honey-300 bg-gradient-to-b from-honey-100 to-cream-100 text-ink-900 shadow-[0_10px_22px_-16px_rgba(184,129,44,0.7)]",
  },
  noon: {
    label: "Noon",
    hint: "Clear decorating",
    selectedClass: "border-garden-300 bg-gradient-to-b from-white to-garden-100 text-garden-900 shadow-[0_10px_22px_-16px_rgba(69,117,56,0.58)]",
  },
  night: {
    label: "Night",
    hint: "Lantern glow",
    selectedClass: "border-lavender-300 bg-gradient-to-b from-lavender-200 to-lavender-400 text-ink-900 shadow-[0_10px_22px_-16px_rgba(85,65,137,0.68)]",
  },
};

const GARDEN_WIDTH = 960;
const GARDEN_HEIGHT = 620;
const WORLD_SCALE = 1.25;
const BASE_GARDEN_WORLD_WIDTH = 3400;
const BASE_GARDEN_WORLD_HEIGHT = 1133;
const GARDEN_WORLD_WIDTH = Math.round(BASE_GARDEN_WORLD_WIDTH * WORLD_SCALE);
const GARDEN_WORLD_HEIGHT = Math.round(BASE_GARDEN_WORLD_HEIGHT * WORLD_SCALE);
const WORLD_EDGE_INSET = 80;
const GARDEN_STORAGE_PREFIX = "hearthaven:garden-decor:v3:";

type WalkSegment = { x1: number; y1: number; x2: number; y2: number; radius: number };
type WalkCircle = { x: number; y: number; radius: number };
type WorldPolygonPoint = { x: number; y: number };

function worldX(value: number) {
  return Math.round(value * WORLD_SCALE);
}

function worldY(value: number) {
  return Math.round(value * WORLD_SCALE);
}

function worldRadius(value: number) {
  return Math.round(value * WORLD_SCALE);
}

function scaleSegment(segment: WalkSegment): WalkSegment {
  return {
    x1: worldX(segment.x1),
    y1: worldY(segment.y1),
    x2: worldX(segment.x2),
    y2: worldY(segment.y2),
    radius: worldRadius(segment.radius),
  };
}

function scaleCircle(circle: WalkCircle): WalkCircle {
  return {
    x: worldX(circle.x),
    y: worldY(circle.y),
    radius: worldRadius(circle.radius),
  };
}

function scalePolygon(points: WorldPolygonPoint[]): WorldPolygonPoint[] {
  return points.map((point) => ({ x: worldX(point.x), y: worldY(point.y) }));
}

const sharedWalkSegments: WalkSegment[] = [
  { x1: 104, y1: 694, x2: 500, y2: 570, radius: 100 },
  { x1: 500, y1: 570, x2: 900, y2: 462, radius: 104 },
  { x1: 900, y1: 462, x2: 1280, y2: 555, radius: 106 },
  { x1: 1280, y1: 555, x2: 1720, y2: 610, radius: 112 },
  { x1: 1720, y1: 610, x2: 2140, y2: 520, radius: 112 },
  { x1: 2140, y1: 520, x2: 2600, y2: 590, radius: 114 },
  { x1: 2600, y1: 590, x2: 3260, y2: 650, radius: 118 },
  { x1: 470, y1: 385, x2: 1140, y2: 360, radius: 118 },
  { x1: 1140, y1: 360, x2: 1740, y2: 430, radius: 116 },
  { x1: 1740, y1: 430, x2: 2380, y2: 390, radius: 118 },
  { x1: 720, y1: 802, x2: 2800, y2: 806, radius: 128 },
].map(scaleSegment);

const parkWalkSegments: WalkSegment[] = [
  { x1: 70, y1: 650, x2: 410, y2: 645, radius: 132 },
  { x1: 410, y1: 645, x2: 720, y2: 515, radius: 130 },
  { x1: 720, y1: 515, x2: 1040, y2: 380, radius: 126 },
  { x1: 1040, y1: 380, x2: 1320, y2: 386, radius: 126 },
  { x1: 1320, y1: 386, x2: 1660, y2: 520, radius: 126 },
  { x1: 1660, y1: 520, x2: 2060, y2: 420, radius: 132 },
  { x1: 2060, y1: 420, x2: 2320, y2: 510, radius: 132 },
  { x1: 2320, y1: 510, x2: 2620, y2: 600, radius: 142 },
  { x1: 2620, y1: 600, x2: 3280, y2: 515, radius: 140 },
  { x1: 690, y1: 752, x2: 2520, y2: 752, radius: 132 },
  { x1: 420, y1: 292, x2: 870, y2: 230, radius: 150 },
  { x1: 1390, y1: 246, x2: 1910, y2: 252, radius: 160 },
  { x1: 2220, y1: 780, x2: 2920, y2: 780, radius: 164 },
].map(scaleSegment);

const sharedWalkCircles: WalkCircle[] = [
  { x: 252, y: 418, radius: 118 },
  { x: 426, y: 488, radius: 112 },
  { x: 500, y: 570, radius: 126 },
  { x: 612, y: 412, radius: 112 },
  { x: 700, y: 430, radius: 112 },
  { x: 900, y: 462, radius: 126 },
  { x: 1048, y: 420, radius: 112 },
  { x: 1280, y: 555, radius: 132 },
  { x: 1348, y: 525, radius: 116 },
  { x: 2140, y: 520, radius: 138 },
  { x: 2860, y: 610, radius: 142 },
].map(scaleCircle);

const parkWalkCircles: WalkCircle[] = [
  { x: 230, y: 652, radius: 270 },
  { x: 540, y: 404, radius: 206 },
  { x: 780, y: 225, radius: 258 },
  { x: 860, y: 548, radius: 188 },
  { x: 1160, y: 612, radius: 222 },
  { x: 1570, y: 246, radius: 286 },
  { x: 1560, y: 510, radius: 210 },
  { x: 2220, y: 510, radius: 294 },
  { x: 2380, y: 760, radius: 318 },
  { x: 2580, y: 618, radius: 210 },
  { x: 2860, y: 590, radius: 232 },
  { x: 3030, y: 264, radius: 202 },
  { x: 3140, y: 470, radius: 190 },
].map(scaleCircle);

/**
 * Expanded walkable footprints used only for movement clamping — the painted
 * park has landmarks (swings, sakura, claw machine, conservatory, rose arch)
 * spread across the whole world, but the visible cream-coloured corridor
 * above only covers the lower band. These extra circles give the keeper
 * AND the companion free range across the whole painted scene without
 * changing the look of the path overlay.
 *
 * Coordinates roughly match the percent positions used by `screens-v6.jsx`
 * in the design package, converted to the 3400×1133 world space.
 */
const parkWalkableExtensions: WalkCircle[] = [
  // Top band — near swings, rose arch, claw machine, sakura
  { x: 612, y: 220, radius: 270 },
  { x: 1530, y: 220, radius: 300 },
  { x: 1904, y: 280, radius: 255 },
  { x: 2788, y: 220, radius: 270 },
  // Upper-middle band — picnic, stage, conservatory
  { x: 220, y: 380, radius: 280 },
  { x: 1020, y: 380, radius: 300 },
  { x: 2312, y: 380, radius: 290 },
  // Wider open lawns connecting plots laterally
  { x: 800, y: 460, radius: 270 },
  { x: 1340, y: 460, radius: 270 },
  { x: 1860, y: 450, radius: 280 },
  { x: 2520, y: 460, radius: 280 },
  // Lower band — gazebo, flower cart, bowling, the bottom strip
  { x: 380, y: 720, radius: 270 },
  { x: 720, y: 720, radius: 260 },
  { x: 2080, y: 740, radius: 280 },
  { x: 2780, y: 720, radius: 280 },
  // Discovery glow-patch positions — derived from ZONE_DISCOVERIES.park
  // coordinates (0–100 % of the painted scene, projected onto the 3400×1133
  // world). Each has a generous walkable bubble so the companion can step
  // onto the "Sniff me" marker directly even when it sits off the main
  // road overlay.
  { x: 816, y: 884, radius: 240 },   // acorn pile near swings
  { x: 1768, y: 929, radius: 240 },  // iridescent feather near cave
  { x: 2720, y: 951, radius: 250 },  // wild strawberries near picnic path
  { x: 2992, y: 249, radius: 250 },  // firefly jar near lantern arch
].map(scaleCircle);

/**
 * Vertical connectors between the bands so the keeper can walk straight up
 * from a lower path to an upper one — the painted park shows ribbons of
 * road between every plot column.
 */
const parkWalkableConnectors: WalkSegment[] = [
  { x1: 540, y1: 220, x2: 540, y2: 720, radius: 126 },
  { x1: 1020, y1: 220, x2: 1020, y2: 700, radius: 126 },
  { x1: 1560, y1: 220, x2: 1560, y2: 700, radius: 132 },
  { x1: 1900, y1: 220, x2: 1900, y2: 720, radius: 132 },
  { x1: 2312, y1: 220, x2: 2312, y2: 700, radius: 132 },
  { x1: 2788, y1: 220, x2: 2788, y2: 700, radius: 132 },
].map(scaleSegment);

/**
 * Garden equivalent — the personal and partner gardens are a single zig-zag
 * corridor along the bottom. Add a wider band on either side so the keeper
 * can step off-path to reach planters and decor.
 */
const sharedWalkableExtensions: WalkCircle[] = [
  { x: 400, y: 380, radius: 240 },
  { x: 900, y: 360, radius: 260 },
  { x: 1400, y: 380, radius: 240 },
  { x: 1900, y: 400, radius: 260 },
  { x: 2400, y: 380, radius: 260 },
  { x: 2900, y: 400, radius: 240 },
  { x: 700, y: 800, radius: 250 },
  { x: 1500, y: 800, radius: 270 },
  { x: 2300, y: 800, radius: 250 },
  { x: 3000, y: 800, radius: 250 },
  // Garden discovery patches — derived from ZONE_DISCOVERIES.garden coords
  // so the "Sniff me" markers always sit inside a walkable bubble.
  { x: 1088, y: 793, radius: 240 },  // moonberry clutch
  { x: 2176, y: 861, radius: 240 },  // pressed flower
  { x: 2584, y: 680, radius: 240 },  // tin soldier
].map(scaleCircle);

const waterPolygonsByVariant: Record<GardenCanvasProps["variant"], WorldPolygonPoint[][]> = {
  personal: [
    scalePolygon([
      { x: 2460, y: 240 },
      { x: 3380, y: 220 },
      { x: 3380, y: 500 },
      { x: 3020, y: 548 },
      { x: 2580, y: 470 },
    ]),
  ],
  partner: [
    scalePolygon([
      { x: 2460, y: 240 },
      { x: 3380, y: 220 },
      { x: 3380, y: 500 },
      { x: 3020, y: 548 },
      { x: 2580, y: 470 },
    ]),
  ],
  park: [
    scalePolygon([
      { x: 2470, y: 176 },
      { x: 2840, y: 152 },
      { x: 2950, y: 324 },
      { x: 2700, y: 438 },
      { x: 2420, y: 330 },
    ]),
  ],
};

/**
 * Variant-aware starting position for the keeper. The previous default
 * (420, 430) sat above the corridor on every variant, which meant the very
 * first keypress yanked the avatar down onto the path. The new defaults
 * land squarely inside the first walkable segment / circle for each
 * variant, so movement feels stable from the first frame.
 */
function getAvatarStartPosition(variant: GardenCanvasProps["variant"]) {
  if (variant === "park") {
    // Inside the first park circle (540, 404, r=210) — center-of-path.
    return { x: worldX(540), y: worldY(404) };
  }
  // Both `garden` and `partner` share the same walkable corridor. The first
  // shared circle sits at (500, 570, r=190), which is the natural "you walk
  // in from the path" entry point.
  return { x: worldX(500), y: worldY(570) };
}

function getPlotPositions(variant: GardenCanvasProps["variant"]) {
  const positions = variant === "partner"
    ? [
        [260, 376],
        [700, 376],
        [318, 492],
        [642, 492],
        [1048, 348],
        [1348, 476],
      ]
    : [
        [252, 360],
        [426, 430],
        [612, 352],
        [628, 492],
        [1042, 348],
        [1360, 486],
      ];
  return positions.map(([x, y]) => [worldX(x), worldY(y)] as [number, number]);
}

const gardenDecorItems: Array<{ kind: GardenDecorKind; label: string; description: string; href?: string }> = [
  { kind: "gazebo", label: "Gazebo", description: "Large meetup structure" },
  { kind: "swing", label: "Swing set", description: "A cozy two-seat swing" },
  { kind: "picnic", label: "Picnic table", description: "Snacks and letters outside" },
  { kind: "bbq", label: "BBQ", description: "Warm grill for garden parties" },
  { kind: "fountain", label: "Berry fountain", description: "Animated water decor" },
  { kind: "lanternArch", label: "Lantern arch", description: "Garden entrance glow" },
  { kind: "fashionStage", label: "Fashion stage", description: "Walk-up runway game", href: "/app/fashion-show" },
  { kind: "arcadeKiosk", label: "Arcade kiosk", description: "Walk-up mini-game stand", href: "/app/petal-catch" },
  { kind: "bowlingKiosk", label: "Bowling kiosk", description: "Moonberry lane game", href: "/app/bowling" },
  { kind: "greenhouse", label: "Greenhouse", description: "Garden expansion piece" },
  { kind: "memoryTree", label: "Memory tree", description: "Shared keepsake centerpiece" },
  { kind: "flowerStand", label: "Flower stand", description: "Extra blooms and color" },
];

const worldObjectSprites: Record<GardenDecorKind, { frame: number; width: number; height: number; yOffset: number }> = {
  gazebo: { frame: 0, width: 260, height: 260, yOffset: -72 },
  swing: { frame: 1, width: 248, height: 218, yOffset: -62 },
  picnic: { frame: 2, width: 232, height: 190, yOffset: -48 },
  bbq: { frame: 3, width: 176, height: 210, yOffset: -60 },
  fountain: { frame: 4, width: 230, height: 220, yOffset: -58 },
  lanternArch: { frame: 5, width: 230, height: 242, yOffset: -76 },
  fashionStage: { frame: 6, width: 286, height: 248, yOffset: -66 },
  arcadeKiosk: { frame: 7, width: 202, height: 236, yOffset: -64 },
  bowlingKiosk: { frame: 8, width: 218, height: 234, yOffset: -64 },
  greenhouse: { frame: 9, width: 268, height: 248, yOffset: -72 },
  memoryTree: { frame: 10, width: 286, height: 254, yOffset: -78 },
  flowerStand: { frame: 11, width: 226, height: 210, yOffset: -58 },
};

const decorInteractionCopy: Record<GardenDecorKind, string> = {
  gazebo: "The gazebo glows like a tiny party room. A good place for friend invites.",
  swing: "The swing rocks gently. Casper trots over like this is the best part of the park.",
  picnic: "The picnic table is set with moonberry tea and a little envelope for guests.",
  bbq: "The BBQ warms up for a garden party. The smoke smells like honey clover.",
  fountain: "The berry fountain splashes a bright little wish into the air.",
  lanternArch: "The lantern arch turns the path into a date-night walkway.",
  fashionStage: "The fashion stage is ready. Walk up again to start the runway.",
  arcadeKiosk: "The arcade kiosk hums with petals, combos, and prizes.",
  bowlingKiosk: "The moonberry lane is polished. Walk up again to bowl.",
  greenhouse: "The greenhouse breathes warm air over every growing plot.",
  memoryTree: "The memory tree lights up, saving this visit as a tiny keepsake.",
  flowerStand: "The flower stand releases fresh petals across the walkway.",
};

/**
 * True if the user is currently typing into a text input — used to suspend
 * canvas keyboard movement so WASD doesn't fire while writing chat.
 */
function isTextInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function isFacingLeft(rotation: number) {
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  return normalized >= 90 && normalized < 270;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function facingRotation(facing: FacingDirection) {
  return facing === "left" ? 180 : 0;
}

function petFlipX(facing: FacingDirection) {
  return facing === "right";
}

export function GardenCanvas({
  canEditGarden = true,
  decor,
  onAvatarMove,
  onNavigate,
  onDecorChange,
  onPlotCare,
  pendingDecorIds = [],
  remotePlayers = [],
  variant,
  plots,
}: GardenCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const remotePlayersRef = useRef(remotePlayers);
  const decorRef = useRef<GardenDecorPlacement[]>(decor ?? readGardenDecor(variant));
  const pendingDecorIdsRef = useRef(pendingDecorIds);
  const onDecorChangeRef = useRef(onDecorChange);
  const onPlotCareRef = useRef(onPlotCare);
  const plotsRef = useRef(plots);
  const onNavigateRef = useRef(onNavigate);
  const timeOfDayRef = useRef<GardenTimeOfDay>("noon");
  const { activeEvent } = useSeasonalEvent();
  const [timeOfDay, setTimeOfDay] = useState<GardenTimeOfDay>("noon");
  const [status, setStatus] = useState(
    variant === "partner"
      ? "The shared garden is glowing under Casper's watch."
      : variant === "park"
        ? "Walk Honeyheart Park, follow the roads, and meet friends by the swings."
        : "Walk the garden, water plots, decorate, and follow the road to the park.",
  );

  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
    window.dispatchEvent(new CustomEvent("hearthaven:garden-remote-players", { detail: { players: remotePlayers } }));
  }, [remotePlayers]);

  useEffect(() => {
    onDecorChangeRef.current = onDecorChange;
    onPlotCareRef.current = onPlotCare;
    plotsRef.current = plots;
    window.dispatchEvent(new CustomEvent("hearthaven:garden-plots-updated", { detail: { plots } }));
  }, [onDecorChange, onPlotCare, plots]);

  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    const nextDecor = decor ?? readGardenDecor(variant);
    decorRef.current = nextDecor;
    window.dispatchEvent(new CustomEvent("hearthaven:garden-decor-updated", { detail: { decor: nextDecor } }));
  }, [decor, variant]);

  useEffect(() => {
    pendingDecorIdsRef.current = pendingDecorIds;
    window.dispatchEvent(new CustomEvent("hearthaven:garden-pending-decor", { detail: { ids: pendingDecorIds } }));
  }, [pendingDecorIds]);

  useEffect(() => {
    timeOfDayRef.current = timeOfDay;
    window.dispatchEvent(new CustomEvent("hearthaven:garden-time", { detail: { timeOfDay } }));
  }, [timeOfDay]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      const initialDecor = decorRef.current;
      if (!mountRef.current || destroyed) return;

      class HeartHavenGardenScene extends PhaserModule.Scene {
        private butterflies: Phaser.GameObjects.Sprite[] = [];
        private fireflies: Phaser.GameObjects.Sprite[] = [];
        private avatar!: Phaser.GameObjects.Container;
        private avatarShadow!: Phaser.GameObjects.Ellipse;
        private avatarSprite!: Phaser.GameObjects.Sprite;
        private avatarSkinSprite!: Phaser.GameObjects.Sprite;
        private avatarHairSprite!: Phaser.GameObjects.Sprite;
        private avatarPose: KeeperPose = "idle";
        private avatarFacing: FacingDirection = "right";
        private afkIdleMs = 0;
        private afkAnimation: KeeperAfkAnimation = "idle";
        private afkStartedAt = 0;
        private afkNextAt = 4200;
        private afkEffect?: Phaser.GameObjects.Container;
        private afkEffectNextAt = 0;
        private keeperCustomization: KeeperCustomization = readKeeperCustomization();
        private pet!: Phaser.GameObjects.Container;
        private petShadow!: Phaser.GameObjects.Ellipse;
        private petSprite!: Phaser.GameObjects.Sprite;
        private petAccessorySprite!: Phaser.GameObjects.Sprite;
        private petCustomization: PetCustomization = readPetCustomization();
        private petMood: GardenPetMood = "idle";
        private petMoodTimer = 0;
        private petFacing: FacingDirection = "right";
        /**
         * Idle breathing tween on the pet. We pause it while the player is
         * driving the companion — otherwise the yoyo motion fights every
         * vertical keypress and the companion only seems to move on X.
         */
        private petBobTween?: Phaser.Tweens.Tween;
        private companionMood: PetMood = getPetMood(getPetVitals());
        private companionMoodHandler?: (event: Event) => void;
        // Vitals-derived behaviour modifiers. Cached at the scene level so
        // per-frame reads are a property access; refreshed whenever the
        // PET_VITALS_EVENT fires (care actions, decay events, nap end).
        private petBehavior: PetBehavior = getPetBehavior();
        /** True while the companion is shuffling off-screen to nap because
         *  energy hit 0. Set by the `updatePet` exhaustion branch. */
        private petFleeing = false;
        /** Where the fleeing companion is heading. Picked once per flee
         *  to keep the path stable across frames. */
        private petFleeTarget?: { x: number; y: number };
        /** Mirrors `petBehavior.napping` for state-transition detection. */
        private petWasNapping = false;
        private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
        private wasd?: Record<"up" | "left" | "down" | "right" | "rotate", Phaser.Input.Keyboard.Key>;
        private target?: Phaser.Math.Vector2;
        private moveBroadcastTimer = 0;
        private lastSentPetPosition: { x: number; y: number } | null = null;
        private footstepTimer = 0;
        private lastSentPosition = getAvatarStartPosition(variant);
        private selectedDecor?: GardenDecorPlacement;
        private decorBubble?: Phaser.GameObjects.Container;
        private decorObjects = new Map<string, Phaser.GameObjects.Container>();
        private remoteAvatars = new Map<string, RemoteGardenAvatarObject>();
        private remotePlayersHandler?: (event: Event) => void;
        private remotePlayersRefreshTimer = 0;
        private lastRemotePlayersSnapshot?: RealtimeRoomPlayer[];
        private chatBubbleHandler?: (event: Event) => void;
        private addDecorHandler?: (event: Event) => void;
        private decorUpdatedHandler?: (event: Event) => void;
        private pendingDecorHandler?: (event: Event) => void;
        private pendingDecorIds = new Set(pendingDecorIdsRef.current);
        private sunshineHandler?: (event: Event) => void;
        private keeperCustomizationHandler?: (event: Event) => void;
        private petCustomizationHandler?: (event: Event) => void;
        private timeOfDayHandler?: (event: Event) => void;
        private textInputFocused = false;
        private textInputFocusHandler?: (event: Event) => void;
        private timeOverlay?: Phaser.GameObjects.Rectangle;
        private skyWash?: Phaser.GameObjects.Rectangle;
        private lowSunGlow?: Phaser.GameObjects.Ellipse;
        private moonGlow?: Phaser.GameObjects.Ellipse;
        private currentTimeOfDay: GardenTimeOfDay = "noon";
        private decorDragging = false;
        /**
         * Which character the player is actively driving with WASD / arrows.
         * Right-click toggles between them; holding right-click recalls the
         * companion to the keeper. The companion is faster (×1.6) and can
         * roam farther from the keeper than the auto-follow normally allows.
         */
        private playMode: "keeper" | "companion" = "keeper";
        private rightButtonDownAt = 0;
        private rightHoldFired = false;
        private playModeBadge?: Phaser.GameObjects.Container;
        private parkActionHandler?: (event: Event) => void;
        private swapRequestHandler?: (event: Event) => void;
        private positionBroadcastTimer = 0;
        private sniffCooldownUntil = 0;
        /**
         * Track whether the keyboard-bound sniff handler has been wired.
         * Phaser's `input.keyboard.on("keydown-Q", …)` does NOT dedupe — and
         * `createInput` runs on every scene start. Without this flag, HMR /
         * scene re-init in dev would stack listeners, firing `trySniff()`
         * dozens of times per key press until the browser hung.
         */
        private sniffKeyHandler?: () => void;
        private deleteKeyHandler?: () => void;
        private backspaceKeyHandler?: () => void;

        constructor() {
          super("HeartHavenGarden");
        }

        preload() {
          this.load.image("garden-bare-map", "/game-assets/generated/heartheaven-garden-bare-map.png");
          this.load.image("park-bare-map", "/game-assets/generated/heartheaven-park-bare-map.png");
          this.load.image("casper-sprite", "/game-assets/generated/casper-sprite.png");
          this.load.spritesheet("keeper-animation-sheet", "/game-assets/generated/keeper-custom-base-sheet.png", {
            frameWidth: 256,
            frameHeight: 384,
          });
          this.load.spritesheet("keeper-skin-mask-sheet", "/game-assets/generated/keeper-skin-mask-sheet.png", {
            frameWidth: 256,
            frameHeight: 384,
          });
          this.load.spritesheet("keeper-hair-style-sheet", "/game-assets/generated/keeper-hair-style-sheet.png", {
            frameWidth: 256,
            frameHeight: 384,
          });
          this.load.spritesheet("pet-animation-sheet", "/game-assets/generated/pet-art-sheet.png", {
            frameWidth: 256,
            frameHeight: 288,
          });
          this.load.spritesheet("pet-accessory-sprites", "/game-assets/generated/pet-accessory-sprites.png", {
            frameWidth: 256,
            frameHeight: 256,
          });
          this.load.spritesheet("minigame-props", "/game-assets/generated/minigame-props-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
          this.load.spritesheet("cozy-furniture-sprites", "/game-assets/generated/cozy-furniture-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
          this.load.spritesheet("world-object-sprites", "/game-assets/generated/world-object-sprites.png", {
            frameWidth: 384,
            frameHeight: 384,
          });
          this.load.spritesheet("ambient-critter-sprites", "/game-assets/generated/ambient-critter-sprites.png", {
            frameWidth: 512,
            frameHeight: 512,
          });
        }

        create() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.cameras.main.setBounds(0, 0, GARDEN_WORLD_WIDTH, GARDEN_WORLD_HEIGHT);
          this.drawBackdrop();
          this.drawGardenGround();
          this.drawRoadNetwork();
          this.drawLanternPath();
          this.drawWaterFeature();
          this.drawParkDistrict();
          this.drawPlots();
          if (variant === "partner") {
            this.drawPartnerHeart();
          } else {
            this.drawPersonalGardenCenterpiece();
          }
          this.drawButterflies();
          this.drawFireflies();
          this.drawSeasonalGardenDecor();
          // Glow patches mark sniff-able hidden item spots — only useful
          // while in companion mode but drawn in either, so the player
          // knows what they're aiming for after swapping.
          this.drawDiscoveryGlowPatches();
          this.createDecorations(initialDecor);
          this.createAvatar();
          this.createPet();
          this.createInput();
          this.createRealtimeBridge();
          this.refreshRemotePlayersFromReact(true);
          this.cameras.main.startFollow(this.avatar, true, 0.08, 0.08);
          this.cameras.main.setDeadzone(180, 120);
          this.addTitle();
          this.sortDepths();
          // TODO: Subscribe partner garden scene to Supabase Realtime so both linked players see care pulses.
        }

        update(_time: number, delta: number) {
          this.checkRightHold();
          this.updateAvatar(delta);
          this.updatePet(delta);
          this.updateRemoteAvatarAnimation();
          this.remotePlayersRefreshTimer += delta;
          if (this.remotePlayersRefreshTimer > 250) {
            this.remotePlayersRefreshTimer = 0;
            this.refreshRemotePlayersFromReact();
          }
          // Broadcast keeper + companion positions to the HUD/minimap at
          // ~6 Hz — frequent enough for the markers to feel live but cheap
          // for React listeners.
          this.positionBroadcastTimer += delta;
          if (this.positionBroadcastTimer > 165) {
            this.positionBroadcastTimer = 0;
            this.broadcastParkPosition();
          }
          this.butterflies.forEach((butterfly, index) => {
            butterfly.x += Math.sin((this.time.now + index * 400) * 0.0012) * 0.34;
            butterfly.y += Math.cos((this.time.now + index * 300) * 0.001) * 0.18;
          });

          this.fireflies.forEach((firefly, index) => {
            const light = this.getFireflyLight();
            firefly.setAlpha(light.base + Math.sin((this.time.now + index * 240) * 0.004) * light.amplitude);
            firefly.y -= delta * light.drift;
            if (firefly.y < 104) firefly.y = PhaserModule.Math.Between(360, 528);
          });
          this.sortDepths();
        }

        private drawBackdrop() {
          const mapKey = variant === "park" ? "park-bare-map" : "garden-bare-map";
          this.add.image(GARDEN_WORLD_WIDTH / 2, GARDEN_WORLD_HEIGHT / 2, mapKey).setDisplaySize(GARDEN_WORLD_WIDTH, GARDEN_WORLD_HEIGHT).setDepth(-30);
          this.add.rectangle(GARDEN_WORLD_WIDTH / 2, GARDEN_WORLD_HEIGHT / 2, GARDEN_WORLD_WIDTH, GARDEN_WORLD_HEIGHT, 0xfffcf3, 0.04).setDepth(-29);
          this.skyWash = this.add
            .rectangle(GARDEN_WORLD_WIDTH / 2, GARDEN_WORLD_HEIGHT / 2, GARDEN_WORLD_WIDTH, GARDEN_WORLD_HEIGHT, 0xffffff, 0)
            .setDepth(-28)
            .setBlendMode(PhaserModule.BlendModes.ADD);
          this.lowSunGlow = this.add
            .ellipse(GARDEN_WORLD_WIDTH * 0.2, GARDEN_WORLD_HEIGHT * 0.28, 1120, 420, 0xffd18a, 0)
            .setDepth(6794)
            .setBlendMode(PhaserModule.BlendModes.ADD);
          this.moonGlow = this.add
            .ellipse(GARDEN_WORLD_WIDTH * 0.82, GARDEN_WORLD_HEIGHT * 0.18, 760, 430, 0xded0ff, 0)
            .setDepth(6795)
            .setBlendMode(PhaserModule.BlendModes.ADD);
          this.timeOverlay = this.add.rectangle(
            GARDEN_WORLD_WIDTH / 2,
            GARDEN_WORLD_HEIGHT / 2,
            GARDEN_WORLD_WIDTH,
            GARDEN_WORLD_HEIGHT,
            0xffffff,
            0,
          ).setDepth(6800).setBlendMode(PhaserModule.BlendModes.MULTIPLY);
          this.applyTimeOfDay(timeOfDayRef.current);
        }

        private drawGardenGround() {
          // The generated bare map now owns ground, roads, creeks, and placement pads.
        }

        private drawRoadNetwork() {
          const segments = variant === "park" ? parkWalkSegments : sharedWalkSegments;
          const circles = variant === "park" ? parkWalkCircles : sharedWalkCircles;
          const extensionCircles = variant === "park" ? parkWalkableExtensions : sharedWalkableExtensions;
          const extensionSegments = variant === "park" ? parkWalkableConnectors : [];

          // DEV-ONLY corridor overlay. The cream stripes painted across the
          // scene were originally a "here is where you walk" guide, but
          // players read them as visual debris — the painted park art
          // already shows where the paths are. Now they only render with
          // `?debug=paths` in the URL, leaving the painted scene clean for
          // everyone else.
          const debugPaths =
            typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug-paths");

          if (debugPaths) {
            const lawn = this.add.graphics().setDepth(-4);
            lawn.fillStyle(0xfae3a8, 0.18);
            extensionCircles.forEach((circle) => {
              lawn.fillCircle(circle.x, circle.y, circle.radius);
            });
            extensionSegments.forEach((segment) => {
              lawn.lineStyle(segment.radius * 2, 0xfae3a8, 0.12);
              lawn.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
            });

            const corridor = this.add.graphics().setDepth(-3);
            segments.forEach((segment) => {
              corridor.lineStyle(segment.radius * 2 + 24, 0xfae3a8, 0.28);
              corridor.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
            });
            circles.forEach((circle) => {
              corridor.fillStyle(0xfae3a8, 0.28);
              corridor.fillCircle(circle.x, circle.y, circle.radius + 12);
            });
            segments.forEach((segment) => {
              corridor.lineStyle(segment.radius * 2, 0xfffcf3, 0.5);
              corridor.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
            });
            circles.forEach((circle) => {
              corridor.fillStyle(0xfffcf3, 0.45);
              corridor.fillCircle(circle.x, circle.y, circle.radius);
            });
            segments.forEach((segment) => {
              corridor.lineStyle(3, 0xd9a53e, 0.4);
              corridor.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
            });
          }

          // 2. Ambient star glints — the original cozy magic — kept on top.
          segments.forEach((segment, segmentIndex) => {
            const steps = Math.max(4, Math.floor(PhaserModule.Math.Distance.Between(segment.x1, segment.y1, segment.x2, segment.y2) / 180));
            for (let index = 0; index <= steps; index += 1) {
              const t = index / steps;
              const x = PhaserModule.Math.Linear(segment.x1, segment.x2, t);
              const y = PhaserModule.Math.Linear(segment.y1, segment.y2, t);
              const glint = this.add.star(
                x + PhaserModule.Math.Between(-18, 18),
                y + PhaserModule.Math.Between(-10, 10),
                5,
                2,
                7,
                segmentIndex % 2 === 0 ? 0xfffcf3 : 0xfaebc2,
                0.18,
              ).setDepth(58);
              this.tweens.add({
                targets: glint,
                alpha: 0.44,
                scale: 1.35,
                duration: 1200 + segmentIndex * 70 + index * 40,
                yoyo: true,
                repeat: -1,
                ease: "Sine.inOut",
              });
            }
          });
        }

        private drawParkDistrict() {
          // Large park pieces are generated sprites in the decor system so hosts can move, face, and save them.
        }

        private drawLanternPath() {
          const positions = variant === "partner"
            ? [
                [382, 482],
                [578, 482],
                [416, 390],
                [544, 390],
                [450, 304],
                [510, 304],
                [984, 346],
                [1308, 462],
              ]
            : [
                [380, 482],
                [574, 480],
                [330, 390],
                [452, 360],
                [920, 338],
                [1284, 450],
              ];

          if (variant === "park") {
            positions.push(
              [1760, 386],
              [2060, 456],
              [2380, 494],
              [2680, 468],
              [2980, 498],
              [3220, 432],
            );
          }

          positions.forEach(([x, y], index) => {
            const lantern = this.add.container(x, y).setDepth(y);
            lantern.add(this.add.ellipse(0, 14, 44, 14, 0x3a2a2a, 0.12));
            const glow = this.add.circle(0, 2, 24, 0xfaebc2, 0.18);
            lantern.addAt(glow, 0);
            lantern.add(this.add.image(0, -18, "minigame-props", 6).setDisplaySize(74, 112));
            this.tweens.add({
              targets: glow,
              alpha: 0.34,
              scale: 1.25,
              duration: 900 + index * 80,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          });
        }

        private drawWaterFeature() {
          // Water is part of the bare generated terrain so it stays pixel crisp across the scrollable map.
        }

        private drawPlots() {
          const positions = getPlotPositions(variant);

          plots.forEach((plot, index) => {
            const [x, y] = positions[index % positions.length];
            this.createPlot(plot, x, y);
          });
        }

        private createPlot(plot: GardenPlotState, x: number, y: number) {
          const color = PhaserModule.Display.Color.HexStringToColor(plot.accent).color;
          const container = this.add.container(x, y).setDepth(y);
          container.add(this.add.ellipse(0, 30, 118, 46, 0x3a2a2a, 0.12));
          container.add(this.add.ellipse(0, 16, 126, 58, 0xead9b5).setStrokeStyle(3, 0xa06c42, 0.32));
          container.add(this.add.ellipse(0, 12, 96, 38, 0x8b5e3c, 0.22));

          const growth = Math.max(0.18, plot.progress / 100);
          const plantArt = this.add
            .image(0, -26, "cozy-furniture-sprites", 7)
            .setDisplaySize(106 + growth * 76, 128 + growth * 92)
            .setAlpha(0.95);
          container.add(plantArt);
          this.tweens.add({
            targets: plantArt,
            rotation: 0.035,
            duration: 1600,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
          for (let index = 0; index < 5; index += 1) {
            const stem = this.add.rectangle(-36 + index * 18, -2, 6, 50 * growth, 0x6e9651);
            stem.setOrigin(0.5, 1);
            stem.setAlpha(0.22);
            container.add(stem);
            const bloom = this.add.circle(-36 + index * 18, -4 - 46 * growth, 8 + growth * 7, color, 0.86);
            bloom.setAlpha(0.38);
            container.add(bloom);
            this.tweens.add({
              targets: [stem, bloom],
              rotation: 0.08,
              duration: 1200 + index * 120,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }

          container.add(
            this.add.text(0, 54, plot.name, {
              align: "center",
              color: "#3A2A2A",
              fontFamily: "Nunito, sans-serif",
              fontSize: "12px",
              fontStyle: "900",
            }).setOrigin(0.5),
          );

          const zone = this.add.zone(x, y, 138, 106).setInteractive({ useHandCursor: true });
          zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            const distance = PhaserModule.Math.Distance.Between(this.avatar?.x ?? x, this.avatar?.y ?? y, x, y);
            if (distance > 120 && this.avatar) {
              const pathPoint = this.constrainAvatarToWalkable(x, y + 58);
              this.target = new PhaserModule.Math.Vector2(pathPoint.x, pathPoint.y);
              setStatus(`Walking over to ${plot.name}.`);
              return;
            }
            this.waterPlot(plot, x, y);
          });
          zone.on("pointerover", () => setStatus(`${plot.name}: ${plot.stage}, ${plot.progress}% grown, ${plot.status}.`));
        }

        private waterPlot(plot: GardenPlotState, x: number, y: number) {
          playCozyCue("water");
          const action = plot.progress >= 80 ? "harvest" : "water";
          onPlotCareRef.current?.(plot.id, action);
          setStatus(
            action === "harvest"
              ? `${plot.name} harvested — new seeds are tucked in.`
              : `${plot.name} watered. ${plot.stage} growth sparkles wake up.`,
          );
          if (action === "water") recordActivity("garden-watered");
          for (let index = 0; index < 14; index += 1) {
            const drop = this.add.circle(x + PhaserModule.Math.Between(-54, 54), y - 74, 4, 0x5e94b0, 0.82).setDepth(6000);
            this.tweens.add({
              targets: drop,
              y: y + PhaserModule.Math.Between(-8, 22),
              alpha: 0,
              duration: PhaserModule.Math.Between(520, 860),
              ease: "Sine.in",
              onComplete: () => drop.destroy(),
            });
          }
          this.spawnSparkleBurst(x, y - 32, 0x5e94b0, 12);
        }

        private drawPersonalGardenCenterpiece() {
          // Centerpieces are generated draggable objects now, not baked into the terrain.
        }

        private drawPartnerHeart() {
          this.createGuardianStatue();
          this.createQuestMarker(272, 282, "Message Milestone", "Achievement bloom unlocked.");
          this.createQuestMarker(688, 282, "Study Week Lantern", "Quest lantern is waiting.");
          this.createQuestMarker(244, 472, "Shared Visit Memory", "Memory flower opened.");
          this.createQuestMarker(716, 472, "Milestone Path", "Milestone petals are glowing.");
        }

        private createMemoryTree() {
          const tree = this.add.container(480, 318).setDepth(318);
          tree.add(this.add.ellipse(0, 108, 172, 48, 0x3a2a2a, 0.16));
          tree.add(this.add.rectangle(0, 56, 34, 142, 0x8b5e3c).setStrokeStyle(3, 0x5b3f3f, 0.36));
          for (let index = 0; index < 42; index += 1) {
            const leaf = this.add.circle(
              PhaserModule.Math.Between(-96, 96),
              PhaserModule.Math.Between(-84, 26),
              PhaserModule.Math.Between(16, 28),
              index % 3 === 0 ? 0xf6cfd2 : index % 3 === 1 ? 0xddceec : 0xe4efd7,
              0.86,
            );
            tree.add(leaf);
            this.tweens.add({
              targets: leaf,
              y: leaf.y + PhaserModule.Math.Between(-6, 7),
              duration: PhaserModule.Math.Between(1400, 2600),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
          tree.add(
            this.add.text(0, -126, "Shared Memory Tree", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "19px",
            }).setOrigin(0.5),
          );
        }

        private createGuardianStatue() {
          const statue = this.add.container(480, 444).setDepth(444);
          statue.add(this.add.ellipse(0, 44, 118, 30, 0x3a2a2a, 0.14));
          statue.add(this.add.image(0, -20, "casper-sprite").setDisplaySize(104, 104));
          statue.add(this.add.rectangle(0, 50, 104, 26, 0xead9b5, 0.86).setStrokeStyle(3, 0xc9a998, 0.5));
          const zone = this.add.zone(480, 424, 130, 106).setInteractive({ useHandCursor: true });
          zone.on("pointerdown", () => {
            playCozyCue("pet");
            setStatus("Casper is protecting the shared gate.");
            this.spawnHeartBurst(480, 380);
          });
        }

        private createQuestMarker(x: number, y: number, title: string, message: string) {
          const marker = this.add.container(x, y).setDepth(y);
          marker.add(this.add.circle(0, 0, 34, 0xfffcf3, 0.9).setStrokeStyle(3, 0xf6cfd2, 0.8));
          marker.add(this.add.image(0, -4, "minigame-props", 3).setDisplaySize(72, 90));
          marker.add(
            this.add.text(0, -48, title, {
              align: "center",
              color: "#5B3F3F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "11px",
              fontStyle: "900",
              wordWrap: { width: 118 },
            }).setOrigin(0.5, 1),
          );
          this.tweens.add({
            targets: marker,
            y: y - 6,
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
          const zone = this.add.zone(x, y, 138, 116).setInteractive({ useHandCursor: true });
          zone.on("pointerdown", () => {
            playCozyCue("heart");
            setStatus(message);
            this.spawnHeartBurst(x, y);
          });
        }

        private spawnHeartBurst(x: number, y: number) {
          for (let index = 0; index < 10; index += 1) {
            const heart = this.add.circle(x, y, 8, index % 2 === 0 ? 0xd87e8c : 0xfaebc2, 0.9).setDepth(6400);
            this.tweens.add({
              targets: heart,
              x: x + PhaserModule.Math.Between(-84, 84),
              y: y - PhaserModule.Math.Between(38, 118),
              alpha: 0,
              scale: 0.2,
              duration: 900,
              ease: "Sine.out",
              onComplete: () => heart.destroy(),
            });
          }
        }

        private spawnSparkleBurst(x: number, y: number, color = 0xfaebc2, count = 16) {
          for (let index = 0; index < count; index += 1) {
            const sparkle = this.add.star(
              x + PhaserModule.Math.Between(-18, 18),
              y + PhaserModule.Math.Between(-12, 12),
              5,
              4,
              PhaserModule.Math.Between(8, 15),
              index % 3 === 0 ? 0xffffff : color,
              0.86,
            ).setDepth(6600);
            this.tweens.add({
              targets: sparkle,
              x: sparkle.x + PhaserModule.Math.Between(-96, 96),
              y: sparkle.y - PhaserModule.Math.Between(36, 120),
              alpha: 0,
              rotation: sparkle.rotation + PhaserModule.Math.FloatBetween(-1.6, 1.6),
              scale: 0.2,
              duration: PhaserModule.Math.Between(760, 1240),
              ease: "Sine.out",
              onComplete: () => sparkle.destroy(),
            });
          }
        }

        private spawnPetalSpiral(x: number, y: number, count = 22) {
          for (let index = 0; index < count; index += 1) {
            const petal = this.add.ellipse(
              x + PhaserModule.Math.Between(-28, 28),
              y + PhaserModule.Math.Between(-18, 22),
              PhaserModule.Math.Between(10, 18),
              PhaserModule.Math.Between(5, 9),
              index % 2 === 0 ? 0xf6cfd2 : 0xddceec,
              0.88,
            ).setDepth(6500);
            this.tweens.add({
              targets: petal,
              x: x + Math.cos(index * 0.75) * PhaserModule.Math.Between(72, 150),
              y: y - PhaserModule.Math.Between(46, 156),
              alpha: 0,
              rotation: petal.rotation + PhaserModule.Math.FloatBetween(2, 5),
              duration: PhaserModule.Math.Between(1100, 1700),
              ease: "Sine.out",
              onComplete: () => petal.destroy(),
            });
          }
        }

        private spawnSmokePuffs(x: number, y: number) {
          for (let index = 0; index < 11; index += 1) {
            const puff = this.add.circle(
              x + PhaserModule.Math.Between(-20, 26),
              y - PhaserModule.Math.Between(46, 78),
              PhaserModule.Math.Between(10, 19),
              0xfffcf3,
              0.48,
            ).setDepth(6400);
            this.tweens.add({
              targets: puff,
              x: puff.x + PhaserModule.Math.Between(-26, 36),
              y: puff.y - PhaserModule.Math.Between(70, 132),
              alpha: 0,
              scale: 1.8,
              duration: PhaserModule.Math.Between(1200, 1900),
              ease: "Sine.out",
              onComplete: () => puff.destroy(),
            });
          }
        }

        private spawnWaterCrown(x: number, y: number) {
          for (let index = 0; index < 18; index += 1) {
            const angle = (Math.PI * 2 * index) / 18;
            const drop = this.add.circle(x, y - 52, 4, 0xaed7e8, 0.86).setDepth(6500);
            this.tweens.add({
              targets: drop,
              x: x + Math.cos(angle) * PhaserModule.Math.Between(54, 118),
              y: y - 52 + Math.sin(angle) * PhaserModule.Math.Between(28, 54),
              alpha: 0,
              scale: 0.2,
              duration: 820,
              ease: "Sine.out",
              onComplete: () => drop.destroy(),
            });
          }
        }

        private showLocalBubble(text: string) {
          if (!this.avatar) return;
          const bubble = this.add.container(this.avatar.x, this.avatar.y - 126).setDepth(7200);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-126, -32, 252, 64, 18);
          bg.lineStyle(2, 0xf6cfd2, 0.82);
          bg.strokeRoundedRect(-126, -32, 252, 64, 18);
          bubble.add(bg);
          bubble.add(this.add.text(0, 0, text, {
            align: "center",
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "12px",
            fontStyle: "900",
            wordWrap: { width: 218 },
          }).setOrigin(0.5));
          this.tweens.add({
            targets: bubble,
            y: bubble.y - 36,
            alpha: 0,
            duration: 2200,
            ease: "Sine.out",
            onComplete: () => bubble.destroy(true),
          });
        }

        private getButterflyAlpha() {
          if (this.currentTimeOfDay === "night") return 0.34;
          if (this.currentTimeOfDay === "morning") return 0.76;
          return 0.9;
        }

        private getFireflyLight() {
          if (this.currentTimeOfDay === "night") return { base: 0.46, amplitude: 0.24, drift: 0.0048 };
          if (this.currentTimeOfDay === "morning") return { base: 0.1, amplitude: 0.08, drift: 0.0025 };
          return { base: 0.22, amplitude: 0.16, drift: 0.003 };
        }

        private updateCritterLighting() {
          const butterflyAlpha = this.getButterflyAlpha();
          this.butterflies.forEach((butterfly) => butterfly.setAlpha(butterflyAlpha));
          const fireflyAlpha = this.getFireflyLight().base;
          this.fireflies.forEach((firefly) => firefly.setAlpha(fireflyAlpha));
        }

        private drawButterflies() {
          const count = variant === "partner" ? 8 : variant === "park" ? 14 : 5;
          for (let index = 0; index < count; index += 1) {
            const x = PhaserModule.Math.Between(130, GARDEN_WORLD_WIDTH - 180);
            const y = PhaserModule.Math.Between(160, Math.round(GARDEN_WORLD_HEIGHT * 0.36));
            const butterfly = this.add
              .sprite(x, y, "ambient-critter-sprites", index % 5)
              .setDisplaySize(42 + (index % 3) * 10, 42 + (index % 3) * 10)
              .setAlpha(this.getButterflyAlpha())
              .setDepth(5800);
            this.butterflies.push(butterfly);
            this.tweens.add({
              targets: butterfly,
              x: x + PhaserModule.Math.Between(-80, 80),
              y: y + PhaserModule.Math.Between(-36, 36),
              rotation: PhaserModule.Math.FloatBetween(-0.08, 0.08),
              duration: PhaserModule.Math.Between(2400, 4200),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        /**
         * Lay down soft pulsing radial gradients on the floor at every
         * still-hidden discovery position. They pulse with a Sine ease so
         * the patches read as "alive" without bordering on flashing. Each
         * patch has a paw-print pill above it that says "Sniff me" so the
         * mechanic discovers itself.
         */
        private drawDiscoveryGlowPatches() {
          const zone = variant === "park" ? "park" : "garden";
          ZONE_DISCOVERIES[zone].forEach((item) => {
            if (isItemFound(zone, item.id)) return;
            const worldX = (item.x / 100) * GARDEN_WORLD_WIDTH;
            const worldY = (item.y / 100) * GARDEN_WORLD_HEIGHT;
            // Group every visual for this patch into one container so
            // we can fade-and-destroy them together when sniff succeeds.
            const patchGroup = this.add.container(0, 0).setDepth(2);
            patchGroup.setName(`discovery-patch-${item.id}`);
            const glow = this.add.circle(worldX, worldY, worldRadius(36), 0xfae3a8, 0.32);
            this.tweens.add({
              targets: glow,
              radius: worldRadius(48),
              alpha: 0.18,
              duration: 1400,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
            const halo = this.add.circle(worldX, worldY, worldRadius(24), 0xfffcf3, 0.55);
            this.tweens.add({
              targets: halo,
              scaleX: 1.18,
              scaleY: 1.18,
              duration: 1800,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
            const tag = this.add
              .text(worldX, worldY + worldRadius(36), "Sniff me", {
                color: "#5B3F76",
                fontFamily: "Nunito, sans-serif",
                fontSize: "11px",
                fontStyle: "900",
                backgroundColor: "#EFE6F7",
                padding: { x: 8, y: 3 },
              })
              .setOrigin(0.5, 0);
            patchGroup.add([glow, halo, tag]);
          });

          // When a sniff reveals an item, fade out and destroy the matching
          // patch. The previous version kicked off the destroy tween but
          // never killed the two yoyo:-1 child tweens (glow radius pulse
          // + halo scale pulse) — those kept running for one more frame
          // AFTER the container destroyed its children, touching freed
          // objects and stalling the input loop (the sniff softlock).
          // Now we kill all child tweens BEFORE the destroy lands.
          const reveal = (event: Event) => {
            const id = (event as CustomEvent<{ id?: string }>).detail?.id;
            if (!id) return;
            const patch = this.children.getByName(`discovery-patch-${id}`) as Phaser.GameObjects.Container | null;
            if (!patch) return;
            // Stop any in-flight tweens that target the patch OR its
            // children. `killTweensOf` is recursive-safe for arrays.
            this.tweens.killTweensOf(patch);
            const childTargets = (patch.list as Phaser.GameObjects.GameObject[]) ?? [];
            for (const child of childTargets) {
              this.tweens.killTweensOf(child);
            }
            this.tweens.add({
              targets: patch,
              alpha: 0,
              duration: 700,
              ease: "Sine.out",
              onComplete: () => {
                // Defensive: double-kill in case onComplete races with a
                // late-arriving yoyo iteration we couldn't predict.
                this.tweens.killTweensOf(patch);
                for (const child of childTargets) {
                  this.tweens.killTweensOf(child);
                }
                patch.destroy(true);
              },
            });
          };
          window.addEventListener("hearthaven:discovery-revealed", reveal);
          this.events.once("shutdown", () => window.removeEventListener("hearthaven:discovery-revealed", reveal));
          this.events.once("destroy", () => window.removeEventListener("hearthaven:discovery-revealed", reveal));
        }

        private drawFireflies() {
          for (let index = 0; index < 28; index += 1) {
            const firefly = this.add
              .sprite(
                PhaserModule.Math.Between(92, GARDEN_WORLD_WIDTH - 92),
                PhaserModule.Math.Between(268, 540),
                "ambient-critter-sprites",
                5,
              )
              .setDisplaySize(30 + (index % 4) * 5, 30 + (index % 4) * 5)
              .setAlpha(this.getFireflyLight().base)
              .setDepth(5900);
            this.fireflies.push(firefly);
          }
        }

        private createAvatar() {
          this.keeperCustomization = readKeeperCustomization();
          const start = getAvatarStartPosition(variant);
          this.avatarShadow = this.add.ellipse(start.x, start.y + 22, 50, 18, 0x3a2a2a, 0.18).setDepth(start.y - 1);
          this.avatar = this.add.container(start.x, start.y).setDepth(start.y);
          this.avatarSkinSprite = this.add
            .sprite(
              0,
              -66,
              "keeper-skin-mask-sheet",
              keeperSkinFrame("idle", this.keeperCustomization.outfitId, this.keeperCustomization.bodyId),
            )
            .setDisplaySize(98, 147)
            .setAlpha(0.92);
          this.avatarSprite = this.add
            .sprite(
              0,
              -66,
              "keeper-animation-sheet",
              keeperFrame(
                this.keeperCustomization.paletteId,
                "idle",
                this.keeperCustomization.outfitId,
                this.keeperCustomization.bodyId,
              ),
            )
            .setDisplaySize(98, 147);
          this.avatarHairSprite = this.add
            .sprite(
              0,
              -66,
              "keeper-hair-style-sheet",
              keeperHairFrame(this.keeperCustomization.hairStyleId, "idle", this.keeperCustomization.bodyId),
            )
            .setDisplaySize(98, 147);
          this.avatar.add([this.avatarSprite, this.avatarSkinSprite, this.avatarHairSprite]);
          this.applyKeeperLayerTints();
          this.avatar.setSize(62, 92);
          this.lastSentPosition = { x: this.avatar.x, y: this.avatar.y };

          this.tweens.add({
            targets: this.avatar,
            scaleY: 1.035,
            duration: 1050,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createPet() {
          this.petCustomization = readPetCustomization();
          const start = getAvatarStartPosition(variant);
          // Pet starts a short stride to the right of the keeper, on the same
          // y-row so it lands on the path too.
          const px = start.x + 66;
          const py = start.y + 20;
          this.petShadow = this.add.ellipse(px, py + 20, 44, 15, 0x3a2a2a, 0.15).setDepth(py - 1);
          this.pet = this.add.container(px, py).setDepth(py);
          this.petSprite = this.add
            .sprite(0, -40, "pet-animation-sheet", petFrame(this.petCustomization.speciesId, "idle"))
            .setDisplaySize(94, 106);
          this.tintPetForTone();
          this.petAccessorySprite = this.createPetAccessorySprite(this.petCustomization.accessory);
          this.petAccessorySprite.setVisible(!isFlyingPetSpecies(this.petCustomization.speciesId));
          this.pet.add([this.petSprite, this.petAccessorySprite]);
          this.pet.setSize(70, 70);
          // A very gentle breathing motion on the sprite layer only. Never
          // tween the pet container's world Y: that breaks vertical follow
          // movement and makes the companion look stuck on one row.
          this.petBobTween = this.tweens.add({
            targets: this.petSprite,
            y: -40.6,
            duration: 3200,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createInput() {
          this.input.keyboard?.disableGlobalCapture();
          // The right mouse button drives the swap mechanic — suppress the
          // browser's context menu so right-click on the canvas registers as
          // a game action and not a system menu.
          this.input.mouse?.disableContextMenu();
          this.cursors = this.input.keyboard?.createCursorKeys();
          this.wasd = this.input.keyboard?.addKeys({
            up: PhaserModule.Input.Keyboard.KeyCodes.W,
            left: PhaserModule.Input.Keyboard.KeyCodes.A,
            down: PhaserModule.Input.Keyboard.KeyCodes.S,
            right: PhaserModule.Input.Keyboard.KeyCodes.D,
            rotate: PhaserModule.Input.Keyboard.KeyCodes.R,
          }) as Record<"up" | "left" | "down" | "right" | "rotate", Phaser.Input.Keyboard.Key> | undefined;

          // Q triggers Sniff while in companion mode — same path as the HUD
          // button. We use the raw keyboard event (not a `wasd` slot) so we
          // can listen alongside the chat-focus guard. Handler references
          // are saved on the scene so a re-init of `createInput` (HMR or
          // explicit scene restart) drops the old listeners first — the
          // old code stacked duplicates, which is how a single Q press
          // could fire 5–20 sniffs in a row and hard-lock the game loop.
          if (this.sniffKeyHandler) this.input.keyboard?.off("keydown-Q", this.sniffKeyHandler);
          this.sniffKeyHandler = () => {
            if (this.textInputFocused || isTextInputFocused()) return;
            if (this.playMode === "companion") this.trySniff();
          };
          this.input.keyboard?.on("keydown-Q", this.sniffKeyHandler);
          if (this.deleteKeyHandler) this.input.keyboard?.off("keydown-DELETE", this.deleteKeyHandler);
          this.deleteKeyHandler = () => {
            if (this.textInputFocused || isTextInputFocused()) return;
            this.removeSelectedDecor();
          };
          this.input.keyboard?.on("keydown-DELETE", this.deleteKeyHandler);
          if (this.backspaceKeyHandler) this.input.keyboard?.off("keydown-BACKSPACE", this.backspaceKeyHandler);
          this.backspaceKeyHandler = () => {
            if (this.textInputFocused || isTextInputFocused()) return;
            this.removeSelectedDecor();
          };
          this.input.keyboard?.on("keydown-BACKSPACE", this.backspaceKeyHandler);

          this.input.on(
            "pointerdown",
            (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
              // Right click — start a swap-or-recall timer. A short tap toggles
              // play mode (keeper ↔ companion); holding ≥500ms recalls the
              // companion back to the keeper without changing modes.
              if (pointer.rightButtonDown()) {
                this.rightButtonDownAt = this.time.now;
                this.rightHoldFired = false;
                return;
              }
              // If the click landed on an interactive game object (decor,
              // kiosk, swing, etc.), its own pointerdown handler already
              // ran and may have opened the decor bubble. We MUST bail out
              // here — Phaser's scene-level pointerdown fires regardless
              // of whether a game object handler called stopPropagation,
              // so unconditionally calling clearSelectedDecor() below
              // would wipe the bubble the keeper just opened. This is
              // the "popup doesn't show in garden/park" bug.
              if (currentlyOver.length > 0) return;
              this.clearSelectedDecor();
              // Left click — click-to-move for whichever sprite is being
              // driven right now.
              if (pointer.y < 112) return;
              const target = this.constrainAvatarToWalkable(pointer.worldX, pointer.worldY);
              this.target = new PhaserModule.Math.Vector2(target.x, target.y);
              playCozyCue("move");
              setStatus(`Walking along the paved path to x ${Math.round(target.x)}, y ${Math.round(target.y)}.`);
            },
          );

          this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
            if (pointer.button !== 2) return;
            if (this.rightHoldFired) {
              // The hold already fired (recall). Don't also toggle modes.
              this.rightHoldFired = false;
              return;
            }
            this.togglePlayMode();
          });

          this.drawPlayModeBadge();
          // The HUD's swap button + action chips drive the canvas through
          // these two events. Mounting the listeners here keeps them paired
          // with the keyboard/mouse bindings they shadow.
          this.swapRequestHandler = () => this.togglePlayMode();
          window.addEventListener("hearthaven:request-play-mode-swap", this.swapRequestHandler);
          this.parkActionHandler = (event: Event) => {
            const action = (event as CustomEvent<{ action?: string }>).detail?.action;
            if (!action) return;
            this.handleParkAction(action);
          };
          window.addEventListener("hearthaven:park-action", this.parkActionHandler);
          // Broadcast a starting position so the minimap doesn't show the
          // default placeholder before the first move tick.
          this.broadcastParkPosition();
        }

        /**
         * Translate HUD action chips into the same code paths the keyboard
         * fires. The keeper has a small emote/treat/whistle palette; the
         * companion handles sniff/squeeze/dig/fetch on top of WASD.
         */
        private handleParkAction(action: string) {
          if (action === "sniff") {
            this.trySniff();
            return;
          }
          if (action === "whistle" || action === "fetch") {
            this.recallCompanion();
            return;
          }
          if (action === "wave") {
            playCozyCue("score");
            setStatus("You waved at the park.");
            return;
          }
          if (action === "treat") {
            playCozyCue("petChirp");
            setStatus("You tossed a treat for the companion.");
            return;
          }
          if (action === "note") {
            playCozyCue("score");
            setStatus("Note dropped — friends in the park can pick it up.");
            return;
          }
          if (action === "squeeze" || action === "dig") {
            playCozyCue("petChirp");
            setStatus(action === "squeeze"
              ? "Snuck through the squeeze gap — only your companion fits."
              : "Pawed at the dirt — nothing buried here yet.");
            return;
          }
        }

        private applySunshinePulse() {
          playCozyCue("heart");
          setTimeOfDay("morning");
          this.petMood = "happy";
          this.petMoodTimer = 0;
          setStatus("Sunshine warmed the shared garden: every visible plot was watered, your companion cheered, and a small care reward was added.");
          this.showLocalBubble("Sunshine warmed every plot.");
          this.spawnHeartBurst(this.avatar.x, this.avatar.y - 104);
          this.spawnSparkleBurst(this.pet.x, this.pet.y - 72, 0xfaebc2, 18);

          getPlotPositions(variant).forEach(([x, y], index) => {
            this.time.delayedCall(index * 90, () => {
              this.spawnSparkleBurst(x, y - 34, 0xd9a53e, 10);
              this.spawnWaterCrown(x, y - 10);
            });
          });
        }

        /**
         * When the companion is on (or right next to) a hidden glow patch,
         * pressing the Sniff action reveals the item, writes it to the
         * discoveries store, and fires a toast + a discovery-revealed event
         * for the HUD to pick up.
         */
        private trySniff() {
          // Belt + braces: a throwing call inside an input handler can
          // wedge Phaser's keyboard system because the exception
          // propagates back into the event-dispatch loop. The cooldown +
          // try/catch keep the worst case to "sniff did nothing" instead
          // of "game locked".
          if (this.playMode !== "companion") {
            setStatus("Swap to your companion first — sniffing is a pet ability.");
            return;
          }
          // Vitals-gated obedience: a hungry companion refuses to focus
          // and a sleeping one obviously can't sniff. Both states clear
          // automatically once the keeper feeds / waits out the nap.
          if (this.petBehavior.napping) {
            setStatus("Your companion is asleep — let them rest.");
            return;
          }
          if (this.petBehavior.disobeys) {
            setStatus("Your companion is too hungry to focus — feed them first.");
            return;
          }
          if (this.time.now < this.sniffCooldownUntil) return;
          this.sniffCooldownUntil = this.time.now + 650;
          try {
            const zone = variant === "park" ? "park" : "garden";
            const pos = this.companionScenePercent();
            const target = nearestHidden(zone, pos, 12);
            this.petMood = "happy";
            this.petMoodTimer = 0;
            const targetPoint = target
              ? { x: (target.x / 100) * GARDEN_WORLD_WIDTH, y: (target.y / 100) * GARDEN_WORLD_HEIGHT }
              : undefined;
            if (this.isSuperSnails()) {
              this.playSuperSnailsSniffLasers(targetPoint);
            } else if (this.pet) {
              this.spawnSparkleBurst(this.pet.x, this.pet.y - 64, 0xc0a8dc, 10);
            }
            if (!target) {
              playCozyCue("petPurr");
              setStatus(this.isSuperSnails()
                ? "Super Snails fires a laser sniff — nothing nearby this time."
                : "Your companion sniffs the air — nothing nearby this time.");
              return;
            }
            const found = markDiscoveryFound(zone, target.id);
            if (!found) {
              setStatus("Already discovered around here.");
              return;
            }
            playCozyCue("score");
            setStatus(`Sniffed up ${target.name}! ${target.hint}`);
            this.showLocalBubble(`${target.name} found.`);
            window.dispatchEvent(new CustomEvent("hearthaven:discovery-revealed", {
              detail: { id: target.id, name: target.name, emoji: target.emoji },
            }));
          } catch (error) {
            console.warn("[hearthaven sniff] aborted:", error);
            setStatus("Your companion paused mid-sniff — try again in a moment.");
          }
        }

        private playSuperSnailsSniffLasers(target?: { x: number; y: number }) {
          if (!this.pet) return;
          const direction = this.petFacing === "left" ? -1 : 1;
          const aim = target ?? { x: this.pet.x + direction * worldRadius(280), y: this.pet.y - worldRadius(56) };
          const startA = { x: this.pet.x + direction * worldRadius(14), y: this.pet.y - worldRadius(68) };
          const startB = { x: this.pet.x + direction * worldRadius(18), y: this.pet.y - worldRadius(58) };
          const beams = this.add.graphics().setDepth(7200);
          beams.lineStyle(10, 0xff4f6e, 0.2);
          beams.lineBetween(startA.x, startA.y, aim.x, aim.y - worldRadius(5));
          beams.lineBetween(startB.x, startB.y, aim.x, aim.y + worldRadius(5));
          beams.lineStyle(5, 0xffd36e, 0.8);
          beams.lineBetween(startA.x, startA.y, aim.x, aim.y - worldRadius(5));
          beams.lineBetween(startB.x, startB.y, aim.x, aim.y + worldRadius(5));
          beams.lineStyle(2, 0xfffcf3, 0.95);
          beams.lineBetween(startA.x, startA.y, aim.x, aim.y - worldRadius(5));
          beams.lineBetween(startB.x, startB.y, aim.x, aim.y + worldRadius(5));

          const impact = this.add.container(aim.x, aim.y).setDepth(7201);
          const halo = this.add.circle(0, 0, worldRadius(34), 0xff4f6e, 0.24);
          const core = this.add.circle(0, 0, worldRadius(12), 0xfffcf3, 0.92);
          impact.add([halo, core]);
          playCozyCue("laser");
          this.spawnSparkleBurst(aim.x, aim.y - worldRadius(10), 0xff4f6e, 12);
          this.tweens.add({
            targets: halo,
            scaleX: 1.8,
            scaleY: 1.8,
            alpha: 0,
            duration: 360,
            ease: "Sine.out",
          });
          this.tweens.add({
            targets: [beams, core],
            alpha: 0,
            duration: 420,
            ease: "Sine.out",
            onComplete: () => {
              beams.destroy();
              impact.destroy(true);
            },
          });
        }

        /**
         * Companion world position as 0–100 percent of the scene, so it
         * lines up with the `ZONE_DISCOVERIES` coordinates without anybody
         * needing to know about Phaser world coordinates.
         */
        private companionScenePercent() {
          const x = (this.pet?.x ?? 0) / GARDEN_WORLD_WIDTH * 100;
          const y = (this.pet?.y ?? 0) / GARDEN_WORLD_HEIGHT * 100;
          return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
        }

        private keeperScenePercent() {
          const x = (this.avatar?.x ?? 0) / GARDEN_WORLD_WIDTH * 100;
          const y = (this.avatar?.y ?? 0) / GARDEN_WORLD_HEIGHT * 100;
          return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
        }

        private broadcastParkPosition() {
          window.dispatchEvent(new CustomEvent("hearthaven:park-position", {
            detail: {
              keeper: this.keeperScenePercent(),
              companion: this.companionScenePercent(),
              keeperHint: this.locationHint(this.keeperScenePercent()),
              companionHint: this.locationHint(this.companionScenePercent()),
            },
          }));
        }

        /**
         * Friendly text describing roughly where in the park (or garden) a
         * character is right now. Falls back to "exploring" so the HUD's
         * Live-card never ends up blank.
         */
        private locationHint(pos: { x: number; y: number }) {
          const landmarks: Array<{ x: number; y: number; name: string }> = [
            { x: 24, y: 78, name: "swings" },
            { x: 40, y: 62, name: "fountain" },
            { x: 58, y: 28, name: "claw machine" },
            { x: 72, y: 68, name: "flower cart" },
            { x: 82, y: 18, name: "sakura tree" },
            { x: 50, y: 82, name: "squeeze gap" },
            { x: 88, y: 22, name: "lantern arch" },
          ];
          let best: { dist: number; name: string } | null = null;
          for (const landmark of landmarks) {
            const dist = Math.hypot(landmark.x - pos.x, landmark.y - pos.y);
            if (!best || dist < best.dist) best = { dist, name: landmark.name };
          }
          if (!best) return "exploring";
          return best.dist < 12 ? `near the ${best.name}` : `wandering past the ${best.name}`;
        }

        /**
         * Swap whether the keeper or the companion is the WASD-driven
         * character. The other one freezes in place (with their auto-idle
         * loop still running), and the camera switches to follow the new
         * active character.
         */
        private togglePlayMode() {
          this.playMode = this.playMode === "keeper" ? "companion" : "keeper";
          this.target = undefined;
          if (this.playMode === "companion") {
            this.petMood = "idle";
            this.petWasNapping = false;
            this.petFleeing = false;
            this.petFleeTarget = undefined;
            this.pet.setVisible(true);
            this.petShadow?.setVisible(true);
            this.cameras.main.startFollow(this.pet, true, 0.08, 0.08);
            setStatus("Playing as your companion. They're faster and can sniff for hidden items. Right-click to swap back.");
            playCozyCue("petChirp");
            // Pause idle sprite bob while the player is directly driving
            // the companion so the walking cycle owns the visual Y offset.
            this.petBobTween?.pause();
          } else {
            this.cameras.main.startFollow(this.avatar, true, 0.08, 0.08);
            setStatus("Back in your keeper. Right-click to swap to your companion.");
            playCozyCue("score");
            this.petBobTween?.resume();
          }
          this.updatePlayModeBadge();
          this.syncHeroicTheme();
          // Mirror the canvas-side play mode out to React so the HUD, the
          // sidebar control card, and the minimap all match what's actually
          // being driven by WASD right now.
          window.dispatchEvent(new CustomEvent("hearthaven:play-mode-changed", { detail: { mode: this.playMode } }));
        }

        /**
         * Snap the companion back to the keeper's side. Triggered by holding
         * the right mouse button ≥500ms — handy when the pet has roamed
         * into the corner of the map and you want them back without walking
         * over yourself.
         */
        private recallCompanion() {
          if (!this.pet || !this.avatar) return;
          const follow = this.companionFollowTarget();
          this.pet.setPosition(follow.x, follow.y);
          this.petMood = "follow";
          this.petMoodTimer = 0;
          playCozyCue("petChirp");
          setStatus("Whistled the companion back to you.");
        }

        /**
         * Floating "playing as" pill in the top-left of the camera. Mirrors
         * the swap state so the player can tell at a glance which character
         * the keyboard is driving.
         */
        private drawPlayModeBadge() {
          const badge = this.add.container(20, 20).setScrollFactor(0).setDepth(10000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.95);
          bg.fillRoundedRect(0, 0, 220, 36, 18);
          bg.lineStyle(2, 0xc0a8dc, 0.85);
          bg.strokeRoundedRect(0, 0, 220, 36, 18);
          const label = this.add
            .text(14, 8, "PLAYING AS", {
              color: "#8E70BD",
              fontFamily: "Nunito, sans-serif",
              fontSize: "10px",
              fontStyle: "900",
            })
            .setName("playmode-label");
          const value = this.add
            .text(86, 6, "Keeper", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "14px",
            })
            .setName("playmode-value");
          const hint = this.add
            .text(14, 22, "Right-click to swap · hold to recall", {
              color: "#84675F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "10px",
              fontStyle: "800",
            })
            .setName("playmode-hint");
          badge.add([bg, label, value, hint]);
          this.playModeBadge = badge;
        }

        private updatePlayModeBadge() {
          if (!this.playModeBadge) return;
          const value = this.playModeBadge.getByName("playmode-value") as Phaser.GameObjects.Text | undefined;
          if (value) value.setText(this.playMode === "companion" ? "Companion" : "Keeper");
        }

        private isSuperSnails() {
          return this.petCustomization.speciesId === "super-snails";
        }

        private syncHeroicTheme() {
          setHeroicCompanionTheme(this.playMode === "companion" && this.isSuperSnails());
        }

        private createRealtimeBridge() {
          this.remotePlayersHandler = (event: Event) => {
            const players = (event as CustomEvent<{ players?: RealtimeRoomPlayer[] }>).detail?.players;
            const nextPlayers = players ?? [];
            this.lastRemotePlayersSnapshot = nextPlayers;
            this.syncRemotePlayers(nextPlayers);
          };
          this.chatBubbleHandler = (event: Event) => {
            const message = (event as CustomEvent<GardenChatMessage>).detail;
            if (message?.text) this.showChatBubble(message);
          };
          this.addDecorHandler = (event: Event) => {
            const detail = (event as CustomEvent<{ kind?: GardenDecorKind; clientX?: number; clientY?: number }>).detail;
            const kind = detail?.kind;
            if (!kind) return;
            if (!canEditGarden) {
              setStatus("Only the host or trusted decorators can place garden items in this visit.");
              return;
            }
            let point: { x: number; y: number } | undefined;
            if (typeof detail.clientX === "number" && typeof detail.clientY === "number") {
              const rect = this.game.canvas.getBoundingClientRect();
              const localX = ((detail.clientX - rect.left) / rect.width) * GARDEN_WIDTH;
              const localY = ((detail.clientY - rect.top) / rect.height) * GARDEN_HEIGHT;
              const worldPoint = this.cameras.main.getWorldPoint(localX, localY);
              point = this.constrainToWorldBounds(worldPoint.x, worldPoint.y);
            }
            this.addDecorFromDrawer(kind, point);
          };
          this.decorUpdatedHandler = (event: Event) => {
            const nextDecor = (event as CustomEvent<{ decor?: GardenDecorPlacement[] }>).detail?.decor;
            if (!Array.isArray(nextDecor)) return;
            this.syncDecor(nextDecor);
          };
          this.pendingDecorHandler = (event: Event) => {
            const ids = (event as CustomEvent<{ ids?: string[] }>).detail?.ids;
            this.updatePendingDecor(Array.isArray(ids) ? ids : []);
          };
          this.sunshineHandler = () => this.applySunshinePulse();
          this.timeOfDayHandler = (event: Event) => {
            const nextTime = (event as CustomEvent<{ timeOfDay?: GardenTimeOfDay }>).detail?.timeOfDay;
            if (nextTime) this.applyTimeOfDay(nextTime);
          };
          this.keeperCustomizationHandler = (event: Event) => {
            this.keeperCustomization = (event as CustomEvent<KeeperCustomization>).detail ?? readKeeperCustomization();
            this.setAvatarPose(this.avatarPose);
          };
          this.petCustomizationHandler = (event: Event) => {
            this.petCustomization = (event as CustomEvent<PetCustomization>).detail ?? readPetCustomization();
            this.setPetPose("idle");
            this.tintPetForTone();
            this.updatePetAccessory(this.petAccessorySprite, this.petCustomization.accessory);
            this.petAccessorySprite?.setVisible(!isFlyingPetSpecies(this.petCustomization.speciesId));
            this.syncHeroicTheme();
          };
          // Vitals-derived companion mood keeps the resting pose in sync with how
          // well-tended the pet has been — the soul of the loop, on the canvas.
          // Also recomputes the behaviour cache (speed/dirty/disobeys/exhaustion)
          // so the next frame picks up care actions immediately.
          this.companionMoodHandler = () => {
            const vitals = getPetVitals();
            this.companionMood = getPetMood(vitals);
            this.petBehavior = getPetBehavior(vitals);
            this.applyPetAppearance();
          };
          this.textInputFocusHandler = (event: Event) => {
            this.textInputFocused = Boolean((event as CustomEvent<boolean>).detail);
          };
          window.addEventListener("hearthaven:garden-remote-players", this.remotePlayersHandler);
          window.addEventListener("hearthaven:garden-chat-bubble", this.chatBubbleHandler);
          window.addEventListener("hearthaven:garden-add-decor", this.addDecorHandler);
          window.addEventListener("hearthaven:garden-decor-updated", this.decorUpdatedHandler);
          window.addEventListener("hearthaven:garden-pending-decor", this.pendingDecorHandler);
          window.addEventListener("hearthaven:partner-sunshine", this.sunshineHandler);
          window.addEventListener("hearthaven:garden-time", this.timeOfDayHandler);
          window.addEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
          window.addEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
          window.addEventListener(PET_VITALS_EVENT, this.companionMoodHandler);
          window.addEventListener("hearthaven:text-input-focus", this.textInputFocusHandler);
          const cleanup = () => {
            this.clearAfkEffect();
            setHeroicCompanionTheme(false);
            if (this.remotePlayersHandler) window.removeEventListener("hearthaven:garden-remote-players", this.remotePlayersHandler);
            if (this.chatBubbleHandler) window.removeEventListener("hearthaven:garden-chat-bubble", this.chatBubbleHandler);
            if (this.addDecorHandler) window.removeEventListener("hearthaven:garden-add-decor", this.addDecorHandler);
            if (this.decorUpdatedHandler) window.removeEventListener("hearthaven:garden-decor-updated", this.decorUpdatedHandler);
            if (this.pendingDecorHandler) window.removeEventListener("hearthaven:garden-pending-decor", this.pendingDecorHandler);
            if (this.sunshineHandler) window.removeEventListener("hearthaven:partner-sunshine", this.sunshineHandler);
            if (this.timeOfDayHandler) window.removeEventListener("hearthaven:garden-time", this.timeOfDayHandler);
            if (this.keeperCustomizationHandler) window.removeEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
            if (this.petCustomizationHandler) window.removeEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
            if (this.companionMoodHandler) window.removeEventListener(PET_VITALS_EVENT, this.companionMoodHandler);
            if (this.textInputFocusHandler) window.removeEventListener("hearthaven:text-input-focus", this.textInputFocusHandler);
            if (this.swapRequestHandler) window.removeEventListener("hearthaven:request-play-mode-swap", this.swapRequestHandler);
            if (this.parkActionHandler) window.removeEventListener("hearthaven:park-action", this.parkActionHandler);
            // Detach the keyboard handlers so the next createInput() (HMR,
            // scene restart) doesn't end up firing both the old and new
            // closures on every keypress — that stacking was the sniff
            // softlock root cause.
            if (this.sniffKeyHandler) this.input.keyboard?.off("keydown-Q", this.sniffKeyHandler);
            if (this.deleteKeyHandler) this.input.keyboard?.off("keydown-DELETE", this.deleteKeyHandler);
            if (this.backspaceKeyHandler) this.input.keyboard?.off("keydown-BACKSPACE", this.backspaceKeyHandler);
            this.sniffKeyHandler = undefined;
            this.deleteKeyHandler = undefined;
            this.backspaceKeyHandler = undefined;
            // Stop the breathing tween so the GC can collect the pet sprite
            // after the scene tears down.
            this.petBobTween?.stop();
            this.petBobTween = undefined;
          };
          this.events.once("shutdown", cleanup);
          this.events.once("destroy", cleanup);
        }

        private applyTimeOfDay(nextTime: GardenTimeOfDay) {
          if (!this.timeOverlay) return;
          this.currentTimeOfDay = nextTime;
          if (nextTime === "morning") {
            this.skyWash?.setFillStyle(0xfff1cf, 0.13);
            this.lowSunGlow?.setPosition(GARDEN_WORLD_WIDTH * 0.18, GARDEN_WORLD_HEIGHT * 0.32).setFillStyle(0xffcf87, 0.18);
            this.moonGlow?.setFillStyle(0xded0ff, 0);
            this.timeOverlay.setFillStyle(0xffd69a, 0.11);
            this.updateCritterLighting();
            setStatus("Morning light selected. Dew, soft warmth, and quieter fireflies are active.");
            return;
          }
          if (nextTime === "night") {
            this.skyWash?.setFillStyle(0x29235c, 0.24);
            this.lowSunGlow?.setPosition(GARDEN_WORLD_WIDTH * 0.14, GARDEN_WORLD_HEIGHT * 0.74).setFillStyle(0x6b5ba6, 0.08);
            this.moonGlow?.setFillStyle(0xded0ff, 0.18);
            this.timeOverlay.setFillStyle(0x1b173e, 0.42);
            this.updateCritterLighting();
            setStatus("Night light selected. Lanterns, moon glow, and bright fireflies are active.");
            return;
          }
          this.skyWash?.setFillStyle(0xfffbec, 0.04);
          this.lowSunGlow?.setPosition(GARDEN_WORLD_WIDTH * 0.34, GARDEN_WORLD_HEIGHT * 0.22).setFillStyle(0xffe5a6, 0.06);
          this.moonGlow?.setFillStyle(0xded0ff, 0);
          this.timeOverlay.setFillStyle(0xffffff, 0);
          this.updateCritterLighting();
          setStatus("Noon light selected. Bright clear decorating is active.");
        }

        private setAvatarPose(pose: KeeperPose) {
          this.avatarPose = pose;
          this.avatarSprite?.setTexture(
            "keeper-animation-sheet",
            keeperFrame(
              this.keeperCustomization.paletteId,
              pose,
              this.keeperCustomization.outfitId,
              this.keeperCustomization.bodyId,
            ),
          );
          this.avatarSkinSprite?.setFrame(keeperSkinFrame(pose, this.keeperCustomization.outfitId, this.keeperCustomization.bodyId));
          this.avatarHairSprite?.setFrame(keeperHairFrame(this.keeperCustomization.hairStyleId, pose, this.keeperCustomization.bodyId));
          this.applyKeeperLayerTints();
        }

        private applyKeeperLayerTints() {
          const skinColor = PhaserModule.Display.Color.HexStringToColor(getKeeperSkinTone(this.keeperCustomization.skinId).color).color;
          const hairColor = PhaserModule.Display.Color.HexStringToColor(getKeeperHairColor(this.keeperCustomization.hairColorId).color).color;
          this.avatarSprite
            ?.clearTint()
            .setAlpha(1);
          this.avatarSkinSprite
            ?.clearTint()
            .setTintFill(skinColor)
            .setAlpha(0.86)
            .setDepth((this.avatarSprite?.depth ?? 0) + 1);
          this.avatarHairSprite
            ?.clearTint()
            .setTintFill(hairColor)
            .setAlpha(0.94)
            .setDepth((this.avatarSprite?.depth ?? 0) + 2);
        }

        private setKeeperLayerFlip(facing: FacingDirection) {
          const flip = facing === "left";
          this.avatarSprite?.setFlipX(flip);
          this.avatarSkinSprite?.setFlipX(flip);
          this.avatarHairSprite?.setFlipX(flip);
        }

        private setKeeperLayerMotion(y: number, rotation: number, scaleX = 1, scaleY = 1, x = 0) {
          [this.avatarSkinSprite, this.avatarSprite, this.avatarHairSprite].forEach((sprite) => {
            sprite?.setPosition(x, y).setRotation(rotation);
          });
          this.avatar.setScale(scaleX, scaleY);
        }

        private setPetPose(pose: PetPose) {
          this.petSprite?.setFrame(petFrame(this.petCustomization.speciesId, pose));
        }

        private clearAfkEffect() {
          this.afkEffect?.destroy(true);
          this.afkEffect = undefined;
        }

        private resetAfkAnimation() {
          this.afkIdleMs = 0;
          this.afkAnimation = "idle";
          this.afkStartedAt = 0;
          this.afkNextAt = PhaserModule.Math.Between(4200, 7800);
          this.afkEffectNextAt = 0;
          this.clearAfkEffect();
        }

        private chooseAfkAnimation(): KeeperAfkAnimation {
          const weightedByOutfit: Record<KeeperOutfitId, KeeperAfkAnimation[]> = {
            cardigan: ["sit", "heart", "wave", "yoyo", "sit"],
            overalls: ["yoyo", "wave", "sit", "yoyo", "heart"],
            cape: ["heart", "wave", "sit", "heart", "yoyo"],
            sweater: ["yoyo", "wave", "heart", "yoyo", "sit"],
          };
          const choices = weightedByOutfit[this.keeperCustomization.outfitId] ?? weightedByOutfit.cardigan;
          return choices[PhaserModule.Math.Between(0, choices.length - 1)];
        }

        private startAfkAnimation() {
          this.clearAfkEffect();
          this.afkAnimation = this.chooseAfkAnimation();
          this.afkStartedAt = this.time.now;
          this.afkEffectNextAt = 0;
          if (this.afkAnimation === "yoyo") this.createAfkYoyo();
        }

        private createAfkYoyo() {
          const string = this.add.line(0, 0, 0, -42, 0, -12, 0x8e70bd, 0.45).setOrigin(0.5, 0);
          const toyShadow = this.add.ellipse(0, 14, 14, 5, 0x3a2a2a, 0.14);
          const toy = this.add.circle(0, -12, 8, 0xf4b6c4, 0.96).setStrokeStyle(2, 0xfff4d6, 0.88);
          const shine = this.add.circle(3, -15, 2.2, 0xffffff, 0.9);
          const yoyo = this.add
            .container(this.avatarFacing === "left" ? -38 : 38, -68, [string, toyShadow, toy, shine])
            .setScale(this.avatarFacing === "left" ? -1 : 1, 1);
          this.avatar.add(yoyo);
          this.afkEffect = yoyo;
          this.tweens.add({
            targets: toy,
            y: 12,
            duration: 520,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
          this.tweens.add({
            targets: shine,
            y: 9,
            duration: 520,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
          this.tweens.add({
            targets: toyShadow,
            scaleX: 1.35,
            alpha: 0.08,
            duration: 520,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private emitAfkSparkle(kind: "heart" | "wave") {
          const glyph = kind === "heart" ? "♡" : "✦";
          const color = kind === "heart" ? "#d87e8c" : "#d9a53e";
          const sparkle = this.add
            .text(
              this.avatar.x + (this.avatarFacing === "left" ? -44 : 44) + PhaserModule.Math.Between(-8, 8),
              this.avatar.y - 130 + PhaserModule.Math.Between(-8, 8),
              glyph,
              { fontFamily: "Georgia, serif", fontSize: "24px", color },
            )
            .setOrigin(0.5)
            .setDepth(this.avatar.y + 80);
          this.tweens.add({
            targets: sparkle,
            y: sparkle.y - 30,
            alpha: 0,
            scale: 1.35,
            duration: 1100,
            ease: "Sine.out",
            onComplete: () => sparkle.destroy(),
          });
        }

        private updateAfkAnimation(delta: number) {
          this.afkIdleMs += delta;

          if (this.afkAnimation === "idle" && this.afkIdleMs >= this.afkNextAt) {
            this.startAfkAnimation();
          }

          if (this.afkAnimation === "idle") {
            const breathe = Math.sin(this.time.now / 680);
            this.setAvatarPose("idle");
            this.setKeeperLayerMotion(-66 - breathe * 0.9, breathe * 0.003, 1 + breathe * 0.008, 1 - breathe * 0.006);
            this.avatarShadow?.setScale(1 + breathe * 0.025, 1 - breathe * 0.012);
            return;
          }

          const elapsed = this.time.now - this.afkStartedAt;
          if (elapsed > 5600) {
            this.resetAfkAnimation();
            this.setAvatarPose("idle");
            this.setKeeperLayerMotion(-66, 0);
            this.avatarShadow?.setScale(1, 1);
            return;
          }

          const wave = Math.sin(elapsed / 360);
          if (this.afkAnimation === "sit") {
            this.setAvatarPose("sit");
            this.setKeeperLayerMotion(-52, 0);
            this.avatarShadow?.setScale(1.16, 1);
            return;
          }

          if (this.afkAnimation === "heart") {
            this.setAvatarPose("heart");
            this.setKeeperLayerMotion(-66 - Math.max(0, wave) * 1.2, wave * 0.006);
            this.avatarShadow?.setScale(1.04, 1);
            if (this.time.now >= this.afkEffectNextAt) {
              this.afkEffectNextAt = this.time.now + 900;
              this.emitAfkSparkle("heart");
            }
            return;
          }

          if (this.afkAnimation === "wave") {
            this.setAvatarPose("wave");
            this.setKeeperLayerMotion(-66, wave * 0.012 * (this.avatarFacing === "left" ? -1 : 1));
            this.avatarShadow?.setScale(1.04, 1);
            if (this.time.now >= this.afkEffectNextAt) {
              this.afkEffectNextAt = this.time.now + 1200;
              this.emitAfkSparkle("wave");
            }
            return;
          }

          this.setAvatarPose("wave");
          this.setKeeperLayerMotion(-66 - Math.abs(wave) * 1.2, wave * 0.01);
          this.avatarShadow?.setScale(1.05, 1);
          if (this.afkEffect) this.afkEffect.setScale(this.avatarFacing === "left" ? -1 : 1, 1);
        }

        private applyKeeperLocomotion(moving: boolean, delta = 16) {
          if (!this.avatarSprite) return;
          if (!moving) {
            this.updateAfkAnimation(delta);
            return;
          }

          if (this.afkAnimation !== "idle" || this.afkIdleMs !== 0) this.resetAfkAnimation();
          const wave = Math.sin(gaitPhase(this.time.now) * Math.PI * 2);
          const stride = Math.abs(wave);
          const direction = this.avatarFacing === "left" ? -1 : 1;
          const stepX = wave * 3.4 * direction;
          this.setAvatarPose(keeperGaitPose(this.time.now));
          this.setKeeperLayerMotion(-66 - stride * 5.2, wave * 0.032 * direction, 1 + stride * 0.035, 1 - stride * 0.025, stepX);
          this.avatarShadow?.setScale(1 + stride * 0.12, 1 - stride * 0.05);
        }

        private applyPetLocomotion(moving: boolean, idlePose: PetPose) {
          if (!this.petSprite) return;
          if (isFlyingPetSpecies(this.petCustomization.speciesId)) {
            const wave = Math.sin(gaitPhase(this.time.now + 90) * Math.PI * 2);
            this.setPetPose(moving ? petGaitPose(this.time.now + 90) : "idle");
            this.petSprite
              .setY(-50 - Math.abs(wave) * (moving ? 5 : 3))
              .setRotation(wave * 0.04 * (this.petFacing === "left" ? -1 : 1));
            this.petShadow?.setScale(0.84 + Math.abs(wave) * 0.1, 0.72);
            return;
          }
          if (!moving) {
            this.setPetPose(idlePose);
            this.petSprite.setY(-40).setRotation(0);
            this.petShadow?.setScale(1, 1);
            return;
          }

          const wave = Math.sin(gaitPhase(this.time.now + 90) * Math.PI * 2);
          this.setPetPose(petGaitPose(this.time.now + 90));
          this.petSprite
            .setY(-40 - Math.abs(wave) * 2.5)
            .setRotation(wave * 0.03 * (this.petFacing === "left" ? -1 : 1));
          this.petShadow?.setScale(1 + Math.abs(wave) * 0.08, 1);
        }

        private updateRemoteAvatarAnimation() {
          this.remoteAvatars.forEach((remote) => {
            const moving = this.time.now < remote.movingUntil;
            const facingLeft = remote.facing === "left";
            const petFacingLeft = remote.petFacing === "left";
            this.setRemoteKeeperFlip(remote, facingLeft);
            remote.petSprite.setFlipX(petFlipX(remote.petFacing));
            remote.petAccessorySprite.setFlipX(petFlipX(remote.petFacing));
            if (isFlyingPetSpecies(remote.petSpeciesId)) {
              const petWave = Math.sin(gaitPhase(this.time.now + 90) * Math.PI * 2);
              if (moving) {
                const wave = Math.sin(gaitPhase(this.time.now) * Math.PI * 2);
                this.setRemoteKeeperFrame(remote, keeperGaitPose(this.time.now));
                const stride = Math.abs(wave);
                const direction = facingLeft ? -1 : 1;
                this.setRemoteKeeperMotion(remote, -66 - stride * 5.2, wave * 0.032 * direction, 1 + stride * 0.035, 1 - stride * 0.025, wave * 3.4 * direction);
                remote.shadow.setScale(1 + Math.abs(wave) * 0.08, 1);
              }
              remote.petSprite
                .setFrame(petFrame(remote.petSpeciesId, moving ? petGaitPose(this.time.now + 90) : "idle"))
                .setY(-48 - Math.abs(petWave) * (moving ? 5 : 3))
                .setRotation(petWave * 0.04 * (petFacingLeft ? -1 : 1));
              remote.petShadow.setScale(0.84 + Math.abs(petWave) * 0.1, 0.72);
              if (!moving) {
                this.setRemoteKeeperFrame(remote, "idle");
                this.setRemoteKeeperMotion(remote, -66, 0);
                remote.shadow.setScale(1, 1);
                return;
              }
              return;
            }

            if (!moving) {
              this.setRemoteKeeperFrame(remote, "idle");
              this.setRemoteKeeperMotion(remote, -66, 0);
              remote.petSprite
                .setFrame(petFrame(remote.petSpeciesId, "idle"))
                .setY(-38)
                .setRotation(0);
              remote.shadow.setScale(1, 1);
              remote.petShadow.setScale(1, 1);
              return;
            }

            const wave = Math.sin(gaitPhase(this.time.now) * Math.PI * 2);
            const petWave = Math.sin(gaitPhase(this.time.now + 90) * Math.PI * 2);
            const stride = Math.abs(wave);
            const direction = facingLeft ? -1 : 1;
            this.setRemoteKeeperFrame(remote, keeperGaitPose(this.time.now));
            this.setRemoteKeeperMotion(remote, -66 - stride * 5.2, wave * 0.032 * direction, 1 + stride * 0.035, 1 - stride * 0.025, wave * 3.4 * direction);
            remote.petSprite
              .setFrame(petFrame(remote.petSpeciesId, petGaitPose(this.time.now + 90)))
              .setY(-38 - Math.abs(petWave) * 2.3)
              .setRotation(petWave * 0.03 * (petFacingLeft ? -1 : 1));
            remote.shadow.setScale(1 + Math.abs(wave) * 0.08, 1);
            remote.petShadow.setScale(1 + Math.abs(petWave) * 0.08, 1);
          });
        }

        private setRemoteKeeperFlip(remote: RemoteGardenAvatarObject, facingLeft: boolean) {
          remote.sprite.setFlipX(facingLeft);
          remote.skinSprite.setFlipX(facingLeft);
          remote.hairSprite.setFlipX(facingLeft);
        }

        private setRemoteKeeperFrame(remote: RemoteGardenAvatarObject, pose: KeeperPose) {
          remote.sprite.setTexture("keeper-animation-sheet", keeperFrame(remote.paletteId, pose, remote.outfitId, remote.bodyId));
          remote.skinSprite.setFrame(keeperSkinFrame(pose, remote.outfitId, remote.bodyId));
          remote.hairSprite.setFrame(keeperHairFrame(remote.hairStyleId, pose, remote.bodyId));
          this.applyRemoteKeeperTints(remote);
        }

        private setRemoteKeeperMotion(remote: RemoteGardenAvatarObject, y: number, rotation: number, scaleX = 1, scaleY = 1, x = 0) {
          [remote.skinSprite, remote.sprite, remote.hairSprite].forEach((sprite) => {
            sprite.setPosition(x, y).setRotation(rotation);
          });
          remote.container.setScale(scaleX, scaleY);
        }

        private applyRemoteKeeperTints(remote: RemoteGardenAvatarObject) {
          const skinColor = PhaserModule.Display.Color.HexStringToColor(getKeeperSkinTone(remote.skinId).color).color;
          const hairColor = PhaserModule.Display.Color.HexStringToColor(getKeeperHairColor(remote.hairColorId).color).color;
          remote.sprite.clearTint().setAlpha(1);
          remote.skinSprite
            .clearTint()
            .setTintFill(skinColor)
            .setAlpha(0.86)
            .setDepth(remote.sprite.depth + 1);
          remote.hairSprite
            .clearTint()
            .setTintFill(hairColor)
            .setAlpha(0.94)
            .setDepth(remote.sprite.depth + 2);
        }

        private tintPetForTone() {
          this.applyPetAppearance();
        }

        /** Combine the customisation tone with a muddy overlay when the
         *  pet is dirty. Phaser only supports one tint per sprite, so we
         *  pick the appropriate single colour and apply it. When clean
         *  the original tone returns. */
        private applyPetAppearance() {
          if (!this.petSprite) return;
          if (isFlyingPetSpecies(this.petCustomization.speciesId)) {
            this.petSprite.clearTint();
            return;
          }
          // Dirty wins over tone — the keeper needs to see the neglect.
          if (this.petBehavior.dirty) {
            const muddy = PhaserModule.Display.Color.HexStringToColor("#7A5A3F").color;
            this.petSprite.setTint(muddy);
            return;
          }
          const tone = getPetTone(this.petCustomization.toneId);
          if (this.petCustomization.toneId === "cream") {
            this.petSprite.clearTint();
            return;
          }
          const tint = PhaserModule.Display.Color.HexStringToColor(tone.color).color;
          this.petSprite.setTint(tint);
        }

        private createPetAccessorySprite(accessoryId: PetAccessoryId) {
          const accessory = getPetAccessory(accessoryId);
          return this.add
            .sprite(accessory.x, accessory.y, "pet-accessory-sprites", petAccessoryFrame(accessoryId))
            .setDisplaySize(accessory.width, accessory.height)
            .setDepth(2);
        }

        private updatePetAccessory(sprite: Phaser.GameObjects.Sprite | undefined, accessoryId: PetAccessoryId) {
          if (!sprite) return;
          const accessory = getPetAccessory(accessoryId);
          sprite
            .setVisible(true)
            .setFrame(petAccessoryFrame(accessoryId))
            .setPosition(accessory.x, accessory.y)
            .setDisplaySize(accessory.width, accessory.height);
        }

        /**
         * If right-click has been held longer than 500ms without releasing,
         * recall the companion to the keeper. The flag prevents the
         * subsequent pointerup from also toggling modes.
         */
        private checkRightHold() {
          if (this.rightHoldFired) return;
          if (this.rightButtonDownAt === 0) return;
          if (!this.input.activePointer.rightButtonDown()) {
            this.rightButtonDownAt = 0;
            return;
          }
          if (this.time.now - this.rightButtonDownAt >= 500) {
            this.rightHoldFired = true;
            this.recallCompanion();
          }
        }

        private updateAvatar(delta: number) {
          // When the player is driving the companion, the keeper stays put.
          // We still update the facing flip and the pose so the keeper
          // "watches" their companion rather than freezing into a T-pose.
          if (this.playMode === "companion") {
            this.avatarFacing = this.pet?.x && this.pet.x < this.avatar.x ? "left" : "right";
            this.setKeeperLayerFlip(this.avatarFacing);
            this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
            this.avatarShadow.setDepth(this.avatar.y - 1);
            this.applyKeeperLocomotion(false, delta);
            return;
          }

          const keyboard = this.readKeyboard();
          const speed = 0.24 * delta;
          let moving = false;
          let moveDx = 0;

          if (keyboard.x !== 0 || keyboard.y !== 0) {
            this.target = undefined;
            const next = this.constrainAvatarToWalkable(this.avatar.x + keyboard.x * speed, this.avatar.y + keyboard.y * speed);
            moveDx = next.x - this.avatar.x;
            this.avatar.setPosition(next.x, next.y);
            moving = true;
          } else if (this.target) {
            const distance = PhaserModule.Math.Distance.Between(this.avatar.x, this.avatar.y, this.target.x, this.target.y);
            if (distance < 5) {
              this.target = undefined;
            } else {
              const angle = PhaserModule.Math.Angle.Between(this.avatar.x, this.avatar.y, this.target.x, this.target.y);
              const next = this.constrainAvatarToWalkable(
                this.avatar.x + Math.cos(angle) * speed,
                this.avatar.y + Math.sin(angle) * speed,
              );
              moveDx = next.x - this.avatar.x;
              this.avatar.setPosition(next.x, next.y);
              moving = true;
            }
          }

          // Don't fire the facing keybind while the player is typing into chat.
          if (
            canEditGarden
            && !this.textInputFocused
            && !isTextInputFocused()
            && this.wasd?.rotate
            && PhaserModule.Input.Keyboard.JustDown(this.wasd.rotate)
          ) {
            this.toggleSelectedDecorFacing();
          }

          // Mirror the keeper sprite to face the direction of travel.
          if (moving && Math.abs(moveDx) > 0.05) {
            this.avatarFacing = moveDx < 0 ? "left" : "right";
          }
          this.setKeeperLayerFlip(this.avatarFacing);

          this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
          this.avatarShadow.setDepth(this.avatar.y - 1);
          this.applyKeeperLocomotion(moving, delta);

          this.moveBroadcastTimer += delta;
          this.footstepTimer += delta;
          const hasMoved = PhaserModule.Math.Distance.Between(
            this.avatar.x,
            this.avatar.y,
            this.lastSentPosition.x,
            this.lastSentPosition.y,
          ) > 3;

          if (hasMoved && this.footstepTimer > 260) {
            this.footstepTimer = 0;
            playCozyCue("avatarStep");
          }

          if (hasMoved && this.moveBroadcastTimer > 120) {
            this.moveBroadcastTimer = 0;
            this.lastSentPosition = { x: this.avatar.x, y: this.avatar.y };
            // Include the pet's world position + the control mode so remote
            // viewers can render BOTH the keeper and the companion in their
            // actual locations — without this, players controlling their
            // companion would appear frozen to anyone else in the scene.
            onAvatarMove?.({
              ...this.lastSentPosition,
              facing: this.avatarFacing,
              petX: this.pet?.x,
              petY: this.pet?.y,
              petFacing: this.petFacing,
              controlMode: this.playMode,
            });
          }
        }

        /**
         * Drive the companion sprite directly from the keyboard. Used while
         * `playMode === "companion"`. Speed is ×1.6 the keeper's so the pet
         * actually feels like a quick scout. We still keep them on the
         * walkable corridor so they don't sprint through hedges.
         */
        private updatePetController(delta: number) {
          if (!this.pet) return;
          const keyboard = this.readKeyboard();
          // Direct control should feel as reliable as keeper control. Vitals
          // still drive mood/poses, but never throttle the player's input.
          const speed = 0.24 * 1.6 * delta;
          const prevPetX = this.pet.x;
          let petMoving = false;
          let petMoveDx = 0;

          if (keyboard.x !== 0 || keyboard.y !== 0) {
            const next = this.constrainAvatarToWalkable(this.pet.x + keyboard.x * speed, this.pet.y + keyboard.y * speed);
            petMoveDx = next.x - this.pet.x;
            this.pet.setPosition(next.x, next.y);
            petMoving = true;
          } else if (this.target) {
            const distance = PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, this.target.x, this.target.y);
            if (distance < 5) {
              this.target = undefined;
            } else {
              const angle = PhaserModule.Math.Angle.Between(this.pet.x, this.pet.y, this.target.x, this.target.y);
              const next = this.constrainAvatarToWalkable(
                this.pet.x + Math.cos(angle) * speed,
                this.pet.y + Math.sin(angle) * speed,
              );
              petMoveDx = next.x - this.pet.x;
              this.pet.setPosition(next.x, next.y);
              petMoving = true;
            }
          }

          if (petMoving && Math.abs(petMoveDx) > 0.05) {
            this.petFacing = petMoveDx < 0 ? "left" : "right";
          } else if (!petMoving) {
            this.petFacing = prevPetX > this.pet.x ? "left" : this.petFacing;
          }
          this.petSprite.setFlipX(petFlipX(this.petFacing));
          this.petAccessorySprite?.setFlipX(petFlipX(this.petFacing));
          this.applyPetLocomotion(petMoving, "idle");
          this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
          this.petShadow.setDepth(this.pet.y - 1);

          // Broadcast the pet's new position to multiplayer. The keeper
          // stays put in companion mode, so `updateAvatar`'s broadcast
          // never fires — without this branch, remote keepers see our pet
          // glued to the spot where we swapped. Throttled at the same
          // 120 ms cadence as the keeper broadcast to keep the channel
          // chatter constant.
          this.moveBroadcastTimer += delta;
          const lastPet = this.lastSentPetPosition;
          const petHasMoved = !lastPet || PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, lastPet.x, lastPet.y) > 3;
          if (petHasMoved && this.moveBroadcastTimer > 120) {
            this.moveBroadcastTimer = 0;
            this.lastSentPetPosition = { x: this.pet.x, y: this.pet.y };
            onAvatarMove?.({
              x: this.avatar.x,
              y: this.avatar.y,
              facing: this.avatarFacing,
              petX: this.pet.x,
              petY: this.pet.y,
              petFacing: this.petFacing,
              controlMode: "companion",
            });
          }
        }

        private companionFollowTarget() {
          const offsetX = this.avatarFacing === "left" ? 64 : -64;
          return this.constrainAvatarToWalkable(this.avatar.x + offsetX, this.avatar.y + 28);
        }

        private updatePet(delta: number) {
          if (!this.pet) return;
          // Refresh the behaviour cache. Cheap (one localStorage read
          // through `getPetVitals`), but skips work during nap because
          // we want the cached `napping` flag to stay sticky until the
          // PET_VITALS_EVENT from `getPetVitals`'s auto-resolve flips it.
          if (!this.petBehavior.napping) this.petBehavior = getPetBehavior();

          // ── NAPPING ─────────────────────────────────────────────────
          // Hide the pet entirely. `getPetVitals` auto-credits +25%
          // energy and clears `napUntil` when the 5-minute window
          // elapses, which fires PET_VITALS_EVENT and runs the handler
          // that flips `petBehavior.napping` back to false.
          if (this.playMode !== "companion" && this.petBehavior.napping) {
            this.petWasNapping = true;
            this.petFleeing = false;
            this.petFleeTarget = undefined;
            const follow = this.companionFollowTarget();
            const next = this.constrainAvatarToWalkable(
              PhaserModule.Math.Linear(this.pet.x, follow.x, 0.08),
              PhaserModule.Math.Linear(this.pet.y, follow.y, 0.08),
            );
            this.pet.setPosition(next.x, next.y).setVisible(true);
            this.petShadow?.setVisible(true);
            this.petMood = "sit";
            this.petFacing = this.avatar.x < this.pet.x ? "left" : "right";
            this.petSprite.setFlipX(petFlipX(this.petFacing));
            this.petAccessorySprite?.setFlipX(petFlipX(this.petFacing));
            this.applyPetLocomotion(false, "sleep");
            this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
            this.petShadow.setDepth(this.pet.y - 1);
            // Poll the auto-resolve once per second so the nap ends
            // promptly even without external events firing.
            if (Math.floor(this.time.now / 1000) % 1 === 0) {
              this.petBehavior = getPetBehavior();
            }
            return;
          }

          // ── WAKING UP ───────────────────────────────────────────────
          // Just-resolved nap. Restore visibility and snap the pet back
          // to a sensible spot beside the keeper so it doesn't "warp in"
          // halfway through a wall.
          if (this.playMode !== "companion" && this.petWasNapping && !this.petBehavior.napping) {
            this.petWasNapping = false;
            this.petFleeing = false;
            this.petFleeTarget = undefined;
            this.pet.setVisible(true);
            this.petShadow?.setVisible(true);
            this.petMood = "happy";
            this.petMoodTimer = 0;
            setStatus(`${this.petCustomization.speciesId} woke up refreshed.`);
          }

          // ── FLEEING ─────────────────────────────────────────────────
          // Pet ran out of energy — shuffle off the edge of the world,
          // then collapse into a nap. The flee uses the dimmest possible
          // speed so the keeper has time to notice and feed/rest them
          // before they're gone.
          if (this.playMode !== "companion" && this.petFleeing) {
            const target = this.petFleeTarget;
            if (!target) {
              this.petFleeing = false;
            } else {
              const sleepySpeed = 0.10 * delta;
              const distance = PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, target.x, target.y);
              if (distance < 12) {
                // Reached the off-screen target. Hide + start the nap timer.
                this.pet.setVisible(false);
                this.petShadow?.setVisible(false);
                this.petFleeing = false;
                this.petFleeTarget = undefined;
                startPetNap();
                this.petBehavior = getPetBehavior();
                this.petWasNapping = true;
                return;
              }
              const angle = PhaserModule.Math.Angle.Between(this.pet.x, this.pet.y, target.x, target.y);
              const nextX = this.pet.x + Math.cos(angle) * sleepySpeed;
              const nextY = this.pet.y + Math.sin(angle) * sleepySpeed;
              this.pet.setPosition(nextX, nextY);
              this.petFacing = Math.cos(angle) < 0 ? "left" : "right";
              this.petSprite.setFlipX(petFlipX(this.petFacing));
              this.petAccessorySprite?.setFlipX(petFlipX(this.petFacing));
              this.applyPetLocomotion(true, "idle");
              this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
              this.petShadow.setDepth(this.pet.y - 1);
              return;
            }
          }

          // ── EXHAUSTED → START FLEE ─────────────────────────────────
          if (this.playMode !== "companion" && this.petBehavior.exhausted && !this.petFleeing) {
            this.petFleeing = true;
            // Flee toward whichever world edge is closer. Companion drifts
            // off the side of the map — easier to "lose" them than to make
            // them stand in the middle awkwardly.
            const fleeLeft = this.pet.x < GARDEN_WORLD_WIDTH / 2;
            this.petFleeTarget = {
              x: fleeLeft ? -120 : GARDEN_WORLD_WIDTH + 120,
              y: this.pet.y,
            };
            setStatus(`${this.petCustomization.speciesId} is exhausted — wandering off for a nap.`);
            // Don't continue with normal pet logic this frame; the next
            // frame will hit the FLEEING branch above.
            return;
          }

          this.petMoodTimer += delta;
          // Long calm period before flipping mood — the previous 5.2s
          // cycle made the companion feel like it was constantly twitching
          // between idle and sit. ~14s feels lounging instead.
          if (this.petMoodTimer > 14000) {
            this.petMoodTimer = 0;
            this.petMood = this.petMood === "idle" ? "sit" : "idle";
          }

          // When the player is driving the companion, WASD moves the pet
          // directly at a faster speed (×1.6) and the auto-follow falls
          // away — the companion can roam free until you swap back.
          if (this.playMode === "companion") {
            this.updatePetController(delta);
            return;
          }

          const follow = this.companionFollowTarget();
          const targetX = follow.x;
          const targetY = follow.y;
          const distance = PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, targetX, targetY);
          let petMoving = false;
          const prevPetX = this.pet.x;
          if (distance > 8) {
            // Joy still matters, but the baseline is high enough that the
            // companion follows across both axes instead of feeling stuck.
            const lerp = 0.105 * this.petBehavior.speedMultiplier;
            const next = this.constrainAvatarToWalkable(
              PhaserModule.Math.Linear(this.pet.x, targetX, lerp),
              PhaserModule.Math.Linear(this.pet.y, targetY, lerp),
            );
            this.pet.setPosition(next.x, next.y);
            this.petMood = "follow";
            petMoving = true;
          } else if (this.petMood === "follow") {
            this.petMood = "happy";
            this.petMoodTimer = 0;
          }

          // Pet faces the way it trots; idle, it turns to watch the keeper.
          const petDx = this.pet.x - prevPetX;
          if (petMoving && Math.abs(petDx) > 0.05) {
            this.petFacing = petDx < 0 ? "left" : "right";
          } else if (!petMoving) {
            this.petFacing = this.avatar.x < this.pet.x ? "left" : "right";
          }
          this.petSprite.setFlipX(petFlipX(this.petFacing));
          this.petAccessorySprite?.setFlipX(petFlipX(this.petFacing));

          // Idle pose echoes the vitals-derived companion mood — a happy pet
          // bounces, a lonely one curls into a sit. Local-state moods still win.
          const idleMoodPose: PetPose =
            this.companionMood === "blissful" || this.companionMood === "happy"
              ? "happy"
              : this.companionMood === "restless" || this.companionMood === "lonely"
                ? "sit"
                : "idle";
          const pose: PetPose = this.petMood === "sit"
            ? "sit"
            : this.petMood === "happy"
              ? "happy"
              : idleMoodPose;
          this.applyPetLocomotion(petMoving, pose);
          // Subtle squish on sit — 0.96 reads as "settled" without making
          // the pet jump shape between frames.
          this.pet.setScale(1, this.petMood === "sit" ? 0.96 : 1);
          this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
          this.petShadow.setDepth(this.pet.y - 1);

          // Keeper-mode pet broadcast — when the keeper is standing still
          // and the pet is auto-following / wandering to a sniff target,
          // the avatar-move broadcast doesn't fire. Without this, remote
          // viewers see the pet teleport on the next keeper move instead
          // of trailing along. Throttled to ~9Hz to match the avatar tick.
          this.moveBroadcastTimer += delta;
          const lastPet = this.lastSentPetPosition;
          const petHasMoved = !lastPet || PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, lastPet.x, lastPet.y) > 3;
          if (petHasMoved && this.moveBroadcastTimer > 120) {
            this.moveBroadcastTimer = 0;
            this.lastSentPetPosition = { x: this.pet.x, y: this.pet.y };
            onAvatarMove?.({
              x: this.avatar.x,
              y: this.avatar.y,
              facing: this.avatarFacing,
              petX: this.pet.x,
              petY: this.pet.y,
              petFacing: this.petFacing,
              controlMode: "keeper",
            });
          }
        }

        private readKeyboard() {
          // When the player is typing into the chat input (or any text field),
          // WASD / arrow keys must NOT move the avatar — they're letters in a
          // message, not movement intent.
          if (this.textInputFocused || isTextInputFocused()) return { x: 0, y: 0 };

          const left = Boolean(this.cursors?.left.isDown || this.wasd?.left.isDown);
          const right = Boolean(this.cursors?.right.isDown || this.wasd?.right.isDown);
          const up = Boolean(this.cursors?.up.isDown || this.wasd?.up.isDown);
          const down = Boolean(this.cursors?.down.isDown || this.wasd?.down.isDown);

          const x = Number(right) - Number(left);
          const y = Number(down) - Number(up);
          if (x === 0 && y === 0) return { x: 0, y: 0 };

          const length = Math.hypot(x, y);
          return { x: x / length, y: y / length };
        }

        private constrainToWorldBounds(x: number, y: number) {
          return {
            x: PhaserModule.Math.Clamp(x, WORLD_EDGE_INSET, GARDEN_WORLD_WIDTH - WORLD_EDGE_INSET),
            y: PhaserModule.Math.Clamp(y, WORLD_EDGE_INSET, GARDEN_WORLD_HEIGHT - WORLD_EDGE_INSET),
          };
        }

        private activeWalkSegments() {
          return variant === "park"
            ? [...parkWalkSegments, ...parkWalkableConnectors]
            : sharedWalkSegments;
        }

        private activeWalkCircles() {
          return variant === "park"
            ? [...parkWalkCircles, ...parkWalkableExtensions]
            : [...sharedWalkCircles, ...sharedWalkableExtensions];
        }

        private isInsidePaintedWalkable(x: number, y: number) {
          const inCircle = this.activeWalkCircles().some((circle) => {
            return PhaserModule.Math.Distance.Between(x, y, circle.x, circle.y) <= circle.radius;
          });
          if (inCircle) return true;
          return this.activeWalkSegments().some((segment) => {
            const projection = projectPointToSegment(x, y, segment);
            return PhaserModule.Math.Distance.Between(x, y, projection.x, projection.y) <= segment.radius;
          });
        }

        private projectToPaintedWalkable(x: number, y: number) {
          if (this.isInsidePaintedWalkable(x, y)) return { x, y };
          let closest = { x, y };
          let bestDistance = Number.POSITIVE_INFINITY;

          this.activeWalkCircles().forEach((circle) => {
            const angle = PhaserModule.Math.Angle.Between(circle.x, circle.y, x, y);
            const candidate = {
              x: circle.x + Math.cos(angle) * circle.radius,
              y: circle.y + Math.sin(angle) * circle.radius,
            };
            const distance = PhaserModule.Math.Distance.Between(x, y, candidate.x, candidate.y);
            if (distance < bestDistance) {
              bestDistance = distance;
              closest = candidate;
            }
          });

          this.activeWalkSegments().forEach((segment) => {
            const projection = projectPointToSegment(x, y, segment);
            const away = new PhaserModule.Math.Vector2(x - projection.x, y - projection.y);
            if (away.lengthSq() < 0.001) away.set(0, 1);
            away.normalize();
            const candidate = {
              x: projection.x + away.x * segment.radius,
              y: projection.y + away.y * segment.radius,
            };
            const distance = PhaserModule.Math.Distance.Between(x, y, candidate.x, candidate.y);
            if (distance < bestDistance) {
              bestDistance = distance;
              closest = candidate;
            }
          });

          return this.constrainToWorldBounds(closest.x, closest.y);
        }

        private constrainAvatarToWalkable(x: number, y: number) {
          let point = this.projectToPaintedWalkable(x, y);

          // Painted-path model: keep the keeper on roads, pads, and discovery
          // bubbles, then push out of water/decor. Loop because pushing away
          // from one obstacle can land near another.
          for (let attempts = 0; attempts < 4; attempts += 1) {
            const before = { ...point };
            point = this.pushOutOfWater(point.x, point.y);
            point = this.pushOutOfDecorFootprints(point.x, point.y);
            point = this.projectToPaintedWalkable(point.x, point.y);
            if (PhaserModule.Math.Distance.Between(before.x, before.y, point.x, point.y) < 0.5) break;
          }

          return point;
        }

        private pushOutOfWater(x: number, y: number) {
          let point = { x, y };
          for (const points of waterPolygonsByVariant[variant]) {
            const polygon = new PhaserModule.Geom.Polygon(points.flatMap((p) => [p.x, p.y]));
            if (!PhaserModule.Geom.Polygon.Contains(polygon, point.x, point.y)) continue;

            let closest = { x: point.x, y: point.y };
            let bestDistance = Number.POSITIVE_INFINITY;
            points.forEach((start, index) => {
              const end = points[(index + 1) % points.length];
              const projection = projectPointToSegment(point.x, point.y, {
                x1: start.x,
                y1: start.y,
                x2: end.x,
                y2: end.y,
                radius: 0,
              });
              const distance = PhaserModule.Math.Distance.Between(point.x, point.y, projection.x, projection.y);
              if (distance < bestDistance) {
                bestDistance = distance;
                closest = projection;
              }
            });

            const center = points.reduce(
              (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
              { x: 0, y: 0 },
            );
            const away = new PhaserModule.Math.Vector2(closest.x - center.x, closest.y - center.y).normalize();
            if (!Number.isFinite(away.x) || !Number.isFinite(away.y)) away.set(0, 1);
            point = {
              x: closest.x + away.x * 34,
              y: closest.y + away.y * 34,
            };
          }
          return point;
        }

        private pushOutOfDecorFootprints(x: number, y: number) {
          let point = { x, y };
          this.decorObjects.forEach((container) => {
            const placement = container.getData("placement") as GardenDecorPlacement | undefined;
            if (!placement) return;
            if (this.selectedDecor?.id === placement.id && this.decorDragging) return;
            const spriteConfig = worldObjectSprites[placement.kind];
            const radiusX = spriteConfig.width * 0.48 + 22;
            const radiusY = Math.max(46, spriteConfig.height * 0.18) + 18;
            const centerX = container.x;
            const centerY = container.y + 22;
            const dx = point.x - centerX;
            const dy = point.y - centerY;
            const normalized = (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY);
            if (normalized >= 1) return;

            const length = Math.hypot(dx / radiusX, dy / radiusY) || 1;
            const nx = (dx / radiusX) / length;
            const ny = (dy / radiusY) / length || 0.2;
            point = {
              x: centerX + nx * radiusX,
              y: centerY + ny * radiusY,
            };
          });
          return point;
        }

        private applyRemotePetTone(sprite: Phaser.GameObjects.Sprite, toneId: PetToneId) {
          if (toneId === "cream") {
            sprite.clearTint();
            return;
          }
          const tone = getPetTone(toneId);
          sprite.setTint(PhaserModule.Display.Color.HexStringToColor(tone.color).color);
        }

        private syncRemotePlayers(players: RealtimeRoomPlayer[]) {
          const activeIds = new Set(players.map((player) => player.id));

          this.remoteAvatars.forEach((avatar, id) => {
            if (!activeIds.has(id)) {
              avatar.container.destroy(true);
              avatar.shadow.destroy();
              avatar.petContainer.destroy(true);
              avatar.petShadow.destroy();
              this.remoteAvatars.delete(id);
            }
          });

          players.forEach((player) => {
            // Render every visiting keeper with their real palette + outfit and
            // their real pet species + fur tone, mirrored to their facing.
            const custom = normalizeRemoteCustomization(player);
            let facingLeft = player.facing === "left";

            const existing = this.remoteAvatars.get(player.id);
            if (existing) {
              const distance = PhaserModule.Math.Distance.Between(existing.container.x, existing.container.y, player.x, player.y);
              const dx = player.x - existing.container.x;
              if (Math.abs(dx) > 2) facingLeft = dx < 0;
              existing.facing = facingLeft ? "left" : "right";
              existing.movingUntil = distance > 2 ? this.time.now + 280 : this.time.now;
              // Prefer the broadcast pet position when the sender includes
              // it — that's the path that fixes "multiplayer companion
              // doesn't appear to move". Fall back to the auto-trailing
              // offset for legacy clients that don't include `petX`/`petY`.
              const petFacingLeft = (player.petFacing ?? player.facing) === "left";
              const petX = typeof player.petX === "number" ? player.petX : player.x + (facingLeft ? 58 : -58);
              const petY = typeof player.petY === "number" ? player.petY : player.y + 18;
              existing.petFacing = petFacingLeft ? "left" : "right";
              existing.controlMode = player.controlMode ?? "keeper";
              const changed =
                existing.characterId !== custom.characterId ||
                existing.bodyId !== custom.bodyId ||
                existing.skinId !== custom.skinId ||
                existing.hairStyleId !== custom.hairStyleId ||
                existing.hairColorId !== custom.hairColorId ||
                existing.paletteId !== custom.paletteId ||
                existing.outfitId !== custom.outfitId ||
                existing.petSpeciesId !== custom.petSpeciesId ||
                existing.petToneId !== custom.petToneId ||
                existing.petAccessoryId !== custom.petAccessoryId;
              if (changed) {
                existing.characterId = custom.characterId;
                existing.bodyId = custom.bodyId;
                existing.skinId = custom.skinId;
                existing.hairStyleId = custom.hairStyleId;
                existing.hairColorId = custom.hairColorId;
                existing.paletteId = custom.paletteId;
                existing.outfitId = custom.outfitId;
                existing.petSpeciesId = custom.petSpeciesId;
                existing.petToneId = custom.petToneId;
                existing.petAccessoryId = custom.petAccessoryId;
                this.setRemoteKeeperFrame(existing, "idle");
                this.applyRemotePetTone(existing.petSprite, custom.petToneId);
                if (isFlyingPetSpecies(custom.petSpeciesId)) existing.petSprite.clearTint();
                this.updatePetAccessory(existing.petAccessorySprite, custom.petAccessoryId);
                existing.petAccessorySprite.setVisible(!isFlyingPetSpecies(custom.petSpeciesId));
              }
              existing.label.setText(player.displayName);
              this.tweens.killTweensOf([existing.container, existing.shadow, existing.petContainer, existing.petShadow]);
              this.tweens.add({
                targets: existing.container,
                x: player.x,
                y: player.y,
                duration: distance > 2 ? 190 : 80,
                ease: "Sine.out",
                onComplete: () => existing.container.setDepth(player.y),
              });
              this.tweens.add({ targets: existing.shadow, x: player.x, y: player.y + 22, duration: distance > 2 ? 190 : 80, ease: "Sine.out" });
              this.tweens.add({
                targets: existing.petContainer,
                x: petX,
                y: petY,
                duration: distance > 2 ? 230 : 100,
                ease: "Sine.out",
                onComplete: () => existing.petContainer.setDepth(petY - 1),
              });
              this.tweens.add({ targets: existing.petShadow, x: petX, y: petY + 16, duration: distance > 2 ? 230 : 100, ease: "Sine.out" });
              return;
            }

            const petX = typeof player.petX === "number" ? player.petX : player.x + (facingLeft ? 58 : -58);
            const petY = typeof player.petY === "number" ? player.petY : player.y + 18;
            const remotePetFacing = (player.petFacing ?? player.facing) as FacingDirection;

            // --- new visiting keeper ---
            const color = PhaserModule.Display.Color.HexStringToColor(player.color).color;
            const shadow = this.add.ellipse(player.x, player.y + 22, 48, 17, 0x3a2a2a, 0.14).setDepth(player.y - 1);
            const container = this.add.container(player.x, player.y).setDepth(player.y);
            const aura = this.add.circle(0, -80, 14, color, 0.28);
            const skinSprite = this.add
              .sprite(0, -66, "keeper-skin-mask-sheet", keeperSkinFrame("idle", custom.outfitId, custom.bodyId))
              .setDisplaySize(98, 147)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
            const sprite = this.add
              .sprite(0, -66, "keeper-animation-sheet", keeperFrame(custom.paletteId, "idle", custom.outfitId, custom.bodyId))
              .setDisplaySize(98, 147)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
            const hairSprite = this.add
              .sprite(0, -66, "keeper-hair-style-sheet", keeperHairFrame(custom.hairStyleId, "idle", custom.bodyId))
              .setDisplaySize(98, 147)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
            sprite.clearTint().setAlpha(1);
            skinSprite.clearTint().setAlpha(0);
            hairSprite.clearTint().setAlpha(0);
            const label = this.add
              .text(0, -102, player.displayName, {
                align: "center",
                color: "#3A2A2A",
                fontFamily: "Nunito, sans-serif",
                fontSize: "11px",
                fontStyle: "900",
                backgroundColor: "#FFFDF6DD",
                padding: { x: 8, y: 3 },
              })
              .setOrigin(0.5);
            container.add([aura, sprite, skinSprite, hairSprite, label]);

            // --- their pet ---
            const petShadow = this.add.ellipse(petX, petY + 16, 42, 14, 0x3a2a2a, 0.13).setDepth(petY - 2);
            const petContainer = this.add.container(petX, petY).setDepth(petY - 1);
            const petSprite = this.add
              .sprite(0, -38, "pet-animation-sheet", petFrame(custom.petSpeciesId, "idle"))
              .setDisplaySize(84, 94)
              .setAlpha(0.94)
              .setFlipX(petFlipX(remotePetFacing));
            this.applyRemotePetTone(petSprite, custom.petToneId);
            if (isFlyingPetSpecies(custom.petSpeciesId)) petSprite.clearTint();
            const petAccessorySprite = this.createPetAccessorySprite(custom.petAccessoryId)
              .setAlpha(0.94)
              .setFlipX(petFlipX(remotePetFacing))
              .setVisible(!isFlyingPetSpecies(custom.petSpeciesId));
            petContainer.add([petSprite, petAccessorySprite]);

            const remoteAvatar: RemoteGardenAvatarObject = {
              container,
              shadow,
              sprite,
              skinSprite,
              hairSprite,
              label,
              petContainer,
              petShadow,
              petSprite,
              petAccessorySprite,
              characterId: custom.characterId,
              bodyId: custom.bodyId,
              skinId: custom.skinId,
              hairStyleId: custom.hairStyleId,
              hairColorId: custom.hairColorId,
              paletteId: custom.paletteId,
              outfitId: custom.outfitId,
              petSpeciesId: custom.petSpeciesId,
              petToneId: custom.petToneId,
              petAccessoryId: custom.petAccessoryId,
              facing: facingLeft ? "left" : "right",
              petFacing: remotePetFacing,
              controlMode: player.controlMode ?? "keeper",
              movingUntil: 0,
            };
            this.remoteAvatars.set(player.id, remoteAvatar);
            this.applyRemoteKeeperTints(remoteAvatar);
          });
        }

        private refreshRemotePlayersFromReact(force = false) {
          const nextPlayers = remotePlayersRef.current ?? [];
          if (!force && this.lastRemotePlayersSnapshot === nextPlayers) return;
          this.lastRemotePlayersSnapshot = nextPlayers;
          this.syncRemotePlayers(nextPlayers);
        }

        private showChatBubble(message: GardenChatMessage) {
          const remote = this.remoteAvatars.get(message.playerId);
          const target = remote?.container ?? this.avatar;
          const bubble = this.add.container(target.x, target.y - 126).setDepth(7200);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-120, -34, 240, 68, 18);
          bg.lineStyle(2, 0xf6cfd2, 0.85);
          bg.strokeRoundedRect(-120, -34, 240, 68, 18);
          bubble.add(bg);
          bubble.add(this.add.text(0, -10, message.text, {
            align: "center",
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "13px",
            fontStyle: "900",
            wordWrap: { width: 206 },
          }).setOrigin(0.5));
          this.tweens.add({
            targets: bubble,
            y: bubble.y - 34,
            alpha: 0,
            duration: 2600,
            ease: "Sine.out",
            onComplete: () => bubble.destroy(true),
          });
        }

        private sortDepths() {
          this.avatar?.setDepth(this.avatar.y);
          this.avatarShadow?.setDepth(this.avatar.y - 1);
          this.pet?.setDepth(this.pet.y);
          this.petShadow?.setDepth(this.pet.y - 1);
          this.decorObjects.forEach((decor) => decor.setDepth(decor.y));
          this.decorBubble?.setDepth(10000);
          this.remoteAvatars.forEach((remote) => {
            remote.container.setDepth(remote.container.y);
            remote.shadow.setDepth(remote.container.y - 1);
          });
        }

        private createDecorations(decorations: GardenDecorPlacement[]) {
          decorations.forEach((decoration) => this.createDecoration(decoration));
        }

        private addDecorFromDrawer(kind: GardenDecorKind, point?: { x: number; y: number }) {
          if (!canEditGarden) {
            setStatus("Only the host or trusted decorators can place garden items in this visit.");
            return;
          }
          const item = gardenDecorItems.find((entry) => entry.kind === kind);
          if (!item) return;
          const center = point ?? this.constrainToWorldBounds(this.cameras.main.scrollX + GARDEN_WIDTH / 2, this.cameras.main.scrollY + GARDEN_HEIGHT / 2 + 80);
          const decoration: GardenDecorPlacement = {
            id: `garden-${kind}-${Date.now()}`,
            kind,
            label: item.label,
            href: item.href,
            x: Math.round(center.x),
            y: Math.round(center.y),
            rotation: 0,
          };
          this.createDecoration(decoration);
          this.persistDecorations();
          playCozyCue("place");
          setStatus(`${item.label} placed. Drag it around the garden or press R while selected to flip it.`);
        }

        private createDecoration(decoration: GardenDecorPlacement) {
          const spriteConfig = worldObjectSprites[decoration.kind];
          if (!spriteConfig) return;
          const container = this.add.container(decoration.x, decoration.y).setDepth(decoration.y);
          container.setRotation(0);
          container.setSize(spriteConfig.width, spriteConfig.height);
          const spriteBounds = this.getDecorSpriteBounds(spriteConfig);
          const hitArea = new PhaserModule.Geom.Rectangle(
            spriteBounds.left,
            spriteBounds.top,
            spriteBounds.width,
            spriteBounds.height,
          );
          container.setInteractive({
            draggable: canEditGarden,
            hitArea,
            hitAreaCallback: PhaserModule.Geom.Rectangle.Contains,
            useHandCursor: true,
          });
          if (canEditGarden) this.input.setDraggable(container);

          const glow = this.add.graphics();
          glow.lineStyle(4, 0xffffff, 0.9);
          glow.strokeRoundedRect(spriteBounds.left, spriteBounds.top, spriteBounds.width, spriteBounds.height, 18);
          glow.setVisible(false);
          container.add(glow);
          container.setData("glow", glow);

          const pendingOutline = this.add.graphics();
          pendingOutline.setVisible(false);
          container.add(pendingOutline);
          container.setData("pendingOutline", pendingOutline);
          container.setData("placement", decoration);

          this.drawGardenDecoration(container, decoration.kind);
          this.decorObjects.set(decoration.id, container);
          this.applyPendingDecorStyle(decoration.id);

          container.on(
            "pointerdown",
            (
              pointer: Phaser.Input.Pointer,
              _localX: number,
              _localY: number,
              event: Phaser.Types.Input.EventData,
            ) => {
              if (pointer.rightButtonDown()) return;
              // Both stop calls — matches room-canvas: Phaser EventData
              // stops propagation to game objects beneath this one, and
              // pointer.event stops the underlying DOM event. The
              // scene-level pointerdown handler also bails out when a
              // game object is under the pointer (see input.on pointerdown
              // in createInput), so the bubble survives.
              event.stopPropagation();
              pointer.event.stopPropagation();
              container.setData("wasSelectedOnPointerDown", this.selectedDecor?.id === decoration.id);
              this.selectDecor(decoration.id);
            },
          );
          container.on("pointerover", () => {
            glow.setVisible(true);
            setStatus(
              canEditGarden
                ? `${decoration.label}: drag to move, R flips facing${decoration.href ? ", click while nearby to play" : ""}.`
                : `${decoration.label}: click while nearby to interact${decoration.href ? " or play" : ""}.`,
            );
          });
          container.on("pointerout", () => {
            if (this.selectedDecor?.id !== decoration.id) glow.setVisible(false);
          });
          container.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            if (!canEditGarden) return;
            this.decorDragging = true;
            const next = this.constrainToWorldBounds(dragX, dragY);
            container.setPosition(next.x, next.y);
            decoration.x = Math.round(next.x);
            decoration.y = Math.round(next.y);
            this.moveDecorBubble();
          });
          container.on("dragend", () => {
            if (!canEditGarden) return;
            this.persistDecorations();
            setStatus(`${decoration.label} moved to x ${decoration.x}, y ${decoration.y}.`);
            this.time.delayedCall(140, () => {
              this.decorDragging = false;
            });
          });
          container.on("pointerup", () => {
            if (this.decorDragging) return;
            const wasSelected = Boolean(container.getData("wasSelectedOnPointerDown"));
            container.setData("wasSelectedOnPointerDown", false);
            if (!wasSelected) {
              setStatus(`${decoration.label} selected. Use the menu, drag it, or tap again to interact.`);
              return;
            }
            const distance = PhaserModule.Math.Distance.Between(this.avatar?.x ?? decoration.x, this.avatar?.y ?? decoration.y, decoration.x, decoration.y);
            if (distance > 180 && this.avatar) {
              const pathPoint = this.constrainAvatarToWalkable(decoration.x, decoration.y + 62);
              this.target = new PhaserModule.Math.Vector2(pathPoint.x, pathPoint.y);
              playCozyCue("move");
              setStatus(`Walking to ${decoration.label}. Click it again when you arrive.`);
              return;
            }
            this.activateDecoration(decoration);
            if (!decoration.href) return;
            playCozyCue("ui");
            setStatus(`Opening ${decoration.label}.`);
            if (onNavigateRef.current) {
              onNavigateRef.current(decoration.href);
            } else {
              window.location.assign(decoration.href);
            }
          });
        }

        private syncDecor(nextDecor: GardenDecorPlacement[]) {
          const nextById = new Map(nextDecor.map((decoration) => [decoration.id, decoration]));

          for (const [id, container] of Array.from(this.decorObjects.entries())) {
            if (!nextById.has(id)) {
              container.destroy(true);
              this.decorObjects.delete(id);
              if (this.selectedDecor?.id === id) {
                this.selectedDecor = undefined;
                this.decorBubble?.destroy(true);
                this.decorBubble = undefined;
              }
            }
          }

          for (const decoration of nextDecor) {
            const spriteConfig = worldObjectSprites[decoration.kind];
            if (!spriteConfig) continue;
            const existing = this.decorObjects.get(decoration.id);
            if (!existing) {
              this.createDecoration(decoration);
              continue;
            }

            const placement = existing.getData("placement") as GardenDecorPlacement;
            if (placement.kind !== decoration.kind) {
              existing.destroy(true);
              this.decorObjects.delete(decoration.id);
              this.createDecoration(decoration);
              continue;
            }

            Object.assign(placement, decoration);
            existing.setPosition(decoration.x, decoration.y);
            existing.setSize(spriteConfig.width, spriteConfig.height);
            const sprite = existing.getData("sprite") as Phaser.GameObjects.Image | undefined;
            sprite?.setFlipX(isFacingLeft(decoration.rotation));
            this.applyPendingDecorStyle(decoration.id);
          }

          this.sortDepths();
          this.moveDecorBubble();
        }

        private updatePendingDecor(ids: string[]) {
          this.pendingDecorIds = new Set(ids);
          this.decorObjects.forEach((_container, id) => this.applyPendingDecorStyle(id));
        }

        private applyPendingDecorStyle(id: string) {
          const container = this.decorObjects.get(id);
          if (!container) return;
          const placement = container.getData("placement") as GardenDecorPlacement | undefined;
          if (!placement) return;
          const spriteConfig = worldObjectSprites[placement.kind];
          if (!spriteConfig) return;
          const outline = container.getData("pendingOutline") as Phaser.GameObjects.Graphics | undefined;
          const isPending = this.pendingDecorIds.has(id);
          container.setAlpha(isPending ? 0.7 : 1);
          outline?.clear();
          outline?.setVisible(isPending);
          if (!isPending || !outline) return;

          const spriteBounds = this.getDecorSpriteBounds(spriteConfig);
          const padding = 11;
          const width = spriteBounds.width + padding * 2;
          const height = spriteBounds.height + padding * 2;
          const left = spriteBounds.left - padding;
          const top = spriteBounds.top - padding;
          outline.lineStyle(3, 0x8e70bd, 0.9);
          outline.strokeRoundedRect(left, top, width, height, 22);
          outline.lineStyle(2, 0xffffff, 0.9);
          for (let x = left + 12; x < left + width - 10; x += 24) {
            outline.lineBetween(x, top, x + 12, top);
            outline.lineBetween(x, top + height, x + 12, top + height);
          }
          for (let y = top + 12; y < top + height - 10; y += 24) {
            outline.lineBetween(left, y, left, y + 12);
            outline.lineBetween(left + width, y, left + width, y + 12);
          }
        }

        private drawGardenDecoration(container: Phaser.GameObjects.Container, kind: GardenDecorKind) {
          const spriteConfig = worldObjectSprites[kind];
          if (!spriteConfig) return;
          container.add(this.add.ellipse(0, 42, spriteConfig.width * 0.62, 34, 0x3a2a2a, 0.13));
          const sprite = this.add
            .image(0, spriteConfig.yOffset, "world-object-sprites", spriteConfig.frame)
            .setDisplaySize(spriteConfig.width, spriteConfig.height)
            .setFlipX(isFacingLeft((container.getData("placement") as GardenDecorPlacement | undefined)?.rotation ?? 0));
          container.add(sprite);
          container.setData("sprite", sprite);
          this.addPassiveDecorMotion(container, sprite, kind);
        }

        private getDecorSpriteBounds(spriteConfig: { width: number; height: number; yOffset: number }) {
          return {
            bottom: spriteConfig.yOffset + spriteConfig.height / 2,
            height: spriteConfig.height,
            left: -spriteConfig.width / 2,
            right: spriteConfig.width / 2,
            top: spriteConfig.yOffset - spriteConfig.height / 2,
            width: spriteConfig.width,
          };
        }

        private addPassiveDecorMotion(
          container: Phaser.GameObjects.Container,
          sprite: Phaser.GameObjects.Image,
          kind: GardenDecorKind,
        ) {
          if (kind === "swing") {
            this.tweens.add({
              targets: sprite,
              rotation: 0.018,
              duration: 1500,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
            return;
          }

          if (kind === "fountain" || kind === "lanternArch" || kind === "arcadeKiosk" || kind === "bowlingKiosk") {
            const glowColor = kind === "fountain" ? 0xaed7e8 : kind === "lanternArch" ? 0xfaebc2 : 0xf6cfd2;
            const glow = this.add.circle(0, sprite.y + sprite.displayHeight * 0.06, sprite.displayWidth * 0.22, glowColor, 0.16);
            container.addAt(glow, 1);
            this.tweens.add({
              targets: glow,
              alpha: 0.34,
              scale: 1.2,
              duration: 980,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
            return;
          }

          if (kind === "memoryTree" || kind === "greenhouse" || kind === "flowerStand") {
            this.tweens.add({
              targets: sprite,
              y: sprite.y - 4,
              duration: 1850,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private activateDecoration(decoration: GardenDecorPlacement) {
          const container = this.decorObjects.get(decoration.id);
          container?.setScale(1.035);
          if (container) {
            this.tweens.add({
              targets: container,
              scale: 1,
              duration: 280,
              ease: "Back.out",
            });
          }

          setStatus(decorInteractionCopy[decoration.kind]);
          this.showLocalBubble(decoration.kind === "memoryTree" ? "Saved this visit." : "This feels alive.");

          switch (decoration.kind) {
            case "gazebo":
              playCozyCue("heart");
              this.spawnPetalSpiral(decoration.x, decoration.y - 78, 28);
              this.spawnSparkleBurst(decoration.x, decoration.y - 112, 0xfaebc2, 16);
              break;
            case "swing":
              playCozyCue("pet");
              this.petMood = "happy";
              this.petMoodTimer = 0;
              this.spawnHeartBurst(decoration.x, decoration.y - 52);
              this.spawnPetalSpiral(decoration.x, decoration.y - 78, 14);
              break;
            case "picnic":
              playCozyCue("heart");
              this.spawnHeartBurst(decoration.x, decoration.y - 34);
              recordActivity("pet-played");
              break;
            case "bbq":
              playCozyCue("place");
              this.spawnSmokePuffs(decoration.x, decoration.y - 34);
              this.spawnSparkleBurst(decoration.x, decoration.y - 42, 0xd9a53e, 10);
              break;
            case "fountain":
              playCozyCue("water");
              this.spawnWaterCrown(decoration.x, decoration.y - 18);
              this.spawnSparkleBurst(decoration.x, decoration.y - 60, 0x5e94b0, 12);
              break;
            case "lanternArch":
              playCozyCue("heart");
              setTimeOfDay("night");
              this.spawnSparkleBurst(decoration.x, decoration.y - 82, 0xfaebc2, 24);
              break;
            case "greenhouse":
              playCozyCue("water");
              recordActivity("garden-watered");
              this.spawnPetalSpiral(decoration.x, decoration.y - 72, 26);
              this.spawnSparkleBurst(decoration.x, decoration.y - 94, 0x6e9651, 18);
              break;
            case "memoryTree":
              playCozyCue("heart");
              this.spawnHeartBurst(decoration.x, decoration.y - 86);
              this.spawnSparkleBurst(decoration.x, decoration.y - 128, 0xc0a8dc, 26);
              break;
            case "flowerStand":
              playCozyCue("place");
              this.spawnPetalSpiral(decoration.x, decoration.y - 44, 30);
              break;
            case "fashionStage":
            case "arcadeKiosk":
            case "bowlingKiosk":
              this.spawnSparkleBurst(decoration.x, decoration.y - 84, 0xfaebc2, 16);
              break;
          }
        }

        private selectDecor(id: string) {
          this.decorObjects.forEach((container, containerId) => {
            const glow = container.getData("glow") as Phaser.GameObjects.Graphics | undefined;
            glow?.setVisible(containerId === id);
          });
          this.selectedDecor = this.decorObjects.get(id)?.getData("placement") as GardenDecorPlacement | undefined;
          if (this.selectedDecor) {
            playCozyCue("ui");
            setStatus(
              canEditGarden
                ? `${this.selectedDecor.label} selected. Drag to move, R flips left/right, Delete removes it.`
                : `${this.selectedDecor.label} selected. Ask the host for decorator permission to move it.`,
            );
            this.showDecorBubble(this.selectedDecor);
          }
        }

        private showDecorBubble(decoration: GardenDecorPlacement) {
          this.decorBubble?.destroy(true);
          // The popup is for ANY clicked decor — hosts get Flip/Remove,
          // guests get the kind-specific interaction (sit on swing,
          // water plant, etc.). The old early-return on !canEditGarden
          // hid the popup from guests entirely, which made the world
          // feel "view-only" even for things every keeper should be
          // allowed to do.
          const container = this.decorObjects.get(decoration.id);
          if (!container) return;
          const spriteConfig = worldObjectSprites[decoration.kind];

          // Kind-specific guest-allowed interaction. Returns a label +
          // handler, or null if this kind has no shared action.
          const interaction = this.getDecorInteraction(decoration);
          const buttonCount =
            (interaction ? 1 : 0) + (canEditGarden ? 2 : 0);
          const bubbleWidth = buttonCount >= 3 ? 320 : 252;
          const bubblePosition = this.getDecorBubblePosition(decoration, spriteConfig, bubbleWidth);
          const bubble = this.add
            .container(bubblePosition.x, bubblePosition.y)
            .setDepth(10000);
          bubble.setData("bubbleWidth", bubbleWidth);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-bubbleWidth / 2, -36, bubbleWidth, 72, 16);
          bg.lineStyle(2, 0xc0a8dc, 0.9);
          bg.strokeRoundedRect(-bubbleWidth / 2, -36, bubbleWidth, 72, 16);

          const label = this.add
            .text(0, -20, decoration.label, {
              color: "#3A2A2A",
              fontFamily: "Nunito, sans-serif",
              fontSize: "12px",
              fontStyle: "900",
            })
            .setOrigin(0.5);

          const children: Phaser.GameObjects.GameObject[] = [bg, label];

          // Layout: distribute up to 3 buttons across the bubble width.
          // We compute x-offsets in a single pass so any combination
          // (guest-only interaction, decorator-only flip+remove, or all
          // three) reads as one centered row.
          const slots: Array<{ label: string; bg: string; fg: string; handler: () => void }> = [];
          if (interaction) {
            slots.push({
              label: interaction.label,
              bg: "#E4F1DD",
              fg: "#447A3A",
              handler: () => interaction.run(),
            });
          }
          if (canEditGarden) {
            slots.push({
              label: "Flip",
              bg: "#EFE6F7",
              fg: "#8E70BD",
              handler: () => this.toggleSelectedDecorFacing(),
            });
            slots.push({
              label: "Remove",
              bg: "#FBE0DA",
              fg: "#9A453E",
              handler: () => this.removeSelectedDecor(),
            });
          }

          if (slots.length === 0) {
            // Pure "info-only" bubble (no allowed actions for this
            // keeper × kind combo). The flavor text below the label
            // serves as the action.
            const hint = this.add
              .text(0, 14, decorInteractionCopy[decoration.kind] ?? "Nothing to do here right now.", {
                color: "#7c5a5a",
                fontFamily: "Nunito, sans-serif",
                fontSize: "10px",
                fontStyle: "700",
                wordWrap: { width: bubbleWidth - 28 },
                align: "center",
              })
              .setOrigin(0.5);
            children.push(hint);
          } else {
            const step = bubbleWidth / (slots.length + 1);
            slots.forEach((slot, index) => {
              const x = -bubbleWidth / 2 + step * (index + 1);
              const btn = this.add
                .text(x, 13, slot.label, {
                  color: slot.fg,
                  fontFamily: "Nunito, sans-serif",
                  fontSize: "11px",
                  fontStyle: "900",
                  backgroundColor: slot.bg,
                  padding: { x: 8, y: 4 },
                })
                .setOrigin(0.5)
                .setInteractive({ useHandCursor: true });
              btn.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
                pointer.event.stopPropagation();
                slot.handler();
              });
              children.push(btn);
            });
          }

          bubble.add(children);
          this.decorBubble = bubble;
        }

        private getDecorBubblePosition(
          decoration: GardenDecorPlacement,
          spriteConfig: { width: number; height: number; yOffset: number },
          bubbleWidth: number,
        ) {
          const container = this.decorObjects.get(decoration.id);
          const camera = this.cameras.main;
          const spriteBounds = this.getDecorSpriteBounds(spriteConfig);
          const itemY = container?.y ?? decoration.y;
          const desiredAboveY = itemY + spriteBounds.top - 60;
          const fallbackBelowY = itemY + spriteBounds.bottom + 60;
          const minX = camera.scrollX + bubbleWidth / 2 + 12;
          const maxX = camera.scrollX + camera.width - bubbleWidth / 2 - 12;
          const minY = camera.scrollY + 46;
          const maxY = camera.scrollY + camera.height - 46;
          const desiredY = desiredAboveY < minY ? fallbackBelowY : desiredAboveY;

          return {
            x: PhaserModule.Math.Clamp(container?.x ?? decoration.x, minX, maxX),
            y: PhaserModule.Math.Clamp(desiredY, minY, maxY),
          };
        }

        /**
         * Kind-specific guest-allowed interaction for a decor piece. Returns
         * a label + handler when the keeper should be able to do something
         * here regardless of decorator permissions (sit on a swing, water a
         * plant, etc.). Decorator-only verbs (Flip / Remove) are added by
         * `showDecorBubble` separately.
         */
        private getDecorInteraction(decoration: GardenDecorPlacement):
          | { label: string; run: () => void }
          | null {
          const container = this.decorObjects.get(decoration.id);
          if (!container) return null;

          // Every decor kind should have a guest-allowed action — without
          // one the popup shows nothing useful for visitors, which makes
          // the world feel "view only" even though it isn't. The action
          // verbs map intuitively to what the object looks like:
          //   - sittable benches/seats     → "Sit"
          //   - watering targets           → "Water"
          //   - water decor (fountain)     → "Make a wish"
          //   - grills + cooktops          → "Grill"
          //   - structures + arches        → "Step inside" / "Light up"
          // The shared `sitOnSwing` / `waterDecor` / `interactAt`
          // animations are reused so we don't need bespoke sprites per
          // kind. Kiosks with an `href` are intentionally NOT included
          // here — those route to a mini-game via a separate flow.
          switch (decoration.kind) {
            case "swing":
              return { label: "Sit on swing", run: () => this.sitOnSwing(decoration) };
            case "picnic":
              return { label: "Sit", run: () => this.sitOnSwing(decoration) };
            case "gazebo":
              return { label: "Rest here", run: () => this.sitOnSwing(decoration) };
            case "memoryTree":
            case "flowerStand":
              return { label: "Water", run: () => this.waterDecor(decoration) };
            case "greenhouse":
              return { label: "Tend plants", run: () => this.waterDecor(decoration) };
            case "fountain":
              return { label: "Make a wish", run: () => this.waterDecor(decoration) };
            case "bbq":
              return { label: "Grill", run: () => this.cookAtDecor(decoration) };
            case "lanternArch":
              return { label: "Light up", run: () => this.lightDecor(decoration) };
            default:
              return null;
          }
        }

        /**
         * Walk the keeper to the decor + play the sit pose for a few
         * seconds. Re-uses the keeper's existing "sit" pose so we don't
         * need new sprite frames for every keeper × swing combo.
         */
        private sitOnSwing(decoration: GardenDecorPlacement) {
          const container = this.decorObjects.get(decoration.id);
          if (!container || !this.avatar) return;
          playCozyCue("petChirp");
          const target = this.constrainAvatarToWalkable(container.x, container.y + 18);
          this.tweens.killTweensOf(this.avatar);
          this.tweens.add({
            targets: this.avatar,
            x: target.x,
            y: target.y,
            duration: 360,
            ease: "Sine.inOut",
            onComplete: () => {
              this.setAvatarPose("sit");
              // Add a slight oscillation to suggest swinging.
              this.tweens.killTweensOf(this.avatar);
              this.tweens.add({
                targets: this.avatar,
                x: target.x + 10,
                duration: 720,
                ease: "Sine.inOut",
                yoyo: true,
                repeat: 4,
                onComplete: () => {
                  this.setAvatarPose("idle");
                },
              });
            },
          });
          setStatus(`${decoration.label}: settling in for a swing.`);
        }

        /**
         * Play the water cue + sparkle burst at the decor's position. No
         * server write — the plant doesn't have growth state yet, so this
         * is a cosmetic "I cared for the world" gesture that's always
         * available to guests.
         */
        private waterDecor(decoration: GardenDecorPlacement) {
          const container = this.decorObjects.get(decoration.id);
          if (!container) return;
          playCozyCue("water");
          this.spawnSparkleBurst(container.x, container.y - 24, 0x5e94b0, 14);
          if (this.pet) this.spawnSparkleBurst(this.pet.x, this.pet.y - 56, 0xc0a8dc, 8);
          recordActivity("garden-watered");
          setStatus(`${decoration.label}: a fresh drink. ${decorInteractionCopy[decoration.kind] ?? ""}`);
        }

        /**
         * Cook-at-grill animation reused by the BBQ. Walks the keeper next
         * to the decor, plays a warm sparkle burst, and emits a status
         * line. We don't need a unique sprite — the sparkle + keeper-
         * stands-near-decor reads as "cooking" in the same way that
         * `waterDecor` reads as "watering".
         */
        private cookAtDecor(decoration: GardenDecorPlacement) {
          const container = this.decorObjects.get(decoration.id);
          if (!container || !this.avatar) return;
          const target = this.constrainAvatarToWalkable(container.x - 32, container.y + 8);
          playCozyCue("petChirp");
          this.tweens.killTweensOf(this.avatar);
          this.tweens.add({
            targets: this.avatar,
            x: target.x,
            y: target.y,
            duration: 320,
            ease: "Sine.inOut",
            onComplete: () => {
              this.spawnSparkleBurst(container.x, container.y - 28, 0xffb86a, 18);
              if (this.pet) this.spawnSparkleBurst(this.pet.x, this.pet.y - 56, 0xffd592, 6);
            },
          });
          setStatus(`${decoration.label}: a warm grill, a little smoke, a snack for the party.`);
        }

        /**
         * Lantern-arch + similar "light it up" interaction. Burst of warm
         * sparkles + status line. Reused for any glowy decor where the
         * verb is "light".
         */
        private lightDecor(decoration: GardenDecorPlacement) {
          const container = this.decorObjects.get(decoration.id);
          if (!container) return;
          playCozyCue("score");
          this.spawnSparkleBurst(container.x, container.y - 30, 0xf4d27a, 22);
          this.spawnSparkleBurst(container.x - 24, container.y - 24, 0xf6cfd2, 8);
          this.spawnSparkleBurst(container.x + 24, container.y - 24, 0xc0a8dc, 8);
          setStatus(`${decoration.label}: lanterns wake up and the path softens.`);
        }

        private clearSelectedDecor() {
          if (!this.selectedDecor) return;
          const selectedId = this.selectedDecor.id;
          this.decorObjects.forEach((container, containerId) => {
            const glow = container.getData("glow") as Phaser.GameObjects.Graphics | undefined;
            if (containerId === selectedId) glow?.setVisible(false);
          });
          this.selectedDecor = undefined;
          this.decorBubble?.destroy(true);
          this.decorBubble = undefined;
        }

        private moveDecorBubble() {
          if (!this.decorBubble || !this.selectedDecor) return;
          const container = this.decorObjects.get(this.selectedDecor.id);
          if (!container) return;
          const spriteConfig = worldObjectSprites[this.selectedDecor.kind];
          const bubbleWidth = (this.decorBubble.getData("bubbleWidth") as number | undefined) ?? 252;
          const bubblePosition = this.getDecorBubblePosition(this.selectedDecor, spriteConfig, bubbleWidth);
          this.decorBubble.setPosition(bubblePosition.x, bubblePosition.y);
        }

        private toggleSelectedDecorFacing() {
          if (!this.selectedDecor) return;
          this.setSelectedDecorFacing(isFacingLeft(this.selectedDecor.rotation) ? "right" : "left");
        }

        private setSelectedDecorFacing(facing: FacingDirection) {
          if (!canEditGarden) {
            setStatus("Only the host or trusted decorators can change garden item facing in this visit.");
            return;
          }
          if (!this.selectedDecor) return;
          const container = this.decorObjects.get(this.selectedDecor.id);
          if (!container) return;
          this.selectedDecor.rotation = facingRotation(facing);
          container.setRotation(0);
          const sprite = container.getData("sprite") as Phaser.GameObjects.Image | undefined;
          sprite?.setFlipX(facing === "left");
          this.persistDecorations();
          playCozyCue("rotate");
          setStatus(`${this.selectedDecor.label} now faces ${facing}.`);
        }

        private removeSelectedDecor() {
          if (!canEditGarden) {
            setStatus("Only the host or trusted decorators can remove garden items in this visit.");
            return;
          }
          if (!this.selectedDecor) {
            setStatus("Select a garden item first, then press Delete or use Remove.");
            return;
          }
          const decoration = this.selectedDecor;
          const container = this.decorObjects.get(decoration.id);
          container?.destroy(true);
          this.decorObjects.delete(decoration.id);
          this.selectedDecor = undefined;
          this.decorBubble?.destroy(true);
          this.decorBubble = undefined;
          this.persistDecorations();
          playCozyCue("place");
          setStatus(`${decoration.label} removed from the garden. You can place it again from the drawer.`);
        }

        private persistDecorations() {
          const decorations = Array.from(this.decorObjects.values()).map((container) => {
            const placement = container.getData("placement") as GardenDecorPlacement;
            return {
              ...placement,
              x: Math.round(container.x),
              y: Math.round(container.y),
              rotation: placement.rotation,
            };
          });
          onDecorChangeRef.current?.(decorations);
        }

        private drawSeasonalGardenDecor() {
          if (!activeEvent) return;

          const primary = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.primary).color;
          const secondary = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.secondary).color;
          const accent = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.accent).color;
          this.add.rectangle(GARDEN_WORLD_WIDTH / 2, GARDEN_WORLD_HEIGHT / 2, GARDEN_WORLD_WIDTH, GARDEN_WORLD_HEIGHT, primary, 0.035).setDepth(-17);

          if (activeEvent.id === "halloween") {
            this.drawGardenPumpkins(primary, secondary);
            this.drawMoonMotes(primary, 18);
            return;
          }

          if (activeEvent.id === "christmas") {
            this.drawSnowGarden(accent);
            this.drawWishLights(primary, secondary);
            return;
          }

          if (activeEvent.id === "new-year") {
            this.drawSkyLanterns(primary, secondary);
            this.drawMoonMotes(secondary, 24);
            return;
          }

          this.drawSparklerFountains(primary, secondary, accent);
          this.drawMoonMotes(secondary, 20);
        }

        private drawGardenPumpkins(primary: number, secondary: number) {
          [
            [166, 468],
            [808, 456],
            [318, 274],
            [644, 274],
          ].forEach(([x, y], index) => {
            const pumpkin = this.add.container(x, y).setDepth(y);
            pumpkin.add(this.add.ellipse(0, 28, 76, 22, 0x3a2a2a, 0.12));
            pumpkin.add(this.add.ellipse(-16, 0, 34, 40, secondary, 0.88));
            pumpkin.add(this.add.ellipse(0, 0, 42, 48, secondary, 0.96));
            pumpkin.add(this.add.ellipse(16, 0, 34, 40, secondary, 0.88));
            pumpkin.add(this.add.rectangle(0, -25, 8, 18, 0x6e9651, 0.9).setRotation(0.25));
            const glow = this.add.circle(0, 2, 28, primary, 0.12);
            pumpkin.addAt(glow, 1);
            this.tweens.add({ targets: glow, alpha: 0.3, scale: 1.15, duration: 820 + index * 70, yoyo: true, repeat: -1 });
          });
        }

        private drawSnowGarden(gold: number) {
          for (let index = 0; index < 42; index += 1) {
            const snow = this.add.circle(
              PhaserModule.Math.Between(80, GARDEN_WORLD_WIDTH - 80),
              PhaserModule.Math.Between(88, 520),
              PhaserModule.Math.Between(2, 4),
              0xffffff,
              0.6,
            ).setDepth(6100);
            this.tweens.add({
              targets: snow,
              y: snow.y + PhaserModule.Math.Between(42, 98),
              x: snow.x + PhaserModule.Math.Between(-18, 18),
              alpha: 0.12,
              duration: PhaserModule.Math.Between(2600, 5200),
              yoyo: true,
              repeat: -1,
            });
          }

          const star = this.add.star(480, 164, 6, 5, 20, gold, 0.72).setDepth(6200);
          this.tweens.add({ targets: star, alpha: 0.24, scale: 1.18, duration: 900, yoyo: true, repeat: -1 });
        }

        private drawWishLights(primary: number, secondary: number) {
          for (let index = 0; index < 18; index += 1) {
            const x = 216 + index * 30;
            const y = 226 + Math.sin(index * 0.7) * 18;
            const light = this.add.circle(x, y, 5, index % 2 === 0 ? primary : secondary, 0.72).setDepth(6080);
            this.tweens.add({ targets: light, alpha: 0.22, duration: 700 + index * 55, yoyo: true, repeat: -1 });
          }
        }

        private drawSkyLanterns(primary: number, secondary: number) {
          for (let index = 0; index < 10; index += 1) {
            const lantern = this.add.container(150 + index * 140, PhaserModule.Math.Between(110, 248)).setDepth(6060);
            lantern.add(this.add.circle(0, 0, 22, secondary, 0.16));
            lantern.add(this.add.rectangle(0, 0, 24, 34, 0xfffcf3, 0.82).setStrokeStyle(3, primary, 0.42));
            this.tweens.add({
              targets: lantern,
              y: lantern.y - PhaserModule.Math.Between(28, 72),
              alpha: 0.54,
              duration: PhaserModule.Math.Between(2600, 4600),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private drawSparklerFountains(primary: number, secondary: number, accent: number) {
          [
            [190, 430],
            [770, 430],
          ].forEach(([x, y]) => {
            const fountain = this.add.container(x, y).setDepth(y);
            fountain.add(this.add.ellipse(0, 30, 104, 28, 0x3a2a2a, 0.13));
            fountain.add(this.add.ellipse(0, 10, 88, 42, 0xc7e0eb, 0.58).setStrokeStyle(3, primary, 0.48));
            for (let index = 0; index < 8; index += 1) {
              const spark = this.add.star(x, y, 5, 2, 12, index % 2 === 0 ? secondary : accent, 0.68).setDepth(6180);
              this.tweens.add({
                targets: spark,
                x: x + PhaserModule.Math.Between(-50, 50),
                y: y - PhaserModule.Math.Between(50, 122),
                alpha: 0,
                duration: 850 + index * 70,
                repeat: -1,
                delay: index * 110,
              });
            }
          });
        }

        private drawMoonMotes(color: number, count: number) {
          for (let index = 0; index < count; index += 1) {
            const mote = this.add.star(
              PhaserModule.Math.Between(92, GARDEN_WORLD_WIDTH - 92),
              PhaserModule.Math.Between(122, 492),
              5,
              2,
              PhaserModule.Math.Between(8, 18),
              color,
              0.32,
            ).setDepth(6120);
            this.tweens.add({
              targets: mote,
              y: mote.y + PhaserModule.Math.Between(-22, 22),
              alpha: 0.1,
              duration: PhaserModule.Math.Between(1200, 2600),
              yoyo: true,
              repeat: -1,
            });
          }
        }

        private addTitle() {
          this.add
            .text(34, 28, variant === "partner" ? "Shared Heart Garden" : variant === "park" ? "Honeyheart Park" : "Casper's Moonberry Beds", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "23px",
            })
            .setScrollFactor(0)
            .setDepth(7000);
          this.add
            .text(
              34,
              58,
              activeEvent
                ? activeEvent.gardenMessage
                : variant === "partner"
                  ? "Click memories, quests, flowers, and Casper."
                  : variant === "park"
                    ? "Follow roads, visit the gazebo, swings, picnic lawn, and game kiosks."
                    : "Click plots to water them.",
              {
                color: "#84675F",
                fontFamily: "Nunito, sans-serif",
                fontSize: "13px",
                fontStyle: "800",
              },
            )
            .setScrollFactor(0)
            .setDepth(7000);
        }
      }

      game = new PhaserModule.Game({
        type: PhaserModule.AUTO,
        parent: mountRef.current,
        width: GARDEN_WIDTH,
        height: GARDEN_HEIGHT,
        backgroundColor: "#fbf3e2",
        scale: {
          mode: PhaserModule.Scale.FIT,
          autoCenter: PhaserModule.Scale.CENTER_BOTH,
        },
        scene: HeartHavenGardenScene,
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load garden");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [activeEvent, canEditGarden, onAvatarMove, plots, timeOfDayRef, variant]);

  function dispatchAddDecor(kind: GardenDecorKind, point?: { clientX: number; clientY: number }) {
    window.dispatchEvent(new CustomEvent("hearthaven:garden-add-decor", { detail: { kind, ...point } }));
  }

  function handleDecorDragStart(event: DragEvent<HTMLButtonElement>, kind: GardenDecorKind) {
    if (!canEditGarden) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/hearthaven-garden-decor", kind);
    event.dataTransfer.setData("text/plain", kind);
    setStatus("Dragging garden decor. Drop it onto the visible map.");
  }

  function handleGardenDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!canEditGarden) {
      setStatus("Only the host or trusted decorators can place garden items in this visit.");
      return;
    }
    const kind = event.dataTransfer.getData("application/hearthaven-garden-decor") || event.dataTransfer.getData("text/plain");
    if (!gardenDecorItems.some((item) => item.kind === kind)) return;
    dispatchAddDecor(kind as GardenDecorKind, { clientX: event.clientX, clientY: event.clientY });
  }

  return (
    <section className="overflow-hidden rounded-lg border border-garden-300/50 bg-garden-100 shadow-[0_24px_70px_rgba(76,110,54,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-garden-300/40 bg-white/68 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-garden-700">
            {variant === "partner" ? "Shared living garden" : variant === "park" ? "Walkable park" : "Living garden"}
          </p>
          <p className="text-sm font-black text-ink-900">
            {activeEvent
                ? `${activeEvent.shortName} garden decor active`
                : variant === "partner"
                  ? "Memory tree, quests, lantern path, and Casper's watch"
                  : variant === "park"
                    ? "Roads, gazebo, swings, picnic lawn, fashion stage, and game kiosks"
                : "Animated plots, water, butterflies, and growth"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          {(["morning", "noon", "night"] as const).map((time) => {
            const option = gardenTimeOfDayCopy[time];
            const selected = timeOfDay === time;
            return (
              <button
                aria-pressed={selected}
                className={`rounded-2xl border px-3 py-2 text-left transition-all duration-200 hover:-translate-y-0.5 active:translate-y-px ${
                  selected
                    ? option.selectedClass
                    : "border-cream-300/80 bg-white/72 text-ink-700 shadow-[0_8px_18px_-16px_rgba(91,63,63,0.55)] hover:border-blush-300/70 hover:bg-blush-50/80"
                }`}
                key={time}
                onClick={() => setTimeOfDay(time)}
                type="button"
              >
                <span className="block text-[11px] font-black uppercase leading-none tracking-normal">{option.label}</span>
                <span className="mt-1 block text-[10px] font-extrabold leading-none opacity-75">{option.hint}</span>
              </button>
            );
          })}
          <span className="rounded-md bg-garden-100 px-2.5 py-1">Click flowers</span>
          <span className="rounded-md bg-sky-100 px-2.5 py-1">Water effects</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Lantern glow</span>
          {variant === "park" ? <span className="rounded-md bg-blush-100 px-2.5 py-1">Game kiosks</span> : null}
        </div>
      </div>
      <div
        ref={mountRef}
        onDragOver={(event) => {
          if (!canEditGarden) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={handleGardenDrop}
        aria-label={
          variant === "partner"
            ? "Scrollable interactive shared garden canvas with avatar movement, chat bubbles, memory tree, quests, Casper statue, and flowers"
            : variant === "park"
              ? "Scrollable interactive park canvas with avatar movement, chat bubbles, roads, picnic areas, a fashion stage, and clickable game kiosks"
              : "Scrollable interactive garden canvas with avatar movement, animated plots, water effects, lanterns, and butterflies"
        }
        className="mx-auto block w-full min-w-0 max-w-full overflow-hidden bg-garden-100"
        role="application"
        style={{
          // Take 100% of the column we're in, capped at the native 960px so
          // we never balloon past the painted assets' resolution. `min-w-0`
          // up the chain protects against the canvas pushing the page wider
          // than the viewport.
          maxWidth: 960,
          aspectRatio: "960 / 620",
        }}
        tabIndex={0}
      />
      <div className="border-t border-garden-300/40 bg-white/78 px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-extrabold uppercase tracking-normal text-garden-700">Garden decor drawer</span>
          <span className="text-xs font-bold text-ink-600">
            {canEditGarden
              ? "Drag icons onto the map, move them in-world, R flips, Delete removes selected decor."
              : "Decorator permissions are off for this visit."}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {gardenDecorItems.map((item) => (
            <button
              className={`grid min-w-[170px] grid-cols-[68px_1fr] gap-2 rounded-2xl border border-cream-300 p-2 text-left shadow-sm transition ${
                canEditGarden
                  ? "bg-cream-50 hover:-translate-y-0.5 hover:border-garden-300 hover:bg-garden-100"
                  : "cursor-not-allowed bg-stone-100/80 opacity-60"
              }`}
              draggable={canEditGarden}
              disabled={!canEditGarden}
              key={item.kind}
              onClick={() => dispatchAddDecor(item.kind)}
              onDragStart={(event) => handleDecorDragStart(event, item.kind)}
              type="button"
            >
              <span className="grid size-16 place-items-center overflow-hidden rounded-xl border border-white/80 bg-white/78 shadow-inner">
                <Image
                  alt={`${item.label} icon`}
                  className="h-full w-full object-contain p-1 drop-shadow-[0_10px_14px_rgba(76,110,54,0.2)]"
                  height={96}
                  src={getGardenDecorArt(item.kind)}
                  width={96}
                />
              </span>
              <span className="min-w-0 self-center">
                <span className="block text-sm font-black leading-tight text-ink-900">{item.label}</span>
                <span className="mt-0.5 block text-xs font-bold leading-4 text-ink-600">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-garden-300/40 bg-white/72 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}

function getGardenStorageKey(variant: GardenCanvasProps["variant"]) {
  return `${GARDEN_STORAGE_PREFIX}${variant}`;
}

export function readGardenDecor(variant: GardenCanvasProps["variant"]): GardenDecorPlacement[] {
  if (typeof window === "undefined") return defaultGardenDecor(variant);

  try {
    const raw = window.localStorage.getItem(getGardenStorageKey(variant));
    if (!raw) return defaultGardenDecor(variant);
    const parsed = JSON.parse(raw) as GardenDecorPlacement[];
    return Array.isArray(parsed) ? parsed.map(hydrateGardenDecorPlacement) : defaultGardenDecor(variant);
  } catch {
    return defaultGardenDecor(variant);
  }
}

export function getDefaultGardenDecor(variant: GardenCanvasProps["variant"]): GardenDecorPlacement[] {
  return defaultGardenDecor(variant);
}

function hydrateGardenDecorPlacement(decoration: GardenDecorPlacement): GardenDecorPlacement {
  const catalogEntry = gardenDecorItems.find((item) => item.kind === decoration.kind);
  return {
    ...decoration,
    href: decoration.href ?? catalogEntry?.href,
  };
}

function projectPointToSegment(x: number, y: number, segment: WalkSegment) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - segment.x1) * dx + (y - segment.y1) * dy) / lengthSquared));
  return {
    x: segment.x1 + dx * t,
    y: segment.y1 + dy * t,
  };
}

export function writeGardenDecor(variant: GardenCanvasProps["variant"], decorations: GardenDecorPlacement[]) {
  window.localStorage.setItem(getGardenStorageKey(variant), JSON.stringify(decorations));
}

function defaultGardenDecor(variant: GardenCanvasProps["variant"]): GardenDecorPlacement[] {
  const sharedOffset = variant === "partner" ? 60 : 0;
  const placement = (x: number, y: number) => ({ x: worldX(x), y: worldY(y) });
  if (variant === "park") {
    return [
      { id: "decor-gazebo", kind: "gazebo", label: "Gazebo", ...placement(540, 404), rotation: 0 },
      { id: "decor-swing", kind: "swing", label: "Swing set", ...placement(860, 548), rotation: 0 },
      { id: "decor-picnic", kind: "picnic", label: "Picnic table", ...placement(1160, 612), rotation: 0 },
      { id: "decor-fountain", kind: "fountain", label: "Berry fountain", ...placement(1560, 510), rotation: 0 },
      { id: "decor-fashion", kind: "fashionStage", label: "Fashion stage", href: "/app/fashion-show", ...placement(2260, 510), rotation: 0 },
      { id: "decor-arcade", kind: "arcadeKiosk", label: "Arcade kiosk", href: "/app/petal-catch", ...placement(2580, 618), rotation: 0 },
      { id: "decor-bowling", kind: "bowlingKiosk", label: "Bowling kiosk", href: "/app/bowling", ...placement(2860, 590), rotation: 0 },
      { id: "decor-flower-stand", kind: "flowerStand", label: "Flower stand", ...placement(3140, 470), rotation: 0 },
    ];
  }

  if (variant === "partner") {
    return [
      { id: "decor-memory-tree", kind: "memoryTree", label: "Memory tree", ...placement(560, 414), rotation: 0 },
      { id: "decor-lantern-arch", kind: "lanternArch", label: "Lantern arch", ...placement(900, 470), rotation: 0 },
      { id: "decor-fountain", kind: "fountain", label: "Berry fountain", ...placement(1210, 500), rotation: 0 },
      { id: "decor-picnic", kind: "picnic", label: "Picnic table", ...placement(1480, 570), rotation: 0 },
    ];
  }

  return [
    { id: "decor-greenhouse", kind: "greenhouse", label: "Greenhouse", ...placement(860 + sharedOffset, 452), rotation: 0 },
    { id: "decor-bbq", kind: "bbq", label: "BBQ", ...placement(1180 + sharedOffset, 552), rotation: 0 },
    { id: "decor-swing", kind: "swing", label: "Swing set", ...placement(1450, 500), rotation: 0 },
    { id: "decor-picnic", kind: "picnic", label: "Picnic table", ...placement(1280, 640), rotation: 0 },
  ];
}
