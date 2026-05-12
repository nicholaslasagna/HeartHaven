"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { GameReward } from "@/lib/game/rewards";

export type MemoryMatchMode = "couples" | "party";

type MemoryMatchCanvasProps = {
  mode: MemoryMatchMode;
  onReward?: (reward: GameReward) => void;
};

type MatchCard = {
  id: string;
  pair: string;
  container: Phaser.GameObjects.Container;
  front: Phaser.GameObjects.Rectangle;
  frontGlow: Phaser.GameObjects.Rectangle;
  back: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  art: Phaser.GameObjects.Image;
  matched: boolean;
  revealed: boolean;
};

const GAME_WIDTH = 920;
const GAME_HEIGHT = 600;

const pairData = [
  { id: "heart", label: "Heart", color: 0xd87e8c },
  { id: "petal", label: "Petal", color: 0xf6cfd2 },
  { id: "lantern", label: "Lantern", color: 0xd9a53e },
  { id: "tree", label: "Tree", color: 0x6e9651 },
  { id: "casper", label: "Casper", color: 0xfffcf3 },
  { id: "moon", label: "Moon", color: 0xc0a8dc },
  { id: "note", label: "Note", color: 0xead9b5 },
  { id: "garden", label: "Garden", color: 0xa9c58a },
];

export function MemoryMatchCanvas({ mode, onReward }: MemoryMatchCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState(mode === "couples" ? "Couple-vs-couple match is ready." : "Party match is ready.");

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class MemoryMatchScene extends PhaserModule.Scene {
        private cards: MatchCard[] = [];
        private revealed: MatchCard[] = [];
        private busy = false;
        private turnIndex = 0;
        private moves = 0;
        private matches = 0;
        private players = mode === "couples"
          ? ["Avery + Riley", "Rose Couple"]
          : ["Avery", "Riley", "Alex", "Maya", "Sam", "Jules"];
        private scores = this.players.map(() => 0);
        private scoreText!: Phaser.GameObjects.Text;
        private turnText!: Phaser.GameObjects.Text;
        private moveText!: Phaser.GameObjects.Text;

        constructor() {
          super("MemoryMatch");
        }

        preload() {
          this.load.image("cozy-room-bg", "/game-assets/generated/cozy-room-bg.png");
          this.load.image("casper-sprite", "/game-assets/generated/casper-sprite.png");
          this.load.spritesheet("minigame-props", "/game-assets/generated/minigame-props-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
          this.load.spritesheet("cozy-furniture-sprites", "/game-assets/generated/cozy-furniture-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
        }

        create() {
          this.drawBackdrop();
          this.createMascot();
          this.createHud();
          this.createCards();
          setStatus(`${this.players[this.turnIndex]}'s turn. Find a pair.`);
          // TODO: Replace pass-and-play turn state with Supabase Realtime game_sessions and game_moves.
          // TODO: Allow party host to invite room visitors into this board with presence channel seats.
        }

        private drawBackdrop() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "cozy-room-bg").setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-20);
          this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xfffcf3, 0.16).setDepth(-19);

          const bg = this.add.graphics();
          bg.fillGradientStyle(0xfdf8ee, 0xfbe3e3, 0xefe6f7, 0xe4efd7, 0.12);
          bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
          bg.fillStyle(0xffffff, 0.34);
          bg.fillRoundedRect(48, 106, GAME_WIDTH - 96, 448, 26);
          bg.lineStyle(3, 0xf6cfd2, 0.5);
          bg.strokeRoundedRect(48, 106, GAME_WIDTH - 96, 448, 26);

          for (let index = 0; index < 28; index += 1) {
            const sparkle = this.add.star(
              PhaserModule.Math.Between(56, GAME_WIDTH - 56),
              PhaserModule.Math.Between(88, GAME_HEIGHT - 40),
              4,
              2,
              PhaserModule.Math.Between(4, 8),
              index % 2 === 0 ? 0xffffff : 0xfaebc2,
              PhaserModule.Math.FloatBetween(0.12, 0.4),
            );
            this.tweens.add({
              targets: sparkle,
              alpha: PhaserModule.Math.FloatBetween(0.28, 0.72),
              scale: 1.25,
              duration: PhaserModule.Math.Between(1200, 2400),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private createMascot() {
          const mascot = this.add.container(802, 484).setDepth(484);
          mascot.add(this.add.ellipse(0, 42, 88, 22, 0x3a2a2a, 0.14));
          mascot.add(this.add.image(0, -18, "casper-sprite").setDisplaySize(112, 112));
          this.tweens.add({
            targets: mascot,
            y: mascot.y - 5,
            duration: 1040,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createHud() {
          this.add
            .text(28, 24, mode === "couples" ? "Couple Memory Match" : "Party Memory Match", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "24px",
            })
            .setDepth(5000);
          this.turnText = this.add.text(28, 56, "", {
            color: "#8E70BD",
            fontFamily: "Nunito, sans-serif",
            fontSize: "14px",
            fontStyle: "900",
          }).setDepth(5000);
          this.scoreText = this.add.text(360, 24, "", {
            color: "#5B3F3F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "13px",
            fontStyle: "900",
          }).setDepth(5000);
          this.moveText = this.add.text(GAME_WIDTH - 140, 24, "", {
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
          }).setDepth(5000);
          this.updateHud();
        }

        private createCards() {
          const pairs = PhaserModule.Utils.Array.Shuffle([...pairData, ...pairData]);
          const startX = 178;
          const startY = 160;
          const gapX = 188;
          const gapY = 102;

          pairs.forEach((pair, index) => {
            const x = startX + (index % 4) * gapX;
            const y = startY + Math.floor(index / 4) * gapY;
            const card = this.createCard(`${pair.id}-${index}`, pair.id, pair.label, pair.color, x, y);
            this.cards.push(card);
          });
        }

        private createCard(id: string, pair: string, label: string, color: number, x: number, y: number): MatchCard {
          const container = this.add.container(x, y).setDepth(y);
          const shadow = this.add.rectangle(5, 9, 128, 88, 0x3a2a2a, 0.12);
          const back = this.add.rectangle(0, 0, 128, 88, 0xfbe3e3).setStrokeStyle(3, 0xd87e8c, 0.55);
          const front = this.add.rectangle(0, 0, 128, 88, color).setStrokeStyle(3, 0x8b5e3c, 0.28);
          const frontGlow = this.add.rectangle(0, 0, 106, 66, 0xffffff, 0.22);
          const art = this.createCardArt(pair);
          const text = this.add.text(0, 30, label, {
            align: "center",
            color: pair === "casper" ? "#3A2A2A" : "#FFFDF6",
            fontFamily: "Nunito, sans-serif",
            fontSize: "11px",
            fontStyle: "900",
            wordWrap: { width: 96 },
          }).setOrigin(0.5);
          const mark = this.add.star(0, 0, 5, 8, 20, 0xffffff, 0.7);
          front.setVisible(false);
          frontGlow.setVisible(false);
          art.setVisible(false);
          text.setVisible(false);
          container.add([shadow, back, mark, front, frontGlow, art, text]);
          container.setSize(128, 88);
          container.setInteractive({ useHandCursor: true });

          const card: MatchCard = {
            id,
            pair,
            container,
            front,
            frontGlow,
            back,
            label: text,
            art,
            matched: false,
            revealed: false,
          };

          container.on("pointerdown", () => this.flipCard(card));
          container.on("pointerover", () => {
            if (!card.matched && !card.revealed) back.setFillStyle(0xefe6f7);
          });
          container.on("pointerout", () => {
            if (!card.matched && !card.revealed) back.setFillStyle(0xfbe3e3);
          });

          return card;
        }

        private flipCard(card: MatchCard) {
          if (this.busy || card.matched || card.revealed || this.revealed.length >= 2) return;

          this.revealCard(card, true);
          this.revealed.push(card);

          if (this.revealed.length === 2) {
            this.moves += 1;
            this.busy = true;
            const [first, second] = this.revealed;
            if (first.pair === second.pair) {
              this.time.delayedCall(280, () => this.resolveMatch(first, second));
            } else {
              this.time.delayedCall(720, () => this.resolveMiss(first, second));
            }
          }
        }

        private revealCard(card: MatchCard, revealed: boolean) {
          card.revealed = revealed;
          card.front.setVisible(revealed);
          card.frontGlow.setVisible(revealed);
          card.art.setVisible(revealed);
          card.label.setVisible(revealed);
          card.back.setVisible(!revealed);
          this.tweens.add({
            targets: card.container,
            scaleX: revealed ? 1.08 : 1,
            scaleY: revealed ? 1.08 : 1,
            duration: 130,
            yoyo: true,
            ease: "Sine.out",
          });
        }

        private createCardArt(pair: string) {
          if (pair === "casper") {
            return this.add.image(0, -12, "casper-sprite").setDisplaySize(56, 56);
          }

          const mapping: Record<string, { texture: string; frame: number; width: number; height: number; y: number }> = {
            heart: { texture: "minigame-props", frame: 3, width: 68, height: 86, y: -12 },
            petal: { texture: "minigame-props", frame: 4, width: 68, height: 86, y: -12 },
            lantern: { texture: "minigame-props", frame: 6, width: 74, height: 92, y: -14 },
            tree: { texture: "cozy-furniture-sprites", frame: 7, width: 86, height: 92, y: -14 },
            moon: { texture: "cozy-furniture-sprites", frame: 4, width: 82, height: 92, y: -14 },
            note: { texture: "cozy-furniture-sprites", frame: 6, width: 80, height: 86, y: -14 },
            garden: { texture: "minigame-props", frame: 7, width: 78, height: 90, y: -14 },
          };
          const art = mapping[pair] ?? mapping.heart;
          return this.add.image(0, art.y, art.texture, art.frame).setDisplaySize(art.width, art.height);
        }

        private resolveMatch(first: MatchCard, second: MatchCard) {
          first.matched = true;
          second.matched = true;
          this.matches += 1;
          this.scores[this.turnIndex] += mode === "couples" ? 2 : 1;
          this.spawnBurst((first.container.x + second.container.x) / 2, (first.container.y + second.container.y) / 2);
          this.revealed = [];
          this.busy = false;
          this.updateHud();
          setStatus(`${this.players[this.turnIndex]} found ${first.pair}.`);

          if (this.matches === pairData.length) {
            this.time.delayedCall(450, () => this.showResults());
          }
        }

        private resolveMiss(first: MatchCard, second: MatchCard) {
          this.revealCard(first, false);
          this.revealCard(second, false);
          this.revealed = [];
          this.turnIndex = (this.turnIndex + 1) % this.players.length;
          this.busy = false;
          this.updateHud();
          setStatus(`${this.players[this.turnIndex]}'s turn.`);
        }

        private spawnBurst(x: number, y: number) {
          for (let index = 0; index < 8; index += 1) {
            const sparkle = this.add.star(x, y, 5, 4, 12, index % 2 === 0 ? 0xfaebc2 : 0xf6cfd2, 0.9).setDepth(6000);
            this.tweens.add({
              targets: sparkle,
              x: x + PhaserModule.Math.Between(-78, 78),
              y: y - PhaserModule.Math.Between(28, 88),
              alpha: 0,
              scale: 0.2,
              duration: 780,
              ease: "Sine.out",
              onComplete: () => sparkle.destroy(),
            });
          }
        }

        private updateHud() {
          this.turnText.setText(`Turn: ${this.players[this.turnIndex]}`);
          this.moveText.setText(`Moves ${this.moves}`);
          this.scoreText.setText(this.players.map((player, index) => `${player}: ${this.scores[index]}`).join("   "));
        }

        private showResults() {
          const maxScore = Math.max(...this.scores);
          const winners = this.players.filter((_player, index) => this.scores[index] === maxScore).join(" + ");
          const coins = 90 + Math.max(0, 30 - this.moves) * 3;
          const hearts = mode === "couples" ? 3 : 2;
          const layer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(8000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-210, -132, 420, 264, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-210, -132, 420, 264, 24);
          layer.add(bg);
          layer.add(
            this.add.text(0, -80, "Memory Match Complete", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "25px",
            }).setOrigin(0.5),
          );
          layer.add(
            this.add.text(0, -18, `Winner: ${winners}\nMoves: ${this.moves}\nReward: ${coins} coins + ${hearts} hearts`, {
              align: "center",
              color: "#5B3F3F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "17px",
              fontStyle: "800",
              lineSpacing: 8,
              wordWrap: { width: 340 },
            }).setOrigin(0.5),
          );
          const restart = this.add.text(0, 84, "New board", {
            color: "#FFFDF6",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
            backgroundColor: "#D87E8C",
            padding: { x: 18, y: 10 },
          }).setOrigin(0.5).setInteractive({ useHandCursor: true });
          restart.on("pointerdown", () => this.scene.restart());
          layer.add(restart);
          setStatus(`Winner: ${winners}. Rewards ready to persist.`);
          onReward?.({
            gameId: `memory-match-${mode}`,
            label: mode === "couples" ? "Couple Memory Match" : "Party Memory Match",
            score: maxScore * 100 - this.moves,
            coins,
            hearts,
          });
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
        scene: MemoryMatchScene,
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load Memory Match");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [mode, onReward]);

  return (
    <section className="overflow-hidden rounded-lg border border-lavender-300/50 bg-lavender-100 shadow-[0_24px_70px_rgba(142,112,189,0.16)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-lavender-300/50 bg-white/70 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-lavender-500">Playable multiplayer mini-game</p>
          <p className="text-sm font-black text-ink-900">
            {mode === "couples" ? "Couple-vs-couple Memory Match" : "Party Memory Match"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Pass turns</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Match pairs</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Party rewards</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive multiplayer Memory Match game canvas with couple and party turn modes"
        className="min-h-[360px] w-full bg-cream-100 [&_canvas]:!h-auto [&_canvas]:!w-full"
        role="application"
        tabIndex={0}
      />
      <div className="border-t border-lavender-300/50 bg-white/70 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}
