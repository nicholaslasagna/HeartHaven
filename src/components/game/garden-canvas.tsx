"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import {
  getPetAccessory,
  getPetTone,
  gaitPhase,
  keeperGaitPose,
  keeperFrame,
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
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperPose,
  type PetCustomization,
  type PetAccessoryId,
  type PetPose,
  type PetSpeciesId,
  type PetToneId,
} from "@/lib/game/avatar-customization";
import { recordActivity } from "@/lib/game/activity";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { PET_VITALS_EVENT, getPetMood, getPetVitals, type PetMood } from "@/lib/game/pet-state";
import type { GardenChatMessage } from "@/lib/game/chat-moderation";
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
  canEditGarden?: boolean;
  onAvatarMove?: (position: { x: number; y: number; facing: FacingDirection }) => void;
};

type GardenDecorKind =
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

type GardenDecorPlacement = {
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
  label: Phaser.GameObjects.Text;
  /** Each visiting keeper brings their own customized pet. */
  petContainer: Phaser.GameObjects.Container;
  petShadow: Phaser.GameObjects.Ellipse;
  petSprite: Phaser.GameObjects.Sprite;
  petAccessorySprite: Phaser.GameObjects.Sprite;
  /** Cached customization so frames only rebuild when it actually changes. */
  bodyId: KeeperBodyId;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  petSpeciesId: PetSpeciesId;
  petToneId: PetToneId;
  petAccessoryId: PetAccessoryId;
  facing: FacingDirection;
  movingUntil: number;
};

type GardenPetMood = "idle" | "follow" | "sit" | "happy";
type GardenTimeOfDay = "morning" | "noon" | "night";

const GARDEN_WIDTH = 960;
const GARDEN_HEIGHT = 620;
const GARDEN_WORLD_WIDTH = 3400;
const GARDEN_WORLD_HEIGHT = 1133;
const GARDEN_STORAGE_PREFIX = "hearthaven:garden-decor:v2:";

type WalkSegment = { x1: number; y1: number; x2: number; y2: number; radius: number };
type WalkCircle = { x: number; y: number; radius: number };

const sharedWalkSegments: WalkSegment[] = [
  { x1: 132, y1: 690, x2: 500, y2: 570, radius: 112 },
  { x1: 500, y1: 570, x2: 900, y2: 462, radius: 118 },
  { x1: 900, y1: 462, x2: 1280, y2: 555, radius: 118 },
  { x1: 1280, y1: 555, x2: 1720, y2: 610, radius: 124 },
  { x1: 1720, y1: 610, x2: 2140, y2: 520, radius: 126 },
  { x1: 2140, y1: 520, x2: 2600, y2: 590, radius: 126 },
  { x1: 2600, y1: 590, x2: 3260, y2: 650, radius: 132 },
];

const parkWalkSegments: WalkSegment[] = [
  { x1: 118, y1: 620, x2: 520, y2: 488, radius: 126 },
  { x1: 520, y1: 488, x2: 870, y2: 420, radius: 132 },
  { x1: 870, y1: 420, x2: 1260, y2: 440, radius: 126 },
  { x1: 1260, y1: 440, x2: 1660, y2: 520, radius: 128 },
  { x1: 1660, y1: 520, x2: 2140, y2: 430, radius: 132 },
  { x1: 2140, y1: 430, x2: 2600, y2: 594, radius: 140 },
  { x1: 2600, y1: 594, x2: 3260, y2: 520, radius: 140 },
  { x1: 860, y1: 720, x2: 2350, y2: 722, radius: 116 },
];

const sharedWalkCircles: WalkCircle[] = [
  { x: 500, y: 570, radius: 190 },
  { x: 900, y: 462, radius: 170 },
  { x: 1280, y: 555, radius: 176 },
  { x: 2140, y: 520, radius: 184 },
  { x: 2860, y: 610, radius: 190 },
];

const parkWalkCircles: WalkCircle[] = [
  { x: 540, y: 404, radius: 210 },
  { x: 860, y: 548, radius: 184 },
  { x: 1160, y: 612, radius: 176 },
  { x: 1560, y: 510, radius: 194 },
  { x: 2260, y: 510, radius: 210 },
  { x: 2580, y: 618, radius: 190 },
  { x: 2860, y: 590, radius: 190 },
  { x: 3140, y: 470, radius: 186 },
];

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

export function GardenCanvas({ canEditGarden = true, onAvatarMove, remotePlayers = [], variant, plots }: GardenCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const remotePlayersRef = useRef(remotePlayers);
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
    timeOfDayRef.current = timeOfDay;
    window.dispatchEvent(new CustomEvent("hearthaven:garden-time", { detail: { timeOfDay } }));
  }, [timeOfDay]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      const initialDecor = readGardenDecor(variant);
      if (!mountRef.current || destroyed) return;

      class HeartHavenGardenScene extends PhaserModule.Scene {
        private butterflies: Phaser.GameObjects.Sprite[] = [];
        private fireflies: Phaser.GameObjects.Sprite[] = [];
        private avatar!: Phaser.GameObjects.Container;
        private avatarShadow!: Phaser.GameObjects.Ellipse;
        private avatarSprite!: Phaser.GameObjects.Sprite;
        private avatarPose: KeeperPose = "idle";
        private avatarFacing: FacingDirection = "right";
        private keeperCustomization: KeeperCustomization = readKeeperCustomization();
        private pet!: Phaser.GameObjects.Container;
        private petShadow!: Phaser.GameObjects.Ellipse;
        private petSprite!: Phaser.GameObjects.Sprite;
        private petAccessorySprite!: Phaser.GameObjects.Sprite;
        private petCustomization: PetCustomization = readPetCustomization();
        private petMood: GardenPetMood = "idle";
        private petMoodTimer = 0;
        private petFacing: FacingDirection = "right";
        private companionMood: PetMood = getPetMood(getPetVitals());
        private companionMoodHandler?: (event: Event) => void;
        private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
        private wasd?: Record<"up" | "left" | "down" | "right" | "rotate", Phaser.Input.Keyboard.Key>;
        private target?: Phaser.Math.Vector2;
        private moveBroadcastTimer = 0;
        private footstepTimer = 0;
        private lastSentPosition = { x: 420, y: 430 };
        private selectedDecor?: GardenDecorPlacement;
        private decorObjects = new Map<string, Phaser.GameObjects.Container>();
        private remoteAvatars = new Map<string, RemoteGardenAvatarObject>();
        private remotePlayersHandler?: (event: Event) => void;
        private chatBubbleHandler?: (event: Event) => void;
        private addDecorHandler?: (event: Event) => void;
        private keeperCustomizationHandler?: (event: Event) => void;
        private petCustomizationHandler?: (event: Event) => void;
        private timeOfDayHandler?: (event: Event) => void;
        private timeOverlay?: Phaser.GameObjects.Rectangle;
        private decorDragging = false;

        constructor() {
          super("HeartHavenGarden");
        }

        preload() {
          this.load.image("garden-bare-map", "/game-assets/generated/heartheaven-garden-bare-map.png");
          this.load.image("park-bare-map", "/game-assets/generated/heartheaven-park-bare-map.png");
          this.load.image("casper-sprite", "/game-assets/generated/casper-sprite.png");
          this.load.spritesheet("keeper-animation-sheet", "/game-assets/generated/keeper-custom-sheet.png", {
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
          this.createDecorations(initialDecor);
          this.createAvatar();
          this.createPet();
          this.createInput();
          this.createRealtimeBridge();
          this.syncRemotePlayers(remotePlayersRef.current);
          this.cameras.main.startFollow(this.avatar, true, 0.08, 0.08);
          this.cameras.main.setDeadzone(180, 120);
          this.addTitle();
          this.sortDepths();
          // TODO: Replace local plot care events with Supabase garden_events and shared_garden_plots writes.
          // TODO: Subscribe partner garden scene to Supabase Realtime so both linked players see care pulses.
        }

        update(_time: number, delta: number) {
          this.updateAvatar(delta);
          this.updatePet(delta);
          this.updateRemoteAvatarAnimation();
          this.butterflies.forEach((butterfly, index) => {
            butterfly.x += Math.sin((this.time.now + index * 400) * 0.0012) * 0.34;
            butterfly.y += Math.cos((this.time.now + index * 300) * 0.001) * 0.18;
          });

          this.fireflies.forEach((firefly, index) => {
            firefly.setAlpha(0.22 + Math.sin((this.time.now + index * 240) * 0.004) * 0.22);
            firefly.y -= delta * 0.003;
            if (firefly.y < 104) firefly.y = PhaserModule.Math.Between(360, 528);
          });
          this.sortDepths();
        }

        private drawBackdrop() {
          const mapKey = variant === "park" ? "park-bare-map" : "garden-bare-map";
          this.add.image(GARDEN_WORLD_WIDTH / 2, GARDEN_WORLD_HEIGHT / 2, mapKey).setDisplaySize(GARDEN_WORLD_WIDTH, GARDEN_WORLD_HEIGHT).setDepth(-30);
          this.add.rectangle(GARDEN_WORLD_WIDTH / 2, GARDEN_WORLD_HEIGHT / 2, GARDEN_WORLD_WIDTH, GARDEN_WORLD_HEIGHT, 0xfffcf3, 0.04).setDepth(-29);
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

          // 1. Visible walkable corridor — a soft cream "road" laid down on top
          //    of the background art so the painted ground and the corridor the
          //    avatar can actually walk along always match. Drawn at a low
          //    depth so all entities still render on top.
          const corridor = this.add.graphics().setDepth(-3);
          // Outer halo first (wider, fainter) for a gently glowing edge.
          segments.forEach((segment) => {
            corridor.lineStyle(segment.radius * 2 + 24, 0xfae3a8, 0.18);
            corridor.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
          });
          circles.forEach((circle) => {
            corridor.fillStyle(0xfae3a8, 0.18);
            corridor.fillCircle(circle.x, circle.y, circle.radius + 12);
          });
          // Main road body — clearly visible cream with a soft warm wash.
          segments.forEach((segment) => {
            corridor.lineStyle(segment.radius * 1.55, 0xfffcf3, 0.62);
            corridor.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
          });
          circles.forEach((circle) => {
            corridor.fillStyle(0xfffcf3, 0.55);
            corridor.fillCircle(circle.x, circle.y, circle.radius * 0.82);
          });
          // Painted edge line so the path reads clearly even on light backgrounds.
          segments.forEach((segment) => {
            corridor.lineStyle(3, 0xd9a53e, 0.28);
            corridor.lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
          });

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
          // Large park pieces are generated sprites in the decor system so hosts can move, rotate, and save them.
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
          setStatus(`${plot.name} watered. ${plot.stage} growth sparkles wake up.`);
          // Watering a plot advances the "water a garden plot" daily task.
          recordActivity("garden-watered");
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

        private drawButterflies() {
          const count = variant === "partner" ? 8 : variant === "park" ? 14 : 5;
          const maxX = variant === "park" ? GARDEN_WORLD_WIDTH - 180 : 830;
          for (let index = 0; index < count; index += 1) {
            const x = PhaserModule.Math.Between(130, maxX);
            const y = PhaserModule.Math.Between(160, 408);
            const butterfly = this.add
              .sprite(x, y, "ambient-critter-sprites", index % 5)
              .setDisplaySize(42 + (index % 3) * 10, 42 + (index % 3) * 10)
              .setAlpha(0.9)
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
              .setAlpha(0.3)
              .setDepth(5900);
            this.fireflies.push(firefly);
          }
        }

        private createAvatar() {
          this.keeperCustomization = readKeeperCustomization();
          this.avatarShadow = this.add.ellipse(420, 452, 50, 18, 0x3a2a2a, 0.18).setDepth(429);
          this.avatar = this.add.container(420, 430).setDepth(430);
          this.avatarSprite = this.add
            .sprite(
              0,
              -66,
              "keeper-animation-sheet",
              keeperFrame(this.keeperCustomization.paletteId, "idle", this.keeperCustomization.outfitId, this.keeperCustomization.bodyId),
            )
            .setDisplaySize(98, 147);
          this.avatar.add(this.avatarSprite);
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
          this.petShadow = this.add.ellipse(486, 470, 44, 15, 0x3a2a2a, 0.15).setDepth(449);
          this.pet = this.add.container(486, 450).setDepth(450);
          this.petSprite = this.add
            .sprite(0, -40, "pet-animation-sheet", petFrame(this.petCustomization.speciesId, "idle"))
            .setDisplaySize(94, 106);
          this.tintPetForTone();
          this.petAccessorySprite = this.createPetAccessorySprite(this.petCustomization.accessory);
          this.pet.add([this.petSprite, this.petAccessorySprite]);
          this.pet.setSize(70, 70);
          this.tweens.add({
            targets: this.pet,
            y: this.pet.y - 3,
            duration: 980,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createInput() {
          this.cursors = this.input.keyboard?.createCursorKeys();
          this.wasd = this.input.keyboard?.addKeys({
            up: PhaserModule.Input.Keyboard.KeyCodes.W,
            left: PhaserModule.Input.Keyboard.KeyCodes.A,
            down: PhaserModule.Input.Keyboard.KeyCodes.S,
            right: PhaserModule.Input.Keyboard.KeyCodes.D,
            rotate: PhaserModule.Input.Keyboard.KeyCodes.R,
          }) as Record<"up" | "left" | "down" | "right" | "rotate", Phaser.Input.Keyboard.Key> | undefined;

          this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (pointer.y < 112) return;
            const target = this.constrainAvatarToWalkable(pointer.worldX, pointer.worldY);
            this.target = new PhaserModule.Math.Vector2(target.x, target.y);
            playCozyCue("move");
            setStatus(`Walking along the paved path to x ${Math.round(target.x)}, y ${Math.round(target.y)}.`);
          });
        }

        private createRealtimeBridge() {
          this.remotePlayersHandler = (event: Event) => {
            const players = (event as CustomEvent<{ players?: RealtimeRoomPlayer[] }>).detail?.players;
            this.syncRemotePlayers(players ?? []);
          };
          this.chatBubbleHandler = (event: Event) => {
            const message = (event as CustomEvent<GardenChatMessage>).detail;
            if (message?.text) this.showChatBubble(message);
          };
          this.addDecorHandler = (event: Event) => {
            const kind = (event as CustomEvent<{ kind?: GardenDecorKind }>).detail?.kind;
            if (!kind) return;
            if (!canEditGarden) {
              setStatus("Only the host or trusted decorators can place garden items in this visit.");
              return;
            }
            this.addDecorFromDrawer(kind);
          };
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
          };
          // Vitals-derived companion mood keeps the resting pose in sync with how
          // well-tended the pet has been — the soul of the loop, on the canvas.
          this.companionMoodHandler = () => {
            this.companionMood = getPetMood(getPetVitals());
          };
          window.addEventListener("hearthaven:garden-remote-players", this.remotePlayersHandler);
          window.addEventListener("hearthaven:garden-chat-bubble", this.chatBubbleHandler);
          window.addEventListener("hearthaven:garden-add-decor", this.addDecorHandler);
          window.addEventListener("hearthaven:garden-time", this.timeOfDayHandler);
          window.addEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
          window.addEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
          window.addEventListener(PET_VITALS_EVENT, this.companionMoodHandler);
          const cleanup = () => {
            if (this.remotePlayersHandler) window.removeEventListener("hearthaven:garden-remote-players", this.remotePlayersHandler);
            if (this.chatBubbleHandler) window.removeEventListener("hearthaven:garden-chat-bubble", this.chatBubbleHandler);
            if (this.addDecorHandler) window.removeEventListener("hearthaven:garden-add-decor", this.addDecorHandler);
            if (this.timeOfDayHandler) window.removeEventListener("hearthaven:garden-time", this.timeOfDayHandler);
            if (this.keeperCustomizationHandler) window.removeEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
            if (this.petCustomizationHandler) window.removeEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
            if (this.companionMoodHandler) window.removeEventListener(PET_VITALS_EVENT, this.companionMoodHandler);
          };
          this.events.once("shutdown", cleanup);
          this.events.once("destroy", cleanup);
        }

        private applyTimeOfDay(nextTime: GardenTimeOfDay) {
          if (!this.timeOverlay) return;
          if (nextTime === "morning") {
            this.timeOverlay.setFillStyle(0xffe7bd, 0.08);
            setStatus("Morning light selected for this garden visit.");
            return;
          }
          if (nextTime === "night") {
            this.timeOverlay.setFillStyle(0x332b62, 0.28);
            setStatus("Night light selected. Lanterns and fireflies stand out more.");
            return;
          }
          this.timeOverlay.setFillStyle(0xffffff, 0);
          setStatus("Noon light selected for clear decorating.");
        }

        private setAvatarPose(pose: KeeperPose) {
          this.avatarPose = pose;
          this.avatarSprite?.setFrame(keeperFrame(this.keeperCustomization.paletteId, pose, this.keeperCustomization.outfitId, this.keeperCustomization.bodyId));
        }

        private setPetPose(pose: PetPose) {
          this.petSprite?.setFrame(petFrame(this.petCustomization.speciesId, pose));
        }

        private applyKeeperLocomotion(moving: boolean) {
          if (!this.avatarSprite) return;
          if (!moving) {
            this.setAvatarPose("idle");
            this.avatarSprite.setY(-66).setRotation(0);
            this.avatarShadow?.setScale(1, 1);
            return;
          }

          const wave = Math.sin(gaitPhase(this.time.now) * Math.PI * 2);
          this.setAvatarPose(keeperGaitPose(this.time.now));
          this.avatarSprite
            .setY(-66 - Math.abs(wave) * 3)
            .setRotation(wave * 0.018 * (this.avatarFacing === "left" ? -1 : 1));
          this.avatarShadow?.setScale(1 + Math.abs(wave) * 0.08, 1);
        }

        private applyPetLocomotion(moving: boolean, idlePose: PetPose) {
          if (!this.petSprite) return;
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
            remote.sprite.setFlipX(facingLeft);
            remote.petSprite.setFlipX(facingLeft);
            remote.petAccessorySprite.setFlipX(facingLeft);

            if (!moving) {
              remote.sprite
                .setFrame(keeperFrame(remote.paletteId, "idle", remote.outfitId, remote.bodyId))
                .setY(-66)
                .setRotation(0);
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
            remote.sprite
              .setFrame(keeperFrame(remote.paletteId, keeperGaitPose(this.time.now), remote.outfitId, remote.bodyId))
              .setY(-66 - Math.abs(wave) * 3)
              .setRotation(wave * 0.018 * (facingLeft ? -1 : 1));
            remote.petSprite
              .setFrame(petFrame(remote.petSpeciesId, petGaitPose(this.time.now + 90)))
              .setY(-38 - Math.abs(petWave) * 2.3)
              .setRotation(petWave * 0.03 * (facingLeft ? -1 : 1));
            remote.shadow.setScale(1 + Math.abs(wave) * 0.08, 1);
            remote.petShadow.setScale(1 + Math.abs(petWave) * 0.08, 1);
          });
        }

        private tintPetForTone() {
          if (!this.petSprite) return;
          const tone = getPetTone(this.petCustomization.toneId);
          const tint = PhaserModule.Display.Color.HexStringToColor(tone.color).color;
          if (this.petCustomization.toneId === "cream") {
            this.petSprite.clearTint();
            return;
          }
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
            .setFrame(petAccessoryFrame(accessoryId))
            .setPosition(accessory.x, accessory.y)
            .setDisplaySize(accessory.width, accessory.height);
        }

        private updateAvatar(delta: number) {
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

          // Don't fire the rotate keybind while the player is typing into chat.
          if (
            canEditGarden
            && !isTextInputFocused()
            && this.wasd?.rotate
            && PhaserModule.Input.Keyboard.JustDown(this.wasd.rotate)
          ) {
            this.rotateSelectedDecor();
          }

          // Mirror the keeper sprite to face the direction of travel.
          if (moving && Math.abs(moveDx) > 0.05) {
            this.avatarFacing = moveDx < 0 ? "left" : "right";
          }
          this.avatarSprite.setFlipX(this.avatarFacing === "left");

          this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
          this.avatarShadow.setDepth(this.avatar.y - 1);
          this.applyKeeperLocomotion(moving);

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
            onAvatarMove?.({ ...this.lastSentPosition, facing: this.avatarFacing });
          }
        }

        private updatePet(delta: number) {
          if (!this.pet) return;
          this.petMoodTimer += delta;
          if (this.petMoodTimer > 5200) {
            this.petMoodTimer = 0;
            this.petMood = this.petMood === "idle" ? "sit" : "idle";
          }

          const targetX = this.avatar.x + 64;
          const targetY = this.avatar.y + 28;
          const distance = PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, targetX, targetY);
          let petMoving = false;
          const prevPetX = this.pet.x;
          if (distance > 16) {
            this.pet.x = PhaserModule.Math.Linear(this.pet.x, targetX, 0.055);
            this.pet.y = PhaserModule.Math.Linear(this.pet.y, targetY, 0.055);
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
          this.petSprite.setFlipX(this.petFacing === "left");
          this.petAccessorySprite?.setFlipX(this.petFacing === "left");

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
          this.pet.setScale(1, this.petMood === "sit" ? 0.9 : 1);
          this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
          this.petShadow.setDepth(this.pet.y - 1);
        }

        private readKeyboard() {
          // When the player is typing into the chat input (or any text field),
          // WASD / arrow keys must NOT move the avatar — they're letters in a
          // message, not movement intent.
          if (isTextInputFocused()) return { x: 0, y: 0 };

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
            x: PhaserModule.Math.Clamp(x, 120, GARDEN_WORLD_WIDTH - 120),
            y: PhaserModule.Math.Clamp(y, 250, GARDEN_WORLD_HEIGHT - 120),
          };
        }

        private constrainAvatarToWalkable(x: number, y: number) {
          const bounded = this.constrainToWorldBounds(x, y);
          const segments = variant === "park" ? parkWalkSegments : sharedWalkSegments;
          const circles = variant === "park" ? parkWalkCircles : sharedWalkCircles;
          let best = { ...bounded };
          let bestDistance = Number.POSITIVE_INFINITY;

          segments.forEach((segment) => {
            const projected = projectPointToSegment(bounded.x, bounded.y, segment);
            const dx = bounded.x - projected.x;
            const dy = bounded.y - projected.y;
            const distance = Math.hypot(dx, dy);
            const candidate =
              distance <= segment.radius || distance === 0
                ? bounded
                : {
                    x: projected.x + (dx / distance) * segment.radius,
                    y: projected.y + (dy / distance) * segment.radius,
                  };
            const correction = Math.hypot(bounded.x - candidate.x, bounded.y - candidate.y);
            if (correction < bestDistance) {
              bestDistance = correction;
              best = candidate;
            }
          });

          circles.forEach((circle) => {
            const dx = bounded.x - circle.x;
            const dy = bounded.y - circle.y;
            const distance = Math.hypot(dx, dy);
            const candidate =
              distance <= circle.radius || distance === 0
                ? bounded
                : {
                    x: circle.x + (dx / distance) * circle.radius,
                    y: circle.y + (dy / distance) * circle.radius,
                  };
            const correction = Math.hypot(bounded.x - candidate.x, bounded.y - candidate.y);
            if (correction < bestDistance) {
              bestDistance = correction;
              best = candidate;
            }
          });

          return this.constrainToWorldBounds(best.x, best.y);
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
              const petX = player.x + (facingLeft ? 58 : -58);
              const petY = player.y + 18;
              const changed =
                existing.bodyId !== custom.bodyId ||
                existing.paletteId !== custom.paletteId ||
                existing.outfitId !== custom.outfitId ||
                existing.petSpeciesId !== custom.petSpeciesId ||
                existing.petToneId !== custom.petToneId ||
                existing.petAccessoryId !== custom.petAccessoryId;
              if (changed) {
                existing.bodyId = custom.bodyId;
                existing.paletteId = custom.paletteId;
                existing.outfitId = custom.outfitId;
                existing.petSpeciesId = custom.petSpeciesId;
                existing.petToneId = custom.petToneId;
                existing.petAccessoryId = custom.petAccessoryId;
                this.applyRemotePetTone(existing.petSprite, custom.petToneId);
                this.updatePetAccessory(existing.petAccessorySprite, custom.petAccessoryId);
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

            const petX = player.x + (facingLeft ? 58 : -58);
            const petY = player.y + 18;

            // --- new visiting keeper ---
            const color = PhaserModule.Display.Color.HexStringToColor(player.color).color;
            const shadow = this.add.ellipse(player.x, player.y + 22, 48, 17, 0x3a2a2a, 0.14).setDepth(player.y - 1);
            const container = this.add.container(player.x, player.y).setDepth(player.y);
            const aura = this.add.circle(0, -80, 14, color, 0.28);
            const sprite = this.add
              .sprite(0, -66, "keeper-animation-sheet", keeperFrame(custom.paletteId, "idle", custom.outfitId, custom.bodyId))
              .setDisplaySize(98, 147)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
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
            container.add([aura, sprite, label]);

            // --- their pet ---
            const petShadow = this.add.ellipse(petX, petY + 16, 42, 14, 0x3a2a2a, 0.13).setDepth(petY - 2);
            const petContainer = this.add.container(petX, petY).setDepth(petY - 1);
            const petSprite = this.add
              .sprite(0, -38, "pet-animation-sheet", petFrame(custom.petSpeciesId, "idle"))
              .setDisplaySize(84, 94)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
            this.applyRemotePetTone(petSprite, custom.petToneId);
            const petAccessorySprite = this.createPetAccessorySprite(custom.petAccessoryId).setAlpha(0.94).setFlipX(facingLeft);
            petContainer.add([petSprite, petAccessorySprite]);

            this.remoteAvatars.set(player.id, {
              container,
              shadow,
              sprite,
              label,
              petContainer,
              petShadow,
              petSprite,
              petAccessorySprite,
              bodyId: custom.bodyId,
              paletteId: custom.paletteId,
              outfitId: custom.outfitId,
              petSpeciesId: custom.petSpeciesId,
              petToneId: custom.petToneId,
              petAccessoryId: custom.petAccessoryId,
              facing: facingLeft ? "left" : "right",
              movingUntil: 0,
            });
          });
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
          this.remoteAvatars.forEach((remote) => {
            remote.container.setDepth(remote.container.y);
            remote.shadow.setDepth(remote.container.y - 1);
          });
        }

        private createDecorations(decorations: GardenDecorPlacement[]) {
          decorations.forEach((decoration) => this.createDecoration(decoration));
        }

        private addDecorFromDrawer(kind: GardenDecorKind) {
          if (!canEditGarden) {
            setStatus("Only the host or trusted decorators can place garden items in this visit.");
            return;
          }
          const item = gardenDecorItems.find((entry) => entry.kind === kind);
          if (!item) return;
          const center = this.constrainToWorldBounds(this.cameras.main.scrollX + GARDEN_WIDTH / 2, this.cameras.main.scrollY + GARDEN_HEIGHT / 2 + 80);
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
          setStatus(`${item.label} placed. Drag it around the garden or press R while selected to rotate.`);
        }

        private createDecoration(decoration: GardenDecorPlacement) {
          const spriteConfig = worldObjectSprites[decoration.kind];
          const container = this.add.container(decoration.x, decoration.y).setDepth(decoration.y);
          container.setRotation((decoration.rotation * Math.PI) / 180);
          container.setSize(spriteConfig.width, spriteConfig.height);
          container.setInteractive({ draggable: canEditGarden, useHandCursor: true });
          if (canEditGarden) this.input.setDraggable(container);

          const glow = this.add.graphics();
          glow.lineStyle(4, 0xffffff, 0.9);
          glow.strokeRoundedRect(-spriteConfig.width / 2, -spriteConfig.height + 36, spriteConfig.width, spriteConfig.height, 18);
          glow.setVisible(false);
          container.add(glow);
          container.setData("glow", glow);
          container.setData("placement", decoration);

          this.drawGardenDecoration(container, decoration.kind);
          this.decorObjects.set(decoration.id, container);

          container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.selectDecor(decoration.id);
          });
          container.on("pointerover", () => {
            glow.setVisible(true);
            setStatus(
              canEditGarden
                ? `${decoration.label}: drag to move, R rotates${decoration.href ? ", click while nearby to play" : ""}.`
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
            window.location.assign(decoration.href);
          });
        }

        private drawGardenDecoration(container: Phaser.GameObjects.Container, kind: GardenDecorKind) {
          const spriteConfig = worldObjectSprites[kind];
          container.add(this.add.ellipse(0, 42, spriteConfig.width * 0.62, 34, 0x3a2a2a, 0.13));
          const sprite = this.add
            .image(0, spriteConfig.yOffset, "world-object-sprites", spriteConfig.frame)
            .setDisplaySize(spriteConfig.width, spriteConfig.height);
          container.add(sprite);
          this.addPassiveDecorMotion(container, sprite, kind);
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
                ? `${this.selectedDecor.label} selected. Drag to move, R rotates.`
                : `${this.selectedDecor.label} selected. Ask the host for decorator permission to move it.`,
            );
          }
        }

        private rotateSelectedDecor() {
          if (!canEditGarden) {
            setStatus("Only the host or trusted decorators can rotate garden items in this visit.");
            return;
          }
          if (!this.selectedDecor) return;
          const container = this.decorObjects.get(this.selectedDecor.id);
          if (!container) return;
          this.selectedDecor.rotation = (this.selectedDecor.rotation + 15) % 360;
          container.setRotation((this.selectedDecor.rotation * Math.PI) / 180);
          this.persistDecorations();
          playCozyCue("rotate");
          setStatus(`${this.selectedDecor.label} rotated.`);
        }

        private persistDecorations() {
          const decorations = Array.from(this.decorObjects.values()).map((container) => {
            const placement = container.getData("placement") as GardenDecorPlacement;
            return {
              ...placement,
              x: Math.round(container.x),
              y: Math.round(container.y),
              rotation: Math.round((container.rotation * 180) / Math.PI),
            };
          });
          writeGardenDecor(variant, decorations);
          // TODO: Persist garden decorations to Supabase placed_items with garden ownership checks.
        }

        private drawSeasonalGardenDecor() {
          if (!activeEvent) return;

          const primary = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.primary).color;
          const secondary = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.secondary).color;
          const accent = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.accent).color;
          this.add.rectangle(GARDEN_WORLD_WIDTH / 2, GARDEN_HEIGHT / 2, GARDEN_WORLD_WIDTH, GARDEN_HEIGHT, primary, 0.035).setDepth(-17);

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
          {(["morning", "noon", "night"] as const).map((time) => (
            <button
              className={`rounded-md px-2.5 py-1 capitalize transition ${
                timeOfDay === time ? "bg-blush-500 text-white" : "bg-white/78 text-ink-700 hover:bg-blush-100"
              }`}
              key={time}
              onClick={() => setTimeOfDay(time)}
              type="button"
            >
              {time}
            </button>
          ))}
          <span className="rounded-md bg-garden-100 px-2.5 py-1">Click flowers</span>
          <span className="rounded-md bg-sky-100 px-2.5 py-1">Water effects</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Lantern glow</span>
          {variant === "park" ? <span className="rounded-md bg-blush-100 px-2.5 py-1">Game kiosks</span> : null}
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label={
          variant === "partner"
            ? "Scrollable interactive shared garden canvas with avatar movement, chat bubbles, memory tree, quests, Casper statue, and flowers"
            : variant === "park"
              ? "Scrollable interactive park canvas with avatar movement, chat bubbles, roads, picnic areas, a fashion stage, and clickable game kiosks"
              : "Scrollable interactive garden canvas with avatar movement, animated plots, water effects, lanterns, and butterflies"
        }
        className="mx-auto block overflow-hidden bg-garden-100"
        role="application"
        style={{
          // Viewport-bounded box; Phaser Scale.FIT fits the 960x620 game
          // (camera scrolls the larger world) inside it.
          width: "min(100%, calc((100dvh - 320px) * 1.5484), 960px)",
          aspectRatio: "960 / 620",
        }}
        tabIndex={0}
      />
      <div className="border-t border-garden-300/40 bg-white/78 px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-extrabold uppercase tracking-normal text-garden-700">Garden decor drawer</span>
          <span className="text-xs font-bold text-ink-600">
            {canEditGarden
              ? "Place here, then drag inside the garden. R rotates selected decor."
              : "Decorator permissions are off for this visit."}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {gardenDecorItems.map((item) => (
            <button
              className={`min-w-[132px] rounded-lg border border-cream-300 px-3 py-2 text-left shadow-sm transition ${
                canEditGarden
                  ? "bg-cream-50 hover:-translate-y-0.5 hover:border-garden-300 hover:bg-garden-100"
                  : "cursor-not-allowed bg-stone-100/80 opacity-60"
              }`}
              disabled={!canEditGarden}
              key={item.kind}
              onClick={() => window.dispatchEvent(new CustomEvent("hearthaven:garden-add-decor", { detail: { kind: item.kind } }))}
              type="button"
            >
              <span className="block text-sm font-black text-ink-900">{item.label}</span>
              <span className="mt-0.5 block text-xs font-bold text-ink-600">{item.description}</span>
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

function readGardenDecor(variant: GardenCanvasProps["variant"]): GardenDecorPlacement[] {
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

function writeGardenDecor(variant: GardenCanvasProps["variant"], decorations: GardenDecorPlacement[]) {
  window.localStorage.setItem(getGardenStorageKey(variant), JSON.stringify(decorations));
}

function defaultGardenDecor(variant: GardenCanvasProps["variant"]): GardenDecorPlacement[] {
  const sharedOffset = variant === "partner" ? 60 : 0;
  if (variant === "park") {
    return [
      { id: "decor-gazebo", kind: "gazebo", label: "Gazebo", x: 540, y: 404, rotation: 0 },
      { id: "decor-swing", kind: "swing", label: "Swing set", x: 860, y: 548, rotation: 0 },
      { id: "decor-picnic", kind: "picnic", label: "Picnic table", x: 1160, y: 612, rotation: 0 },
      { id: "decor-fountain", kind: "fountain", label: "Berry fountain", x: 1560, y: 510, rotation: 0 },
      { id: "decor-fashion", kind: "fashionStage", label: "Fashion stage", href: "/app/fashion-show", x: 2260, y: 510, rotation: 0 },
      { id: "decor-arcade", kind: "arcadeKiosk", label: "Arcade kiosk", href: "/app/petal-catch", x: 2580, y: 618, rotation: 0 },
      { id: "decor-bowling", kind: "bowlingKiosk", label: "Bowling kiosk", href: "/app/bowling", x: 2860, y: 590, rotation: 0 },
      { id: "decor-flower-stand", kind: "flowerStand", label: "Flower stand", x: 3140, y: 470, rotation: 0 },
    ];
  }

  if (variant === "partner") {
    return [
      { id: "decor-memory-tree", kind: "memoryTree", label: "Memory tree", x: 560, y: 414, rotation: 0 },
      { id: "decor-lantern-arch", kind: "lanternArch", label: "Lantern arch", x: 900, y: 470, rotation: 0 },
      { id: "decor-fountain", kind: "fountain", label: "Berry fountain", x: 1210, y: 500, rotation: 0 },
      { id: "decor-picnic", kind: "picnic", label: "Picnic table", x: 1480, y: 570, rotation: 0 },
    ];
  }

  return [
    { id: "decor-greenhouse", kind: "greenhouse", label: "Greenhouse", x: 860 + sharedOffset, y: 452, rotation: 0 },
    { id: "decor-bbq", kind: "bbq", label: "BBQ", x: 1180 + sharedOffset, y: 552, rotation: 0 },
    { id: "decor-swing", kind: "swing", label: "Swing set", x: 1450, y: 500, rotation: 0 },
    { id: "decor-picnic", kind: "picnic", label: "Picnic table", x: 1280, y: 640, rotation: 0 },
  ];
}
