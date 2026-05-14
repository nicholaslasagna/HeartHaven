"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import {
  getPetTone,
  keeperFrame,
  KEEPER_CUSTOMIZATION_EVENT,
  normalizeRemoteCustomization,
  petFrame,
  PET_CUSTOMIZATION_EVENT,
  readKeeperCustomization,
  readPetCustomization,
  type KeeperCustomization,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperPose,
  type PetCustomization,
  type PetPose,
  type PetSpeciesId,
  type PetToneId,
} from "@/lib/game/avatar-customization";
import { playCozyCue } from "@/lib/game/cozy-audio";
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
  /** Cached customization so frames only rebuild when it actually changes. */
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  petSpeciesId: PetSpeciesId;
  petToneId: PetToneId;
};

type GardenPetMood = "idle" | "follow" | "sit" | "happy";
type GardenTimeOfDay = "morning" | "noon" | "night";

const GARDEN_WIDTH = 960;
const GARDEN_HEIGHT = 620;
const GARDEN_WORLD_WIDTH = 3400;
const GARDEN_WORLD_HEIGHT = 1133;
const GARDEN_STORAGE_PREFIX = "hearthaven:garden-decor:v2:";

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

export function GardenCanvas({ onAvatarMove, remotePlayers = [], variant, plots }: GardenCanvasProps) {
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
        private butterflies: Phaser.GameObjects.Container[] = [];
        private fireflies: Phaser.GameObjects.Arc[] = [];
        private avatar!: Phaser.GameObjects.Container;
        private avatarShadow!: Phaser.GameObjects.Ellipse;
        private avatarSprite!: Phaser.GameObjects.Sprite;
        private avatarPose: KeeperPose = "idle";
        private avatarFacing: FacingDirection = "right";
        private keeperCustomization: KeeperCustomization = readKeeperCustomization();
        private pet!: Phaser.GameObjects.Container;
        private petShadow!: Phaser.GameObjects.Ellipse;
        private petSprite!: Phaser.GameObjects.Sprite;
        private petCustomization: PetCustomization = readPetCustomization();
        private petMood: GardenPetMood = "idle";
        private petMoodTimer = 0;
        private petFacing: FacingDirection = "right";
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
          this.load.spritesheet("keeper-animation-sheet", "/game-assets/generated/keeper-art-sheet.png", {
            frameWidth: 256,
            frameHeight: 384,
          });
          this.load.spritesheet("pet-animation-sheet", "/game-assets/generated/pet-art-sheet.png", {
            frameWidth: 256,
            frameHeight: 288,
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
          // Roads are painted into the map at native resolution.
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
              this.target = new PhaserModule.Math.Vector2(x, y + 58);
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

        private drawButterflies() {
          const count = variant === "partner" ? 8 : variant === "park" ? 14 : 5;
          const maxX = variant === "park" ? GARDEN_WORLD_WIDTH - 180 : 830;
          for (let index = 0; index < count; index += 1) {
            const x = PhaserModule.Math.Between(130, maxX);
            const y = PhaserModule.Math.Between(160, 408);
            const butterfly = this.add.container(x, y).setDepth(5800);
            butterfly.add(this.add.ellipse(-5, 0, 12, 18, 0xf6cfd2, 0.8));
            butterfly.add(this.add.ellipse(5, 0, 12, 18, 0xddceec, 0.8));
            butterfly.add(this.add.rectangle(0, 2, 3, 16, 0x5b3f3f, 0.65));
            this.butterflies.push(butterfly);
            this.tweens.add({
              targets: butterfly,
              x: x + PhaserModule.Math.Between(-80, 80),
              y: y + PhaserModule.Math.Between(-36, 36),
              duration: PhaserModule.Math.Between(2400, 4200),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private drawFireflies() {
          for (let index = 0; index < 28; index += 1) {
            const firefly = this.add.circle(
              PhaserModule.Math.Between(92, GARDEN_WORLD_WIDTH - 92),
              PhaserModule.Math.Between(268, 540),
              PhaserModule.Math.Between(2, 4),
              0xfaebc2,
              0.3,
            ).setDepth(5900);
            this.fireflies.push(firefly);
          }
        }

        private createAvatar() {
          this.keeperCustomization = readKeeperCustomization();
          this.avatarShadow = this.add.ellipse(420, 452, 50, 18, 0x3a2a2a, 0.18).setDepth(429);
          this.avatar = this.add.container(420, 430).setDepth(430);
          this.avatarSprite = this.add
            .sprite(0, -66, "keeper-animation-sheet", keeperFrame(this.keeperCustomization.paletteId, "idle", this.keeperCustomization.outfitId))
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
          this.pet.add(this.petSprite);
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
            const target = this.constrainToGarden(pointer.worldX, pointer.worldY);
            this.target = new PhaserModule.Math.Vector2(target.x, target.y);
            playCozyCue("move");
            setStatus(`Walking through the garden to x ${Math.round(target.x)}, y ${Math.round(target.y)}.`);
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
            if (kind) this.addDecorFromDrawer(kind);
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
          };
          window.addEventListener("hearthaven:garden-remote-players", this.remotePlayersHandler);
          window.addEventListener("hearthaven:garden-chat-bubble", this.chatBubbleHandler);
          window.addEventListener("hearthaven:garden-add-decor", this.addDecorHandler);
          window.addEventListener("hearthaven:garden-time", this.timeOfDayHandler);
          window.addEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
          window.addEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
          const cleanup = () => {
            if (this.remotePlayersHandler) window.removeEventListener("hearthaven:garden-remote-players", this.remotePlayersHandler);
            if (this.chatBubbleHandler) window.removeEventListener("hearthaven:garden-chat-bubble", this.chatBubbleHandler);
            if (this.addDecorHandler) window.removeEventListener("hearthaven:garden-add-decor", this.addDecorHandler);
            if (this.timeOfDayHandler) window.removeEventListener("hearthaven:garden-time", this.timeOfDayHandler);
            if (this.keeperCustomizationHandler) window.removeEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
            if (this.petCustomizationHandler) window.removeEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
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
          this.avatarSprite?.setFrame(keeperFrame(this.keeperCustomization.paletteId, pose, this.keeperCustomization.outfitId));
        }

        private setPetPose(pose: PetPose) {
          this.petSprite?.setFrame(petFrame(this.petCustomization.speciesId, pose));
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

        private updateAvatar(delta: number) {
          const keyboard = this.readKeyboard();
          const speed = 0.24 * delta;
          let moving = false;
          let moveDx = 0;

          if (keyboard.x !== 0 || keyboard.y !== 0) {
            this.target = undefined;
            const next = this.constrainToGarden(this.avatar.x + keyboard.x * speed, this.avatar.y + keyboard.y * speed);
            moveDx = next.x - this.avatar.x;
            this.avatar.setPosition(next.x, next.y);
            moving = true;
          } else if (this.target) {
            const distance = PhaserModule.Math.Distance.Between(this.avatar.x, this.avatar.y, this.target.x, this.target.y);
            if (distance < 5) {
              this.target = undefined;
            } else {
              const angle = PhaserModule.Math.Angle.Between(this.avatar.x, this.avatar.y, this.target.x, this.target.y);
              const next = this.constrainToGarden(
                this.avatar.x + Math.cos(angle) * speed,
                this.avatar.y + Math.sin(angle) * speed,
              );
              moveDx = next.x - this.avatar.x;
              this.avatar.setPosition(next.x, next.y);
              moving = true;
            }
          }

          if (this.wasd?.rotate && PhaserModule.Input.Keyboard.JustDown(this.wasd.rotate)) {
            this.rotateSelectedDecor();
          }

          // Mirror the keeper sprite to face the direction of travel.
          if (moving && Math.abs(moveDx) > 0.05) {
            this.avatarFacing = moveDx < 0 ? "left" : "right";
          }
          this.avatarSprite.setFlipX(this.avatarFacing === "left");

          this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
          this.avatarShadow.setDepth(this.avatar.y - 1);
          this.setAvatarPose(moving ? (Math.floor(this.time.now / 180) % 2 === 0 ? "walk1" : "walk2") : "idle");

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

          const pose: PetPose = this.petMood === "sit"
            ? "sit"
            : this.petMood === "happy"
              ? "happy"
              : petMoving
                ? Math.floor(this.time.now / 180) % 2 === 0 ? "walk1" : "walk2"
                : "idle";
          this.setPetPose(pose);
          this.pet.setScale(1, this.petMood === "sit" ? 0.9 : 1);
          this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
          this.petShadow.setDepth(this.pet.y - 1);
        }

        private readKeyboard() {
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

        private constrainToGarden(x: number, y: number) {
          return {
            x: PhaserModule.Math.Clamp(x, 120, GARDEN_WORLD_WIDTH - 120),
            y: PhaserModule.Math.Clamp(y, 250, GARDEN_WORLD_HEIGHT - 120),
          };
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
            const facingLeft = player.facing === "left";
            const walkFrame: KeeperPose = Math.floor(this.time.now / 180) % 2 === 0 ? "walk1" : "walk2";
            const petWalkFrame: PetPose = Math.floor(this.time.now / 200) % 2 === 0 ? "walk1" : "walk2";
            const petX = player.x + (facingLeft ? 58 : -58);
            const petY = player.y + 18;

            const existing = this.remoteAvatars.get(player.id);
            if (existing) {
              const changed =
                existing.paletteId !== custom.paletteId ||
                existing.outfitId !== custom.outfitId ||
                existing.petSpeciesId !== custom.petSpeciesId ||
                existing.petToneId !== custom.petToneId;
              if (changed) {
                existing.paletteId = custom.paletteId;
                existing.outfitId = custom.outfitId;
                existing.petSpeciesId = custom.petSpeciesId;
                existing.petToneId = custom.petToneId;
                this.applyRemotePetTone(existing.petSprite, custom.petToneId);
              }
              existing.sprite.setFrame(keeperFrame(custom.paletteId, walkFrame, custom.outfitId));
              existing.sprite.setFlipX(facingLeft);
              existing.petSprite.setFlipX(facingLeft);
              existing.petSprite.setFrame(petFrame(custom.petSpeciesId, petWalkFrame));
              existing.label.setText(player.displayName);
              this.tweens.add({
                targets: existing.container,
                x: player.x,
                y: player.y,
                duration: 140,
                ease: "Sine.out",
                onComplete: () => existing.container.setDepth(player.y),
              });
              this.tweens.add({ targets: existing.shadow, x: player.x, y: player.y + 22, duration: 140, ease: "Sine.out" });
              this.tweens.add({
                targets: existing.petContainer,
                x: petX,
                y: petY,
                duration: 200,
                ease: "Sine.out",
                onComplete: () => existing.petContainer.setDepth(petY - 1),
              });
              this.tweens.add({ targets: existing.petShadow, x: petX, y: petY + 16, duration: 200, ease: "Sine.out" });
              this.time.delayedCall(180, () => {
                existing.sprite.setFrame(keeperFrame(custom.paletteId, "idle", custom.outfitId));
                existing.petSprite.setFrame(petFrame(custom.petSpeciesId, "idle"));
              });
              return;
            }

            // --- new visiting keeper ---
            const color = PhaserModule.Display.Color.HexStringToColor(player.color).color;
            const shadow = this.add.ellipse(player.x, player.y + 22, 48, 17, 0x3a2a2a, 0.14).setDepth(player.y - 1);
            const container = this.add.container(player.x, player.y).setDepth(player.y);
            const aura = this.add.circle(0, -80, 14, color, 0.28);
            const sprite = this.add
              .sprite(0, -66, "keeper-animation-sheet", keeperFrame(custom.paletteId, "idle", custom.outfitId))
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
            petContainer.add(petSprite);

            this.remoteAvatars.set(player.id, {
              container,
              shadow,
              sprite,
              label,
              petContainer,
              petShadow,
              petSprite,
              paletteId: custom.paletteId,
              outfitId: custom.outfitId,
              petSpeciesId: custom.petSpeciesId,
              petToneId: custom.petToneId,
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
          const item = gardenDecorItems.find((entry) => entry.kind === kind);
          if (!item) return;
          const center = this.constrainToGarden(this.cameras.main.scrollX + GARDEN_WIDTH / 2, this.cameras.main.scrollY + GARDEN_HEIGHT / 2 + 80);
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
          container.setInteractive({ draggable: true, useHandCursor: true });
          this.input.setDraggable(container);

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
            setStatus(`${decoration.label}: drag to move, R rotates${decoration.href ? ", click while nearby to play" : ""}.`);
          });
          container.on("pointerout", () => {
            if (this.selectedDecor?.id !== decoration.id) glow.setVisible(false);
          });
          container.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            this.decorDragging = true;
            const next = this.constrainToGarden(dragX, dragY);
            container.setPosition(next.x, next.y);
            decoration.x = Math.round(next.x);
            decoration.y = Math.round(next.y);
          });
          container.on("dragend", () => {
            this.persistDecorations();
            setStatus(`${decoration.label} moved to x ${decoration.x}, y ${decoration.y}.`);
            this.time.delayedCall(140, () => {
              this.decorDragging = false;
            });
          });
          container.on("pointerup", () => {
            if (!decoration.href || this.decorDragging) return;
            const distance = PhaserModule.Math.Distance.Between(this.avatar?.x ?? decoration.x, this.avatar?.y ?? decoration.y, decoration.x, decoration.y);
            if (distance > 180 && this.avatar) {
              this.target = new PhaserModule.Math.Vector2(decoration.x, decoration.y + 62);
              playCozyCue("move");
              setStatus(`Walking to ${decoration.label}. Click it again when you arrive to play.`);
              return;
            }
            playCozyCue("ui");
            setStatus(`Opening ${decoration.label}.`);
            window.location.assign(decoration.href);
          });
        }

        private drawGardenDecoration(container: Phaser.GameObjects.Container, kind: GardenDecorKind) {
          const spriteConfig = worldObjectSprites[kind];
          container.add(this.add.ellipse(0, 42, spriteConfig.width * 0.62, 34, 0x3a2a2a, 0.13));
          container.add(
            this.add
              .image(0, spriteConfig.yOffset, "world-object-sprites", spriteConfig.frame)
              .setDisplaySize(spriteConfig.width, spriteConfig.height),
          );
        }

        private selectDecor(id: string) {
          this.decorObjects.forEach((container, containerId) => {
            const glow = container.getData("glow") as Phaser.GameObjects.Graphics | undefined;
            glow?.setVisible(containerId === id);
          });
          this.selectedDecor = this.decorObjects.get(id)?.getData("placement") as GardenDecorPlacement | undefined;
          if (this.selectedDecor) {
            playCozyCue("ui");
            setStatus(`${this.selectedDecor.label} selected. Drag to move, R rotates.`);
          }
        }

        private rotateSelectedDecor() {
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
  }, [activeEvent, onAvatarMove, plots, timeOfDayRef, variant]);

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
          <span className="text-xs font-bold text-ink-600">Place here, then drag inside the garden. R rotates selected decor.</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {gardenDecorItems.map((item) => (
            <button
              className="min-w-[132px] rounded-lg border border-cream-300 bg-cream-50 px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-garden-300 hover:bg-garden-100"
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
