"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { GameReward } from "@/lib/game/rewards";
import { playCozyCue } from "@/lib/game/cozy-audio";

export type CozyQuestVariant = "lantern-relay" | "heart-hunt";

type CozyQuestCanvasProps = {
  variant: CozyQuestVariant;
  onReward?: (reward: GameReward) => void;
};

type QuestTarget = {
  node: Phaser.GameObjects.Container;
  found: boolean;
};

const GAME_WIDTH = 900;
const GAME_HEIGHT = 560;

const questCopy: Record<CozyQuestVariant, { title: string; label: string; seconds: number }> = {
  "lantern-relay": {
    title: "Lantern Relay",
    label: "Light the lantern path in order.",
    seconds: 45,
  },
  "heart-hunt": {
    title: "Heart Hunt",
    label: "Find the hidden keepsakes before time runs out.",
    seconds: 50,
  },
};

export function CozyQuestCanvas({ variant, onReward }: CozyQuestCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState(questCopy[variant].label);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class CozyQuestScene extends PhaserModule.Scene {
        private targets: QuestTarget[] = [];
        private currentIndex = 0;
        private score = 0;
        private timeLeft = questCopy[variant].seconds;
        private elapsed = 0;
        private gameOver = false;
        private scoreText!: Phaser.GameObjects.Text;
        private timerText!: Phaser.GameObjects.Text;
        private progressText!: Phaser.GameObjects.Text;
        private rewardLayer?: Phaser.GameObjects.Container;

        constructor() {
          super("CozyQuest");
        }

        preload() {
          this.load.image("cozy-room-bg", "/game-assets/generated/cozy-room-bg.png");
          this.load.image("moonberry-garden-bg", "/game-assets/generated/moonberry-garden-bg.png");
          this.load.image("casper-sprite", "/game-assets/generated/casper-sprite.png");
          this.load.spritesheet("minigame-props", "/game-assets/generated/minigame-props-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
        }

        create() {
          this.drawBackdrop();
          this.createCasperMascot();
          this.createHud();
          if (variant === "lantern-relay") {
            this.createLanternRelay();
          } else {
            this.createHeartHunt();
          }
          this.updateHud();
          setStatus(questCopy[variant].label);
          // TODO: Replace local clicks with Supabase game_moves rows for party co-op rounds.
        }

        update(_time: number, delta: number) {
          if (this.gameOver) return;
          this.elapsed += delta;
          this.timeLeft = Math.max(0, questCopy[variant].seconds - this.elapsed / 1000);
          this.updateHud();
          if (this.timeLeft <= 0) this.endRound();
        }

        private drawBackdrop() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          const bgKey = variant === "lantern-relay" ? "moonberry-garden-bg" : "cozy-room-bg";
          this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, bgKey).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-20);
          this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xfffcf3, 0.16).setDepth(-19);

          const bg = this.add.graphics();
          bg.fillGradientStyle(0xfdf8ee, 0xfbe3e3, 0xefe6f7, 0xe4efd7, 0.1);
          bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
          bg.fillStyle(0xffffff, 0.35);
          bg.fillRoundedRect(52, 86, GAME_WIDTH - 104, 422, 26);
          bg.lineStyle(3, variant === "lantern-relay" ? 0xd9a53e : 0xd87e8c, 0.42);
          bg.strokeRoundedRect(52, 86, GAME_WIDTH - 104, 422, 26);

          const ground = this.add.graphics();
          ground.fillStyle(0x3a2a2a, 0.08);
          ground.fillEllipse(450, 424, 680, 188);
          ground.fillGradientStyle(0xe4efd7, 0xf5e9d0, 0xfbe3e3, 0xefe6f7, 0.18);
          ground.fillEllipse(450, 404, 640, 178);
        }

        private createCasperMascot() {
          const casper = this.add.container(790, 438).setDepth(438);
          casper.add(this.add.ellipse(0, 42, 86, 22, 0x3a2a2a, 0.15));
          casper.add(this.add.image(0, -18, "casper-sprite").setDisplaySize(106, 106));
          this.tweens.add({
            targets: casper,
            y: casper.y - 5,
            duration: 980,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createHud() {
          this.add.text(28, 24, questCopy[variant].title, {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "25px",
          }).setDepth(7000);
          const style = {
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
          };
          this.scoreText = this.add.text(30, 58, "", style).setDepth(7000);
          this.progressText = this.add.text(190, 58, "", { ...style, color: "#8E70BD" }).setDepth(7000);
          this.timerText = this.add.text(GAME_WIDTH - 128, 58, "", style).setDepth(7000);
        }

        private createLanternRelay() {
          const path = [
            [172, 410],
            [270, 342],
            [374, 420],
            [474, 332],
            [570, 418],
            [674, 338],
            [748, 420],
          ];

          path.forEach(([x, y], index) => {
            const lantern = this.add.container(x, y).setDepth(y);
            const glow = this.add.circle(0, 0, 36, 0xfaebc2, index === 0 ? 0.34 : 0.08);
            const body = this.add.image(0, -18, "minigame-props", 6).setDisplaySize(96, 132);
            const flame = this.add.circle(0, 4, 8, index === 0 ? 0xd9a53e : 0xc9a998, 0.85);
            lantern.add([glow, body, flame]);
            lantern.setSize(72, 82);
            lantern.setInteractive({ useHandCursor: true });
            lantern.on("pointerdown", () => this.clickLantern(index, glow, flame));
            this.targets.push({ node: lantern, found: false });
            this.tweens.add({
              targets: glow,
              alpha: index === 0 ? 0.46 : 0.16,
              scale: 1.18,
              duration: 900 + index * 80,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          });
        }

        private clickLantern(index: number, glow: Phaser.GameObjects.Arc, flame: Phaser.GameObjects.Arc) {
          if (this.gameOver || this.targets[index].found) return;
          if (index !== this.currentIndex) {
            this.score = Math.max(0, this.score - 10);
            playCozyCue("miss");
            setStatus("Wrong lantern. Follow the glowing path.");
            this.pulse(0x84675f);
            return;
          }

          this.targets[index].found = true;
          this.currentIndex += 1;
          this.score += 50 + Math.ceil(this.timeLeft);
          playCozyCue("lantern");
          glow.setFillStyle(0xfaebc2, 0.46);
          flame.setFillStyle(0xd9a53e, 1);
          this.spawnBurst(this.targets[index].node.x, this.targets[index].node.y);
          setStatus("Lantern lit. Keep the path glowing.");

          const next = this.targets[this.currentIndex]?.node;
          if (next) {
            this.spawnBurst(next.x, next.y);
          } else {
            this.endRound();
          }
        }

        private createHeartHunt() {
          const positions = [
            [164, 190],
            [286, 386],
            [382, 234],
            [510, 402],
            [628, 220],
            [736, 374],
            [432, 326],
            [220, 292],
          ];

          const decor = this.add.graphics();
          decor.fillStyle(0xead9b5, 0.85);
          decor.fillRoundedRect(120, 306, 180, 74, 18);
          decor.fillStyle(0xc0a8dc, 0.45);
          decor.fillEllipse(622, 320, 178, 88);
          decor.fillStyle(0xf6cfd2, 0.65);
          decor.fillRoundedRect(388, 176, 180, 92, 18);

          positions.forEach(([x, y], index) => {
            const target = this.add.container(x, y).setDepth(y);
            target.add(this.add.image(0, 0, "minigame-props", 3).setDisplaySize(74, 104).setAlpha(0.2));
            target.add(this.add.circle(0, 0, 28, 0xffffff, 0.01));
            target.setSize(64, 64);
            target.setInteractive({ useHandCursor: true });
            target.on("pointerdown", () => this.findHeart(index));
            this.targets.push({ node: target, found: false });
          });
        }

        private findHeart(index: number) {
          const target = this.targets[index];
          if (this.gameOver || target.found) return;
          target.found = true;
          this.currentIndex += 1;
          this.score += 65 + Math.ceil(this.timeLeft * 1.5);
          playCozyCue("heart");
          target.node.each((child: Phaser.GameObjects.GameObject) => {
            const node = child as Phaser.GameObjects.GameObject & { setAlpha?: (alpha: number) => void };
            node.setAlpha?.(0.92);
          });
          this.spawnBurst(target.node.x, target.node.y);
          setStatus("Keepsake found. The room feels warmer.");
          if (this.currentIndex === this.targets.length) this.endRound();
        }

        private spawnBurst(x: number, y: number) {
          for (let index = 0; index < 8; index += 1) {
            const spark = this.add.star(x, y, 5, 4, 12, index % 2 === 0 ? 0xfaebc2 : 0xf6cfd2, 0.92).setDepth(6500);
            this.tweens.add({
              targets: spark,
              x: x + PhaserModule.Math.Between(-68, 68),
              y: y - PhaserModule.Math.Between(24, 86),
              alpha: 0,
              scale: 0.2,
              duration: 720,
              ease: "Sine.out",
              onComplete: () => spark.destroy(),
            });
          }
        }

        private pulse(color: number) {
          const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, color, 0.1).setDepth(6400);
          this.tweens.add({ targets: overlay, alpha: 0, duration: 220, onComplete: () => overlay.destroy() });
        }

        private updateHud() {
          this.scoreText?.setText(`Score ${this.score}`);
          this.progressText?.setText(`${this.currentIndex}/${this.targets.length} complete`);
          this.timerText?.setText(`${Math.ceil(this.timeLeft)}s`);
        }

        private endRound() {
          if (this.gameOver) return;
          this.gameOver = true;
          this.updateHud();
          const allFound = this.currentIndex === this.targets.length;
          const coins = 80 + Math.floor(this.score / 5) + (allFound ? 60 : 0);
          const hearts = allFound ? 4 : this.score > 350 ? 3 : 2;
          const layer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(8000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-216, -136, 432, 272, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-216, -136, 432, 272, 24);
          layer.add(bg);
          layer.add(this.add.text(0, -82, `${questCopy[variant].title} Complete`, {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "25px",
          }).setOrigin(0.5));
          layer.add(this.add.text(0, -20, `Score ${this.score}\nProgress ${this.currentIndex}/${this.targets.length}\nReward ${coins} coins + ${hearts} hearts`, {
            align: "center",
            color: "#5B3F3F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "17px",
            fontStyle: "800",
            lineSpacing: 8,
          }).setOrigin(0.5));
          const restart = this.add.text(0, 86, "Play again", {
            color: "#FFFDF6",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
            backgroundColor: "#D87E8C",
            padding: { x: 18, y: 10 },
          }).setOrigin(0.5).setInteractive({ useHandCursor: true });
          restart.on("pointerdown", () => this.scene.restart());
          layer.add(restart);
          this.rewardLayer = layer;
          playCozyCue("reward");
          onReward?.({
            gameId: variant,
            label: questCopy[variant].title,
            score: this.score,
            coins,
            hearts,
          });
          setStatus(`${questCopy[variant].title} rewards awarded.`);
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
        scene: CozyQuestScene,
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : `Unable to load ${questCopy[variant].title}`);
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [onReward, variant]);

  return (
    <section className="overflow-hidden rounded-lg border border-blush-300/50 bg-cream-100 shadow-[0_24px_70px_rgba(216,126,140,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blush-200/80 bg-white/70 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">Playable party mini-game</p>
          <p className="text-sm font-black text-ink-900">{questCopy[variant].title}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Score</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Timer</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Wallet rewards</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label={`Interactive ${questCopy[variant].title} mini-game canvas with score, timer, and rewards`}
        className="min-h-[340px] w-full bg-cream-100 [&_canvas]:!h-auto [&_canvas]:!w-full"
        role="application"
        tabIndex={0}
      />
      <div className="border-t border-blush-200 bg-white/70 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}
