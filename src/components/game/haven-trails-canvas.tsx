"use client";

import { useEffect, useRef } from "react";
import type Phaser from "phaser";
import { playCozyCue } from "@/lib/game/cozy-audio";
import {
  HAVEN_TRAILS_PATH_VISUAL_WIDTH,
  HAVEN_TRAILS_WORLD_HEIGHT,
  HAVEN_TRAILS_WORLD_WIDTH,
  havenTrailsBlockedZones,
  havenTrailsLandmarks,
  havenTrailsPaths,
  havenTrailsPortals,
  havenTrailsWorldArt,
  findHavenTrailsRoute,
  getTrailBlockedFootprint,
  isHavenTrailsWalkable,
} from "@/lib/game/haven-trails-map";
import { getDailyTrailDiscoveries, getTrailDiscoveryDayKey, type TrailDiscovery } from "@/lib/game/trail-discoveries";

export type HavenTrailsKeeper = {
  name: string;
  image: string;
};

export type HavenTrailsCompanion = {
  name: string;
  speciesId: string;
  toneId: string;
  image: string;
};

type HavenTrailsEvent =
  | { type: "landmark"; id: string; label: string }
  | { type: "discovery"; id: string; label: string; copy: string }
  | { type: "portal"; id: string; label: string; href: string };

type HavenTrailsCanvasProps = {
  keeper: HavenTrailsKeeper;
  companion: HavenTrailsCompanion;
  discovered?: string[];
  onEvent?: (event: HavenTrailsEvent) => void;
  onStatus?: (message: string) => void;
};

const VIEW_WIDTH = 1120;
const VIEW_HEIGHT = 640;
const WORLD_WIDTH = HAVEN_TRAILS_WORLD_WIDTH;
const WORLD_HEIGHT = HAVEN_TRAILS_WORLD_HEIGHT;
const COMPANION_FOLLOW_DISTANCE = 54;
const COMPANION_FOLLOW_LERP = 7;

const toneAccent: Record<string, number> = {
  cream: 0xfffcf3,
  blush: 0xf4b5be,
  lavender: 0xc0a8dc,
  honey: 0xd9a53e,
  sky: 0x80b9d2,
  mint: 0x7ba35c,
};

function safeName(value: string, fallback: string) {
  const cleaned = value.replace(/[<>]/g, "").trim().slice(0, 24);
  return cleaned || fallback;
}

export function HavenTrailsCanvas({ keeper, companion, discovered = [], onEvent, onStatus }: HavenTrailsCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onEvent, onStatus });
  const discoveredRef = useRef(new Set(discovered));

  useEffect(() => {
    callbacksRef.current = { onEvent, onStatus };
    discoveredRef.current = new Set(discovered);
  }, [discovered, onEvent, onStatus]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (destroyed || !mount) return;

      class HavenTrailsScene extends PhaserModule.Scene {
        private player!: Phaser.Physics.Arcade.Image;
        private companionSprite!: Phaser.GameObjects.Image;
        private companionShadow!: Phaser.GameObjects.Ellipse;
        private keeperShadow!: Phaser.GameObjects.Ellipse;
        private keys!: Record<string, Phaser.Input.Keyboard.Key>;
        private moveTarget: Phaser.Math.Vector2 | null = null;
        private moveRoute: Phaser.Math.Vector2[] = [];
        private lastPosition = new PhaserModule.Math.Vector2(510, 570);
        private playerMoving = false;
        private interactionLabel?: Phaser.GameObjects.Container;
        private discoveredSet = new Set(discoveredRef.current);
        private portalMarkers: Array<{ x: number; y: number; label: string; href: string; id: string }> = [];
        private landmarkMarkers: Array<{ x: number; y: number; label: string; copy: string; id: string }> = [];
        private discoveryMarkers: TrailDiscovery[] = [];
        private sniffKey!: Phaser.Input.Keyboard.Key;
        private readonly debugZones = typeof window !== "undefined"
          && new URLSearchParams(window.location.search).get("debugZones") === "1";

        constructor() {
          super("HavenTrails");
        }

        preload() {
          this.load.image("trails-bg", "/game-assets/generated/hearthaven-world-poster.png");
          this.load.image("keeper", keeper.image);
          this.load.image("companion", companion.image);
          this.load.image("firefly", "/game-assets/generated/critters/firefly.png");
          this.load.image("butterfly", "/game-assets/generated/critters/butterfly-pink.png");
          this.load.image("dragonfly", "/game-assets/generated/critters/dragonfly.png");
          Object.entries(havenTrailsWorldArt).forEach(([key, path]) => this.load.image(key, path));
        }

        create() {
          this.physics.world.setBounds(90, 90, WORLD_WIDTH - 180, WORLD_HEIGHT - 180);
          this.drawWorld();
          this.createLandmarks();
          this.createPortals();
          this.createTrailDiscoveries();
          this.createActors();
          this.createControls();
          this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
          this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
          this.cameras.main.setZoom(1);
          callbacksRef.current.onStatus?.(this.debugZones
            ? "Zone debug is on. Walkable roads are highlighted; blockers include keeper clearance."
            : "Walk the lantern roads. Press E to explore, or Q when your companion catches a scent.");
        }

        update(_time: number, delta: number) {
          if (!this.player || !this.companionSprite) return;
          const dt = Math.min(0.04, delta / 1000);
          const beforeX = this.player.x;
          const beforeY = this.player.y;
          const speed = this.keys.shift.isDown ? 250 : 170;
          let dx = Number(this.keys.d.isDown || this.keys.right.isDown) - Number(this.keys.a.isDown || this.keys.left.isDown);
          let dy = Number(this.keys.s.isDown || this.keys.down.isDown) - Number(this.keys.w.isDown || this.keys.up.isDown);
          if (dx !== 0 || dy !== 0) {
            this.moveTarget = null;
            this.moveRoute = [];
          } else if (this.moveTarget) {
            dx = this.moveTarget.x - this.player.x;
            dy = this.moveTarget.y - this.player.y;
            const distance = Math.hypot(dx, dy);
            if (distance < 12) {
              this.moveTarget = this.moveRoute.shift() ?? null;
              if (!this.moveTarget) {
                dx = 0;
                dy = 0;
              } else {
                dx = this.moveTarget.x - this.player.x;
                dy = this.moveTarget.y - this.player.y;
              }
            } else {
              dx /= distance;
              dy /= distance;
            }
          }

          if (dx !== 0 || dy !== 0) {
            const length = Math.hypot(dx, dy) || 1;
            const nextX = PhaserModule.Math.Clamp(this.player.x + (dx / length) * speed * dt, 100, WORLD_WIDTH - 100);
            const nextY = PhaserModule.Math.Clamp(this.player.y + (dy / length) * speed * dt, 100, WORLD_HEIGHT - 100);
            if (this.isWalkable(nextX, this.player.y)) this.player.x = nextX;
            if (this.isWalkable(this.player.x, nextY)) this.player.y = nextY;
          }

          this.playerMoving = Math.hypot(this.player.x - beforeX, this.player.y - beforeY) > 0.2;
          const angle = Math.atan2(this.player.y - this.lastPosition.y, this.player.x - this.lastPosition.x);
          const followX = this.player.x - Math.cos(angle || 0) * COMPANION_FOLLOW_DISTANCE;
          const followY = this.player.y - Math.sin(angle || 0) * COMPANION_FOLLOW_DISTANCE + 12;
          this.moveCompanion(followX, followY, dt);
          this.companionSprite.setFlipX(this.player.x < this.companionSprite.x);
          this.companionSprite.rotation = this.playerMoving ? Math.sin(this.time.now / 220) * 0.018 : Math.sin(this.time.now / 900) * 0.008;
          this.player.setFlipX(dx < 0 || (dx === 0 && this.player.flipX));
          this.lastPosition.set(this.player.x, this.player.y);
          this.keeperShadow.setPosition(this.player.x, this.player.y + 10);
          this.companionShadow.setPosition(this.companionSprite.x, this.companionSprite.y + 20);
          this.checkNearbyInteraction();
        }

        private drawWorld() {
          this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "trails-bg").setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT).setDepth(-20);
          this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0xeff3d8, 0.16).setDepth(-19);
          const pathGraphics = this.add.graphics().setDepth(-10);
          pathGraphics.lineStyle(HAVEN_TRAILS_PATH_VISUAL_WIDTH + 24, 0x8d765e, 0.22);
          havenTrailsPaths.forEach((path) => pathGraphics.lineBetween(path.x1, path.y1, path.x2, path.y2));
          pathGraphics.lineStyle(HAVEN_TRAILS_PATH_VISUAL_WIDTH, 0xf8e9c6, 0.94);
          havenTrailsPaths.forEach((path) => pathGraphics.lineBetween(path.x1, path.y1, path.x2, path.y2));
          pathGraphics.lineStyle(3, 0xffffff, 0.58);
          havenTrailsPaths.forEach((path) => pathGraphics.lineBetween(path.x1, path.y1, path.x2, path.y2));

          if (this.debugZones) {
            const debug = this.add.graphics().setDepth(20_000);
            debug.lineStyle(HAVEN_TRAILS_PATH_VISUAL_WIDTH, 0x6da35b, 0.22);
            havenTrailsPaths.forEach((path) => debug.lineBetween(path.x1, path.y1, path.x2, path.y2));
            debug.lineStyle(2, 0x6da35b, 0.9);
            havenTrailsPaths.forEach((path) => {
              debug.strokeCircle(path.x1, path.y1, 10);
              debug.strokeCircle(path.x2, path.y2, 10);
            });
            debug.lineStyle(3, 0xd85b70, 0.9);
            havenTrailsBlockedZones.forEach((zone) => {
              const footprint = getTrailBlockedFootprint(zone);
              debug.strokeRoundedRect(footprint.x, footprint.y, footprint.width, footprint.height, footprint.radius);
              this.add.text(footprint.x, footprint.y - 8, zone.label, {
                color: "#a63852",
                backgroundColor: "#fffaf0",
                fontFamily: "Nunito, sans-serif",
                fontSize: "12px",
                fontStyle: "900",
                padding: { x: 5, y: 3 },
              }).setDepth(20_001);
            });
            havenTrailsPortals.forEach((portal) => {
              debug.lineStyle(2, 0x8e70bd, 0.9);
              debug.strokeCircle(portal.x, portal.y, 22);
            });
          }

          const blockers = this.add.graphics().setDepth(-2);
          havenTrailsBlockedZones.forEach((zone) => {
            const footprint = getTrailBlockedFootprint(zone);
            blockers.fillStyle(0x466546, 0.2);
            blockers.fillRoundedRect(footprint.x, footprint.y, footprint.width, footprint.height, footprint.radius);
            blockers.lineStyle(3, 0x3d5a43, 0.24);
            blockers.strokeRoundedRect(footprint.x, footprint.y, footprint.width, footprint.height, footprint.radius);
          });

          const fireflies = [
            [790, 340], [850, 390], [1260, 490], [1320, 540], [1580, 910], [1770, 900], [1880, 860],
          ];
          fireflies.forEach(([x, y], index) => {
            const sprite = this.add.image(x, y, index % 3 === 0 ? "firefly" : index % 3 === 1 ? "butterfly" : "dragonfly").setDisplaySize(30, 30).setDepth(y + 5);
            this.tweens.add({ targets: sprite, y: y - 12, x: x + (index % 2 ? 9 : -8), alpha: 0.45, duration: 1100 + index * 130, yoyo: true, repeat: -1, ease: "Sine.inOut" });
          });
        }

        private createActors() {
          this.keeperShadow = this.add.ellipse(510, 590, 76, 24, 0x3a2a2a, 0.17).setDepth(570);
          this.companionShadow = this.add.ellipse(456, 610, 52, 16, 0x3a2a2a, 0.14).setDepth(565);
          this.player = this.physics.add.image(510, 570, "keeper").setDisplaySize(96, 144).setOrigin(0.5, 1).setDepth(570);
          this.player.setCollideWorldBounds(true);
          const body = this.player.body as Phaser.Physics.Arcade.Body;
          body.setSize(44, 64).setOffset(106, 300);
          this.companionSprite = this.add.image(456, 594, "companion").setDisplaySize(76, 86).setOrigin(0.5, 1).setDepth(565);
          const accent = this.add.circle(456, 520, 7, toneAccent[companion.toneId] ?? 0xf4b5be, 0.95).setDepth(575);
          // Keep the generated companion art's palette intact. The accent is
          // the place for the selected tone, so a full-image tint does not
          // wash out the character's fur, eyes, or clothing.
          this.tweens.add({ targets: accent, y: 514, alpha: 0.58, duration: 860, yoyo: true, repeat: -1, ease: "Sine.inOut" });
          this.add.text(510, 396, safeName(keeper.name, "Keeper"), { color: "#3a2a2a", fontFamily: "Nunito, sans-serif", fontSize: "14px", fontStyle: "900", stroke: "#fffaf0", strokeThickness: 5 }).setOrigin(0.5).setDepth(1000).setName("keeper-name");
          this.add.text(456, 492, safeName(companion.name, "Casper"), { color: "#5b3f3f", fontFamily: "Nunito, sans-serif", fontSize: "12px", fontStyle: "900", stroke: "#fffaf0", strokeThickness: 4 }).setOrigin(0.5).setDepth(1000).setName("companion-name");
        }

        private createControls() {
          const keyboard = this.input.keyboard!;
          this.keys = {
            w: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.W),
            a: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.A),
            s: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.S),
            d: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.D),
            up: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.UP),
            down: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.DOWN),
            left: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.LEFT),
            right: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.RIGHT),
            shift: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.SHIFT),
            e: keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.E),
          };
          this.sniffKey = keyboard.addKey(PhaserModule.Input.Keyboard.KeyCodes.Q);
          this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
            this.queueMoveTo(point.x, point.y);
            this.hideInteraction();
            callbacksRef.current.onStatus?.(this.moveTarget ? "Following the lantern road..." : "That spot is off the lantern road.");
          });
        }

        private queueMoveTo(x: number, y: number) {
          const route = findHavenTrailsRoute(
            { x: this.player.x, y: this.player.y },
            { x, y },
          );
          this.moveRoute = route.map((point) => new PhaserModule.Math.Vector2(point.x, point.y));
          this.moveTarget = this.moveRoute.shift() ?? null;
        }

        private createPortals() {
          this.portalMarkers = havenTrailsPortals;
          havenTrailsPortals.forEach((portal, index) => {
            const marker = this.add.container(portal.x, portal.y).setDepth(portal.y + 40).setSize(190, 140).setInteractive({ useHandCursor: true });
            marker.add(this.add.image(0, -42, portal.artKey).setDisplaySize(86, 72).setOrigin(0.5, 1));
            const plate = this.add.graphics();
            plate.fillStyle(index % 2 ? 0xddebd1 : 0xf7e2e1, 0.95);
            plate.fillRoundedRect(-95, -22, 190, 70, 18);
            plate.lineStyle(3, index % 2 ? 0x8ab06a : 0xd98291, 0.72);
            plate.strokeRoundedRect(-95, -22, 190, 70, 18);
            marker.add(plate);
            marker.add(this.add.text(0, -3, portal.label, { color: "#3a2a2a", fontFamily: "Nunito, sans-serif", fontSize: "15px", fontStyle: "900", align: "center", wordWrap: { width: 165 } }).setOrigin(0.5));
            marker.add(this.add.text(0, 24, "Walk here · E", { color: "#765a5a", fontFamily: "Nunito, sans-serif", fontSize: "11px", fontStyle: "800" }).setOrigin(0.5));
            marker.on("pointerdown", (event: Phaser.Input.Pointer) => {
              event.event.stopPropagation();
              this.queueMoveTo(portal.x, portal.y + 76);
            });
            this.tweens.add({ targets: marker, y: portal.y - 4, duration: 1200 + index * 100, yoyo: true, repeat: -1, ease: "Sine.inOut" });
          });
        }

        private createLandmarks() {
          this.landmarkMarkers = havenTrailsLandmarks;
          havenTrailsLandmarks.forEach((landmark, index) => {
            const node = this.add.container(landmark.x, landmark.y).setDepth(landmark.y + 30).setSize(84, 84).setInteractive({ useHandCursor: true });
            const glow = this.add.circle(0, 0, 38, index % 2 ? 0xc0a8dc : 0xf4b5be, 0.18);
            const art = this.add.image(0, -12, landmark.artKey).setDisplaySize(74, 74).setOrigin(0.5, 1);
            node.add([glow, art]);
            node.add(this.add.text(0, 52, landmark.label, { color: "#3a2a2a", fontFamily: "Nunito, sans-serif", fontSize: "12px", fontStyle: "900", stroke: "#fffaf0", strokeThickness: 4 }).setOrigin(0.5));
            node.on("pointerdown", (event: Phaser.Input.Pointer) => {
              event.event.stopPropagation();
              this.queueMoveTo(landmark.x, landmark.y + 78);
              callbacksRef.current.onStatus?.(`Walking toward ${landmark.label}...`);
            });
            this.tweens.add({ targets: glow, alpha: 0.34, scale: 1.25, duration: 900 + index * 120, yoyo: true, repeat: -1, ease: "Sine.inOut" });
          });
        }

        private createTrailDiscoveries() {
          const dayKey = getTrailDiscoveryDayKey();
          this.discoveryMarkers = getDailyTrailDiscoveries(dayKey);
          this.discoveryMarkers.forEach((discovery, index) => {
            if (this.discoveredSet.has(discovery.id)) return;
            const node = this.add.container(discovery.x, discovery.y)
              .setDepth(discovery.y + 8)
              .setSize(64, 64)
              .setInteractive({ useHandCursor: true });
            const glow = this.add.circle(0, 0, 24, index % 2 ? 0xf4b5be : 0xc0a8dc, 0.18);
            const firefly = this.add.image(0, -6, "firefly").setDisplaySize(28, 28).setOrigin(0.5, 1);
            const ring = this.add.graphics();
            ring.lineStyle(2, index % 2 ? 0xd98291 : 0x9d84c8, 0.6);
            ring.strokeCircle(0, 2, 19);
            node.add([glow, ring, firefly]);
            node.add(this.add.text(0, 27, "Sniff", {
              color: "#5b3f3f",
              fontFamily: "Nunito, sans-serif",
              fontSize: "10px",
              fontStyle: "900",
              stroke: "#fffaf0",
              strokeThickness: 4,
            }).setOrigin(0.5));
            node.on("pointerdown", (event: Phaser.Input.Pointer) => {
              event.event.stopPropagation();
              this.queueMoveTo(discovery.x, discovery.y);
              callbacksRef.current.onStatus?.(`Your companion caught a scent near ${discovery.label}.`);
            });
            this.tweens.add({
              targets: [glow, firefly],
              y: "-=6",
              alpha: 0.46,
              duration: 900 + index * 100,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
            node.setName(`trail-discovery-${discovery.id}`);
          });
        }

        private isWalkable(x: number, y: number) {
          return isHavenTrailsWalkable(x, y);
        }

        private moveCompanion(targetX: number, targetY: number, dt: number) {
          const amount = Math.min(1, dt * COMPANION_FOLLOW_LERP);
          const nextX = PhaserModule.Math.Linear(this.companionSprite.x, targetX, amount);
          const nextY = PhaserModule.Math.Linear(this.companionSprite.y, targetY, amount);

          // Move each axis independently so a tree, pond, or thicket blocks
          // the pet in the same way it blocks the keeper instead of letting a
          // diagonal interpolation cut through the scenery.
          if (this.isWalkable(nextX, this.companionSprite.y)) this.companionSprite.x = nextX;
          if (this.isWalkable(this.companionSprite.x, nextY)) this.companionSprite.y = nextY;

          const distance = PhaserModule.Math.Distance.Between(
            this.companionSprite.x,
            this.companionSprite.y,
            this.player.x,
            this.player.y,
          );
          if (distance < 150) return;

          // If a branch or blocker separated the pair, choose a nearby valid
          // point around the keeper. This is a gentle catch-up, not a teleport
          // through an obstacle, and keeps the companion recoverable on every
          // road junction.
          const candidates = [
            { x: this.player.x - COMPANION_FOLLOW_DISTANCE, y: this.player.y + 12 },
            { x: this.player.x + COMPANION_FOLLOW_DISTANCE, y: this.player.y + 12 },
            { x: this.player.x, y: this.player.y - COMPANION_FOLLOW_DISTANCE },
            { x: this.player.x, y: this.player.y + COMPANION_FOLLOW_DISTANCE },
          ].filter((candidate) => this.isWalkable(candidate.x, candidate.y));
          const recovery = candidates.sort(
            (a, b) =>
              PhaserModule.Math.Distance.Between(this.companionSprite.x, this.companionSprite.y, a.x, a.y)
              - PhaserModule.Math.Distance.Between(this.companionSprite.x, this.companionSprite.y, b.x, b.y),
          )[0];
          if (recovery) {
            this.companionSprite.setPosition(recovery.x, recovery.y);
          }
        }

        private checkNearbyInteraction() {
          const nearDiscovery = this.discoveryMarkers.find((discovery) =>
            !this.discoveredSet.has(discovery.id)
            && PhaserModule.Math.Distance.Between(this.player.x, this.player.y, discovery.x, discovery.y) < 100,
          );
          if (nearDiscovery) {
            this.showInteraction(`${nearDiscovery.label}\nQ to sniff`, nearDiscovery.x, nearDiscovery.y - 52);
            if (PhaserModule.Input.Keyboard.JustDown(this.sniffKey)) {
              this.discoveredSet.add(nearDiscovery.id);
              playCozyCue("unlock");
              callbacksRef.current.onEvent?.({
                type: "discovery",
                id: nearDiscovery.id,
                label: nearDiscovery.label,
                copy: nearDiscovery.copy,
              });
              callbacksRef.current.onStatus?.(`${nearDiscovery.label}: ${nearDiscovery.copy}`);
              const node = this.children.getByName(`trail-discovery-${nearDiscovery.id}`);
              if (node) {
                this.tweens.add({
                  targets: node,
                  scale: 1.35,
                  alpha: 0,
                  duration: 360,
                  onComplete: () => node.destroy(),
                });
              }
            }
            return;
          }
          const nearPortal = this.portalMarkers.find((portal) => PhaserModule.Math.Distance.Between(this.player.x, this.player.y, portal.x, portal.y) < 100);
          const nearLandmark = this.landmarkMarkers.find((landmark) => PhaserModule.Math.Distance.Between(this.player.x, this.player.y, landmark.x, landmark.y) < 100);
          if (nearPortal) {
            this.showInteraction(`${nearPortal.label}\nPress E to enter`, nearPortal.x, nearPortal.y - 70);
            if (PhaserModule.Input.Keyboard.JustDown(this.keys.e)) {
              playCozyCue("move");
              callbacksRef.current.onEvent?.({ type: "portal", id: nearPortal.id, label: nearPortal.label, href: nearPortal.href });
            }
            return;
          }
          if (nearLandmark) {
            this.showInteraction(`${nearLandmark.label}\nPress E to explore`, nearLandmark.x, nearLandmark.y - 75);
            if (PhaserModule.Input.Keyboard.JustDown(this.keys.e)) {
              const firstVisit = !this.discoveredSet.has(nearLandmark.id);
              this.discoveredSet.add(nearLandmark.id);
              playCozyCue(firstVisit ? "unlock" : "pet");
              callbacksRef.current.onEvent?.({ type: "landmark", id: nearLandmark.id, label: nearLandmark.label });
              callbacksRef.current.onStatus?.(firstVisit ? `${nearLandmark.label}: ${nearLandmark.copy}` : `${nearLandmark.label} is still glowing softly.`);
            }
            return;
          }
          this.hideInteraction();
        }

        private showInteraction(copy: string, x: number, y: number) {
          if (!this.interactionLabel) {
            this.interactionLabel = this.add.container(x, y).setDepth(6000);
            const bg = this.add.graphics();
            bg.fillStyle(0xfffcf3, 0.96);
            bg.fillRoundedRect(-120, -28, 240, 56, 16);
            bg.lineStyle(2, 0xc0a8dc, 0.75);
            bg.strokeRoundedRect(-120, -28, 240, 56, 16);
            this.interactionLabel.add(bg);
            this.interactionLabel.add(this.add.text(0, 0, "", { color: "#3a2a2a", fontFamily: "Nunito, sans-serif", fontSize: "13px", fontStyle: "900", align: "center", lineSpacing: 4 }).setOrigin(0.5).setName("copy"));
          }
          this.interactionLabel.setPosition(x, y);
          this.interactionLabel.setVisible(true);
          (this.interactionLabel.getByName("copy") as Phaser.GameObjects.Text).setText(copy);
        }

        private hideInteraction() {
          this.interactionLabel?.setVisible(false);
        }
      }

      game = new PhaserModule.Game({
        type: PhaserModule.AUTO,
        parent: mount,
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        backgroundColor: "#eef0d9",
        scale: { mode: PhaserModule.Scale.FIT, autoCenter: PhaserModule.Scale.CENTER_BOTH },
          physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
        scene: HavenTrailsScene,
      });
    }

    boot().catch((error) => callbacksRef.current.onStatus?.(error instanceof Error ? error.message : "Haven Trails could not open."));
    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [companion.image, companion.speciesId, companion.toneId, keeper.image]);

  return (
    <div
      ref={mountRef}
      aria-label="Interactive Haven Trails exploration map"
      className="mx-auto block w-full overflow-hidden bg-[#eef0d9]"
      role="application"
      style={{ aspectRatio: `${VIEW_WIDTH} / ${VIEW_HEIGHT}` }}
      tabIndex={0}
    />
  );
}
