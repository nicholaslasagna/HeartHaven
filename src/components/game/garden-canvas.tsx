"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";

type GardenPlotState = {
  id: string;
  name: string;
  stage: string;
  progress: number;
  accent: string;
  status: string;
};

type GardenCanvasProps = {
  variant: "personal" | "partner";
  plots: GardenPlotState[];
};

const GARDEN_WIDTH = 960;
const GARDEN_HEIGHT = 620;

export function GardenCanvas({ variant, plots }: GardenCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState(
    variant === "partner" ? "The shared garden is glowing under the guardian's watch." : "Click plots to water and inspect growth.",
  );

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class HeartHavenGardenScene extends PhaserModule.Scene {
        private butterflies: Phaser.GameObjects.Container[] = [];
        private fireflies: Phaser.GameObjects.Arc[] = [];

        constructor() {
          super("HeartHavenGarden");
        }

        create() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.drawBackdrop();
          this.drawGardenGround();
          this.drawLanternPath();
          this.drawWaterFeature();
          this.drawPlots();
          if (variant === "partner") {
            this.drawPartnerHeart();
          } else {
            this.drawPersonalGardenCenterpiece();
          }
          this.drawButterflies();
          this.drawFireflies();
          this.addTitle();
          // TODO: Replace local plot care events with Supabase garden_events and shared_garden_plots writes.
          // TODO: Subscribe partner garden scene to Supabase Realtime so both linked players see care pulses.
        }

        update(_time: number, delta: number) {
          this.butterflies.forEach((butterfly, index) => {
            butterfly.x += Math.sin((this.time.now + index * 400) * 0.0012) * 0.34;
            butterfly.y += Math.cos((this.time.now + index * 300) * 0.001) * 0.18;
          });

          this.fireflies.forEach((firefly, index) => {
            firefly.setAlpha(0.22 + Math.sin((this.time.now + index * 240) * 0.004) * 0.22);
            firefly.y -= delta * 0.003;
            if (firefly.y < 104) firefly.y = PhaserModule.Math.Between(360, 528);
          });
        }

        private drawBackdrop() {
          const sky = this.add.graphics();
          sky.fillGradientStyle(0xfdf8ee, 0xfbe3e3, 0xefe6f7, 0xe4efd7, 1);
          sky.fillRect(0, 0, GARDEN_WIDTH, GARDEN_HEIGHT);

          const distant = this.add.graphics();
          distant.fillStyle(0xddceec, 0.42);
          distant.fillEllipse(210, 224, 460, 168);
          distant.fillStyle(0xc7e0eb, 0.34);
          distant.fillEllipse(720, 206, 520, 166);
          distant.fillStyle(0xe4efd7, 0.72);
          distant.fillEllipse(472, 270, 760, 190);
        }

        private drawGardenGround() {
          const ground = this.add.graphics();
          ground.fillStyle(0x3a2a2a, 0.12);
          ground.fillEllipse(482, 422, 760, 286);
          ground.fillGradientStyle(0xfdf8ee, 0xe4efd7, 0xd8e9c8, 0xfbe3e3, 1);
          ground.fillPoints(
            [
              new PhaserModule.Geom.Point(190, 226),
              new PhaserModule.Geom.Point(766, 226),
              new PhaserModule.Geom.Point(868, 468),
              new PhaserModule.Geom.Point(480, 574),
              new PhaserModule.Geom.Point(92, 468),
            ],
            true,
          );
          ground.lineStyle(4, 0xa9c58a, 0.35);
          ground.strokePoints(
            [
              new PhaserModule.Geom.Point(190, 226),
              new PhaserModule.Geom.Point(766, 226),
              new PhaserModule.Geom.Point(868, 468),
              new PhaserModule.Geom.Point(480, 574),
              new PhaserModule.Geom.Point(92, 468),
            ],
            true,
          );

          const path = this.add.graphics();
          path.lineStyle(34, 0xf5e9d0, 0.82);
          path.beginPath();
          path.moveTo(480, 560);
          path.lineTo(480, 420);
          path.lineTo(variant === "partner" ? 480 : 340, 302);
          path.strokePath();
          path.lineStyle(4, 0xffffff, 0.28);
          path.strokePath();
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
              ]
            : [
                [380, 482],
                [574, 480],
                [330, 390],
                [452, 360],
              ];

          positions.forEach(([x, y], index) => {
            const lantern = this.add.container(x, y).setDepth(y);
            lantern.add(this.add.ellipse(0, 14, 44, 14, 0x3a2a2a, 0.12));
            lantern.add(this.add.rectangle(0, -2, 26, 42, 0xfaebc2).setStrokeStyle(2, 0x9c6f1f, 0.5));
            const glow = this.add.circle(0, 2, 24, 0xfaebc2, 0.18);
            lantern.addAt(glow, 0);
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
          const pond = this.add.container(726, 392).setDepth(392);
          pond.add(this.add.ellipse(0, 12, 162, 72, 0x5e94b0, 0.32).setStrokeStyle(3, 0xc7e0eb, 0.72));
          pond.add(this.add.ellipse(8, 2, 118, 42, 0xc7e0eb, 0.52));
          for (let index = 0; index < 5; index += 1) {
            const ripple = this.add.ellipse(0, 4, 48 + index * 16, 18 + index * 5, 0xffffff, 0);
            ripple.setStrokeStyle(2, 0xffffff, 0.22);
            pond.add(ripple);
            this.tweens.add({
              targets: ripple,
              scale: 1.18,
              alpha: 0.3,
              duration: 1400 + index * 160,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private drawPlots() {
          const positions = variant === "partner"
            ? [
                [260, 376],
                [700, 376],
                [318, 492],
                [642, 492],
              ]
            : [
                [252, 360],
                [426, 430],
                [612, 352],
                [628, 492],
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
          for (let index = 0; index < 5; index += 1) {
            const stem = this.add.rectangle(-36 + index * 18, -2, 6, 50 * growth, 0x6e9651);
            stem.setOrigin(0.5, 1);
            container.add(stem);
            const bloom = this.add.circle(-36 + index * 18, -4 - 46 * growth, 8 + growth * 7, color, 0.86);
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
          zone.on("pointerdown", () => this.waterPlot(plot, x, y));
          zone.on("pointerover", () => setStatus(`${plot.name}: ${plot.stage}, ${plot.progress}% grown, ${plot.status}.`));
        }

        private waterPlot(plot: GardenPlotState, x: number, y: number) {
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
          const arbor = this.add.container(346, 292).setDepth(292);
          arbor.add(this.add.arc(0, 8, 72, Math.PI, 0, false, 0xffffff, 0).setStrokeStyle(9, 0x8b5e3c, 0.48));
          arbor.add(this.add.rectangle(-64, 36, 12, 112, 0x8b5e3c, 0.52));
          arbor.add(this.add.rectangle(64, 36, 12, 112, 0x8b5e3c, 0.52));
          for (let index = 0; index < 16; index += 1) {
            arbor.add(this.add.circle(-66 + index * 9, -36 + Math.sin(index) * 16, 7, 0xf6cfd2, 0.9));
          }
        }

        private drawPartnerHeart() {
          this.createMemoryTree();
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
          statue.add(this.add.rectangle(0, 36, 94, 32, 0xead9b5).setStrokeStyle(3, 0xc9a998, 0.5));
          statue.add(this.add.ellipse(0, -4, 76, 54, 0xfffcf3).setStrokeStyle(4, 0xc9a998, 0.58));
          statue.add(this.add.circle(-26, -28, 20, 0xfffcf3).setStrokeStyle(3, 0xc9a998, 0.58));
          statue.add(this.add.triangle(-38, -52, -12, -26, -34, -18, -52, -18, 0xfffcf3).setStrokeStyle(2, 0xc9a998, 0.5));
          statue.add(this.add.circle(-32, -30, 3, 0x3a2a2a));
          const zone = this.add.zone(480, 424, 130, 106).setInteractive({ useHandCursor: true });
          zone.on("pointerdown", () => {
            setStatus("The garden guardian is protecting the shared gate.");
            this.spawnHeartBurst(480, 380);
          });
        }

        private createQuestMarker(x: number, y: number, title: string, message: string) {
          const marker = this.add.container(x, y).setDepth(y);
          marker.add(this.add.circle(0, 0, 34, 0xfffcf3, 0.9).setStrokeStyle(3, 0xf6cfd2, 0.8));
          marker.add(this.add.star(0, 0, 5, 8, 18, 0xd87e8c, 0.82));
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
          const count = variant === "partner" ? 8 : 5;
          for (let index = 0; index < count; index += 1) {
            const x = PhaserModule.Math.Between(130, 830);
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
              PhaserModule.Math.Between(92, 868),
              PhaserModule.Math.Between(268, 540),
              PhaserModule.Math.Between(2, 4),
              0xfaebc2,
              0.3,
            ).setDepth(5900);
            this.fireflies.push(firefly);
          }
        }

        private addTitle() {
          this.add
            .text(34, 28, variant === "partner" ? "Shared Heart Garden" : "Moonberry Meadow", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "23px",
            })
            .setDepth(7000);
          this.add
            .text(34, 58, variant === "partner" ? "Click memories, quests, flowers, and the guardian." : "Click plots to water them.", {
              color: "#84675F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "13px",
              fontStyle: "800",
            })
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
  }, [plots, variant]);

  return (
    <section className="overflow-hidden rounded-lg border border-garden-300/50 bg-garden-100 shadow-[0_24px_70px_rgba(76,110,54,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-garden-300/40 bg-white/68 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-garden-700">
            {variant === "partner" ? "Shared living garden" : "Living garden"}
          </p>
          <p className="text-sm font-black text-ink-900">
            {variant === "partner" ? "Memory tree, quests, lantern path, and guardian watch" : "Animated plots, water, butterflies, and growth"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-garden-100 px-2.5 py-1">Click flowers</span>
          <span className="rounded-md bg-sky-100 px-2.5 py-1">Water effects</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Lantern glow</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label={
          variant === "partner"
            ? "Interactive shared garden canvas with memory tree, quests, guardian statue, and flowers"
            : "Interactive garden canvas with animated plots, water effects, lanterns, and butterflies"
        }
        className="min-h-[380px] w-full bg-garden-100 [&_canvas]:!h-auto [&_canvas]:!w-full"
        role="application"
        tabIndex={0}
      />
      <div className="border-t border-garden-300/40 bg-white/72 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}
