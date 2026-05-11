"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { RoomPlacement } from "@/lib/game/types";

type RoomCanvasProps = {
  placements: RoomPlacement[];
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

const ROOM_WIDTH = 960;
const ROOM_HEIGHT = 600;

export function RoomCanvas({ placements }: RoomCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Lighting the Moonlit Loft");
  const [selected, setSelected] = useState("No item selected");

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
        private pet!: Phaser.GameObjects.Container;
        private petShadow!: Phaser.GameObjects.Ellipse;
        private petEyes: Phaser.GameObjects.Ellipse[] = [];
        private petMood: PetMood = "idle";
        private petMoodTimer = 0;
        private blinkTimer = 0;
        private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
        private wasd?: Record<"up" | "left" | "down" | "right" | "rotate", Phaser.Input.Keyboard.Key>;
        private target?: Phaser.Math.Vector2;
        private floorPolygon!: Phaser.Geom.Polygon;
        private furniture: FurnitureObject[] = [];
        private selectedFurniture?: FurnitureObject;
        private interactionBubble?: Phaser.GameObjects.Container;
        private dragStarted = false;
        private sparkleLayer!: Phaser.GameObjects.Container;

        constructor() {
          super("HeartHavenRoom");
        }

        create() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.drawRoomShell();
          this.drawAmbientMagic();
          this.createFurniture(normalizedPlacements);
          this.createAvatar();
          this.createPet();
          this.createInput();
          this.sortDepths();

          this.add
            .text(34, 30, "Moonlit Loft", {
              color: "#3A2A2A",
              fontFamily: "Nunito, sans-serif",
              fontSize: "22px",
              fontStyle: "800",
            })
            .setDepth(5000);

          this.add
            .text(34, 58, "Click the floor or use WASD. Drag furniture. Press R to rotate.", {
              color: "#84675F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "13px",
              fontStyle: "700",
            })
            .setDepth(5000);

          setStatus("Click the floor to move. Hover, drag, click, and rotate furniture.");
          // TODO: Broadcast avatar position and furniture edits through Supabase Realtime room sessions.
          // TODO: Save mutable placement state to Supabase placed_items after drag/rotate interactions.
        }

        update(_time: number, delta: number) {
          this.updateAvatar(delta);
          this.updatePet(delta);
          this.updateSparkles(delta);
          this.sortDepths();
        }

        private drawRoomShell() {
          const backWall = this.add.graphics().setDepth(0);
          backWall.fillGradientStyle(0xfffcf3, 0xfffcf3, 0xefe6f7, 0xfbe3e3, 1);
          backWall.fillRoundedRect(112, 88, 736, 252, 18);
          backWall.lineStyle(3, 0xc9a998, 0.26);
          backWall.strokeRoundedRect(112, 88, 736, 252, 18);

          const leftWall = this.add.graphics().setDepth(1);
          leftWall.fillStyle(0xf7ead3, 0.92);
          leftWall.fillPoints(
            [
              new PhaserModule.Geom.Point(112, 122),
              new PhaserModule.Geom.Point(214, 214),
              new PhaserModule.Geom.Point(214, 426),
              new PhaserModule.Geom.Point(112, 340),
            ],
            true,
          );
          leftWall.lineStyle(2, 0xc9a998, 0.22);
          leftWall.strokePath();

          const rightWall = this.add.graphics().setDepth(1);
          rightWall.fillStyle(0xf3e2cb, 0.92);
          rightWall.fillPoints(
            [
              new PhaserModule.Geom.Point(848, 122),
              new PhaserModule.Geom.Point(746, 214),
              new PhaserModule.Geom.Point(746, 426),
              new PhaserModule.Geom.Point(848, 340),
            ],
            true,
          );
          rightWall.lineStyle(2, 0xc9a998, 0.22);
          rightWall.strokePath();

          this.floorPolygon = new PhaserModule.Geom.Polygon([
            214, 214,
            746, 214,
            862, 424,
            480, 536,
            98, 424,
          ]);

          const floorShadow = this.add.graphics().setDepth(2);
          floorShadow.fillStyle(0x8b5e3c, 0.13);
          floorShadow.fillPoints(
            this.floorPolygon.points.map((point) => new PhaserModule.Geom.Point(point.x + 0, point.y + 14)),
            true,
          );

          const floor = this.add.graphics().setDepth(3);
          floor.fillGradientStyle(0xfdf8ee, 0xf7e8cf, 0xe4efd7, 0xf5d9d9, 1);
          floor.fillPoints(this.floorPolygon.points, true);
          floor.lineStyle(4, 0xb49e94, 0.35);
          floor.strokePoints(this.floorPolygon.points, true);

          const floorLines = this.add.graphics().setDepth(4);
          floorLines.lineStyle(1, 0xffffff, 0.22);
          for (let row = 0; row < 6; row += 1) {
            const y = 248 + row * 40;
            floorLines.lineBetween(174 + row * 12, y, 786 - row * 12, y);
          }
          for (let col = 0; col < 7; col += 1) {
            const x = 230 + col * 84;
            floorLines.lineBetween(x, 222, x - 140, 450);
            floorLines.lineBetween(x, 222, x + 140, 450);
          }

          const glow = this.add.graphics().setDepth(5);
          glow.fillStyle(0xf8d4d8, 0.13);
          glow.fillEllipse(480, 346, 580, 210);
          glow.fillStyle(0xfaebc2, 0.16);
          glow.fillEllipse(592, 228, 260, 130);
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
          container.setInteractive({ draggable: placement.floorLocked, useHandCursor: true });
          if (placement.floorLocked) {
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
          this.avatarShadow = this.add.ellipse(390, 396, 58, 22, 0x3a2a2a, 0.18).setDepth(350);
          this.avatar = this.add.container(390, 374).setDepth(374);

          const body = this.add.ellipse(0, 10, 44, 58, 0xd87e8c).setStrokeStyle(3, 0x8b5e3c, 0.45);
          const face = this.add.circle(0, -18, 24, 0xffdfcf).setStrokeStyle(3, 0x8b5e3c, 0.35);
          const hair = this.add.ellipse(0, -28, 42, 20, 0x5b3f3f, 0.78);
          const eyeLeft = this.add.circle(-8, -18, 3, 0x3a2a2a);
          const eyeRight = this.add.circle(8, -18, 3, 0x3a2a2a);
          const scarf = this.add.rectangle(0, 6, 42, 9, 0xfaebc2).setStrokeStyle(1, 0xd9a53e, 0.35);
          this.avatar.add([body, face, hair, eyeLeft, eyeRight, scarf]);

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
          this.petShadow = this.add.ellipse(456, 410, 52, 18, 0x3a2a2a, 0.15).setDepth(360);
          this.pet = this.add.container(456, 388).setDepth(388);

          const tail = this.add.ellipse(24, 8, 34, 16, 0xfdf8ee).setStrokeStyle(2, 0xc9a998, 0.55);
          const body = this.add.ellipse(0, 8, 52, 34, 0xfffcf3).setStrokeStyle(3, 0xc9a998, 0.55);
          const head = this.add.circle(-18, -9, 21, 0xfffcf3).setStrokeStyle(3, 0xc9a998, 0.55);
          const earLeft = this.add.triangle(-30, -27, 0, 16, 9, 0, 18, 16, 0xfffcf3).setStrokeStyle(2, 0xc9a998, 0.55);
          const earRight = this.add.triangle(-11, -29, 0, 15, 9, 0, 18, 15, 0xfffcf3).setStrokeStyle(2, 0xc9a998, 0.55);
          const blush = this.add.circle(-30, -4, 5, 0xf6cfd2, 0.75);
          const eyeLeft = this.add.ellipse(-26, -12, 4, 6, 0x3a2a2a);
          const eyeRight = this.add.ellipse(-12, -12, 4, 6, 0x3a2a2a);
          this.petEyes = [eyeLeft, eyeRight];
          this.pet.add([tail, body, head, earLeft, earRight, blush, eyeLeft, eyeRight]);

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
          }) as Record<"up" | "left" | "down" | "right" | "rotate", Phaser.Input.Keyboard.Key> | undefined;

          this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (pointer.y < 198 || this.dragStarted) return;
            const target = this.constrainToFloor(pointer.x, pointer.y);
            this.target = new PhaserModule.Math.Vector2(target.x, target.y);
            this.petMood = "follow";
            setStatus(`Walking to x ${Math.round(target.x)}, y ${Math.round(target.y)}.`);
          });
        }

        private updateAvatar(delta: number) {
          const keyboard = this.readKeyboard();
          const speed = 0.23 * delta;

          if (keyboard.x !== 0 || keyboard.y !== 0) {
            this.target = undefined;
            const next = this.constrainToFloor(this.avatar.x + keyboard.x * speed, this.avatar.y + keyboard.y * speed);
            this.avatar.setPosition(next.x, next.y);
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
              this.avatar.setPosition(next.x, next.y);
            }
          }

          if (this.wasd?.rotate && PhaserModule.Input.Keyboard.JustDown(this.wasd.rotate)) {
            this.rotateSelectedFurniture();
          }

          this.avatarShadow.setPosition(this.avatar.x, this.avatar.y + 22);
          this.avatarShadow.setDepth(this.avatar.y - 1);
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

          if (distance > 10) {
            const followSpeed = this.petMood === "sleep" ? 0.025 : 0.055;
            this.pet.x = PhaserModule.Math.Linear(this.pet.x, targetX, followSpeed);
            this.pet.y = PhaserModule.Math.Linear(this.pet.y, targetY, followSpeed);
            if (this.petMood !== "sleep") this.petMood = "follow";
          } else if (this.petMood === "follow") {
            this.petMood = "idle";
          }

          const squish = this.petMood === "sit" ? 0.88 : this.petMood === "sleep" ? 0.7 : 1;
          this.pet.setScale(1, squish);
          this.petEyes.forEach((eye) => eye.setScale(1, this.petMood === "sleep" ? 0.1 : 1));

          this.petShadow.setPosition(this.pet.x, this.pet.y + 18);
          this.petShadow.setDepth(this.pet.y - 1);
        }

        private selectFurniture(furniture: FurnitureObject) {
          this.furniture.forEach((item) => item.glow.setVisible(item === furniture));
          this.selectedFurniture = furniture;
          furniture.glow.setVisible(true);
          setSelected(furniture.placement.label);
          setStatus(`${furniture.placement.label}: drag to place, press R or use Rotate.`);

          if (furniture.placement.kind === "bed") {
            this.petMood = "sleep";
            setStatus("Casper curls up near the canopy bed.");
          } else if (furniture.placement.kind === "chair") {
            this.petMood = "sit";
            setStatus("Casper sits beside the lavender chair.");
          } else if (["lantern", "table", "plant"].includes(furniture.placement.kind)) {
            this.petMood = "react";
            this.playInteractionSparkles(furniture.container.x, furniture.container.y);
          }

          this.showInteractionBubble(furniture);
        }

        private showInteractionBubble(furniture: FurnitureObject) {
          this.interactionBubble?.destroy(true);

          const bubble = this.add.container(furniture.container.x, furniture.container.y - furniture.placement.height * 0.72).setDepth(6000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.95);
          bg.fillRoundedRect(-92, -34, 184, 68, 18);
          bg.lineStyle(2, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-92, -34, 184, 68, 18);

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

          bubble.add([bg, label, rotateButton]);
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
          const placement = this.selectedFurniture.placement;
          placement.rotation = (placement.rotation + 45) % 360;
          this.selectedFurniture.container.setRotation((placement.rotation * Math.PI) / 180);
          this.playInteractionSparkles(this.selectedFurniture.container.x, this.selectedFurniture.container.y);
          setStatus(`${placement.label} rotated to ${placement.rotation} degrees.`);
        }

        private playInteractionSparkles(x: number, y: number) {
          for (let index = 0; index < 8; index += 1) {
            const sparkle = this.add.star(x, y - 24, 5, 3, 9, 0xfaebc2, 0.9).setDepth(6200);
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
            const baseDepth = item.placement.floorLocked ? item.container.y : 130 + item.placement.zIndex;
            item.container.setDepth(baseDepth);
          });
          this.interactionBubble?.setDepth(6000);
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
  }, [placements]);

  return (
    <section className="overflow-hidden rounded-lg border border-cream-300 bg-cream-100 shadow-[0_24px_70px_rgba(91,63,63,0.16)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-300/70 bg-white/68 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">Playable 2.5D room</p>
          <p className="text-sm font-black text-ink-900">{selected}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-cream-200 px-2.5 py-1">WASD</span>
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Click to move</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Drag furniture</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">R rotates</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive 2.5D room canvas with player movement, Casper, and draggable furniture"
        className="min-h-[360px] w-full bg-cream-100 [&_canvas]:!h-auto [&_canvas]:!w-full"
        role="application"
        tabIndex={0}
      />
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

  if (placement.kind === "rug") {
    container.add(add.ellipse(0, 8, 206, 72, 0xf6cfd2).setStrokeStyle(4, 0xd87e8c, 0.45));
    container.add(add.ellipse(0, 8, 156, 44, 0xfffcf3, 0.38).setStrokeStyle(2, 0xffffff, 0.34));
    return;
  }

  if (placement.kind === "window") {
    container.add(add.rectangle(0, 0, 118, 96, 0xc7e0eb).setStrokeStyle(5, 0x8b5e3c, 0.72));
    container.add(add.rectangle(0, 0, 96, 74, 0xe1eff5, 0.72).setStrokeStyle(2, 0xffffff, 0.8));
    container.add(add.line(0, 0, -48, 0, 48, 0, 0x8b5e3c, 0.5));
    container.add(add.line(0, 0, 0, -36, 0, 36, 0x8b5e3c, 0.5));
    container.add(add.arc(0, -48, 55, Math.PI, 0, false, 0xfbe3e3, 0.48).setStrokeStyle(3, 0xd87e8c, 0.35));
    return;
  }

  if (placement.kind === "lantern") {
    container.add(add.circle(0, -8, 42, 0xfaebc2, 0.18));
    container.add(add.rectangle(0, 0, 38, 64, 0xfaebc2).setStrokeStyle(3, 0x8b5e3c, 0.72));
    container.add(add.circle(0, 8, 14, 0xd9a53e, 0.8));
    container.add(add.arc(0, -34, 16, Math.PI, 0, false, 0xffffff, 0).setStrokeStyle(3, 0x8b5e3c, 0.72));
    return;
  }

  if (placement.kind === "chair") {
    container.add(add.rectangle(0, -18, 72, 68, 0xddceec).setStrokeStyle(3, 0x8e70bd, 0.48));
    container.add(add.rectangle(0, 18, 92, 30, 0xc0a8dc).setStrokeStyle(3, 0x8e70bd, 0.42));
    container.add(add.circle(-34, 5, 13, 0xf6cfd2, 0.7));
    container.add(add.circle(34, 5, 13, 0xf6cfd2, 0.7));
    return;
  }

  if (placement.kind === "bed") {
    container.add(add.rectangle(0, 0, 146, 82, 0xfffcf3).setStrokeStyle(4, 0xc9a998, 0.58));
    container.add(add.rectangle(-20, -20, 92, 36, 0xfbe3e3).setStrokeStyle(2, 0xd87e8c, 0.34));
    container.add(add.rectangle(42, -22, 42, 32, 0xefe6f7).setStrokeStyle(2, 0x8e70bd, 0.26));
    container.add(add.line(-76, -52, -76, 48, 0x8b5e3c, 0.55).setLineWidth(4));
    container.add(add.line(76, -52, 76, 48, 0x8b5e3c, 0.55).setLineWidth(4));
    container.add(add.arc(0, -52, 76, Math.PI, 0, false, 0xfbe3e3, 0.3).setStrokeStyle(3, 0xd87e8c, 0.28));
    return;
  }

  if (placement.kind === "table") {
    container.add(add.ellipse(0, -12, 86, 48, 0xfaebc2).setStrokeStyle(4, 0x9c6f1f, 0.42));
    container.add(add.rectangle(0, 22, 18, 52, 0x8b5e3c, 0.78));
    container.add(add.ellipse(0, 48, 58, 16, 0x8b5e3c, 0.38));
    container.add(add.circle(-20, -18, 8, 0xf6cfd2, 0.8));
    container.add(add.circle(18, -16, 7, 0xe4efd7, 0.9));
    return;
  }

  if (placement.kind === "shelf") {
    container.add(add.rectangle(0, 0, 118, 62, 0xead9b5).setStrokeStyle(4, 0x8b5e3c, 0.55));
    container.add(add.line(0, 0, -54, 0, 54, 0, 0x8b5e3c, 0.45));
    container.add(add.circle(-34, -18, 9, 0xf6cfd2, 0.82));
    container.add(add.rectangle(0, -16, 20, 18, 0xefe6f7).setStrokeStyle(2, 0x8e70bd, 0.3));
    container.add(add.circle(34, 18, 8, 0xfaebc2, 0.9));
    return;
  }

  if (placement.kind === "plant") {
    container.add(add.rectangle(0, 34, 42, 36, 0xf6cfd2).setStrokeStyle(3, 0xd87e8c, 0.45));
    for (let index = 0; index < 7; index += 1) {
      const angle = -80 + index * 26;
      const leaf = add.ellipse(0, -8, 22, 54, 0x6e9651, 0.88);
      leaf.setRotation((angle * Math.PI) / 180);
      container.add(leaf);
      scene.tweens.add({
        targets: leaf,
        rotation: leaf.rotation + 0.1,
        duration: 1400 + index * 120,
        yoyo: true,
        repeat: -1,
        ease: "Sine.inOut",
      });
    }
    return;
  }

  container.add(add.rectangle(0, 0, placement.width, placement.height, 0xfffcf3).setStrokeStyle(3, 0xc9a998, 0.5));
}
