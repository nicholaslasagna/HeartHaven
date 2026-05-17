"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import {
  getPetAccessory,
  getPetTone,
  gaitPhase,
  keeperGaitPose,
  keeperFrame,
  keeperHairFrame,
  keeperSkinFrame,
  KEEPER_CUSTOMIZATION_EVENT,
  normalizeRemoteCustomization,
  petAccessoryFrame,
  petFrame,
  petGaitPose,
  PET_CUSTOMIZATION_EVENT,
  readKeeperCustomization,
  readPetCustomization,
  type KeeperBodyId,
  type KeeperCustomization,
  type KeeperHairColorId,
  type KeeperHairStyleId,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperPose,
  type KeeperSkinId,
  type PetAccessoryId,
  type PetCustomization,
  type PetPose,
  type PetSpeciesId,
  type PetToneId,
} from "@/lib/game/avatar-customization";
import { playCozyCue } from "@/lib/game/cozy-audio";
import type { GardenChatMessage } from "@/lib/game/chat-moderation";
import {
  PET_VITALS_EVENT,
  getPetBehavior,
  getPetMood,
  getPetVitals,
  startPetNap,
  type PetBehavior,
  type PetMood as CompanionMood,
} from "@/lib/game/pet-state";
import { defaultRoomSurfaceSelection, type RoomSurfaceSelection } from "@/lib/game/room-surfaces";
import type { FacingDirection, RealtimeRoomPlayer, RoomBlueprint, RoomEmote, RoomPlacement } from "@/lib/game/types";
import { useSeasonalEvent } from "@/lib/game/use-seasonal-event";

type RoomPortal = {
  name: string;
  href: string;
};

type RoomCanvasProps = {
  remotePlayers?: RealtimeRoomPlayer[];
  roomName?: string;
  roomTheme?: RoomBlueprint["theme"];
  placements: RoomPlacement[];
  /** When false, the keeper is a VISITOR — they can walk + emote but can't
   *  drag, face, or re-layer furniture. Defaults to true (own room). */
  canEditRoom?: boolean;
  /**
   * Optional world dimensions. When set (typically by a `RoomBlueprint`
   * with `worldWidth` + `worldHeight`), the camera scrolls inside a
   * bigger room — the same feel as the park / garden, but indoors.
   * When omitted, both default to the legacy 960×600 viewport so the
   * starter loft still fits a single screen.
  */
  worldWidth?: number;
  worldHeight?: number;
  roomPortals?: {
    left?: RoomPortal;
    right?: RoomPortal;
  };
  roomSurfaces?: RoomSurfaceSelection;
  pendingPlacementIds?: string[];
  onAvatarMove?: (position: {
    x: number;
    y: number;
    facing: FacingDirection;
    petX?: number;
    petY?: number;
    petFacing?: FacingDirection;
    controlMode?: "keeper" | "companion";
  }) => void;
  onRoomEmote?: (emote: RoomEmote) => void;
  onPlacementsChange?: (placements: RoomPlacement[]) => void;
};

type FurnitureKind = "rug" | "window" | "lantern" | "chair" | "bed" | "petBed" | "sofa" | "swing" | "table" | "shelf" | "plant" | "generic";
type FurnitureActor = "keeper" | "companion";
type FurnitureAction = "sit" | "sleep";

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
  pendingOutline: Phaser.GameObjects.Graphics;
  baseY: number;
  /** Reference to the breathing bob tween so we can pause/resume it during drag. */
  bobTween?: Phaser.Tweens.Tween;
};

type ActiveFurnitureInteraction = {
  placementId: string;
  actor: FurnitureActor;
  action: FurnitureAction;
};

type PetMood = "idle" | "follow" | "sit" | "sleep" | "react";
type KeeperAfkAnimation = "idle" | "sit" | "wave" | "heart" | "yoyo";
type RemoteAvatarObject = {
  container: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Sprite;
  skinSprite: Phaser.GameObjects.Sprite;
  hairSprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  /** Remote companion — every visiting keeper brings their own pet. */
  petContainer: Phaser.GameObjects.Container;
  petShadow: Phaser.GameObjects.Ellipse;
  petSprite: Phaser.GameObjects.Sprite;
  petAccessorySprite: Phaser.GameObjects.Sprite;
  /** Last known customization, so we only rebuild frames when it changes. */
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
  /** Pet facing (decoupled from keeper facing for companion mode). */
  petFacing: FacingDirection;
  /** Whose body the remote keeper is currently driving. */
  controlMode: "keeper" | "companion";
  movingUntil: number;
};

const ROOM_WIDTH = 960;
const ROOM_HEIGHT = 600;
const roomEmotes: { emote: RoomEmote; label: string }[] = [
  { emote: "heart", label: "Heart" },
  { emote: "wave", label: "Wave" },
  { emote: "sparkle", label: "Sparkle" },
  { emote: "cozy", label: "Cozy" },
];

function isFacingLeft(rotation: number) {
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  return normalized >= 90 && normalized < 270;
}

function facingRotation(facing: FacingDirection) {
  return facing === "left" ? 180 : 0;
}

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
  worldWidth: worldWidthProp,
  worldHeight: worldHeightProp,
  roomPortals,
  roomSurfaces = defaultRoomSurfaceSelection,
  pendingPlacementIds = [],
}: RoomCanvasProps) {
  // Bigger world for living-room-class blueprints (park-style scroll).
  // Falls back to the original fixed 960×600 viewport when the blueprint
  // doesn't opt in, so the starter Moonlit Loft still renders identically.
  const worldWidth = Math.max(ROOM_WIDTH, worldWidthProp ?? ROOM_WIDTH);
  const worldHeight = Math.max(ROOM_HEIGHT, worldHeightProp ?? ROOM_HEIGHT);
  const isLargeRoom = worldWidth > ROOM_WIDTH || worldHeight > ROOM_HEIGHT;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const remotePlayersRef = useRef(remotePlayers);
  const placementsRef = useRef(placements);
  const pendingPlacementIdsRef = useRef(pendingPlacementIds);
  const onPlacementsChangeRef = useRef(onPlacementsChange);
  const [status, setStatus] = useState("Lighting the Moonlit Loft");
  const [selected, setSelected] = useState("No item selected");
  const { activeEvent } = useSeasonalEvent();

  useEffect(() => {
    remotePlayersRef.current = remotePlayers;
    window.dispatchEvent(new CustomEvent("hearthaven:remote-players", { detail: { players: remotePlayers } }));
  }, [remotePlayers]);

  useEffect(() => {
    onPlacementsChangeRef.current = onPlacementsChange;
  }, [onPlacementsChange]);

  useEffect(() => {
    placementsRef.current = placements;
    window.dispatchEvent(new CustomEvent("hearthaven:room-placements-updated", { detail: { placements } }));
  }, [placements]);

  useEffect(() => {
    pendingPlacementIdsRef.current = pendingPlacementIds;
    window.dispatchEvent(new CustomEvent("hearthaven:room-pending-placements", { detail: { ids: pendingPlacementIds } }));
  }, [pendingPlacementIds]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      const normalizedPlacements = placementsRef.current.map(toPlayablePlacement);

      if (!mountRef.current || destroyed) return;

      class HeartHavenRoomScene extends PhaserModule.Scene {
        private avatar!: Phaser.GameObjects.Container;
        private avatarShadow!: Phaser.GameObjects.Ellipse;
        private avatarSprite!: Phaser.GameObjects.Sprite;
        private avatarSkinSprite!: Phaser.GameObjects.Sprite;
        private avatarHairSprite!: Phaser.GameObjects.Sprite;
        private avatarPose: KeeperPose = "idle";
        private avatarEmoteTimer = 0;
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
        private petEyes: Phaser.GameObjects.Ellipse[] = [];
        private petMood: PetMood = "idle";
        private petMoodTimer = 0;
        private petFacing: FacingDirection = "right";
        private companionMood: CompanionMood = getPetMood(getPetVitals());
        private companionMoodHandler?: (event: Event) => void;
        // Vitals-derived behaviour modifiers. See garden-canvas for the
        // full reasoning — same model, same five flags, applied every
        // frame in `updatePet`.
        private petBehavior: PetBehavior = getPetBehavior();
        private petFleeing = false;
        private petFleeTarget?: { x: number; y: number };
        private petWasNapping = false;
        private textInputFocused = false;
        private textInputFocusHandler?: (event: Event) => void;
        private blinkTimer = 0;
        private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
        private wasd?: Record<"up" | "left" | "down" | "right" | "rotate" | "layerUp" | "layerDown" | "remove", Phaser.Input.Keyboard.Key>;
        private target?: Phaser.Math.Vector2;
        private floorPolygon!: Phaser.Geom.Polygon;
        private furniture: FurnitureObject[] = [];
        private selectedFurniture?: FurnitureObject;
        private interactionBubble?: Phaser.GameObjects.Container;
        private keeperFurnitureInteraction?: ActiveFurnitureInteraction;
        private petFurnitureInteraction?: ActiveFurnitureInteraction;
        private dragStarted = false;
        private sparkleLayer!: Phaser.GameObjects.Container;
        private remoteAvatars = new Map<string, RemoteAvatarObject>();
        private roomEmoteHandler?: (event: Event) => void;
        private roomChatBubbleHandler?: (event: Event) => void;
        private remotePlayersHandler?: (event: Event) => void;
        private remoteEmoteHandler?: (event: Event) => void;
        private roomPlacementsHandler?: (event: Event) => void;
        private pendingPlacementsHandler?: (event: Event) => void;
        private pendingPlacementIds = new Set(pendingPlacementIdsRef.current);
        private keeperCustomizationHandler?: (event: Event) => void;
        private petCustomizationHandler?: (event: Event) => void;
        private moveBroadcastTimer = 0;
        private footstepTimer = 0;
        // Initial broadcast position. The real values are set in
        // `createAvatar` once the world dimensions are known; this is
        // just the seed for the diff check on the first frame.
        private lastSentPosition = { x: 0, y: 0 };
        private lastSentPetPosition: { x: number; y: number } | null = null;
        /**
         * Which character WASD is currently driving. Right-click on the room
         * canvas toggles between keeper and companion (the pet). Hold right-
         * click ≥500ms to recall the companion to the keeper. Same mechanic
         * as the garden canvas — the two scenes share the model so the
         * player builds the muscle memory once.
         */
        private playMode: "keeper" | "companion" = "keeper";
        private rightButtonDownAt = 0;
        private rightHoldFired = false;
        private playModeBadge?: Phaser.GameObjects.Container;
        /** Idle pet breathing tween. Paused while controlling the companion. */
        private petBobTween?: Phaser.Tweens.Tween;
        private portalHotspots: Array<{ x: number; y: number; portal: RoomPortal; side: "left" | "right" }> = [];
        private portalTraveling = false;

        constructor() {
          super("HeartHavenRoom");
        }

        preload() {
          this.load.image("cozy-room-bg", "/game-assets/generated/cozy-room-bg.png");
          this.load.image("room-wall-surface", roomSurfaces.wall.asset);
          this.load.image("room-floor-surface", roomSurfaces.floor.asset);
          this.load.image("keeper-sprite", "/game-assets/generated/keeper-sprite.png");
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
          this.load.spritesheet("cozy-furniture-sprites", "/game-assets/generated/cozy-furniture-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
          this.load.image("furniture-canopy-bed", "/game-assets/generated/furniture/canopy-bed.png");
          this.load.image("furniture-blush-loveseat", "/game-assets/generated/furniture/blush-loveseat.png");
          this.load.image("furniture-moonberry-pet-bed", "/game-assets/generated/furniture/moonberry-pet-bed.png");
          this.load.image("furniture-garden-swing", "/game-assets/generated/furniture/garden-swing-bench.png");
          this.load.image("furniture-honey-tea-set", "/game-assets/generated/furniture/honey-tea-set.png");
          this.load.image("furniture-lavender-armchair", "/game-assets/generated/furniture/lavender-armchair-v2.png");
        }

        create() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          // Big-room camera setup. Setting the camera bounds to the
          // configured world size lets the 960×600 viewport scroll
          // through anything bigger — exact same trick the garden /
          // park canvas uses. We center the camera on the avatar so
          // the host's perspective always follows them.
          this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
          this.drawRoomShell();
          this.drawRoomPortals();
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
          // Only enable camera follow when the world is bigger than the
          // viewport. Otherwise the camera stays put and the 2.5D room
          // looks identical to its single-screen heritage.
          if (isLargeRoom) {
            this.cameras.main.startFollow(this.avatar, true, 0.08, 0.08);
            this.cameras.main.setDeadzone(160, 110);
          }

          this.add
            .text(34, 30, roomName, {
              color: "#3A2A2A",
              fontFamily: "Nunito, sans-serif",
              fontSize: "22px",
              fontStyle: "800",
            })
            .setDepth(5000);

          this.add
            .text(34, 58, "Click or WASD to move. Drag furniture. R flips left/right. Q/E adjusts 2.5D depth.", {
              color: "#84675F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "13px",
              fontStyle: "700",
            })
            .setDepth(5000);

          setStatus(activeEvent?.roomMessage ?? "Click the floor to move. Hover, drag, click, and face furniture left/right.");
          // TODO: Persist furniture edits through Supabase Realtime room sessions for collaborative decorating.
          // TODO: Save mutable placement state to Supabase placed_items after drag/facing interactions.
        }

        update(_time: number, delta: number) {
          this.checkRightHold();
          this.updateAvatar(delta);
          this.updatePet(delta);
          this.updateRemoteAvatarAnimation();
          this.updateSparkles(delta);
          this.sortDepths();
        }

        private drawRoomShell() {
          // The 2.5D room shell scales with the configured world. For a
          // starter loft this is still 960×600; for a Great Hall it might
          // be 2880×880 and the camera scrolls inside it.
          this.add
            .image(worldWidth / 2, worldHeight / 2, "cozy-room-bg")
            .setDisplaySize(worldWidth, worldHeight)
            .setDepth(-20);
          this.add
            .rectangle(worldWidth / 2, worldHeight / 2, worldWidth, worldHeight, getThemeTint(roomTheme), 0.1)
            .setDepth(-19);

          // Build a floor polygon that fills most of the world width so
          // big living rooms don't end up with a tiny playable square in
          // the middle. The original starter ratios are preserved on a
          // 960×600 room — for bigger rooms we scale the corner inset
          // proportionally to width.
          const wallTop = Math.round(worldHeight * 0.4);
          const floorBottom = Math.round(worldHeight * 0.92);
          const floorMidY = Math.round(worldHeight * 0.82);
          const insetTop = Math.max(120, Math.round(worldWidth * 0.07));
          const insetBottom = Math.max(80, Math.round(worldWidth * 0.05));
          this.floorPolygon = new PhaserModule.Geom.Polygon([
            insetTop, wallTop,
            worldWidth - insetTop, wallTop,
            worldWidth - insetBottom, floorBottom - 12,
            worldWidth / 2, floorBottom,
            insetBottom, floorBottom - 12,
            insetBottom, floorMidY,
          ]);

          const wallSurface = this.add
            .tileSprite(worldWidth / 2, wallTop / 2, worldWidth, wallTop + 12, "room-wall-surface")
            .setDepth(-18)
            .setAlpha(0.92);
          wallSurface.setTileScale(0.72, 0.72);
          this.add
            .rectangle(worldWidth / 2, wallTop - 8, worldWidth, 18, 0x3a2a2a, 0.08)
            .setDepth(-16);

          const floorHeight = Math.max(1, floorBottom - wallTop + 72);
          const floorSurface = this.add
            .tileSprite(worldWidth / 2, wallTop + floorHeight / 2 - 18, worldWidth, floorHeight, "room-floor-surface")
            .setDepth(-17)
            .setAlpha(0.96);
          floorSurface.setTileScale(0.78, 0.78);
          const floorMask = this.make.graphics({ x: 0, y: 0 });
          floorMask.fillStyle(0xffffff, 1);
          floorMask.fillPoints(this.floorPolygon.points, true);
          floorSurface.setMask(floorMask.createGeometryMask());

          this.add
            .rectangle(worldWidth / 2, wallTop / 2, worldWidth, wallTop + 14, 0xffffff, 0.1)
            .setDepth(-15);
          this.add
            .rectangle(worldWidth / 2, wallTop + floorHeight / 2 - 18, worldWidth, floorHeight, getThemeTint(roomTheme), 0.06)
            .setDepth(-14)
            .setMask(floorMask.createGeometryMask());

          const playableArea = this.add.graphics().setDepth(-5);
          playableArea.fillStyle(0xfffcf3, 0.06);
          playableArea.fillPoints(this.floorPolygon.points, true);
          playableArea.lineStyle(3, 0xffffff, 0.24);
          playableArea.strokePoints(this.floorPolygon.points, true);
        }

        private drawRoomPortals() {
          const configs: Array<{ side: "left" | "right"; x: number; y: number; portal?: RoomPortal }> = [
            { side: "left", x: Math.max(176, Math.round(worldWidth * 0.095)), y: Math.round(worldHeight * 0.62), portal: roomPortals?.left },
            { side: "right", x: Math.min(worldWidth - 176, Math.round(worldWidth * 0.905)), y: Math.round(worldHeight * 0.62), portal: roomPortals?.right },
          ];

          configs.forEach((config) => {
            if (!config.portal) return;
            const target = this.constrainToFloor(config.x, config.y);
            const archX = config.side === "left" ? Math.max(70, target.x - 54) : Math.min(worldWidth - 70, target.x + 54);
            const door = this.add.container(target.x, target.y).setDepth(92);
            const glow = this.add.ellipse(0, 34, 118, 38, 0xfaebc2, 0.26);
            const pad = this.add.ellipse(0, 38, 86, 24, 0x3a2a2a, 0.12);
            const arch = this.add.graphics();
            arch.fillStyle(0xfffcf3, 0.72);
            arch.fillRoundedRect(archX - target.x - 32, -118, 64, 132, 30);
            arch.lineStyle(3, 0xc0a8dc, 0.58);
            arch.strokeRoundedRect(archX - target.x - 32, -118, 64, 132, 30);
            const arrow = this.add
              .text(config.side === "left" ? -38 : 38, -40, config.side === "left" ? "‹" : "›", {
                color: "#8E70BD",
                fontFamily: "Caprasimo, Georgia, serif",
                fontSize: "42px",
              })
              .setOrigin(0.5);
            const label = this.add
              .text(0, 72, config.portal.name, {
                align: "center",
                color: "#5B3F3F",
                fontFamily: "Nunito, sans-serif",
                fontSize: "12px",
                fontStyle: "900",
                wordWrap: { width: 132 },
              })
              .setOrigin(0.5);
            door.add([glow, pad, arch, arrow, label]);

            this.tweens.add({
              targets: glow,
              alpha: 0.42,
              scaleX: 1.14,
              scaleY: 1.08,
              duration: 960,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });

            const zone = this.add.zone(target.x, target.y, 132, 178).setInteractive({ useHandCursor: true });
            zone.setDepth(95);
            zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
              pointer.event.stopPropagation();
              this.target = new PhaserModule.Math.Vector2(target.x, target.y);
              playCozyCue("move");
              setStatus(`Walking to ${config.portal?.name}.`);
            });

            this.portalHotspots.push({
              x: target.x,
              y: target.y,
              portal: config.portal,
              side: config.side,
            });
          });
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

          this.add.rectangle(worldWidth / 2, worldHeight / 2, worldWidth, worldHeight, primary, 0.045).setDepth(-18);

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
          container.setRotation(0);
          container.setScale(isFacingLeft(placement.rotation) ? -placement.scale : placement.scale, placement.scale);

          const shadow = this.add.ellipse(0, placement.height * 0.32, placement.width * 0.8, 24, 0x3a2a2a, 0.14);
          container.add(shadow);

          const glow = this.add.graphics();
          glow.lineStyle(4, 0xffffff, 0.95);
          glow.strokeRoundedRect(-placement.width / 2 - 6, -placement.height / 2 - 6, placement.width + 12, placement.height + 12, 18);
          glow.setVisible(false);
          container.add(glow);

          const pendingOutline = this.add.graphics();
          pendingOutline.setVisible(false);
          container.add(pendingOutline);

          drawFurnitureShape(this, container, placement);
          // Hosts and approved decorators can rearrange both floor AND wall
          // items. Visitors still get the hover affordance (so they can see
          // labels) but cannot drag. The previous code gated drag on
          // `floorLocked`, which meant wall items (windows, shelves) were
          // impossible to move — that's the "only x-axis works" bug.
          const canDrag = Boolean(canEditRoom);
          container.setInteractive({ draggable: canDrag, useHandCursor: true });
          if (canDrag) {
            this.input.setDraggable(container);
          }

          const furniture: FurnitureObject = {
            placement,
            container,
            glow,
            pendingOutline,
            baseY: placement.y,
          };
          this.applyPendingStyle(furniture);

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

          container.on("dragstart", () => {
            // Kill the breathing tween while the player is moving the piece
            // — otherwise the tween keeps lerping the container's y back
            // toward its captured baseline, which is why drag previously
            // only seemed to work on the x-axis.
            if (furniture.bobTween) {
              furniture.bobTween.stop();
              furniture.bobTween = undefined;
            }
          });

          container.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            this.dragStarted = true;
            const snapped = this.constrainForPlacement(placement, dragX, dragY);
            container.setPosition(snapped.x, snapped.y);
            furniture.placement.x = Math.round(snapped.x);
            furniture.placement.y = Math.round(snapped.y);
            // Update depth live so closer-to-camera pieces correctly occlude
            // farther-back ones during the drag (the 2.5D occlusion fix).
            container.setDepth(furniture.placement.floorLocked ? snapped.y + furniture.placement.zIndex * 10 : 130 + furniture.placement.zIndex * 10);
            this.moveBubbleToSelection();
          });

          container.on("dragend", () => {
            if (this.dragStarted) {
              furniture.baseY = furniture.placement.y;
              setStatus(`${placement.label} moved to x ${Math.round(container.x)}, y ${Math.round(container.y)}.`);
              onPlacementsChangeRef.current?.(this.exportPlacements());
              // Restart the breathing tween relative to the new resting y so
              // the bob continues to feel "alive" without snapping the piece
              // back to its old position.
              furniture.bobTween = this.tweens.add({
                targets: container,
                y: placement.kind === "lantern" ? furniture.baseY - 4 : furniture.baseY,
                duration: 1800,
                yoyo: true,
                repeat: -1,
                ease: "Sine.inOut",
              });
            }
          });

          furniture.bobTween = this.tweens.add({
            targets: container,
            y: placement.kind === "lantern" ? placement.y - 4 : placement.y,
            duration: 1800,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });

          return furniture;
        }

        private syncPlacements(nextPlacements: RoomPlacement[]) {
          const nextPlayable = nextPlacements.map(toPlayablePlacement);
          const nextById = new Map(nextPlayable.map((placement) => [placement.id, placement]));

          for (const item of [...this.furniture]) {
            if (!nextById.has(item.placement.id)) {
              item.bobTween?.stop();
              item.container.destroy(true);
              this.furniture = this.furniture.filter((entry) => entry !== item);
              if (this.selectedFurniture === item) {
                this.selectedFurniture = undefined;
                this.interactionBubble?.destroy(true);
                this.interactionBubble = undefined;
                setSelected("No item selected");
              }
            }
          }

          for (const nextPlacement of nextPlayable) {
            const existing = this.findFurnitureById(nextPlacement.id);
            if (!existing) {
              const created = this.createFurnitureObject(nextPlacement);
              this.furniture.push(created);
              continue;
            }

            if (existing.placement.catalogItemId !== nextPlacement.catalogItemId) {
              existing.bobTween?.stop();
              existing.container.destroy(true);
              this.furniture = this.furniture.filter((entry) => entry !== existing);
              const replacement = this.createFurnitureObject(nextPlacement);
              this.furniture.push(replacement);
              continue;
            }

            Object.assign(existing.placement, nextPlacement);
            existing.bobTween?.stop();
            existing.bobTween = undefined;
            existing.container.setPosition(nextPlacement.x, nextPlacement.y);
            existing.container.setSize(nextPlacement.width, nextPlacement.height);
            existing.container.setRotation(0);
            existing.container.setScale(
              isFacingLeft(nextPlacement.rotation) ? -nextPlacement.scale : nextPlacement.scale,
              nextPlacement.scale,
            );
            existing.baseY = nextPlacement.y;
            existing.bobTween = this.tweens.add({
              targets: existing.container,
              y: nextPlacement.kind === "lantern" ? existing.baseY - 4 : existing.baseY,
              duration: 1800,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
            this.applyPendingStyle(existing);
          }

          this.sortDepths();
          this.moveBubbleToSelection();
        }

        private updatePendingPlacements(ids: string[]) {
          this.pendingPlacementIds = new Set(ids);
          this.furniture.forEach((item) => this.applyPendingStyle(item));
        }

        private applyPendingStyle(item: FurnitureObject) {
          const isPending = this.pendingPlacementIds.has(item.placement.id);
          item.container.setAlpha(isPending ? 0.7 : 1);
          item.pendingOutline.clear();
          item.pendingOutline.setVisible(isPending);
          if (!isPending) return;

          const width = item.placement.width + 18;
          const height = item.placement.height + 18;
          item.pendingOutline.lineStyle(3, 0xc685a2, 0.9);
          item.pendingOutline.strokeRoundedRect(-width / 2, -height / 2, width, height, 20);
          item.pendingOutline.lineStyle(2, 0xffffff, 0.9);
          for (let x = -width / 2 + 10; x < width / 2 - 8; x += 22) {
            item.pendingOutline.lineBetween(x, -height / 2, x + 10, -height / 2);
            item.pendingOutline.lineBetween(x, height / 2, x + 10, height / 2);
          }
          for (let y = -height / 2 + 10; y < height / 2 - 8; y += 22) {
            item.pendingOutline.lineBetween(-width / 2, y, -width / 2, y + 10);
            item.pendingOutline.lineBetween(width / 2, y, width / 2, y + 10);
          }
        }

        /**
         * Drag-clamp that respects whether the placement is a floor item or a
         * wall item. Floor items use the existing floor polygon. Wall items
         * are kept within the upper wall band so a window can't end up on
         * the rug, but they can slide freely across the back wall horizontally.
         */
        private constrainForPlacement(
          placement: PlayablePlacement,
          x: number,
          y: number,
        ): Phaser.Math.Vector2 {
          if (placement.floorLocked) {
            return this.constrainToFloor(x, y);
          }
          return new PhaserModule.Math.Vector2(
            PhaserModule.Math.Clamp(x, 140, 820),
            PhaserModule.Math.Clamp(y, 100, 220),
          );
        }

        private createAvatar() {
          // Keeper sized as a cozy focal point — tall enough to read clearly,
          // small enough that the room feels like a space you stand inside
          // (Webkinz keeps the pet ~1/5 of the room width).
          // Start the keeper centered horizontally in the world so big
          // rooms don't have everyone clumped in the same corner — the
          // 0.4 vertical ratio keeps them on the front half of the floor
          // for the same 2.5D feel as the original 960×600 layout.
          this.keeperCustomization = readKeeperCustomization();
          const startX = Math.round(worldWidth * 0.4);
          const startY = Math.round(worldHeight * 0.62);
          this.avatarShadow = this.add.ellipse(startX, startY + 18, 50, 18, 0x3a2a2a, 0.18).setDepth(startY - 24);
          this.avatar = this.add.container(startX, startY).setDepth(startY);
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
              keeperFrame(this.keeperCustomization.paletteId, "idle", this.keeperCustomization.outfitId, this.keeperCustomization.bodyId),
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

          // A very gentle breathing motion. 0.6px over 3.2s reads as
          // "alive" without making the pet feel restless or jittery. Held
          // in a field so we can pause it when the player swaps to control
          // the companion — otherwise the yoyo lerps Y back every frame
          // and vertical movement looks broken.
          this.petBobTween = this.tweens.add({
            targets: this.pet,
            y: this.pet.y - 0.6,
            duration: 3200,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createInput() {
          this.input.keyboard?.disableGlobalCapture();
          this.input.mouse?.disableContextMenu();
          this.cursors = this.input.keyboard?.createCursorKeys();
          this.wasd = this.input.keyboard?.addKeys({
            up: PhaserModule.Input.Keyboard.KeyCodes.W,
            left: PhaserModule.Input.Keyboard.KeyCodes.A,
            down: PhaserModule.Input.Keyboard.KeyCodes.S,
            right: PhaserModule.Input.Keyboard.KeyCodes.D,
            rotate: PhaserModule.Input.Keyboard.KeyCodes.R,
            layerUp: PhaserModule.Input.Keyboard.KeyCodes.E,
            layerDown: PhaserModule.Input.Keyboard.KeyCodes.Q,
            remove: PhaserModule.Input.Keyboard.KeyCodes.DELETE,
          }) as Record<"up" | "left" | "down" | "right" | "rotate" | "layerUp" | "layerDown" | "remove", Phaser.Input.Keyboard.Key> | undefined;

          this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (pointer.rightButtonDown()) {
              this.rightButtonDownAt = this.time.now;
              this.rightHoldFired = false;
              return;
            }
            // The top-band cutoff (originally 198 for a 600-tall world)
            // keeps clicks on the wall art from teleporting the keeper.
            // Scales with the world so big rooms don't accidentally
            // ignore most of the upper half.
            if (pointer.y < worldHeight * 0.33 || this.dragStarted) return;
            const target = this.constrainToFloor(pointer.x, pointer.y);
            this.clearFurnitureInteraction("keeper");
            if (this.playMode === "companion") this.clearFurnitureInteraction("companion");
            this.target = new PhaserModule.Math.Vector2(target.x, target.y);
            if (this.playMode !== "companion") this.petMood = "follow";
            playCozyCue("move");
            setStatus(`Walking to x ${Math.round(target.x)}, y ${Math.round(target.y)}.`);
          });

          this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
            if (pointer.button !== 2) return;
            if (this.rightHoldFired) {
              this.rightHoldFired = false;
              return;
            }
            this.togglePlayMode();
          });

          this.drawPlayModeBadge();
        }

        private togglePlayMode() {
          this.playMode = this.playMode === "keeper" ? "companion" : "keeper";
          this.target = undefined;
          if (this.playMode === "companion") {
            this.petMood = "idle";
            setStatus("Playing as your companion. Right-click to swap back.");
            playCozyCue("petChirp");
            // Pause the breathing yoyo so vertical input isn't immediately
            // overwritten — this is the bug that made the companion feel
            // like it could only move sideways.
            this.petBobTween?.pause();
          } else {
            setStatus("Back in your keeper. Right-click to swap to your companion.");
            playCozyCue("score");
            this.petBobTween?.resume();
          }
          this.updatePlayModeBadge();
        }

        private recallCompanion() {
          if (!this.pet || !this.avatar) return;
          this.clearFurnitureInteraction("companion");
          this.pet.setPosition(this.avatar.x + 54, this.avatar.y + 24);
          this.petMood = "follow";
          this.petMoodTimer = 0;
          playCozyCue("petChirp");
          setStatus("Whistled the companion back to you.");
        }

        private drawPlayModeBadge() {
          const badge = this.add.container(20, 88).setScrollFactor(0).setDepth(10000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.95);
          bg.fillRoundedRect(0, 0, 220, 36, 18);
          bg.lineStyle(2, 0xc0a8dc, 0.85);
          bg.strokeRoundedRect(0, 0, 220, 36, 18);
          const label = this.add.text(14, 8, "PLAYING AS", {
            color: "#8E70BD",
            fontFamily: "Nunito, sans-serif",
            fontSize: "10px",
            fontStyle: "900",
          });
          const value = this.add
            .text(86, 6, "Keeper", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "14px",
            })
            .setName("playmode-value");
          const hint = this.add.text(14, 22, "Right-click to swap · hold to recall", {
            color: "#84675F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "10px",
            fontStyle: "800",
          });
          badge.add([bg, label, value, hint]);
          this.playModeBadge = badge;
        }

        private updatePlayModeBadge() {
          if (!this.playModeBadge) return;
          const value = this.playModeBadge.getByName("playmode-value") as Phaser.GameObjects.Text | undefined;
          if (value) value.setText(this.playMode === "companion" ? "Companion" : "Keeper");
        }

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

        private createRealtimeBridge() {
          this.roomEmoteHandler = (event: Event) => {
            const emote = (event as CustomEvent<{ emote?: RoomEmote }>).detail?.emote;
            if (!emote) return;
            this.playRoomEmote(emote);
          };
          this.roomChatBubbleHandler = (event: Event) => {
            const message = (event as CustomEvent<GardenChatMessage>).detail;
            if (message?.text) this.showChatBubble(message);
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
          this.roomPlacementsHandler = (event: Event) => {
            const next = (event as CustomEvent<{ placements?: RoomPlacement[] }>).detail?.placements;
            if (!Array.isArray(next)) return;
            this.syncPlacements(next);
          };
          this.pendingPlacementsHandler = (event: Event) => {
            const ids = (event as CustomEvent<{ ids?: string[] }>).detail?.ids;
            this.updatePendingPlacements(Array.isArray(ids) ? ids : []);
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
          // well-tended they've been — Webkinz-soul, on the canvas. The same handler
          // refreshes the behaviour cache (speed/dirty/disobeys/exhaustion).
          this.companionMoodHandler = () => {
            const vitals = getPetVitals();
            this.companionMood = getPetMood(vitals);
            this.petBehavior = getPetBehavior(vitals);
            this.applyPetAppearance();
          };
          this.textInputFocusHandler = (event: Event) => {
            this.textInputFocused = Boolean((event as CustomEvent<boolean>).detail);
          };
          window.addEventListener("hearthaven:room-emote", this.roomEmoteHandler);
          window.addEventListener("hearthaven:room-chat-bubble", this.roomChatBubbleHandler);
          window.addEventListener("hearthaven:remote-players", this.remotePlayersHandler);
          window.addEventListener("hearthaven:remote-emote", this.remoteEmoteHandler);
          window.addEventListener("hearthaven:room-placements-updated", this.roomPlacementsHandler);
          window.addEventListener("hearthaven:room-pending-placements", this.pendingPlacementsHandler);
          window.addEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
          window.addEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
          window.addEventListener(PET_VITALS_EVENT, this.companionMoodHandler);
          window.addEventListener("hearthaven:text-input-focus", this.textInputFocusHandler);
          const cleanup = () => {
            this.clearAfkEffect();
            if (this.roomEmoteHandler) window.removeEventListener("hearthaven:room-emote", this.roomEmoteHandler);
            if (this.roomChatBubbleHandler) window.removeEventListener("hearthaven:room-chat-bubble", this.roomChatBubbleHandler);
            if (this.remotePlayersHandler) window.removeEventListener("hearthaven:remote-players", this.remotePlayersHandler);
            if (this.remoteEmoteHandler) window.removeEventListener("hearthaven:remote-emote", this.remoteEmoteHandler);
            if (this.roomPlacementsHandler) window.removeEventListener("hearthaven:room-placements-updated", this.roomPlacementsHandler);
            if (this.pendingPlacementsHandler) window.removeEventListener("hearthaven:room-pending-placements", this.pendingPlacementsHandler);
            if (this.keeperCustomizationHandler) window.removeEventListener(KEEPER_CUSTOMIZATION_EVENT, this.keeperCustomizationHandler);
            if (this.petCustomizationHandler) window.removeEventListener(PET_CUSTOMIZATION_EVENT, this.petCustomizationHandler);
            if (this.companionMoodHandler) window.removeEventListener(PET_VITALS_EVENT, this.companionMoodHandler);
            if (this.textInputFocusHandler) window.removeEventListener("hearthaven:text-input-focus", this.textInputFocusHandler);
            // Stop the pet breathing tween so the scene can be garbage
            // collected without a dangling tween targeting destroyed sprites.
            this.petBobTween?.stop();
            this.petBobTween = undefined;
            // Same treatment for every furniture bob tween. Without this,
            // a room un-mount mid-tween left a handful of yoyo'ing tweens
            // pointed at destroyed containers — Phaser swallows the
            // error but the console gets noisy on every navigation.
            for (const item of this.furniture) {
              item.bobTween?.stop();
              item.bobTween = undefined;
            }
          };
          this.events.once("shutdown", cleanup);
          this.events.once("destroy", cleanup);
        }

        private setAvatarPose(pose: KeeperPose) {
          this.avatarPose = pose;
          this.avatarSprite?.setFrame(keeperFrame(this.keeperCustomization.paletteId, pose, this.keeperCustomization.outfitId, this.keeperCustomization.bodyId));
          this.avatarSkinSprite?.setFrame(keeperSkinFrame(pose, this.keeperCustomization.outfitId, this.keeperCustomization.bodyId));
          this.avatarHairSprite?.setFrame(keeperHairFrame(this.keeperCustomization.hairStyleId, pose, this.keeperCustomization.bodyId));
          this.applyKeeperLayerTints();
        }

        private applyKeeperLayerTints() {
          // The current keeper sheet is full painterly art. The old mask tint
          // pass produced visible "paint spill" over the face/hair on several
          // skin and hair choices, so we keep those layers transparent until
          // full generated variant sheets replace them.
          this.avatarSprite?.clearTint().setAlpha(1);
          this.avatarSkinSprite
            ?.clearTint()
            .setAlpha(0)
            .setDepth((this.avatarSprite?.depth ?? 0) + 1);
          this.avatarHairSprite
            ?.clearTint()
            .setAlpha(0)
            .setDepth((this.avatarSprite?.depth ?? 0) + 2);
        }

        private setKeeperLayerFlip(facing: FacingDirection) {
          const flip = facing === "left";
          this.avatarSprite?.setFlipX(flip);
          this.avatarSkinSprite?.setFlipX(flip);
          this.avatarHairSprite?.setFlipX(flip);
        }

        private setKeeperLayerMotion(y: number, rotation: number) {
          [this.avatarSkinSprite, this.avatarSprite, this.avatarHairSprite].forEach((sprite) => {
            sprite?.setY(y).setRotation(rotation);
          });
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
          this.afkNextAt = PhaserModule.Math.Between(4200, 7600);
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
            this.setAvatarPose("idle");
            this.setKeeperLayerMotion(-66, 0);
            this.avatarShadow?.setScale(1, 1);
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
          const tilt = wave * 0.018 * (this.avatarFacing === "left" ? -1 : 1);
          this.setAvatarPose(keeperGaitPose(this.time.now));
          this.setKeeperLayerMotion(-66 - Math.abs(wave) * 3, tilt);
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
          const tilt = wave * 0.03 * (this.petFacing === "left" ? -1 : 1);
          this.setPetPose(petGaitPose(this.time.now + 90));
          this.petSprite.setY(-40 - Math.abs(wave) * 2.5).setRotation(tilt);
          this.petShadow?.setScale(1 + Math.abs(wave) * 0.08, 1);
        }

        private updateRemoteAvatarAnimation() {
          this.remoteAvatars.forEach((remote) => {
            const moving = this.time.now < remote.movingUntil;
            const facingLeft = remote.facing === "left";
            this.setRemoteKeeperFlip(remote, facingLeft);
            remote.petSprite.setFlipX(facingLeft);
            remote.petAccessorySprite.setFlipX(facingLeft);

            if (!moving) {
              this.setRemoteKeeperFrame(remote, "idle");
              this.setRemoteKeeperMotion(remote, -66, 0);
              remote.petSprite
                .setFrame(petFrame(remote.petSpeciesId, "idle"))
                .setY(-36)
                .setRotation(0);
              remote.shadow.setScale(1, 1);
              remote.petShadow.setScale(1, 1);
              return;
            }

            const wave = Math.sin(gaitPhase(this.time.now) * Math.PI * 2);
            const petWave = Math.sin(gaitPhase(this.time.now + 90) * Math.PI * 2);
            this.setRemoteKeeperFrame(remote, keeperGaitPose(this.time.now));
            this.setRemoteKeeperMotion(remote, -66 - Math.abs(wave) * 3, wave * 0.018 * (facingLeft ? -1 : 1));
            remote.petSprite
              .setFrame(petFrame(remote.petSpeciesId, petGaitPose(this.time.now + 90)))
              .setY(-36 - Math.abs(petWave) * 2.2)
              .setRotation(petWave * 0.03 * (facingLeft ? -1 : 1));
            remote.shadow.setScale(1 + Math.abs(wave) * 0.08, 1);
            remote.petShadow.setScale(1 + Math.abs(petWave) * 0.08, 1);
          });
        }

        private setRemoteKeeperFlip(remote: RemoteAvatarObject, facingLeft: boolean) {
          remote.sprite.setFlipX(facingLeft);
          remote.skinSprite.setFlipX(facingLeft);
          remote.hairSprite.setFlipX(facingLeft);
        }

        private setRemoteKeeperFrame(remote: RemoteAvatarObject, pose: KeeperPose) {
          remote.sprite.setFrame(keeperFrame(remote.paletteId, pose, remote.outfitId, remote.bodyId));
          remote.skinSprite.setFrame(keeperSkinFrame(pose, remote.outfitId, remote.bodyId));
          remote.hairSprite.setFrame(keeperHairFrame(remote.hairStyleId, pose, remote.bodyId));
          this.applyRemoteKeeperTints(remote);
        }

        private setRemoteKeeperMotion(remote: RemoteAvatarObject, y: number, rotation: number) {
          [remote.skinSprite, remote.sprite, remote.hairSprite].forEach((sprite) => {
            sprite.setY(y).setRotation(rotation);
          });
        }

        private applyRemoteKeeperTints(remote: RemoteAvatarObject) {
          // Match local keeper logic: keep legacy tint masks hidden so remote
          // avatars do not get the broken blotchy overlay either.
          remote.sprite.clearTint().setAlpha(1);
          remote.skinSprite
            .clearTint()
            .setAlpha(0)
            .setDepth(remote.sprite.depth + 1);
          remote.hairSprite
            .clearTint()
            .setAlpha(0)
            .setDepth(remote.sprite.depth + 2);
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
          bubble.add(this.add.text(0, -9, message.text, {
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

        private tintPetForTone() {
          this.applyPetAppearance();
        }

        /** Combine the customisation tone with a muddy overlay when the
         *  pet is dirty. Same logic as garden-canvas — single tint per
         *  sprite, dirty wins. */
        private applyPetAppearance() {
          if (!this.petSprite) return;
          if (this.petBehavior.dirty) {
            const muddy = PhaserModule.Display.Color.HexStringToColor("#7A5A3F").color;
            this.petSprite.setTint(muddy);
            return;
          }
          if (this.petCustomization.toneId === "cream") {
            this.petSprite.clearTint();
            return;
          }
          const tone = getPetTone(this.petCustomization.toneId);
          const tint = PhaserModule.Display.Color.HexStringToColor(tone.color).color;
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
            let facingLeft = player.facing === "left";

            const existing = this.remoteAvatars.get(player.id);
            if (existing) {
              const distance = PhaserModule.Math.Distance.Between(existing.container.x, existing.container.y, player.x, player.y);
              const dx = player.x - existing.container.x;
              if (Math.abs(dx) > 2) facingLeft = dx < 0;
              existing.facing = facingLeft ? "left" : "right";
              existing.movingUntil = distance > 2 ? this.time.now + 280 : this.time.now;
              // Honor broadcast pet position when present — companion-mode
              // movement only updates `petX`/`petY`, not the keeper's
              // coords. Fall back to the auto-trailing offset for clients
              // that don't broadcast pet position.
              const petX = typeof player.petX === "number" ? player.petX : player.x + (facingLeft ? 54 : -54);
              const petY = typeof player.petY === "number" ? player.petY : player.y + 14;
              existing.petFacing = (player.petFacing ?? player.facing) as FacingDirection;
              existing.controlMode = player.controlMode ?? "keeper";
              const changed =
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
              this.tweens.add({ targets: existing.shadow, x: player.x, y: player.y + 20, duration: distance > 2 ? 190 : 80, ease: "Sine.out" });
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

            const petX = typeof player.petX === "number" ? player.petX : player.x + (facingLeft ? 54 : -54);
            const petY = typeof player.petY === "number" ? player.petY : player.y + 14;

            // --- new visiting keeper ---
            const color = PhaserModule.Display.Color.HexStringToColor(player.color).color;
            const shadow = this.add.ellipse(player.x, player.y + 20, 46, 16, 0x3a2a2a, 0.14).setDepth(player.y - 1);
            const container = this.add.container(player.x, player.y).setDepth(player.y);
            const aura = this.add.circle(0, -80, 13, color, 0.28);
            const skinSprite = this.add
              .sprite(0, -66, "keeper-skin-mask-sheet", keeperSkinFrame("idle", custom.outfitId, custom.bodyId))
              .setDisplaySize(94, 141)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
            const sprite = this.add
              .sprite(0, -66, "keeper-animation-sheet", keeperFrame(custom.paletteId, "idle", custom.outfitId, custom.bodyId))
              .setDisplaySize(94, 141)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
            const hairSprite = this.add
              .sprite(0, -66, "keeper-hair-style-sheet", keeperHairFrame(custom.hairStyleId, "idle", custom.bodyId))
              .setDisplaySize(94, 141)
              .setAlpha(0.94)
              .setFlipX(facingLeft);
            sprite.clearTint().setAlpha(1);
            skinSprite.clearTint().setAlpha(0);
            hairSprite.clearTint().setAlpha(0);
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
            container.add([aura, sprite, skinSprite, hairSprite, label]);

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
              skinSprite,
              hairSprite,
              label,
              petContainer,
              petShadow,
              petSprite,
              petAccessorySprite,
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
              petFacing: (player.petFacing ?? player.facing) as FacingDirection,
              controlMode: player.controlMode ?? "keeper",
              movingUntil: 0,
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
          // While the player is driving the companion, the keeper holds still.
          // We keep its facing pointed toward the pet so the keeper "watches"
          // their companion rather than going limp.
          if (this.playMode === "companion") {
            this.avatarFacing = this.pet?.x && this.pet.x < this.avatar.x ? "left" : "right";
            this.setKeeperLayerFlip(this.avatarFacing);
            this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
            this.avatarShadow.setDepth(this.avatar.y - 1);
            this.applyKeeperLocomotion(false, delta);
            return;
          }

          const keyboard = this.readKeyboard();
          if (this.keeperFurnitureInteraction && (keyboard.x !== 0 || keyboard.y !== 0 || this.target)) {
            this.clearFurnitureInteraction("keeper");
          }
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

          if (this.keeperFurnitureInteraction && !moving) {
            const furniture = this.findFurnitureById(this.keeperFurnitureInteraction.placementId);
            if (furniture) {
              const anchor = getFurnitureAnchor(furniture.placement, "keeper", this.keeperFurnitureInteraction.action);
              const target = this.constrainToFloor(furniture.container.x + anchor.x, furniture.container.y + anchor.y);
              this.avatar.setPosition(
                PhaserModule.Math.Linear(this.avatar.x, target.x, 0.18),
                PhaserModule.Math.Linear(this.avatar.y, target.y, 0.18),
              );
              this.avatarFacing = isFacingLeft(furniture.placement.rotation) ? "right" : "left";
              this.setKeeperLayerFlip(this.avatarFacing);
              this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
              this.avatarShadow.setDepth(this.avatar.y - 1);
              this.setAvatarPose("sit");
              this.setKeeperLayerMotion(this.keeperFurnitureInteraction.action === "sleep" ? -52 : -54, 0);
              this.checkRoomPortalTravel();
              return;
            }
            this.clearFurnitureInteraction("keeper");
          }

          // Face the way we're walking. A small deadzone keeps the sprite from
          // flickering when movement is almost purely vertical.
          if (moving && Math.abs(moveDx) > 0.05) {
            this.avatarFacing = moveDx < 0 ? "left" : "right";
          }
          // The keeper art is drawn facing the viewer; flipX mirrors it so it
          // reads as facing left vs right.
          this.setKeeperLayerFlip(this.avatarFacing);

          // Same guard for R / Q / E — never fire while a text input is focused.
          // Also gated by `canEditRoom`: visitors can't change facing or re-layer host furniture.
          if (canEditRoom && !this.textInputFocused && !isTextInputFocused()) {
            if (this.wasd?.rotate && PhaserModule.Input.Keyboard.JustDown(this.wasd.rotate)) {
              this.toggleSelectedFurnitureFacing();
            }
            if (this.wasd?.layerUp && PhaserModule.Input.Keyboard.JustDown(this.wasd.layerUp)) {
              this.changeSelectedLayer(1);
            }
            if (this.wasd?.layerDown && PhaserModule.Input.Keyboard.JustDown(this.wasd.layerDown)) {
              this.changeSelectedLayer(-1);
            }
            if (this.wasd?.remove && PhaserModule.Input.Keyboard.JustDown(this.wasd.remove)) {
              this.removeSelectedFurniture();
            }
          }

          this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
          this.avatarShadow.setDepth(this.avatar.y - 1);
          this.avatarEmoteTimer = Math.max(0, this.avatarEmoteTimer - delta);
          if (this.avatarEmoteTimer === 0) {
            this.applyKeeperLocomotion(moving, delta);
          }
          this.checkRoomPortalTravel();

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

        private readKeyboard() {
          // Suspend movement keys while the player is typing — WASD letters
          // belong in their chat / message field, not the floor.
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

        private checkRoomPortalTravel() {
          if (this.portalTraveling || this.playMode !== "keeper") return;
          for (const hotspot of this.portalHotspots) {
            const distance = PhaserModule.Math.Distance.Between(this.avatar.x, this.avatar.y, hotspot.x, hotspot.y);
            if (distance > 46) continue;
            this.portalTraveling = true;
            this.target = undefined;
            playCozyCue("ui");
            setStatus(`Entering ${hotspot.portal.name}...`);
            this.time.delayedCall(220, () => {
              window.location.assign(hotspot.portal.href);
            });
            return;
          }
        }

        private updatePet(delta: number) {
          // Refresh behaviour cache. See garden-canvas for the full
          // walkthrough — same model, same exhaustion flow.
          if (!this.petBehavior.napping) this.petBehavior = getPetBehavior();

          // ── NAPPING ─────────────────────────────────────────────────
          if (this.petBehavior.napping) {
            this.petWasNapping = true;
            this.pet.setVisible(false);
            this.petShadow?.setVisible(false);
            this.petBehavior = getPetBehavior();
            return;
          }

          // ── WAKING UP ───────────────────────────────────────────────
          if (this.petWasNapping && !this.petBehavior.napping) {
            this.petWasNapping = false;
            this.petFleeing = false;
            this.petFleeTarget = undefined;
            // In a room, the safe wake-up spot is beside the keeper at
            // the canonical offset. Snap to it so the pet doesn't appear
            // half-inside a couch.
            this.pet.setPosition(this.avatar.x + 54, this.avatar.y + 24);
            this.pet.setVisible(true);
            this.petShadow?.setVisible(true);
            this.petMood = "follow";
            this.petMoodTimer = 0;
            setStatus(`${this.petCustomization.speciesId} woke up refreshed.`);
          }

          // ── FLEEING ─────────────────────────────────────────────────
          // Pet shuffles to the nearest world edge, then collapses into
          // the 5-minute nap. The room world is smaller than the garden
          // so the edge isn't far away, but the slow pace still gives
          // the keeper a chance to notice + intervene.
          if (this.petFleeing) {
            const target = this.petFleeTarget;
            if (!target) {
              this.petFleeing = false;
            } else {
              const sleepySpeed = 0.10 * delta;
              const distance = PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, target.x, target.y);
              if (distance < 12) {
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
              this.pet.setPosition(
                this.pet.x + Math.cos(angle) * sleepySpeed,
                this.pet.y + Math.sin(angle) * sleepySpeed,
              );
              this.petFacing = Math.cos(angle) < 0 ? "left" : "right";
              this.petSprite.setFlipX(this.petFacing === "left");
              this.petAccessorySprite?.setFlipX(this.petFacing === "left");
              this.applyPetLocomotion(true, "idle");
              this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
              this.petShadow.setDepth(this.pet.y - 1);
              return;
            }
          }

          // ── EXHAUSTED → START FLEE ─────────────────────────────────
          if (this.petBehavior.exhausted && !this.petFleeing) {
            this.petFleeing = true;
            const worldWidth = this.cameras.main.worldView.width || ROOM_WIDTH;
            const fleeLeft = this.pet.x < worldWidth / 2;
            this.petFleeTarget = { x: fleeLeft ? -80 : worldWidth + 80, y: this.pet.y };
            setStatus(`${this.petCustomization.speciesId} is exhausted — shuffling off to nap.`);
            return;
          }

          this.petMoodTimer += delta;
          this.blinkTimer += delta;

          if (this.blinkTimer > 2600 && this.petMood !== "sleep") {
            this.blinkTimer = 0;
            this.petEyes.forEach((eye) => eye.setScale(1, 0.12));
            this.time.delayedCall(120, () => this.petEyes.forEach((eye) => eye.setScale(1, 1)));
          }

          // Companion-controlled branch — WASD drives the pet directly at
          // ×1.6 speed (modulated by joy) and the auto-follow is suspended.
          if (this.playMode === "companion") {
            const keyboard = this.readKeyboard();
            const ctlSpeed = 0.23 * 1.6 * delta * this.petBehavior.speedMultiplier;
            const prevX = this.pet.x;
            let petMoving = false;
            if (keyboard.x !== 0 || keyboard.y !== 0) {
              this.clearFurnitureInteraction("companion");
              const next = this.constrainToFloor(this.pet.x + keyboard.x * ctlSpeed, this.pet.y + keyboard.y * ctlSpeed);
              this.pet.setPosition(next.x, next.y);
              petMoving = true;
            }
            if (petMoving && this.pet.x !== prevX) {
              this.petFacing = this.pet.x < prevX ? "left" : "right";
            }
            this.petSprite.setFlipX(this.petFacing === "left");
            this.petAccessorySprite?.setFlipX(this.petFacing === "left");
            this.pet.setDepth(this.pet.y);
            this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
            this.petShadow.setDepth(this.pet.y - 1);
            // Standing still shows the idle frame (not a frozen walk1 — that
            // looked like the companion was permanently mid-step). When the
            // companion actually moves, applyPetLocomotion swaps to the
            // alternating walk1/walk2 cycle automatically.
            this.applyPetLocomotion(petMoving, "idle");

            // Broadcast pet movement so remote viewers see the companion
            // actually move while we're driving it (the keeper stays put,
            // so `updateAvatar` never fires its own broadcast in this mode).
            this.moveBroadcastTimer += delta;
            const lastPet = this.lastSentPetPosition;
            const petHasMoved = !lastPet || PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, lastPet.x, lastPet.y) > 3;
            if (petHasMoved && this.moveBroadcastTimer > 110) {
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
            return;
          }

          if (this.petFurnitureInteraction) {
            const furniture = this.findFurnitureById(this.petFurnitureInteraction.placementId);
            if (furniture) {
              const anchor = getFurnitureAnchor(furniture.placement, "companion", this.petFurnitureInteraction.action);
              const target = this.constrainToFloor(furniture.container.x + anchor.x, furniture.container.y + anchor.y);
              const prevPetX = this.pet.x;
              this.pet.x = PhaserModule.Math.Linear(this.pet.x, target.x, 0.12);
              this.pet.y = PhaserModule.Math.Linear(this.pet.y, target.y, 0.12);
              const petDx = this.pet.x - prevPetX;
              if (Math.abs(petDx) > 0.05) this.petFacing = petDx < 0 ? "left" : "right";
              else this.petFacing = isFacingLeft(furniture.placement.rotation) ? "right" : "left";
              this.petSprite.setFlipX(this.petFacing === "left");
              this.petAccessorySprite?.setFlipX(this.petFacing === "left");
              const pose: PetPose = this.petFurnitureInteraction.action === "sleep" ? "sleep" : "sit";
              this.petMood = pose === "sleep" ? "sleep" : "sit";
              this.pet.setScale(1, pose === "sleep" ? 0.84 : 0.96);
              this.petEyes.forEach((eye) => eye.setScale(1, pose === "sleep" ? 0.1 : 1));
              this.applyPetLocomotion(PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, target.x, target.y) > 8, pose);
              this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
              this.petShadow.setDepth(this.pet.y - 1);
              return;
            }
            this.clearFurnitureInteraction("companion");
          }

          // Settled lounging cycle — 14 seconds between idle/sit
          // toggles. The previous 6.2s made the pet read as twitchy.
          if (this.petMoodTimer > 14000 && this.petMood !== "follow") {
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
            // Joy scales the follow lerp so a sad companion noticeably
            // drags behind the keeper.
            const followSpeed = (this.petMood === "sleep" ? 0.025 : 0.055) * this.petBehavior.speedMultiplier;
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

          // Gentler squish — sit is barely compressed, sleep is a softer
          // curl. Snap-shifting from 1.0 to 0.88 every few seconds is the
          // "constantly moving" feel we're trying to avoid.
          const squish = this.petMood === "sit" ? 0.96 : this.petMood === "sleep" ? 0.84 : 1;
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
                : idleMoodPose;
          this.applyPetLocomotion(petMoving, pose);

          this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
          this.petShadow.setDepth(this.pet.y - 1);

          // Keeper-mode pet broadcast — when the keeper is standing still
          // but the pet is auto-following / settling into furniture, the
          // avatar-move path doesn't fire, so remote viewers would see the
          // pet snap on the next keeper move instead of trailing along
          // smoothly. Broadcast pet position here too, throttled the same
          // way as the companion-mode branch above.
          this.moveBroadcastTimer += delta;
          const lastPet = this.lastSentPetPosition;
          const petHasMoved = !lastPet || PhaserModule.Math.Distance.Between(this.pet.x, this.pet.y, lastPet.x, lastPet.y) > 3;
          if (petHasMoved && this.moveBroadcastTimer > 110) {
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

        private selectFurniture(furniture: FurnitureObject) {
          this.furniture.forEach((item) => item.glow.setVisible(item === furniture));
          this.selectedFurniture = furniture;
          furniture.glow.setVisible(true);
          setSelected(furniture.placement.label);
          const options = getFurnitureInteractionOptions(furniture.placement.kind);
          setStatus(
            options.length > 0
              ? `${furniture.placement.label}: choose an action, drag to move, or face it left/right.`
              : `${furniture.placement.label}: drag to place, press R to face left/right, Q/E to adjust depth.`,
          );

          if (["lantern", "table", "plant"].includes(furniture.placement.kind)) {
            this.petMood = "react";
            playCozyCue("petChirp");
            this.playInteractionSparkles(furniture.container.x, furniture.container.y);
          }

          this.showInteractionBubble(furniture);
        }

        private showInteractionBubble(furniture: FurnitureObject) {
          this.interactionBubble?.destroy(true);

          const actions = getFurnitureInteractionOptions(furniture.placement.kind);
          const bubbleHeight = actions.length > 0 ? 112 : 78;
          const bubble = this.add.container(furniture.container.x, furniture.container.y - furniture.placement.height * 0.78).setDepth(6000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.95);
          bg.fillRoundedRect(-162, -bubbleHeight / 2, 324, bubbleHeight, 18);
          bg.lineStyle(2, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-162, -bubbleHeight / 2, 324, bubbleHeight, 18);

          const label = this.add
            .text(0, -bubbleHeight / 2 + 17, furniture.placement.label, {
              color: "#3A2A2A",
              fontFamily: "Nunito, sans-serif",
              fontSize: "13px",
              fontStyle: "800",
            })
            .setOrigin(0.5);

          const leftButton = this.add
            .text(-48, bubbleHeight / 2 - 22, "Face L", {
              color: "#8E70BD",
              fontFamily: "Nunito, sans-serif",
              fontSize: "12px",
              fontStyle: "900",
              backgroundColor: "#EFE6F7",
              padding: { x: 9, y: 5 },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
          leftButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.setSelectedFurnitureFacing("left");
          });

          const rightButton = this.add
            .text(48, bubbleHeight / 2 - 22, "Face R", {
              color: "#8E70BD",
              fontFamily: "Nunito, sans-serif",
              fontSize: "12px",
              fontStyle: "900",
              backgroundColor: "#EFE6F7",
              padding: { x: 9, y: 5 },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
          rightButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            pointer.event.stopPropagation();
            this.setSelectedFurnitureFacing("right");
          });

          const downButton = this.add
            .text(-124, bubbleHeight / 2 - 22, "Depth -", {
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
            .text(124, bubbleHeight / 2 - 22, "Depth +", {
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

          const children: Phaser.GameObjects.GameObject[] = [bg, label, downButton, leftButton, rightButton, upButton];
          if (canEditRoom) {
            const removeButton = this.add
              .text(0, bubbleHeight / 2 - 22, "Remove", {
                color: "#9F4D5D",
                fontFamily: "Nunito, sans-serif",
                fontSize: "12px",
                fontStyle: "900",
                backgroundColor: "#FCE6E9",
                padding: { x: 10, y: 5 },
              })
              .setOrigin(0.5)
              .setInteractive({ useHandCursor: true });
            removeButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
              pointer.event.stopPropagation();
              this.removeSelectedFurniture();
            });
            children.push(removeButton);
          }

          actions.forEach((action, index) => {
            const x = (index - (actions.length - 1) / 2) * 104;
            const actionButton = this.add
              .text(x, 13, action.label, {
                color: action.actor === "keeper" ? "#5B3F3F" : "#8E70BD",
                fontFamily: "Nunito, sans-serif",
                fontSize: "12px",
                fontStyle: "900",
                backgroundColor: action.actor === "keeper" ? "#F5E9D0" : "#EFE6F7",
                padding: { x: 10, y: 5 },
              })
              .setOrigin(0.5)
              .setInteractive({ useHandCursor: true });
            actionButton.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
              pointer.event.stopPropagation();
              this.activateFurnitureInteraction(furniture, action.actor, action.action);
            });
            children.push(actionButton);
          });

          bubble.add(children);
          this.interactionBubble = bubble;
        }

        private activateFurnitureInteraction(furniture: FurnitureObject, actor: FurnitureActor, action: FurnitureAction) {
          const anchor = getFurnitureAnchor(furniture.placement, actor, action);
          const target = this.constrainToFloor(furniture.container.x + anchor.x, furniture.container.y + anchor.y);
          const facing = isFacingLeft(furniture.placement.rotation) ? "right" : "left";
          const label = actor === "keeper" ? "keeper" : "companion";
          if (actor === "keeper") {
            this.playMode = "keeper";
            this.target = undefined;
            this.keeperFurnitureInteraction = { placementId: furniture.placement.id, actor, action };
            this.avatarFacing = facing;
            this.setKeeperLayerFlip(this.avatarFacing);
            this.tweens.killTweensOf([this.avatar, this.avatarShadow]);
            this.tweens.add({ targets: this.avatar, x: target.x, y: target.y, duration: 360, ease: "Sine.out" });
            this.tweens.add({ targets: this.avatarShadow, x: target.x, y: target.y + 22, duration: 360, ease: "Sine.out" });
            this.setAvatarPose("sit");
            playCozyCue(action === "sleep" ? "petSleep" : "place");
          } else {
            this.petFurnitureInteraction = { placementId: furniture.placement.id, actor, action };
            this.petMood = action === "sleep" ? "sleep" : "sit";
            this.petMoodTimer = 0;
            this.petFacing = facing;
            this.petSprite.setFlipX(this.petFacing === "left");
            this.petAccessorySprite?.setFlipX(this.petFacing === "left");
            this.tweens.killTweensOf([this.pet, this.petShadow]);
            this.tweens.add({ targets: this.pet, x: target.x, y: target.y, duration: 420, ease: "Sine.out" });
            this.tweens.add({ targets: this.petShadow, x: target.x, y: target.y + 18, duration: 420, ease: "Sine.out" });
            playCozyCue(action === "sleep" ? "petSleep" : "petPurr");
          }
          this.playInteractionSparkles(target.x, target.y - 34, action === "sleep" ? 0xc0a8dc : 0xfaebc2);
          setStatus(`${furniture.placement.label}: ${label} ${action === "sleep" ? "settles in for a nap" : "sits down"}.`);
        }

        private clearFurnitureInteraction(actor?: FurnitureActor) {
          if (!actor || actor === "keeper") this.keeperFurnitureInteraction = undefined;
          if (!actor || actor === "companion") this.petFurnitureInteraction = undefined;
        }

        private findFurnitureById(id: string) {
          return this.furniture.find((item) => item.placement.id === id);
        }

        private removeSelectedFurniture() {
          if (!this.selectedFurniture) return;
          if (!canEditRoom) {
            setStatus("Only the room host or an approved decorator can remove furniture here.");
            return;
          }
          const item = this.selectedFurniture;
          item.bobTween?.stop();
          item.container.destroy(true);
          this.furniture = this.furniture.filter((entry) => entry !== item);
          this.selectedFurniture = undefined;
          this.interactionBubble?.destroy(true);
          this.interactionBubble = undefined;
          this.clearFurnitureInteraction();
          playCozyCue("place");
          setSelected("No item selected");
          setStatus(`${item.placement.label} removed from this room.`);
          onPlacementsChangeRef.current?.(this.exportPlacements());
        }

        private moveBubbleToSelection() {
          if (!this.interactionBubble || !this.selectedFurniture) return;
          this.interactionBubble.setPosition(
            this.selectedFurniture.container.x,
            this.selectedFurniture.container.y - this.selectedFurniture.placement.height * 0.72,
          );
        }

        private toggleSelectedFurnitureFacing() {
          if (!this.selectedFurniture) return;
          this.setSelectedFurnitureFacing(isFacingLeft(this.selectedFurniture.placement.rotation) ? "right" : "left");
        }

        private setSelectedFurnitureFacing(facing: FacingDirection) {
          if (!this.selectedFurniture) return;
          // Visitors can't edit the host's room.
          if (!canEditRoom) {
            setStatus("Only the room host or an approved decorator can change furniture facing here.");
            return;
          }
          const placement = this.selectedFurniture.placement;
          placement.rotation = facingRotation(facing);
          this.selectedFurniture.container.setRotation(0);
          this.selectedFurniture.container.setScale(
            facing === "left" ? -placement.scale : placement.scale,
            placement.scale,
          );
          playCozyCue("rotate");
          this.playInteractionSparkles(this.selectedFurniture.container.x, this.selectedFurniture.container.y);
          setStatus(`${placement.label} now faces ${facing}.`);
          onPlacementsChangeRef.current?.(this.exportPlacements());
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
          onPlacementsChangeRef.current?.(this.exportPlacements());
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
          // Scale the clamps with the configured world so big living
          // rooms have a correspondingly bigger walkable area. The
          // ratios match the original 960×600 values (132/828 → ~14%/86%,
          // 226/500 → ~38%/83%) so the starter loft still feels the same.
          const minX = Math.round(worldWidth * 0.137);
          const maxX = Math.round(worldWidth * 0.862);
          const minY = Math.round(worldHeight * 0.377);
          const maxY = Math.round(worldHeight * 0.833);
          const clamped = new PhaserModule.Math.Vector2(
            PhaserModule.Math.Clamp(x, minX, maxX),
            PhaserModule.Math.Clamp(y, minY, maxY),
          );

          if (this.floorPolygon && !PhaserModule.Geom.Polygon.Contains(this.floorPolygon, clamped.x, clamped.y)) {
            const tightMinX = Math.round(worldWidth * 0.185);
            const tightMaxX = Math.round(worldWidth * 0.815);
            const tightMinY = Math.round(worldHeight * 0.417);
            const tightMaxY = Math.round(worldHeight * 0.757);
            clamped.x = PhaserModule.Math.Clamp(clamped.x, tightMinX, tightMaxX);
            clamped.y = PhaserModule.Math.Clamp(clamped.y, tightMinY, tightMaxY);
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
          // Keep Phaser's logical viewport fixed at 960x600 and let the
          // React/CSS shell scale the canvas. Phaser.Scale.FIT can compute
          // stale parent sizes while the app shell is still laying out, which
          // was pushing the room off-canvas inside the unified area view.
          mode: PhaserModule.Scale.NONE,
          autoCenter: PhaserModule.Scale.NO_CENTER,
        },
        input: {
          activePointers: 3,
        },
        scene: HeartHavenRoomScene,
      });

      requestAnimationFrame(() => {
        if (!game?.canvas || destroyed) return;
        game.canvas.style.display = "block";
        game.canvas.style.width = "100%";
        game.canvas.style.height = "100%";
        game.canvas.style.maxWidth = "100%";
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load Phaser room");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [activeEvent, canEditRoom, onAvatarMove, onRoomEmote, roomName, roomPortals, roomSurfaces, roomTheme, worldHeight, worldWidth]);

  return (
    <section className="block w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-cream-300 bg-cream-100 shadow-[0_24px_70px_rgba(91,63,63,0.16)]">
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
          <span className="rounded-md bg-honey-100 px-2.5 py-1">R flips facing</span>
          <span className="rounded-md bg-garden-100 px-2.5 py-1">Q/E depth</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive 2.5D room canvas with player movement, Casper, and draggable furniture"
        className="mx-auto block aspect-[960/600] w-full min-w-0 max-w-[960px] overflow-hidden bg-cream-100 [&>canvas]:!block [&>canvas]:!h-full [&>canvas]:!max-w-full [&>canvas]:!w-full"
        role="application"
        style={{
          // Take 100% of whatever column we land in, capped at the native
          // 960px the scene was painted for. The canvas itself is scaled by
          // CSS, not Phaser, so it cannot push the room layout wider.
          maxWidth: 960,
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
  if (id.includes("loveseat") || id.includes("sofa")) return "sofa";
  if (id.includes("pet-bed") || id.includes("boo-bed")) return "petBed";
  if (id.includes("swing")) return "swing";
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
    petBed: { width: 126, height: 86 },
    sofa: { width: 176, height: 104 },
    swing: { width: 184, height: 150 },
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

function getFurnitureImageConfig(id: string, kind: FurnitureKind) {
  const configs: Record<string, { key: string; width: number; height: number; yOffset: number }> = {
    "bed-cream-canopy": { key: "furniture-canopy-bed", width: 230, height: 178, yOffset: -42 },
    "loveseat-blush-heart": { key: "furniture-blush-loveseat", width: 206, height: 142, yOffset: -34 },
    "sofa-blush-cloud": { key: "furniture-blush-loveseat", width: 206, height: 142, yOffset: -34 },
    "pet-bed-moonberry": { key: "furniture-moonberry-pet-bed", width: 146, height: 114, yOffset: -26 },
    "casper-boo-bed": { key: "furniture-moonberry-pet-bed", width: 146, height: 114, yOffset: -26 },
    "swing-rose-garden-bench": { key: "furniture-garden-swing", width: 218, height: 170, yOffset: -52 },
    "tea-set-honey-stools": { key: "furniture-honey-tea-set", width: 182, height: 134, yOffset: -32 },
    "table-honey-tea": { key: "furniture-honey-tea-set", width: 182, height: 134, yOffset: -32 },
    "game-table-garden": { key: "furniture-honey-tea-set", width: 182, height: 134, yOffset: -32 },
    "peppermint-cocoa-table": { key: "furniture-honey-tea-set", width: 182, height: 134, yOffset: -32 },
    "sparkling-toast-table": { key: "furniture-honey-tea-set", width: 182, height: 134, yOffset: -32 },
    "armchair-lavender-heart": { key: "furniture-lavender-armchair", width: 132, height: 130, yOffset: -32 },
    "chair-lavender-cushion": { key: "furniture-lavender-armchair", width: 132, height: 130, yOffset: -32 },
  };
  const direct = configs[id];
  if (direct) return direct;
  if (kind === "bed") return configs["bed-cream-canopy"];
  if (kind === "petBed") return configs["pet-bed-moonberry"];
  if (kind === "sofa") return configs["loveseat-blush-heart"];
  if (kind === "swing") return configs["swing-rose-garden-bench"];
  return undefined;
}

function getFurnitureInteractionOptions(kind: FurnitureKind): Array<{ actor: FurnitureActor; action: FurnitureAction; label: string }> {
  if (kind === "bed") {
    return [
      { actor: "keeper", action: "sleep", label: "Keeper nap" },
      { actor: "companion", action: "sleep", label: "Pet nap" },
    ];
  }
  if (kind === "petBed") {
    return [{ actor: "companion", action: "sleep", label: "Pet nap" }];
  }
  if (kind === "chair" || kind === "sofa" || kind === "swing") {
    return [
      { actor: "keeper", action: "sit", label: "Keeper sit" },
      { actor: "companion", action: "sit", label: "Pet sit" },
    ];
  }
  if (kind === "table") {
    return [{ actor: "keeper", action: "sit", label: "Sit nearby" }];
  }
  return [];
}

function getFurnitureAnchor(placement: PlayablePlacement, actor: FurnitureActor, action: FurnitureAction) {
  const facingSign = isFacingLeft(placement.rotation) ? -1 : 1;
  const anchors: Partial<Record<FurnitureKind, Partial<Record<FurnitureActor, { x: number; y: number }>>>> = {
    bed: {
      keeper: { x: -20, y: -18 },
      companion: { x: 44, y: -20 },
    },
    petBed: {
      companion: { x: 0, y: -6 },
    },
    chair: {
      keeper: { x: 0, y: -10 },
      companion: { x: 42, y: 18 },
    },
    sofa: {
      keeper: { x: -28, y: -12 },
      companion: { x: 46, y: 18 },
    },
    swing: {
      keeper: { x: -18, y: -24 },
      companion: { x: 44, y: 10 },
    },
    table: {
      keeper: { x: -56, y: 24 },
    },
  };
  const anchor = anchors[placement.kind]?.[actor] ?? { x: 0, y: 0 };
  return {
    x: anchor.x * facingSign,
    y: action === "sleep" && actor === "keeper" ? anchor.y - 2 : anchor.y,
  };
}

function drawFurnitureShape(scene: Phaser.Scene, container: Phaser.GameObjects.Container, placement: PlayablePlacement) {
  const add = scene.add;
  const imageConfig = getFurnitureImageConfig(placement.catalogItemId, placement.kind);
  if (imageConfig) {
    if (["lantern", "swing", "bed", "petBed"].includes(placement.kind)) {
      container.add(add.circle(0, imageConfig.yOffset + imageConfig.height * 0.14, Math.max(46, imageConfig.width * 0.22), 0xfaebc2, 0.12));
    }
    container.add(
      add
        .image(0, imageConfig.yOffset, imageConfig.key)
        .setDisplaySize(imageConfig.width, imageConfig.height),
    );
    return;
  }

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
    petBed: 2,
    sofa: 1,
    swing: 1,
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
    petBed: { width: 136, height: 132 },
    sofa: { width: 192, height: 156 },
    swing: { width: 204, height: 180 },
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
    petBed: -24,
    sofa: -28,
    swing: -48,
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
