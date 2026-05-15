"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import {
  getPetAccessory,
  getPetTone,
  keeperFrame,
  KEEPER_CUSTOMIZATION_EVENT,
  normalizeRemoteCustomization,
  petAccessoryFrame,
  petFrame,
  PET_CUSTOMIZATION_EVENT,
  readKeeperCustomization,
  readPetCustomization,
  type KeeperBodyId,
  type KeeperCustomization,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperPose,
  type PetAccessoryId,
  type PetCustomization,
  type PetPose,
  type PetSpeciesId,
  type PetToneId,
} from "@/lib/game/avatar-customization";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { PET_VITALS_EVENT, getPetMood, getPetVitals, type PetMood as CompanionMood } from "@/lib/game/pet-state";
import type { FacingDirection, RealtimeRoomPlayer, RoomBlueprint, RoomEmote, RoomPlacement } from "@/lib/game/types";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";

type RoomCanvasProps = {
  remotePlayers?: RealtimeRoomPlayer[];
  roomName?: string;
  roomTheme?: RoomBlueprint["theme"];
  placements: RoomPlacement[];
  /** When false, the keeper is a VISITOR — they can walk + emote but can't
   *  drag, rotate, or re-layer furniture. Defaults to true (own room). */
  canEditRoom?: boolean;
  onAvatarMove?: (position: { x: number; y: number; facing: FacingDirection }) => void;
  onRoomEmote?: (emote: RoomEmote) => void;
  onPlacementsChange?: (placements: RoomPlacement[]) => void;
};

type FurnitureKind = "rug" | "window" | "lantern" | "chair" | "bed" | "table" | "shelf" | "plant" | "generic";

type PlayablePlacement = RoomPlacement & {
  label: string;
  kind: FurnitureKind;
  width: number;
  height: number;
  floorLocked: boolean;
};

type FurnitureObject = {
  placement: PlayablePlacement;
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Graphics;
  baseY: number;
};

type PetMood = "idle" | "follow" | "sit" | "sleep" | "react";
type RemoteAvatarObject = {
  container: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  /** Remote companion — every visiting keeper brings their own pet. */
  petContainer: Phaser.GameObjects.Container;
  petShadow: Phaser.GameObjects.Ellipse;
  petSprite: Phaser.GameObjects.Sprite;
  petAccessorySprite: Phaser.GameObjects.Sprite;
  /** Last known customization, so we only rebuild frames when it changes. */
  bodyId: KeeperBodyId;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  petSpeciesId: PetSpeciesId;
  petToneId: PetToneId;
  petAccessoryId: PetAccessoryId;
};

const ROOM_WIDTH = 960;
const ROOM_HEIGHT = 600;
const roomEmotes: { emote: RoomEmote; label: string }[] = [
  { emote: "heart", label: "Heart" },
  { emote: "wave", label: "Wave" },
  { emote: "sparkle", label: "Sparkle" },
  { emote: "cozy", label: "Cozy" },
];

/**
 * True if the user is currently typing into a text input — suspends canvas
 * keyboard handling so WASD doesn't fire while typing in chat.
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

export function RoomCanvas({
  remotePlayers = [],
  roomName = "Moonlit Loft",
  roomTheme = "loft",
  placements,
  canEditRoom = true,
  onAvatarMove,
  onRoomEmote,
  onPlacementsChange,
}: RoomCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const remotePlayersRef = useRef(remotePlayers);
  const [status, setStatus] = useState("Lighting the Moonlit Loft");
  const [selected, setSelected] = useState("No item selected");
  const { activeEvent } = useSeasonalEvent();

  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
    window.dispatchEvent(new CustomEvent("hearthaven:remote-players", { detail: { players: remotePlayers } }));
  }, [remotePlayers]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      const normalizedPlacements = placements.map(toPlayablePlacement);

      if (!mountRef.current || destroyed) return;

      class HeartHavenRoomScene extends PhaserModule.Scene {
        private avatar!: Phaser.GameObjects.Container;
        private avatarShadow!: Phaser.GameObjects.Ellipse;
        private avatarSprite!: Phaser.GameObjects.Sprite;
        private avatarPose: KeeperPose = "idle";
        private avatarEmoteTimer = 0;
        private avatarFacing: FacingDirection = "right";
        private keeperCustomization: KeeperCustomization = readKeeperCustomization();
        private pet!: Phaser.GameObjects.Container;
        private petShadow!: Phaser.GameObjects.Ellipse;
        private petSprite!: Phaser.GameObjects.Sprite;
        private petAccessorySprite!: Phaser.GameObjects.Sprite;
        private petCustomization: PetCustomization = readPetCustomization();
        private petEyes: Phaser.GameObjects.Ellipse[] = [];
        private petMood: PetMood = "idle";
        private petMoodTimer = 0;
        private petFacing: FacingDirection = "right";
        private companionMood: CompanionMood = getPetMood(getPetVitals());
        private companionMoodHandler?: (event: Event) => void;
        private blinkTimer = 0;
        private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
        private wasd?: Record<"up" | "left" | "down" | "right" | "rotate" | "layerUp" | "layerDown", Phaser.Input.Keyboard.Key>;
        private target?: Phaser.Math.Vector2;
        private floorPolygon!: Phaser.Geom.Polygon;
        private furniture: FurnitureObject[] = [];
        private selectedFurniture?: FurnitureObject;
        private interactionBubble?: Phaser.GameObjects.Container;
        private dragStarted = false;
        private sparkleLayer!: Phaser.GameObjects.Container;
        private remoteAvatars = new Map<string, RemoteAvatarObject>();
        private roomEmoteHandler?: (event: Event) => void;
        private remotePlayersHandler?: (event: Event) => void;
        private remoteEmoteHandler?: (event: Event) => void;
        private keeperCustomizationHandler?: (event: Event) => void;
        private petCustomizationHandler?: (event: Event) => void;
        private moveBroadcastTimer = 0;
        private footstepTimer = 0;
        private lastSentPosition = { x: 390, y: 374 };

        constructor() {
          super("HeartHavenRoom");
        }

        preload() {
          this.load.image("cozy-room-bg", "/game-assets/generated/cozy-room-bg.png");
          this.load.image("keeper-sprite", "/game-assets/generated/keeper-sprite.png");
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
          this.load.spritesheet("cozy-furniture-sprites", "/game-assets/generated/cozy-furniture-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
        }

        create() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.drawRoomShell();
          this.drawAmbientMagic();
          this.drawSeasonalRoomDecor();
          this.createFurniture(normalizedPlacements);
          this.drawBlankRoomHint(normalizedPlacements.length === 0);
          this.createAvatar();
          this.createPet();
          this.createInput();
          this.createRealtimeBridge();
          this.syncRemotePlayers(remotePlayersRef.current);
          this.sortDepths();

          this.add
            .text(34, 30, roomName, {
              color: "#3A2A2A",
              fontFamily: "Nunito, sans-serif",
              fontSize: "22px",
              fontStyle: "800",
            })
            .setDepth(5000);

          this.add
            .text(34, 58, "Click or WASD to move. Drag furniture. R rotates. Q/E adjusts 2.5D depth.", {
              color: "#84675F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "13px",
              fontStyle: "700",
            })
            .setDepth(5000);

          setStatus(activeEvent?.roomMessage ?? "Click the floor to move. Hover, drag, click, and rotate furniture.");
          // TODO: Persist furniture edits through Supabase Realtime room sessions for collaborative decorating.
          // TODO: Save mutable placement state to Supabase placed_items after drag/rotate interactions.
        }

        update(_time: number, delta: number) {
          this.updateAvatar(delta);
          this.updatePet(delta);
          this.updateSparkles(delta);
          this.sortDepths();
        }

        private drawRoomShell() {
          this.add.image(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, "cozy-room-bg").setDisplaySize(ROOM_WIDTH, ROOM_HEIGHT).setDepth(-20);
          this.add.rectangle(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, ROOM_WIDTH, ROOM_HEIGHT, getThemeTint(roomTheme), 0.1).setDepth(-19);

          this.floorPolygon = new PhaserModule.Geom.Polygon([
            154, 238,
            810, 238,
            840, 490,
            480, 552,
            112, 490,
          ]);

          const playableArea = this.add.graphics().setDepth(-5);
          playableArea.fillStyle(0xfffcf3, 0.06);
          playableArea.fillPoints(this.floorPolygon.points, true);
          playableArea.lineStyle(3, 0xffffff, 0.24);
          playableArea.strokePoints(this.floorPolygon.points, true);
        }

        private drawAmbientMagic() {
          this.sparkleLayer = this.add.container(0, 0).setDepth(4900);
          for (let index = 0; index < 26; index += 1) {
            const sparkle = this.add.star(
              PhaserModule.Math.Between(120, 840),
              PhaserModule.Math.Between(102, 484),
              4,
              2,
              PhaserModule.Math.Between(4, 9),
              0xffffff,
              PhaserModule.Math.FloatBetween(0.18, 0.42),
            );
            sparkle.setData("drift", PhaserModule.Math.FloatBetween(0.25, 0.8));
            sparkle.setData("phase", PhaserModule.Math.FloatBetween(0, Math.PI * 2));
            this.sparkleLayer.add(sparkle);
          }
        }

        private drawBlankRoomHint(isBlank: boolean) {
          if (!isBlank) return;
          const hint = this.add.container(480, 322).setDepth(90);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.72);
          bg.fillRoundedRect(-150, -34, 300, 68, 20);
          bg.lineStyle(2, 0xf6cfd2, 0.55);
          bg.strokeRoundedRect(-150, -34, 300, 68, 20);
          hint.add(bg);
          hint.add(this.add.text(0, -8, "Blank room ready", {
            align: "center",
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "18px",
          }).setOrigin(0.5));
          hint.add(this.add.text(0, 15, "Add furniture from the drawer, then drag it on the floor.", {
            align: "center",
            color: "#84675F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "12px",
            fontStyle: "900",
          }).setOrigin(0.5));
        }

        private drawSeasonalRoomDecor() {
          if (!activeEvent) return;

          const primary = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.primary).color;
          const secondary = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.secondary).color;
          const accent = PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.accent).color;
          const decorLayer = this.add.container(0, 0).setDepth(42);

          this.add.rectangle(ROOM_WIDTH / 2, ROOM_HEIGHT / 2, ROOM_WIDTH, ROOM_HEIGHT, primary, 0.045).setDepth(-18);

          if (activeEvent.id === "halloween") {
            this.drawBunting(decorLayer, primary, secondary, true);
            this.drawPumpkin(162, 410, secondary, accent);
            this.drawPumpkin(792, 420, secondary, accent);
            this.drawFloatingMotifs(primary, 10, "bat");
            return;
          }

          if (activeEvent.id === "christmas") {
            this.drawBunting(decorLayer, secondary, activeEvent.colors.accent ? PhaserModule.Display.Color.HexStringToColor(activeEvent.colors.accent).color : primary);
            this.drawWishTree(178, 392, secondary, primary);
            this.drawSnowfall();
            return;
          }

          if (activeEvent.id === "new-year") {
            this.drawBunting(decorLayer, accent, primary);
            this.drawCountdownClock(784, 170, primary, secondary);
            this.drawFloatingMotifs(secondary, 18, "star");
            return;
          }

          this.drawBunting(decorLayer, primary, secondary);
          this.drawSparklerLantern(170, 398, primary, secondary);
          this.drawSparklerLantern(790, 398, primary, secondary);
          this.drawFloatingMotifs(secondary, 14, "firework");
        }

        private drawBunting(layer: Phaser.GameObjects.Container, primary: number, secondary: number, batShape = false) {
          const rope = this.add.graphics();
          rope.lineStyle(4, 0xffffff, 0.42);
          rope.beginPath();
          rope.moveTo(172, 118);
          for (let step = 1; step <= 24; step += 1) {
            const t = step / 24;
            const inv = 1 - t;
            const x = inv * inv * 172 + 2 * inv * t * 480 + t * t * 788;
            const y = inv * inv * 118 + 2 * inv * t * 174 + t * t * 118;
            rope.lineTo(x, y);
          }
          rope.strokePath();
          layer.add(rope);

          for (let index = 0; index < 12; index += 1) {
            const x = 196 + index * 52;
            const y = 128 + Math.sin(index / 11 * Math.PI) * 36;
            if (batShape) {
              layer.add(this.add.ellipse(x - 9, y, 22, 10, primary, 0.78));
              layer.add(this.add.ellipse(x + 9, y, 22, 10, primary, 0.78));
              layer.add(this.add.circle(x, y + 1, 5, secondary, 0.92));
            } else {
              const flag = this.add.triangle(x, y, -12, -10, 12, -10, 0, 18, index % 2 === 0 ? primary : secondary, 0.72);
              layer.add(flag);
            }
          }
        }

        private drawPumpkin(x: number, y: number, color: number, accent: number) {
          const pumpkin = this.add.container(x, y).setDepth(y);
          pumpkin.add(this.add.ellipse(0, 34, 86, 24, 0x3a2a2a, 0.13));
          pumpkin.add(this.add.ellipse(-22, 0, 42, 50, color, 0.92));
          pumpkin.add(this.add.ellipse(0, 0, 50, 56, color, 0.98));
          pumpkin.add(this.add.ellipse(22, 0, 42, 50, color, 0.92));
          pumpkin.add(this.add.rectangle(0, -32, 10, 22, 0x6e9651, 0.9).setRotation(0.25));
          const glow = this.add.circle(0, 3, 30, accent, 0.12);
          pumpkin.addAt(glow, 1);
          this.tweens.add({ targets: glow, alpha: 0.28, scale: 1.12, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
        }

        private drawWishTree(x: number, y: number, green: number, red: number) {
          const tree = this.add.container(x, y).setDepth(y);
          tree.add(this.add.ellipse(0, 54, 96, 24, 0x3a2a2a, 0.14));
          tree.add(this.add.rectangle(0, 28, 18, 64, 0x8b5e3c, 0.9));
          for (let index = 0; index < 4; index += 1) {
            tree.add(this.add.triangle(0, -48 + index * 28, -54 + index * 8, 38, 54 - index * 8, 38, 0, -34, green, 0.9));
          }
          for (let index = 0; index < 10; index += 1) {
            const light = this.add.circle(PhaserModule.Math.Between(-38, 38), PhaserModule.Math.Between(-48, 34), 4, index % 2 === 0 ? red : 0xfae3a8, 0.9);
            tree.add(light);
            this.tweens.add({ targets: light, alpha: 0.38, duration: 700 + index * 70, yoyo: true, repeat: -1 });
          }
        }

        private drawCountdownClock(x: number, y: number, primary: number, gold: number) {
          const clock = this.add.container(x, y).setDepth(y);
          clock.add(this.add.circle(0, 0, 44, 0xfffcf3, 0.92).setStrokeStyle(4, gold, 0.82));
          clock.add(this.add.text(0, -8, "12", { color: "#3A2A2A", fontFamily: "Caprasimo, Georgia, serif", fontSize: "18px" }).setOrigin(0.5));
          clock.add(this.add.rectangle(0, 12, 4, 26, primary, 0.9).setRotation(-0.6));
          this.tweens.add({ targets: clock, rotation: 0.035, duration: 900, yoyo: true, repeat: -1 });
        }

        private drawSparklerLantern(x: number, y: number, primary: number, secondary: number) {
          const lantern = this.add.container(x, y).setDepth(y);
          lantern.add(this.add.ellipse(0, 38, 74, 20, 0x3a2a2a, 0.14));
          lantern.add(this.add.rectangle(0, 0, 34, 74, 0xfffcf3, 0.86).setStrokeStyle(4, primary, 0.62));
          const glow = this.add.circle(0, 4, 34, secondary, 0.18);
          lantern.addAt(glow, 0);
          this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.34, duration: 720, yoyo: true, repeat: -1 });
        }

        private drawFloatingMotifs(color: number, count: number, kind: "star" | "bat" | "firework") {
          for (let index = 0; index < count; index += 1) {
            const x = PhaserModule.Math.Between(118, 842);
            const y = PhaserModule.Math.Between(96, 278);
            const motif =
              kind === "star"
                ? this.add.star(x, y, 5, 3, 10, color, 0.62)
                : kind === "firework"
                  ? this.add.star(x, y, 7, 2, 18, color, 0.42)
                  : this.add.ellipse(x, y, 28, 10, color, 0.52);
            motif.setDepth(4920);
            this.tweens.add({
              targets: motif,
              y: y + PhaserModule.Math.Between(-18, 18),
              alpha: 0.18,
              duration: PhaserModule.Math.Between(1100, 2200),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private drawSnowfall() {
          for (let index = 0; index < 34; index += 1) {
            const snow = this.add.circle(
              PhaserModule.Math.Between(90, 870),
              PhaserModule.Math.Between(80, 360),
              PhaserModule.Math.Between(2, 4),
              0xffffff,
              0.58,
            ).setDepth(4925);
            this.tweens.add({
              targets: snow,
              y: snow.y + PhaserModule.Math.Between(70, 140),
              x: snow.x + PhaserModule.Math.Between(-18, 18),
              alpha: 0.18,
              duration: PhaserModule.Math.Between(2800, 5200),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private updateSparkles(delta: number) {
          this.sparkleLayer.each((child: Phaser.GameObjects.GameObject) => {
            const sparkle = child as Phaser.GameObjects.Star;
            const phase = (sparkle.getData("phase") as number) + delta * 0.0016 * (sparkle.getData("drift") as number);
            sparkle.setData("phase", phase);
            sparkle.setAlpha(0.18 + Math.sin(phase) * 0.18);
            sparkle.y += Math.sin(phase) * 0.025;
          });
        }

        private createFurniture(roomPlacements: PlayablePlacement[]) {
          roomPlacements.forEach((placement) => {
            const item = this.createFurnitureObject(placement);
            this.furniture.push(item);
          });
        }

        private createFurnitureObject(placement: PlayablePlacement): FurnitureObject {
          const container = this.add.container(placement.x, placement.y).setDepth(placement.y);
          container.setSize(placement.width, placement.height);
          container.setRotation((placement.rotation * Math.PI) / 180);
          container.setScale(placement.scale);

          const shadow = this.add.ellipse(0, placement.height * 0.32, placement.width * 0.8, 24, 0x3a2a2a, 0.14);
          container.add(shadow);

          const glow = this.add.graphics();
          glow.lineStyle(4, 0xffffff, 0.95);
          glow.strokeRoundedRect(-placement.width / 2 - 6, -placement.height / 2 - 6, placement.width + 12, placement.height + 12, 18);
          glow.setVisible(false);
          container.add(glow);

          drawFurnitureShape(this, container, placement);
          // Only the room's host can rearrange furniture. Visitors keep hover
          // affordances (they can click to interact) but cannot drag.
          const canDrag = Boolean(canEditRoom && placement.floorLocked);
          container.setInteractive({ draggable: canDrag, useHandCursor: true });
          if (canDrag) {
            this.input.setDraggable(container);
          }

          const furniture: FurnitureObject = {
            placement,
            container,
            glow,
            baseY: placement.y,
          };

          container.on("pointerover", () => {
            glow.setVisible(true);
            setStatus(`${placement.label}: click to interact, drag to move.`);
          });

          container.on("pointerout", () => {
            if (this.selectedFurniture !== furniture) {
              glow.setVisible(false);
            }
          });

          container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.dragStarted = false;
            playCozyCue("place");
            this.selectFurniture(furniture);
          });

          container.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            this.dragStarted = true;
            const snapped = this.constrainToFloor(dragX, dragY);
            container.setPosition(snapped.x, snapped.y);
            furniture.placement.x = Math.round(snapped.x);
            furniture.placement.y = Math.round(snapped.y);
            this.moveBubbleToSelection();
          });

          container.on("dragend", () => {
            if (this.dragStarted) {
              setStatus(`${placement.label} moved to x ${Math.round(container.x)}, y ${Math.round(container.y)}.`);
              onPlacementsChange?.(this.exportPlacements());
            }
          });

          this.tweens.add({
            targets: container,
            y: placement.kind === "lantern" ? placement.y - 4 : placement.y,
            duration: 1800,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });

          return furniture;
        }

        private createAvatar() {
          // Keeper sized as a cozy focal point — tall enough to read clearly,
          // small enough that the room feels like a space you stand inside
          // (Webkinz keeps the pet ~1/5 of the room width).
          this.keeperCustomization = readKeeperCustomization();
          this.avatarShadow = this.add.ellipse(390, 392, 50, 18, 0x3a2a2a, 0.18).setDepth(350);
          this.avatar = this.add.container(390, 374).setDepth(374);
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
          // Companion sits a touch smaller than the keeper, like Casper
          // trotting at your heel.
          this.petCustomization = readPetCustomization();
          this.petShadow = this.add.ellipse(456, 406, 44, 15, 0x3a2a2a, 0.15).setDepth(360);
          this.pet = this.add.container(456, 388).setDepth(388);
          this.petEyes = [];
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
            duration: 950,
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
            layerUp: PhaserModule.Input.Keyboard.KeyCodes.E,
            layerDown: PhaserModule.Input.Keyboard.KeyCodes.Q,
          }) as Record<"up" | "left" | "down" | "right" | "rotate" | "layerUp" | "layerDown", Phaser.Input.Keyboard.Key> | undefined;

          this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (pointer.y < 198 || this.dragStarted) return;
            const target = this.constrainToFloor(pointer.x, pointer.y);
            this.target = new PhaserModule.Math.Vector2(target.x, target.y);
            this.petMood = "follow";
            playCozyCue("move");
            setStatus(`Walking to x ${Math.round(target.x)}, y ${Math.round(target.y)}.`);
          });
        }

        private createRealtimeBridge() {
          this.roomEmoteHandler = (event: Event) => {
            const emote = (event as CustomEvent<{ emote?: RoomEmote }>).detail?.emote;
            if (!emote) return;
            this.playRoomEmote(emote);
          };
          this.remotePlayersHandler = (event: Event) => {
            const players = (event as CustomEvent<{ players?: RealtimeRoomPlayer[] }>).detail?.players;
            this.syncRemotePlayers(players ?? []);
          };
          this.remoteEmoteHandler = (event: Event) => {
            const player = (event as CustomEvent<RealtimeRoomPlayer>).detail;
            if (!player?.id || !player.emote) return;
            this.playRemoteEmote(player);
          };
          this.keeperCustomizationHandler = (event: Event) => {
            this.keeperCustomization = (event as CustomEvent<KeeperCustomization>).detail ?? readKeeperCustomization();
            this.setAvatarPose(this.avatarPose);
          };
          this.petCustomizationHandler = (event: Event) => {
            this.petCustomization = (event as CustomEvent<PetCustomization>).detail ?? readPetCustomization();
            this.setPetPose(this.petMood === "sleep" ? "sleep" : "idle");
            this.tintPetForTone();
            this.updatePetAccessory(this.petAccessorySprite, this.petCustomization.accessory);
          };
          // Companion mood is the vitals-derived "blissful/happy/content/restless/lonely"
          // reading. We keep it cached so the pet's resting pose subtly reflects how
          // well-tended they've been — Webkinz-soul, on the canvas.
          this.companionMoodHandler = () => {
            this.companionMood = getPetMood(getPetVitals());
          };
          window.addEventListener("hearthaven:room-emote", this.roomEmoteHandler);
          window.addEventListener("hearthaven:remote-players", this.remotePlayersHandler);
          window.addEventListener("hearthaven:remote-emote", this.remoteEmoteHandler);
          window.addEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
          window.addEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
          window.addEventListener(PET_VITALS_EVENT, this.companionMoodHandler);
          const cleanup = () => {
            if (this.roomEmoteHandler) window.removeEventListener("hearthaven:room-emote", this.roomEmoteHandler);
            if (this.remotePlayersHandler) window.removeEventListener("hearthaven:remote-players", this.remotePlayersHandler);
            if (this.remoteEmoteHandler) window.removeEventListener("hearthaven:remote-emote", this.remoteEmoteHandler);
            if (this.keeperCustomizationHandler) window.removeEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
            if (this.petCustomizationHandler) window.removeEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
            if (this.companionMoodHandler) window.removeEventListener(PET_VITALS_EVENT, this.companionMoodHandler);
          };
          this.events.once("shutdown", cleanup);
          this.events.once("destroy", cleanup);
        }

        private setAvatarPose(pose: KeeperPose) {
          this.avatarPose = pose;
          this.avatarSprite?.setFrame(keeperFrame(this.keeperCustomization.paletteId, pose, this.keeperCustomization.outfitId, this.keeperCustomization.bodyId));
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

        private applyRemotePetTone(sprite: Phaser.GameObjects.Sprite, toneId: PetToneId) {
          if (toneId === "cream") {
            sprite.clearTint();
            return;
          }
          const tone = getPetTone(toneId);
          sprite.setTint(PhaserModule.Display.Color.HexStringToColor(tone.color).color);
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
            // Every remote keeper renders with their real palette + outfit, and
            // brings their real pet species + fur tone — normalized so an old
            // client that only sent `color` still resolves to a valid look.
            const custom = normalizeRemoteCustomization(player);
            const facingLeft = player.facing === "left";
            const walkFrame: KeeperPose = Math.floor(this.time.now / 180) % 2 === 0 ? "walk1" : "walk2";
            const petWalkFrame: PetPose = Math.floor(this.time.now / 200) % 2 === 0 ? "walk1" : "walk2";
            const petX = player.x + (facingLeft ? 54 : -54);
            const petY = player.y + 14;

            const existing = this.remoteAvatars.get(player.id);
            if (existing) {
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
              existing.sprite.setFrame(keeperFrame(custom.paletteId, walkFrame, custom.outfitId, custom.bodyId));
              existing.sprite.setFlipX(facingLeft);
              existing.petSprite.setFlipX(facingLeft);
              existing.petAccessorySprite.setFlipX(facingLeft);
              existing.label.setText(player.displayName);
              this.tweens.add({
                targets: existing.container,
                x: player.x,
                y: player.y,
                duration: 140,
                ease: "Sine.out",
                onComplete: () => {
                  existing.sprite.setFrame(keeperFrame(custom.paletteId, "idle", custom.outfitId, custom.bodyId));
                  existing.container.setDepth(player.y);
                },
              });
              this.tweens.add({ targets: existing.shadow, x: player.x, y: player.y + 20, duration: 140, ease: "Sine.out" });
              existing.petSprite.setFrame(petFrame(custom.petSpeciesId, petWalkFrame));
              this.tweens.add({
                targets: existing.petContainer,
                x: petX,
                y: petY,
                duration: 200,
                ease: "Sine.out",
                onComplete: () => {
                  existing.petSprite.setFrame(petFrame(custom.petSpeciesId, "idle"));
                  existing.petContainer.setDepth(petY - 1);
                },
              });
              this.tweens.add({ targets: existing.petShadow, x: petX, y: petY + 16, duration: 200, ease: "Sine.out" });
              return;
            }

            // --- new visiting keeper ---
            const color = PhaserModule.Display.Color.HexStringToColor(player.color).color;
            const shadow = this.add.ellipse(player.x, player.y + 20, 46, 16, 0x3a2a2a, 0.14).setDepth(player.y - 1);
            const container = this.add.container(player.x, player.y).setDepth(player.y);
            const aura = this.add.circle(0, -80, 13, color, 0.28);
            const sprite = this.add
              .sprite(0, -66, "keeper-animation-sheet", keeperFrame(custom.paletteId, "idle", custom.outfitId, custom.bodyId))
              .setDisplaySize(94, 141)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
            const label = this.add
              .text(0, -100, player.displayName, {
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
            const petShadow = this.add.ellipse(petX, petY + 16, 40, 13, 0x3a2a2a, 0.13).setDepth(petY - 2);
            const petContainer = this.add.container(petX, petY).setDepth(petY - 1);
            const petSprite = this.add
              .sprite(0, -36, "pet-animation-sheet", petFrame(custom.petSpeciesId, "idle"))
              .setDisplaySize(80, 90)
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
            });
          });
        }

        private playRoomEmote(emote: RoomEmote) {
          const labels: Record<RoomEmote, string> = {
            heart: "love",
            wave: "hello",
            sparkle: "sparkle",
            cozy: "cozy",
          };
          const colors: Record<RoomEmote, number> = {
            heart: 0xd87e8c,
            wave: 0x5e94b0,
            sparkle: 0xfaebc2,
            cozy: 0xc0a8dc,
          };
          playCozyCue("emote");
          onRoomEmote?.(emote);
          if (emote === "wave") this.setAvatarPose("wave");
          if (emote === "heart" || emote === "sparkle" || emote === "cozy") this.setAvatarPose("heart");
          this.avatarEmoteTimer = 1050;
          const bubble = this.add.container(this.avatar.x, this.avatar.y - 112).setDepth(7000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.95);
          bg.fillRoundedRect(-54, -22, 108, 44, 18);
          bg.lineStyle(2, colors[emote], 0.72);
          bg.strokeRoundedRect(-54, -22, 108, 44, 18);
          bubble.add(bg);
          bubble.add(this.add.text(0, 0, labels[emote], {
            align: "center",
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "13px",
            fontStyle: "900",
          }).setOrigin(0.5));
          this.playInteractionSparkles(this.avatar.x, this.avatar.y - 28, colors[emote]);
          this.tweens.add({
            targets: bubble,
            y: bubble.y - 32,
            alpha: 0,
            duration: 1200,
            ease: "Sine.out",
            onComplete: () => bubble.destroy(true),
          });
          setStatus(`You sent a ${labels[emote]} emote. Casper noticed.`);
        }

        private playRemoteEmote(player: RealtimeRoomPlayer) {
          const remote = this.remoteAvatars.get(player.id);
          if (!remote || !player.emote) return;
          const labels: Record<RoomEmote, string> = {
            heart: "love",
            wave: "hello",
            sparkle: "sparkle",
            cozy: "cozy",
          };
          const colors: Record<RoomEmote, number> = {
            heart: 0xd87e8c,
            wave: 0x5e94b0,
            sparkle: 0xfaebc2,
            cozy: 0xc0a8dc,
          };
          const bubble = this.add.container(remote.container.x, remote.container.y - 112).setDepth(7000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.95);
          bg.fillRoundedRect(-54, -22, 108, 44, 18);
          bg.lineStyle(2, colors[player.emote], 0.72);
          bg.strokeRoundedRect(-54, -22, 108, 44, 18);
          bubble.add(bg);
          bubble.add(this.add.text(0, 0, labels[player.emote], {
            align: "center",
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "13px",
            fontStyle: "900",
          }).setOrigin(0.5));
          this.playInteractionSparkles(remote.container.x, remote.container.y - 28, colors[player.emote]);
          this.tweens.add({
            targets: bubble,
            y: bubble.y - 32,
            alpha: 0,
            duration: 1200,
            ease: "Sine.out",
            onComplete: () => bubble.destroy(true),
          });
          setStatus(`${player.displayName} sent ${labels[player.emote]}.`);
        }

        private updateAvatar(delta: number) {
          const keyboard = this.readKeyboard();
          const speed = 0.23 * delta;
          let moving = false;
          // Horizontal intent this frame — drives the left/right sprite mirror.
          let moveDx = 0;

          if (keyboard.x !== 0 || keyboard.y !== 0) {
            this.target = undefined;
            const next = this.constrainToFloor(this.avatar.x + keyboard.x * speed, this.avatar.y + keyboard.y * speed);
            moveDx = next.x - this.avatar.x;
            this.avatar.setPosition(next.x, next.y);
            moving = true;
          } else if (this.target) {
            const distance = PhaserModule.Math.Distance.Between(this.avatar.x, this.avatar.y, this.target.x, this.target.y);
            if (distance < 4) {
              this.target = undefined;
            } else {
              const angle = PhaserModule.Math.Angle.Between(this.avatar.x, this.avatar.y, this.target.x, this.target.y);
              const next = this.constrainToFloor(
                this.avatar.x + Math.cos(angle) * speed,
                this.avatar.y + Math.sin(angle) * speed,
              );
              moveDx = next.x - this.avatar.x;
              this.avatar.setPosition(next.x, next.y);
              moving = true;
            }
          }

          // Face the way we're walking. A small deadzone keeps the sprite from
          // flickering when movement is almost purely vertical.
          if (moving && Math.abs(moveDx) > 0.05) {
            this.avatarFacing = moveDx < 0 ? "left" : "right";
          }
          // The keeper art is drawn facing the viewer; flipX mirrors it so it
          // reads as facing left vs right.
          this.avatarSprite.setFlipX(this.avatarFacing === "left");

          // Same guard for R / Q / E — never fire while a text input is focused.
          // Also gated by `canEditRoom`: visitors can't rotate or re-layer host furniture.
          if (canEditRoom && !isTextInputFocused()) {
            if (this.wasd?.rotate && PhaserModule.Input.Keyboard.JustDown(this.wasd.rotate)) {
              this.rotateSelectedFurniture();
            }
            if (this.wasd?.layerUp && PhaserModule.Input.Keyboard.JustDown(this.wasd.layerUp)) {
              this.changeSelectedLayer(1);
            }
            if (this.wasd?.layerDown && PhaserModule.Input.Keyboard.JustDown(this.wasd.layerDown)) {
              this.changeSelectedLayer(-1);
            }
          }

          this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
          this.avatarShadow.setDepth(this.avatar.y - 1);
          this.avatarEmoteTimer = Math.max(0, this.avatarEmoteTimer - delta);
          if (this.avatarEmoteTimer === 0) {
            this.setAvatarPose(moving ? (Math.floor(this.time.now / 180) % 2 === 0 ? "walk1" : "walk2") : "idle");
          }

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

          if (hasMoved && this.moveBroadcastTimer > 110) {
            this.moveBroadcastTimer = 0;
            this.lastSentPosition = { x: this.avatar.x, y: this.avatar.y };
            onAvatarMove?.({ ...this.lastSentPosition, facing: this.avatarFacing });
          }
        }

        private readKeyboard() {
          // Suspend movement keys while the player is typing — WASD letters
          // belong in their chat / message field, not the floor.
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

        private updatePet(delta: number) {
          this.petMoodTimer += delta;
          this.blinkTimer += delta;

          if (this.blinkTimer > 2600 && this.petMood !== "sleep") {
            this.blinkTimer = 0;
            this.petEyes.forEach((eye) => eye.setScale(1, 0.12));
            this.time.delayedCall(120, () => this.petEyes.forEach((eye) => eye.setScale(1, 1)));
          }

          if (this.petMoodTimer > 6200 && this.petMood !== "follow") {
            this.petMoodTimer = 0;
            this.petMood = this.petMood === "idle" ? "sit" : "idle";
            setStatus(this.petMood === "sit" ? "Casper sits beside the room glow." : "Casper is keeping watch.");
          }

          const desiredOffset = this.petMood === "sleep" ? { x: 180, y: -152 } : { x: 62, y: 24 };
          const targetX = this.petMood === "sleep" ? 600 : this.avatar.x + desiredOffset.x;
          const targetY = this.petMood === "sleep" ? 266 : this.avatar.y + desiredOffset.y;
          const distance = PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, targetX, targetY);
          let petMoving = false;
          const prevPetX = this.pet.x;

          if (distance > 10) {
            const followSpeed = this.petMood === "sleep" ? 0.025 : 0.055;
            this.pet.x = PhaserModule.Math.Linear(this.pet.x, targetX, followSpeed);
            this.pet.y = PhaserModule.Math.Linear(this.pet.y, targetY, followSpeed);
            petMoving = this.petMood !== "sleep";
            if (this.petMood !== "sleep") this.petMood = "follow";
          } else if (this.petMood === "follow") {
            this.petMood = "idle";
          }

          // Pet faces the way it's trotting; when idle it turns to look at the
          // keeper so the companion always feels attentive.
          const petDx = this.pet.x - prevPetX;
          if (petMoving && Math.abs(petDx) > 0.05) {
            this.petFacing = petDx < 0 ? "left" : "right";
          } else if (!petMoving && this.petMood !== "sleep") {
            this.petFacing = this.avatar.x < this.pet.x ? "left" : "right";
          }
          this.petSprite.setFlipX(this.petFacing === "left");
          this.petAccessorySprite?.setFlipX(this.petFacing === "left");

          const squish = this.petMood === "sit" ? 0.88 : this.petMood === "sleep" ? 0.7 : 1;
          this.pet.setScale(1, squish);
          this.petEyes.forEach((eye) => eye.setScale(1, this.petMood === "sleep" ? 0.1 : 1));
          // Idle pose reflects the vitals-derived companion mood: blissful pets
          // hop happily, lonely ones curl up small. Anything that's already in a
          // specific local-state mood (sleep/sit/react) keeps its pose.
          const idleMoodPose: PetPose =
            this.companionMood === "blissful" || this.companionMood === "happy"
              ? "happy"
              : this.companionMood === "restless" || this.companionMood === "lonely"
                ? "sit"
                : "idle";
          const pose: PetPose = this.petMood === "sleep"
            ? "sleep"
            : this.petMood === "sit"
              ? "sit"
              : this.petMood === "react"
                ? "happy"
                : petMoving
                  ? Math.floor(this.time.now / 180) % 2 === 0 ? "walk1" : "walk2"
                  : idleMoodPose;
          this.setPetPose(pose);

          this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
          this.petShadow.setDepth(this.pet.y - 1);
        }

        private selectFurniture(furniture: FurnitureObject) {
          this.furniture.forEach((item) => item.glow.setVisible(item === furniture));
          this.selectedFurniture = furniture;
          furniture.glow.setVisible(true);
          setSelected(furniture.placement.label);
          setStatus(`${furniture.placement.label}: drag to place, press R to rotate, Q/E to adjust depth.`);

          if (furniture.placement.kind === "bed") {
            this.petMood = "sleep";
            playCozyCue("petSleep");
            setStatus("Casper curls up near the canopy bed.");
          } else if (furniture.placement.kind === "chair") {
            this.petMood = "sit";
            playCozyCue("petPurr");
            setStatus("Casper sits beside the lavender chair.");
          } else if (["lantern", "table", "plant"].includes(furniture.placement.kind)) {
            this.petMood = "react";
            playCozyCue("petChirp");
            this.playInteractionSparkles(furniture.container.x, furniture.container.y);
          }

          this.showInteractionBubble(furniture);
        }

        private showInteractionBubble(furniture: FurnitureObject) {
          this.interactionBubble?.destroy(true);

          const bubble = this.add.container(furniture.container.x, furniture.container.y - furniture.placement.height * 0.72).setDepth(6000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.95);
          bg.fillRoundedRect(-124, -34, 248, 68, 18);
          bg.lineStyle(2, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-124, -34, 248, 68, 18);

          const label = this.add
            .text(0, -18, furniture.placement.label, {
              color: "#3A2A2A",
              fontFamily: "Nunito, sans-serif",
              fontSize: "13px",
              fontStyle: "800",
            })
            .setOrigin(0.5);

          const rotateButton = this.add
            .text(0, 12, "Rotate", {
              color: "#8E70BD",
              fontFamily: "Nunito, sans-serif",
              fontSize: "12px",
              fontStyle: "900",
              backgroundColor: "#EFE6F7",
              padding: { x: 12, y: 5 },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
          rotateButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.rotateSelectedFurniture();
          });

          const downButton = this.add
            .text(-72, 12, "Depth -", {
              color: "#5B3F3F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "12px",
              fontStyle: "900",
              backgroundColor: "#F5E9D0",
              padding: { x: 10, y: 5 },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
          downButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.changeSelectedLayer(-1);
          });

          const upButton = this.add
            .text(74, 12, "Depth +", {
              color: "#5B3F3F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "12px",
              fontStyle: "900",
              backgroundColor: "#E4EFD7",
              padding: { x: 10, y: 5 },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
          upButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.changeSelectedLayer(1);
          });

          bubble.add([bg, label, downButton, rotateButton, upButton]);
          this.interactionBubble = bubble;
        }

        private moveBubbleToSelection() {
          if (!this.interactionBubble || !this.selectedFurniture) return;
          this.interactionBubble.setPosition(
            this.selectedFurniture.container.x,
            this.selectedFurniture.container.y - this.selectedFurniture.placement.height * 0.72,
          );
        }

        private rotateSelectedFurniture() {
          if (!this.selectedFurniture) return;
          // Visitors can't edit the host's room.
          if (!canEditRoom) {
            setStatus("Only the room host can move furniture here.");
            return;
          }
          const placement = this.selectedFurniture.placement;
          placement.rotation = (placement.rotation + 45) % 360;
          this.selectedFurniture.container.setRotation((placement.rotation * Math.PI) / 180);
          playCozyCue("rotate");
          this.playInteractionSparkles(this.selectedFurniture.container.x, this.selectedFurniture.container.y);
          setStatus(`${placement.label} rotated to ${placement.rotation} degrees.`);
          onPlacementsChange?.(this.exportPlacements());
        }

        private changeSelectedLayer(delta: number) {
          if (!this.selectedFurniture) return;
          if (!canEditRoom) {
            setStatus("Only the room host can change depth here.");
            return;
          }
          const placement = this.selectedFurniture.placement;
          placement.zIndex = PhaserModule.Math.Clamp(placement.zIndex + delta, -6, 12);
          playCozyCue("place");
          this.playInteractionSparkles(
            this.selectedFurniture.container.x,
            this.selectedFurniture.container.y,
            delta > 0 ? 0xe4efd7 : 0xf5e9d0,
          );
          setStatus(`${placement.label} depth layer is now ${placement.zIndex}.`);
          onPlacementsChange?.(this.exportPlacements());
        }

        private playInteractionSparkles(x: number, y: number, color = 0xfaebc2) {
          for (let index = 0; index < 8; index += 1) {
            const sparkle = this.add.star(x, y - 24, 5, 3, 9, color, 0.9).setDepth(6200);
            this.tweens.add({
              targets: sparkle,
              x: x + PhaserModule.Math.Between(-64, 64),
              y: y - PhaserModule.Math.Between(32, 92),
              alpha: 0,
              scale: 0.2,
              duration: 760,
              ease: "Sine.out",
              onComplete: () => sparkle.destroy(),
            });
          }
        }

        private constrainToFloor(x: number, y: number) {
          const clamped = new PhaserModule.Math.Vector2(
            PhaserModule.Math.Clamp(x, 132, 828),
            PhaserModule.Math.Clamp(y, 226, 500),
          );

          if (this.floorPolygon && !PhaserModule.Geom.Polygon.Contains(this.floorPolygon, clamped.x, clamped.y)) {
            clamped.x = PhaserModule.Math.Clamp(clamped.x, 178, 782);
            clamped.y = PhaserModule.Math.Clamp(clamped.y, 250, 454);
          }

          return clamped;
        }

        private sortDepths() {
          this.avatar.setDepth(this.avatar.y);
          this.pet.setDepth(this.pet.y + (this.petMood === "sleep" ? -8 : 0));
          this.furniture.forEach((item) => {
            const baseDepth = item.placement.floorLocked
              ? item.container.y + item.placement.zIndex * 10
              : 130 + item.placement.zIndex * 10;
            item.container.setDepth(baseDepth);
          });
          this.remoteAvatars.forEach((remote) => {
            remote.container.setDepth(remote.container.y);
            remote.shadow.setDepth(remote.container.y - 1);
          });
          this.interactionBubble?.setDepth(6000);
        }

        private exportPlacements(): RoomPlacement[] {
          return this.furniture.map((item) => ({
            id: item.placement.id,
            catalogItemId: item.placement.catalogItemId,
            x: item.placement.x,
            y: item.placement.y,
            rotation: item.placement.rotation,
            scale: item.placement.scale,
            zIndex: item.placement.zIndex,
          }));
        }
      }

      game = new PhaserModule.Game({
        type: PhaserModule.AUTO,
        parent: mountRef.current,
        width: ROOM_WIDTH,
        height: ROOM_HEIGHT,
        backgroundColor: "#fbf3e2",
        scale: {
          mode: PhaserModule.Scale.FIT,
          autoCenter: PhaserModule.Scale.CENTER_BOTH,
        },
        input: {
          activePointers: 3,
        },
        scene: HeartHavenRoomScene,
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load Phaser room");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [activeEvent, canEditRoom, onAvatarMove, onPlacementsChange, onRoomEmote, placements, roomName, roomTheme]);

  return (
    <section className="overflow-hidden rounded-lg border border-cream-300 bg-cream-100 shadow-[0_24px_70px_rgba(91,63,63,0.16)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-300/70 bg-white/68 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">Playable 2.5D room</p>
          <p className="text-sm font-black text-ink-900">
            {selected}
            {activeEvent ? ` | ${activeEvent.shortName} decor active` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-cream-200 px-2.5 py-1">WASD</span>
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Click to move</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Drag furniture</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">R rotates</span>
          <span className="rounded-md bg-garden-100 px-2.5 py-1">Q/E depth</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive 2.5D room canvas with player movement, Casper, and draggable furniture"
        className="mx-auto block overflow-hidden bg-cream-100"
        role="application"
        style={{
          // Bounded box: never wider than the room's native 960px, never
          // taller than the viewport minus page chrome. Phaser's Scale.FIT
          // fits the game inside this box, so the avatar/pet/furniture stay
          // proportional instead of ballooning on wide screens.
          width: "min(100%, calc((100dvh - 330px) * 1.6), 960px)",
          aspectRatio: "960 / 600",
        }}
        tabIndex={0}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-cream-300 bg-white/72 px-4 py-3">
        <span className="text-xs font-extrabold uppercase tracking-normal text-ink-500">Quick emotes</span>
        {roomEmotes.map((item) => (
          <button
            className="rounded-md border border-blush-200 bg-blush-100 px-3 py-1.5 text-xs font-extrabold text-ink-800 shadow-sm transition-colors hover:bg-blush-200"
            key={item.emote}
            onClick={() => window.dispatchEvent(new CustomEvent("hearthaven:room-emote", { detail: { emote: item.emote } }))}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="border-t border-cream-300 bg-white/70 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}

function toPlayablePlacement(placement: RoomPlacement): PlayablePlacement {
  const kind = getFurnitureKind(placement.catalogItemId);
  const size = getFurnitureSize(kind);

  return {
    ...placement,
    label: labelFromCatalogId(placement.catalogItemId),
    kind,
    width: size.width,
    height: size.height,
    floorLocked: !["window", "shelf"].includes(kind),
  };
}

function getFurnitureKind(id: string): FurnitureKind {
  if (id.includes("rug")) return "rug";
  if (id.includes("window")) return "window";
  if (id.includes("lantern")) return "lantern";
  if (id.includes("chair")) return "chair";
  if (id.includes("bed")) return "bed";
  if (id.includes("table")) return "table";
  if (id.includes("shelf")) return "shelf";
  if (id.includes("plant")) return "plant";
  return "generic";
}

function getFurnitureSize(kind: FurnitureKind) {
  const sizes: Record<FurnitureKind, { width: number; height: number }> = {
    rug: { width: 214, height: 92 },
    window: { width: 132, height: 116 },
    lantern: { width: 58, height: 94 },
    chair: { width: 100, height: 92 },
    bed: { width: 164, height: 118 },
    table: { width: 96, height: 78 },
    shelf: { width: 128, height: 76 },
    plant: { width: 72, height: 104 },
    generic: { width: 112, height: 72 },
  };

  return sizes[kind];
}

function labelFromCatalogId(id: string) {
  return id
    .split("-")
    .filter((part) => !["cozy", "garden", "honey", "cream"].includes(part))
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function drawFurnitureShape(scene: Phaser.Scene, container: Phaser.GameObjects.Container, placement: PlayablePlacement) {
  const add = scene.add;
  const spriteFrame = getFurnitureSpriteFrame(placement.kind);

  if (spriteFrame !== undefined) {
    if (placement.kind === "lantern") {
      container.add(add.circle(0, 0, 48, 0xfaebc2, 0.16));
    }

    const size = getFurnitureSpriteDisplaySize(placement.kind);
    container.add(
      add
        .image(0, getFurnitureSpriteOffsetY(placement.kind), "cozy-furniture-sprites", spriteFrame)
        .setDisplaySize(size.width, size.height),
    );
    return;
  }

  container.add(add.rectangle(0, 0, placement.width, placement.height, 0xfffcf3).setStrokeStyle(3, 0xc9a998, 0.5));
}

function getFurnitureSpriteFrame(kind: FurnitureKind) {
  const frames: Partial<Record<FurnitureKind, number>> = {
    rug: 0,
    chair: 1,
    bed: 2,
    table: 3,
    window: 4,
    lantern: 5,
    shelf: 6,
    plant: 7,
  };

  return frames[kind];
}

function getFurnitureSpriteDisplaySize(kind: FurnitureKind) {
  // Webkinz-cozy proportions: furniture reads as decor inside a roomy space,
  // not as wall-to-wall giant props. Roughly a 0.7x pass over the old values
  // so the 960x600 room can hold several pieces with the keeper + pet still
  // the clear focal point.
  const sizes: Partial<Record<FurnitureKind, { width: number; height: number }>> = {
    rug: { width: 224, height: 150 },
    chair: { width: 122, height: 166 },
    bed: { width: 178, height: 178 },
    table: { width: 156, height: 150 },
    window: { width: 152, height: 170 },
    lantern: { width: 90, height: 160 },
    shelf: { width: 168, height: 164 },
    plant: { width: 142, height: 160 },
  };

  return sizes[kind] ?? { width: 104, height: 104 };
}

function getFurnitureSpriteOffsetY(kind: FurnitureKind) {
  // Offsets scaled to match the smaller sprites so each piece still sits with
  // its visual base on the placement anchor.
  const offsets: Partial<Record<FurnitureKind, number>> = {
    rug: -3,
    chair: -25,
    bed: -35,
    table: -25,
    window: -12,
    lantern: -25,
    shelf: -25,
    plant: -26,
  };

  return offsets[kind] ?? 0;
}

function getThemeTint(theme: RoomBlueprint["theme"]) {
  const tints: Record<RoomBlueprint["theme"], number> = {
    loft: 0xfffcf3,
    kitchen: 0xfaebc2,
    library: 0xc0a8dc,
    patio: 0xe4efd7,
    lodge: 0xf6cfd2,
    observatory: 0xc7e0eb,
  };

  return tints[theme];
}
