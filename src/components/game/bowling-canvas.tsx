"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { GameReward } from "@/lib/game/rewards";
import { playCozyCue } from "@/lib/game/cozy-audio";

type BowlingCanvasProps = {
  onReward?: (reward: GameReward) => void;
};

type BowlingPin = {
  node: Phaser.GameObjects.Container;
  standing: boolean;
};

type BowlingFrame = {
  rolls: number[];
};

const GAME_WIDTH = 920;
const GAME_HEIGHT = 600;
const MAX_FRAMES = 5;
const PIN_COUNT = 10;
const BALL_START = { x: 460, y: 502 };
const BOWLING_PLAYERS = [
  { name: "Blush Lane", shortName: "Blush", color: "#D87E8C" },
  { name: "Lavender Lane", shortName: "Lavender", color: "#8E70BD" },
];
const PIN_POSITIONS = [
  [460, 128],
  [430, 162],
  [490, 162],
  [400, 196],
  [460, 196],
  [520, 196],
  [370, 230],
  [430, 230],
  [490, 230],
  [550, 230],
] as const;

function createBowlingMatchFrames() {
  return BOWLING_PLAYERS.map(() => Array.from({ length: MAX_FRAMES }, () => ({ rolls: [] as number[] })));
}

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
        private playerFrames: BowlingFrame[][] = createBowlingMatchFrames();
        private playerFrameIndexes = [0, 0];
        private playerComplete = [false, false];
        private currentPlayerIndex = 0;
        private rolling = false;
        private aiming = false;
        private gutter = false;
        private gameOver = false;
        private vx = 0;
        private vy = 0;
        private knockedThisRoll = 0;
        private frameText!: Phaser.GameObjects.Text;
        private scoreText!: Phaser.GameObjects.Text;
        private pinsText!: Phaser.GameObjects.Text;
        private rollsText!: Phaser.GameObjects.Text;
        private activePlayerText!: Phaser.GameObjects.Text;
        private powerText!: Phaser.GameObjects.Text;
        private rewardLayer?: Phaser.GameObjects.Container;

        constructor() {
          super("MoonberryBowling");
        }

        private get frames() {
          return this.playerFrames[this.currentPlayerIndex];
        }

        private set frames(value: BowlingFrame[]) {
          this.playerFrames[this.currentPlayerIndex] = value;
        }

        private get frameIndex() {
          return this.playerFrameIndexes[this.currentPlayerIndex];
        }

        private set frameIndex(value: number) {
          this.playerFrameIndexes[this.currentPlayerIndex] = value;
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
            if (distance < 110) {
              this.aiming = true;
              this.drawAim(pointer);
              playCozyCue("ui");
              setStatus("Aim up the lane. Longer drag means more power; the gutters are real.");
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

          setStatus("Frame 1, roll 1. Drag from the moonberry ball to aim down the lane.");
        }

        update(_time: number, delta: number) {
          if (!this.rolling) return;

          const dt = delta / 1000;
          this.ball.x += this.vx * dt;
          this.ball.y += this.vy * dt;
          this.vx *= this.gutter ? 0.982 : 0.992;
          this.vy *= this.gutter ? 0.988 : 0.996;
          this.ball.rotation += Math.hypot(this.vx, this.vy) * dt * 0.032;

          const bounds = this.laneBoundsAt(this.ball.y);
          if (!this.gutter && (this.ball.x < bounds.left + 8 || this.ball.x > bounds.right - 8)) {
            this.gutter = true;
            this.ball.setAlpha(0.72);
            playCozyCue("gutter");
            setStatus("Gutter. Casper still believes in the next roll.");
          }

          if (!this.gutter) {
            this.checkPinHits();
          }

          this.ballShadow.setPosition(this.ball.x, this.ball.y + 24);
          this.ballShadow.setDepth(this.ball.y - 1);
          this.ball.setDepth(this.ball.y);

          if (this.ball.y < 76 || (Math.abs(this.vy) < 52 && this.ball.y < 300)) {
            this.finishRoll();
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
          lane.fillGradientStyle(0xf5e9d0, 0xfdf8ee, 0xead9b5, 0xf8d9bf, 0.96);
          lane.fillPoints(
            [
              new PhaserModule.Geom.Point(318, 112),
              new PhaserModule.Geom.Point(602, 112),
              new PhaserModule.Geom.Point(752, 536),
              new PhaserModule.Geom.Point(168, 536),
            ],
            true,
          );
          lane.lineStyle(4, 0x9c6f1f, 0.32);
          lane.strokePoints(
            [
              new PhaserModule.Geom.Point(318, 112),
              new PhaserModule.Geom.Point(602, 112),
              new PhaserModule.Geom.Point(752, 536),
              new PhaserModule.Geom.Point(168, 536),
            ],
            true,
          );

          lane.fillStyle(0x8e70bd, 0.12);
          lane.fillPoints(
            [
              new PhaserModule.Geom.Point(118, 536),
              new PhaserModule.Geom.Point(168, 536),
              new PhaserModule.Geom.Point(318, 112),
              new PhaserModule.Geom.Point(286, 112),
            ],
            true,
          );
          lane.fillPoints(
            [
              new PhaserModule.Geom.Point(752, 536),
              new PhaserModule.Geom.Point(802, 536),
              new PhaserModule.Geom.Point(634, 112),
              new PhaserModule.Geom.Point(602, 112),
            ],
            true,
          );

          for (let index = 0; index < 8; index += 1) {
            const x = 250 + index * 60;
            lane.lineStyle(2, 0xffffff, 0.2);
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
          this.add.text(28, 24, "Moonberry Bowling", {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "25px",
          }).setDepth(7000);
          this.frameText = this.add.text(30, 58, "", style).setDepth(7000);
          this.scoreText = this.add.text(190, 58, "", { ...style, color: "#8E70BD" }).setDepth(7000);
          this.rollsText = this.add.text(350, 58, "", { ...style, fontSize: "13px" }).setDepth(7000);
          this.pinsText = this.add.text(GAME_WIDTH - 170, 58, "", style).setDepth(7000);
          this.powerText = this.add.text(30, 86, "", { ...style, color: "#9C6F1F", fontSize: "13px" }).setDepth(7000);
          this.activePlayerText = this.add.text(GAME_WIDTH - 226, 86, "", { ...style, color: "#D87E8C", fontSize: "13px" }).setDepth(7000);
          this.updateHud();
        }

        private createBall() {
          this.ballShadow = this.add.ellipse(BALL_START.x, BALL_START.y + 30, 84, 24, 0x3a2a2a, 0.16).setDepth(500);
          this.ball = this.add.container(BALL_START.x, BALL_START.y).setDepth(BALL_START.y);
          this.ball.add(this.add.image(0, 0, "minigame-props", 0).setDisplaySize(112, 150));
          this.ball.setSize(76, 76);
          this.ball.setInteractive({ useHandCursor: true });
        }

        private createPins(reset = true) {
          if (reset) {
            this.pins.forEach((pin) => pin.node.destroy());
            this.pins = [];
          }

          if (this.pins.length > 0) return;

          PIN_POSITIONS.forEach(([x, y], index) => {
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
          const target = this.clampAim(pointer.x, pointer.y);
          const distance = PhaserModule.Math.Clamp(
            PhaserModule.Math.Distance.Between(this.ball.x, this.ball.y, target.x, target.y),
            70,
            360,
          );
          const powerPercent = Math.round(((distance - 70) / 290) * 100);
          this.aimLine.clear();
          this.aimLine.lineStyle(9, 0xd87e8c, 0.28);
          this.aimLine.lineBetween(this.ball.x, this.ball.y, target.x, target.y);
          this.aimLine.lineStyle(3, 0xffffff, 0.82);
          this.aimLine.lineBetween(this.ball.x, this.ball.y, target.x, target.y);
          this.aimLine.fillStyle(0xd87e8c, 0.9);
          this.aimLine.fillCircle(target.x, target.y, 8);
          this.powerText.setText(`Power ${powerPercent}%`);
        }

        private roll(pointer: Phaser.Input.Pointer) {
          this.aimLine.clear();
          const target = this.clampAim(pointer.x, pointer.y);
          const angle = PhaserModule.Math.Angle.Between(this.ball.x, this.ball.y, target.x, target.y);
          const distance = PhaserModule.Math.Clamp(PhaserModule.Math.Distance.Between(this.ball.x, this.ball.y, target.x, target.y), 70, 360);
          const power = PhaserModule.Math.Linear(520, 760, (distance - 70) / 290);
          this.vx = Math.cos(angle) * power;
          this.vy = Math.sin(angle) * power;
          this.knockedThisRoll = 0;
          this.gutter = false;
          this.rolling = true;
          this.ball.setAlpha(1);
          this.powerText.setText("");
          playCozyCue("roll");
          setStatus(`${BOWLING_PLAYERS[this.currentPlayerIndex].name} rolling...`);
        }

        private clampAim(x: number, y: number) {
          const clampedY = PhaserModule.Math.Clamp(y, 96, this.ball.y - 54);
          const bounds = this.laneBoundsAt(clampedY);
          return {
            x: PhaserModule.Math.Clamp(x, bounds.left + 24, bounds.right - 24),
            y: clampedY,
          };
        }

        private laneBoundsAt(y: number) {
          const t = PhaserModule.Math.Clamp((536 - y) / (536 - 112), 0, 1);
          return {
            left: PhaserModule.Math.Linear(168, 318, t),
            right: PhaserModule.Math.Linear(752, 602, t),
          };
        }

        private checkPinHits() {
          this.pins.forEach((pin) => {
            if (!pin.standing) return;
            const distance = PhaserModule.Math.Distance.Between(this.ball.x, this.ball.y, pin.node.x, pin.node.y);
            if (distance < 52) {
              const direction = pin.node.x >= this.ball.x ? 1 : -1;
              this.knockPin(pin, direction);
              this.vx *= 0.86;
              this.vy *= 0.93;
              this.carryPins(pin, direction);
            }
          });
        }

        private carryPins(source: BowlingPin, direction: number) {
          this.pins.forEach((nearby) => {
            if (!nearby.standing) return;
            const pinDistance = PhaserModule.Math.Distance.Between(source.node.x, source.node.y, nearby.node.x, nearby.node.y);
            const inCarryLine = Math.sign(nearby.node.x - source.node.x || direction) === direction || pinDistance < 62;
            if (pinDistance < 86 && inCarryLine && PhaserModule.Math.FloatBetween(0, 1) > 0.24) {
              this.knockPin(nearby, nearby.node.x > source.node.x ? 1 : -1);
            }
          });
        }

        private knockPin(pin: BowlingPin, direction: number) {
          if (!pin.standing) return;
          pin.standing = false;
          this.knockedThisRoll += 1;
          playCozyCue("pin");
          this.tweens.add({
            targets: pin.node,
            x: pin.node.x + direction * PhaserModule.Math.Between(36, 78),
            y: pin.node.y + PhaserModule.Math.Between(10, 34),
            rotation: direction * PhaserModule.Math.FloatBetween(0.9, 1.7),
            alpha: 0.42,
            duration: 420,
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

        private finishRoll() {
          if (!this.rolling) return;
          this.rolling = false;
          this.aimLine.clear();
          this.ball.setAlpha(1);
          const frame = this.frames[this.frameIndex];
          frame.rolls.push(this.knockedThisRoll);
          this.updateHud();

          const framePins = frame.rolls.reduce((sum, roll) => sum + roll, 0);
          const finalFrame = this.frameIndex === MAX_FRAMES - 1;
          const strike = this.knockedThisRoll === PIN_COUNT && frame.rolls.length === 1;
          const spare = frame.rolls.length === 2 && framePins === PIN_COUNT && frame.rolls[0] !== PIN_COUNT;

          if (strike) {
            playCozyCue("strike");
            setStatus("Strike! Casper did a victory hop.");
          } else if (spare) {
            playCozyCue("spare");
            setStatus("Spare! Every pin found its way home.");
          } else if (this.knockedThisRoll === 0) {
            playCozyCue(this.gutter ? "gutter" : "miss");
            setStatus(this.gutter ? "Gutter roll. Line up the next one." : "No pins this roll. Adjust the angle.");
          } else {
            setStatus(`${this.knockedThisRoll} pin${this.knockedThisRoll === 1 ? "" : "s"} down.`);
          }

          if (this.shouldEndGame()) {
            this.playerComplete[this.currentPlayerIndex] = true;
            if (this.playerComplete.every(Boolean)) {
              this.time.delayedCall(820, () => this.showRewards());
            } else {
              this.time.delayedCall(880, () => this.switchPlayer());
            }
            return;
          }

          if (this.shouldAdvanceFrame()) {
            this.time.delayedCall(880, () => this.nextFrame());
            return;
          }

          const resetPins = finalFrame && (strike || spare || frame.rolls[frame.rolls.length - 1] === PIN_COUNT);
          this.time.delayedCall(720, () => this.nextRoll(resetPins));
        }

        private shouldAdvanceFrame() {
          if (this.frameIndex >= MAX_FRAMES - 1) return false;
          const rolls = this.frames[this.frameIndex].rolls;
          return rolls[0] === PIN_COUNT || rolls.length >= 2;
        }

        private shouldEndGame() {
          if (this.frameIndex < MAX_FRAMES - 1) return false;
          const rolls = this.frames[this.frameIndex].rolls;
          if (rolls.length < 2) return false;
          if (rolls[0] === PIN_COUNT) return rolls.length >= 3;
          if (rolls[0] + rolls[1] === PIN_COUNT) return rolls.length >= 3;
          return rolls.length >= 2;
        }

        private nextRoll(resetPins: boolean) {
          this.resetBall();
          if (resetPins) this.createPins(true);
          this.knockedThisRoll = 0;
          this.updateHud();
          const rollNumber = this.frames[this.frameIndex].rolls.length + 1;
          setStatus(`Frame ${this.frameIndex + 1}, roll ${rollNumber}. Aim for the remaining pins.`);
        }

        private nextFrame() {
          this.frameIndex += 1;
          this.switchPlayer();
        }

        private switchPlayer() {
          const preferred = this.currentPlayerIndex === 0 ? 1 : 0;
          this.currentPlayerIndex = this.playerComplete[preferred] ? this.currentPlayerIndex : preferred;
          this.resetBall();
          this.createPins(true);
          this.knockedThisRoll = 0;
          this.updateHud();
          setStatus(`${BOWLING_PLAYERS[this.currentPlayerIndex].name}'s turn. Frame ${this.frameIndex + 1}, roll 1.`);
        }

        private resetBall() {
          this.ball.setPosition(BALL_START.x, BALL_START.y);
          this.ball.setRotation(0);
          this.ball.setAlpha(1);
          this.ballShadow.setPosition(BALL_START.x, BALL_START.y + 30);
          this.vx = 0;
          this.vy = 0;
          this.gutter = false;
        }

        private standingPins() {
          return this.pins.filter((pin) => pin.standing).length;
        }

        private updateHud() {
          const frame = this.frames[this.frameIndex];
          const rollNumber = Math.min(3, frame.rolls.length + 1);
          this.frameText?.setText(`Frame ${this.frameIndex + 1}/${MAX_FRAMES}`);
          this.scoreText?.setText(`Blush ${this.calculatePlayerScore(0)}  |  Lavender ${this.calculatePlayerScore(1)}`);
          this.pinsText?.setText(`Pins ${PIN_COUNT - this.standingPins()}/10`);
          this.rollsText?.setText(`Roll ${rollNumber}${this.frameIndex === MAX_FRAMES - 1 ? " final" : ""}  |  ${this.formatFrames()}`);
          this.activePlayerText?.setText(`Turn: ${BOWLING_PLAYERS[this.currentPlayerIndex].name}`);
          this.activePlayerText?.setColor(BOWLING_PLAYERS[this.currentPlayerIndex].color);
        }

        private formatFrames() {
          return this.frames
            .map((frame, index) => {
              if (frame.rolls.length === 0) return `${index + 1}: --`;
              if (frame.rolls[0] === PIN_COUNT && index < MAX_FRAMES - 1) return `${index + 1}: X`;
              const [first, second, third] = frame.rolls;
              const firstMark = first === PIN_COUNT ? "X" : first ?? "-";
              const secondMark =
                first !== PIN_COUNT && first !== undefined && second !== undefined && first + second === PIN_COUNT
                  ? "/"
                  : second === PIN_COUNT
                    ? "X"
                    : second ?? "-";
              const thirdMark = third === PIN_COUNT ? "X" : third ?? undefined;
              return `${index + 1}: ${firstMark} ${secondMark}${thirdMark !== undefined ? ` ${thirdMark}` : ""}`;
            })
            .join("   ");
        }

        private calculatePlayerScore(playerIndex: number) {
          return this.calculateScore(this.playerFrames[playerIndex]);
        }

        private calculateScore(frames = this.frames) {
          let score = 0;
          for (let index = 0; index < MAX_FRAMES; index += 1) {
            const rolls = frames[index].rolls;
            if (rolls.length === 0) break;

            if (index === MAX_FRAMES - 1) {
              score += rolls.reduce((sum, roll) => sum + roll, 0);
              break;
            }

            const first = rolls[0] ?? 0;
            const second = rolls[1] ?? 0;
            if (first === PIN_COUNT) {
              const [bonusOne = 0, bonusTwo = 0] = this.rollsAfterFrame(index, frames);
              score += PIN_COUNT + bonusOne + bonusTwo;
            } else if (rolls.length >= 2 && first + second === PIN_COUNT) {
              const [bonus = 0] = this.rollsAfterFrame(index, frames);
              score += PIN_COUNT + bonus;
            } else {
              score += first + second;
            }
          }
          return score;
        }

        private rollsAfterFrame(frameIndex: number, frames = this.frames) {
          return frames.slice(frameIndex + 1).flatMap((frame) => frame.rolls);
        }

        private showRewards() {
          this.gameOver = true;
          const playerScores = BOWLING_PLAYERS.map((_, index) => this.calculatePlayerScore(index));
          const winningIndex = playerScores[0] >= playerScores[1] ? 0 : 1;
          const finalScore = Math.max(...playerScores);
          const coins = 120 + finalScore * 3;
          const hearts = finalScore >= 120 ? 7 : finalScore >= 90 ? 5 : finalScore >= 60 ? 4 : 2;
          const layer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(8000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-226, -150, 452, 300, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-226, -150, 452, 300, 24);
          layer.add(bg);
          layer.add(this.add.text(0, -96, "Bowling Complete", {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "27px",
          }).setOrigin(0.5));
          layer.add(this.add.text(0, -28, `${BOWLING_PLAYERS[winningIndex].name} wins\nBlush ${playerScores[0]} | Lavender ${playerScores[1]}\nReward ${coins} coins + ${hearts} hearts\nCasper saved a moonberry sticker for the party.`, {
            align: "center",
            color: "#5B3F3F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "17px",
            fontStyle: "800",
            lineSpacing: 8,
            wordWrap: { width: 380 },
          }).setOrigin(0.5));
          const restart = this.add.text(0, 100, "Bowl again", {
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
          playCozyCue("reward");
          onReward?.({
            gameId: "moonberry-bowling",
            label: "Moonberry Bowling",
            score: finalScore,
            coins,
            hearts,
          });
          setStatus(`Bowling party rewards awarded: ${coins} coins and ${hearts} hearts.`);
        }

        private restartRound() {
          this.rewardLayer?.destroy(true);
          this.rewardLayer = undefined;
          this.playerFrames = createBowlingMatchFrames();
          this.playerFrameIndexes = [0, 0];
          this.playerComplete = [false, false];
          this.currentPlayerIndex = 0;
          this.knockedThisRoll = 0;
          this.gameOver = false;
          this.resetBall();
          this.createPins(true);
          this.updateHud();
          setStatus("New bowling party lane started. Blush Lane begins frame 1.");
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
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Aim + power</span>
          <span className="rounded-md bg-blush-100 px-2.5 py-1">2 rolls/frame</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Strikes + spares</span>
          <span className="rounded-md bg-garden-100 px-2.5 py-1">Gutters</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive Moonberry Bowling game canvas with aiming, gutters, pin collisions, frame scoring, and rewards"
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
