"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { GameReward } from "@/lib/game/rewards";

type BowlingCanvasProps = {
  onReward?: (reward: GameReward) => void;
};

type BowlingPin = {
  node: Phaser.GameObjects.Container;
  standing: boolean;
};

const GAME_WIDTH = 920;
const GAME_HEIGHT = 600;
const MAX_FRAMES = 5;

export function BowlingCanvas({ onReward }: BowlingCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Drag from the ball to aim, then release to roll.");

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class BowlingScene extends PhaserModule.Scene {
        private ball!: Phaser.GameObjects.Container;
        private ballShadow!: Phaser.GameObjects.Ellipse;
        private aimLine!: Phaser.GameObjects.Graphics;
        private pins: BowlingPin[] = [];
        private frame = 1;
        private totalScore = 0;
        private knockedThisFrame = 0;
        private rolling = false;
        private aiming = false;
        private gameOver = false;
        private vx = 0;
        private vy = 0;
        private frameText!: Phaser.GameObjects.Text;
        private scoreText!: Phaser.GameObjects.Text;
        private pinsText!: Phaser.GameObjects.Text;
        private rewardLayer?: Phaser.GameObjects.Container;

        constructor() {
          super("MoonberryBowling");
        }

        preload() {
          this.load.image("moonberry-bowling-bg", "/game-assets/generated/moonberry-bowling-bg.png");
          this.load.image("casper-sprite", "/game-assets/generated/casper-sprite.png");
          this.load.spritesheet("minigame-props", "/game-assets/generated/minigame-props-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
        }

        create() {
          this.drawBackdrop();
          this.createMascot();
          this.createHud();
          this.createPins();
          this.createBall();
          this.aimLine = this.add.graphics().setDepth(6000);

          this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (this.gameOver || this.rolling) return;
            const distance = PhaserModule.Math.Distance.Between(pointer.x, pointer.y, this.ball.x, this.ball.y);
            if (distance < 96) {
              this.aiming = true;
              this.drawAim(pointer);
              setStatus("Aim toward the pins. Longer drag means more power.");
            }
          });

          this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
            if (this.aiming) this.drawAim(pointer);
          });

          this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
            if (!this.aiming) return;
            this.aiming = false;
            this.roll(pointer);
          });

          setStatus("Drag from the moonberry ball to aim, then release to roll.");
        }

        update(_time: number, delta: number) {
          if (!this.rolling) return;

          const dt = delta / 1000;
          this.ball.x += this.vx * dt;
          this.ball.y += this.vy * dt;
          this.vx *= 0.996;
          this.vy *= 0.998;
          this.ball.rotation += this.vx * dt * 0.035;

          if (this.ball.x < 174 || this.ball.x > 746) {
            this.vx *= -0.42;
            this.ball.x = PhaserModule.Math.Clamp(this.ball.x, 174, 746);
          }

          this.ballShadow.setPosition(this.ball.x, this.ball.y + 24);
          this.ball.setDepth(this.ball.y);
          this.ballShadow.setDepth(this.ball.y - 1);
          this.checkPinHits();

          if (this.ball.y < 72 || Math.abs(this.vy) < 45) {
            this.finishFrame();
          }
        }

        private drawBackdrop() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "moonberry-bowling-bg").setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-20);
          this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xfffcf3, 0.06).setDepth(-19);

          const bg = this.add.graphics();
          bg.fillGradientStyle(0xfdf8ee, 0xfbe3e3, 0xefe6f7, 0xe4efd7, 0.08);
          bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

          bg.fillStyle(0xffffff, 0.38);
          bg.fillRoundedRect(70, 78, 780, 468, 28);
          bg.lineStyle(3, 0xf6cfd2, 0.45);
          bg.strokeRoundedRect(70, 78, 780, 468, 28);

          const lane = this.add.graphics();
          lane.fillGradientStyle(0xf5e9d0, 0xfdf8ee, 0xead9b5, 0xf8d9bf, 0.1);
          lane.fillPoints(
            [
              new PhaserModule.Geom.Point(318, 112),
              new PhaserModule.Geom.Point(602, 112),
              new PhaserModule.Geom.Point(752, 536),
              new PhaserModule.Geom.Point(168, 536),
            ],
            true,
          );
          lane.lineStyle(4, 0x9c6f1f, 0.3);
          lane.strokePoints(
            [
              new PhaserModule.Geom.Point(318, 112),
              new PhaserModule.Geom.Point(602, 112),
              new PhaserModule.Geom.Point(752, 536),
              new PhaserModule.Geom.Point(168, 536),
            ],
            true,
          );

          for (let index = 0; index < 8; index += 1) {
            const x = 250 + index * 60;
            lane.lineStyle(2, 0xffffff, 0.22);
            lane.lineBetween(x, 530, PhaserModule.Math.Linear(374, 546, index / 7), 124);
          }

          for (let index = 0; index < 18; index += 1) {
            const sparkle = this.add.star(
              PhaserModule.Math.Between(100, 820),
              PhaserModule.Math.Between(82, 520),
              4,
              2,
              PhaserModule.Math.Between(4, 8),
              index % 2 === 0 ? 0xffffff : 0xfaebc2,
              PhaserModule.Math.FloatBetween(0.12, 0.36),
            );
            this.tweens.add({
              targets: sparkle,
              alpha: PhaserModule.Math.FloatBetween(0.22, 0.64),
              scale: 1.2,
              duration: PhaserModule.Math.Between(1100, 2200),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private createMascot() {
          const mascot = this.add.container(108, 472).setDepth(472);
          mascot.add(this.add.ellipse(0, 42, 88, 22, 0x3a2a2a, 0.16));
          mascot.add(this.add.image(0, -18, "casper-sprite").setDisplaySize(112, 112));
          this.tweens.add({
            targets: mascot,
            y: mascot.y - 5,
            duration: 980,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createHud() {
          const style = {
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "16px",
            fontStyle: "900",
          };
          this.add
            .text(28, 24, "Moonberry Bowling", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "25px",
            })
            .setDepth(7000);
          this.frameText = this.add.text(30, 58, "", style).setDepth(7000);
          this.scoreText = this.add.text(214, 58, "", { ...style, color: "#8E70BD" }).setDepth(7000);
          this.pinsText = this.add.text(GAME_WIDTH - 170, 58, "", style).setDepth(7000);
          this.updateHud();
        }

        private createBall() {
          this.ballShadow = this.add.ellipse(460, 526, 84, 24, 0x3a2a2a, 0.16).setDepth(500);
          this.ball = this.add.container(460, 496).setDepth(496);
          this.ball.add(this.add.image(0, 0, "minigame-props", 0).setDisplaySize(112, 150));
          this.ball.setSize(76, 76);
          this.ball.setInteractive({ useHandCursor: true });
        }

        private createPins() {
          this.pins.forEach((pin) => pin.node.destroy());
          this.pins = [];

          const positions = [
            [460, 124],
            [428, 158],
            [492, 158],
            [396, 192],
            [460, 192],
            [524, 192],
            [364, 226],
            [428, 226],
            [492, 226],
            [556, 226],
          ];

          positions.forEach(([x, y], index) => {
            const pin = this.add.container(x, y).setDepth(y);
            pin.add(this.add.ellipse(0, 31, 34, 10, 0x3a2a2a, 0.14));
            pin.add(this.add.image(0, -10, "minigame-props", 1).setDisplaySize(86, 136));
            this.pins.push({ node: pin, standing: true });
            if (index === 0) {
              this.tweens.add({
                targets: pin,
                y: y - 2,
                duration: 1200,
                yoyo: true,
                repeat: -1,
                ease: "Sine.inOut",
              });
            }
          });
        }

        private drawAim(pointer: Phaser.Input.Pointer) {
          const targetX = PhaserModule.Math.Clamp(pointer.x, 250, 670);
          const targetY = PhaserModule.Math.Clamp(pointer.y, 90, this.ball.y - 45);
          this.aimLine.clear();
          this.aimLine.lineStyle(7, 0xd87e8c, 0.42);
          this.aimLine.lineBetween(this.ball.x, this.ball.y, targetX, targetY);
          this.aimLine.lineStyle(2, 0xffffff, 0.72);
          this.aimLine.lineBetween(this.ball.x, this.ball.y, targetX, targetY);
        }

        private roll(pointer: Phaser.Input.Pointer) {
          this.aimLine.clear();
          const targetX = PhaserModule.Math.Clamp(pointer.x, 250, 670);
          const targetY = PhaserModule.Math.Clamp(pointer.y, 90, this.ball.y - 45);
          const dx = targetX - this.ball.x;
          const dy = targetY - this.ball.y;
          const distance = PhaserModule.Math.Clamp(Math.hypot(dx, dy), 90, 360);
          const power = PhaserModule.Math.Linear(0.68, 1.18, (distance - 90) / 270);
          this.vx = dx * 1.25 * power;
          this.vy = -430 * power;
          this.rolling = true;
          setStatus("Moonberry ball rolling...");
        }

        private checkPinHits() {
          this.pins.forEach((pin) => {
            if (!pin.standing) return;
            const distance = PhaserModule.Math.Distance.Between(this.ball.x, this.ball.y, pin.node.x, pin.node.y);
            if (distance < 38) {
              this.knockPin(pin, this.vx >= 0 ? 1 : -1);
              this.pins.forEach((nearby) => {
                if (!nearby.standing) return;
                const pinDistance = PhaserModule.Math.Distance.Between(pin.node.x, pin.node.y, nearby.node.x, nearby.node.y);
                if (pinDistance < 76 && PhaserModule.Math.FloatBetween(0, 1) > 0.34) {
                  this.knockPin(nearby, nearby.node.x > pin.node.x ? 1 : -1);
                }
              });
            }
          });
        }

        private knockPin(pin: BowlingPin, direction: number) {
          pin.standing = false;
          this.knockedThisFrame += 1;
          this.tweens.add({
            targets: pin.node,
            x: pin.node.x + direction * PhaserModule.Math.Between(28, 64),
            y: pin.node.y + PhaserModule.Math.Between(8, 28),
            rotation: direction * PhaserModule.Math.FloatBetween(0.8, 1.4),
            alpha: 0.46,
            duration: 360,
            ease: "Back.out",
          });
          this.spawnSpark(pin.node.x, pin.node.y);
          this.updateHud();
        }

        private spawnSpark(x: number, y: number) {
          for (let index = 0; index < 5; index += 1) {
            const spark = this.add.star(x, y, 5, 3, 9, index % 2 === 0 ? 0xfaebc2 : 0xf6cfd2, 0.92).setDepth(6500);
            this.tweens.add({
              targets: spark,
              x: x + PhaserModule.Math.Between(-42, 42),
              y: y - PhaserModule.Math.Between(12, 58),
              alpha: 0,
              scale: 0.2,
              duration: 560,
              ease: "Sine.out",
              onComplete: () => spark.destroy(),
            });
          }
        }

        private finishFrame() {
          if (!this.rolling) return;
          this.rolling = false;
          const framePoints = this.knockedThisFrame * 10 + (this.knockedThisFrame === 10 ? 20 : 0);
          this.totalScore += framePoints;
          this.updateHud();
          setStatus(`${this.knockedThisFrame} pins down. Frame score ${framePoints}.`);

          if (this.frame >= MAX_FRAMES) {
            this.time.delayedCall(720, () => this.showRewards());
          } else {
            this.time.delayedCall(840, () => this.nextFrame());
          }
        }

        private nextFrame() {
          this.frame += 1;
          this.knockedThisFrame = 0;
          this.ball.setPosition(460, 496);
          this.ball.setRotation(0);
          this.ballShadow.setPosition(460, 526);
          this.vx = 0;
          this.vy = 0;
          this.createPins();
          this.updateHud();
          setStatus(`Frame ${this.frame}. Casper is cheering from the cozy lane.`);
        }

        private updateHud() {
          this.frameText?.setText(`Frame ${this.frame}/${MAX_FRAMES}`);
          this.scoreText?.setText(`Score ${this.totalScore}`);
          this.pinsText?.setText(`Pins ${this.knockedThisFrame}/10`);
        }

        private showRewards() {
          this.gameOver = true;
          const coins = 100 + this.totalScore * 2;
          const hearts = this.totalScore >= 360 ? 5 : this.totalScore >= 260 ? 4 : this.totalScore >= 160 ? 3 : 2;
          const layer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(8000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-216, -140, 432, 280, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-216, -140, 432, 280, 24);
          layer.add(bg);
          layer.add(this.add.text(0, -88, "Bowling Complete", {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "27px",
          }).setOrigin(0.5));
          layer.add(this.add.text(0, -24, `Final score ${this.totalScore}\nReward ${coins} coins + ${hearts} hearts\nCasper saved a moonberry sticker for you.`, {
            align: "center",
            color: "#5B3F3F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "17px",
            fontStyle: "800",
            lineSpacing: 8,
            wordWrap: { width: 360 },
          }).setOrigin(0.5));
          const restart = this.add.text(0, 92, "Bowl again", {
            color: "#FFFDF6",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
            backgroundColor: "#D87E8C",
            padding: { x: 18, y: 10 },
          }).setOrigin(0.5).setInteractive({ useHandCursor: true });
          restart.on("pointerdown", () => this.restartRound());
          layer.add(restart);
          this.rewardLayer = layer;
          onReward?.({
            gameId: "moonberry-bowling",
            label: "Moonberry Bowling",
            score: this.totalScore,
            coins,
            hearts,
          });
          setStatus(`Bowling rewards awarded: ${coins} coins and ${hearts} hearts.`);
        }

        private restartRound() {
          this.rewardLayer?.destroy(true);
          this.rewardLayer = undefined;
          this.frame = 1;
          this.totalScore = 0;
          this.knockedThisFrame = 0;
          this.gameOver = false;
          this.ball.setPosition(460, 496);
          this.ball.setRotation(0);
          this.ballShadow.setPosition(460, 526);
          this.createPins();
          this.updateHud();
          setStatus("New bowling round started.");
        }
      }

      game = new PhaserModule.Game({
        type: PhaserModule.AUTO,
        parent: mountRef.current,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        backgroundColor: "#fbf3e2",
        scale: {
          mode: PhaserModule.Scale.FIT,
          autoCenter: PhaserModule.Scale.CENTER_BOTH,
        },
        scene: BowlingScene,
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load Moonberry Bowling");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [onReward]);

  return (
    <section className="overflow-hidden rounded-lg border border-honey-500/30 bg-cream-100 shadow-[0_24px_70px_rgba(156,111,31,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-honey-500/20 bg-white/70 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-honey-700">Playable mini-game</p>
          <p className="text-sm font-black text-ink-900">Moonberry Bowling</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Drag to aim</span>
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Knock pins</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Earn rewards</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive Moonberry Bowling game canvas with aiming, rolling, pin collisions, scoring, and rewards"
        className="min-h-[360px] w-full bg-cream-100 [&_canvas]:!h-auto [&_canvas]:!w-full"
        role="application"
        tabIndex={0}
      />
      <div className="border-t border-honey-500/20 bg-white/70 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}
