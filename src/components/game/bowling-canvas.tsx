"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { BOWLING_PINS, computeBowlingState, type BowlingRoll } from "@/lib/game/bowling-scoring";

type BowlingCanvasProps = {
  /** Ordered roll log (oldest first), derived from the game move log. */
  rolls: BowlingRoll[];
  /** My seat (0/1) when online; null for local solo play. */
  mySeatIndex: number | null;
  seatCount: number;
  /** Player display names by seat index. */
  seatNames: string[];
  /** Submit one roll. Returns ok/reason; the canvas waits for the roll
   *  to reflect back through `rolls` before clearing its busy state. */
  onRoll: (pins: number, details: { aim: number; power: number }) => Promise<{ ok: boolean; reason?: string }>;
  rollLocked?: boolean;
  sessionId?: string | null;
};

const GAME_WIDTH = 920;
const GAME_HEIGHT = 600;
const BALL_START = { x: 460, y: 502 };
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

const SEAT_COLORS = ["#D87E8C", "#8E70BD"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Resolve a deterministic bowling result from direction + power. */
function pinsFromAimPower(aim: number, power: number, standing: number): number {
  const aimError = Math.abs(aim);
  const powerError = Math.abs(power - 0.84);
  const aimQuality = clamp(1 - aimError / 0.92, 0, 1);
  const powerQuality = clamp(1 - powerError / 0.84, 0, 1);

  if (standing <= 0) return 0;
  if (aimError > 0.78 || power < 0.14) return 0;
  if (standing === BOWLING_PINS && aimError <= 0.13 && power >= 0.72 && power <= 0.98) return BOWLING_PINS;
  if (standing < BOWLING_PINS && aimError <= 0.22 && power >= 0.55) return standing;

  const base = Math.round(standing * (0.12 + aimQuality * 0.52 + powerQuality * 0.34));
  const hookPenalty = Math.max(0, aimError - 0.42) * 3;
  const powerPenalty = power < 0.35 ? 2 : power > 0.98 ? 1 : 0;
  return clamp(base - Math.round(hookPenalty) - powerPenalty, 0, standing);
}

export function BowlingCanvas({
  rolls,
  mySeatIndex,
  seatCount,
  seatNames,
  onRoll,
  rollLocked = false,
  sessionId,
}: BowlingCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rollsRef = useRef(rolls);
  const mySeatRef = useRef(mySeatIndex);
  const seatCountRef = useRef(seatCount);
  const seatNamesRef = useRef(seatNames);
  const onRollRef = useRef(onRoll);
  const rollLockedRef = useRef(rollLocked);
  const sessionIdRef = useRef(sessionId);
  const [status, setStatus] = useState("Tap to start the power meter, tap again to roll.");

  useEffect(() => {
    rollsRef.current = rolls;
    mySeatRef.current = mySeatIndex;
    seatCountRef.current = seatCount;
    seatNamesRef.current = seatNames;
    onRollRef.current = onRoll;
    rollLockedRef.current = rollLocked;
    sessionIdRef.current = sessionId;
    // Tell the live scene that the roll log changed so it can re-render
    // pins / turn / animate the newest roll.
    window.dispatchEvent(new CustomEvent("hearthaven:bowling-sync"));
  }, [rolls, mySeatIndex, seatCount, seatNames, onRoll, rollLocked, sessionId]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class BowlingScene extends PhaserModule.Scene {
        private pins: Phaser.GameObjects.Container[] = [];
        private ball!: Phaser.GameObjects.Container;
        private ballShadow!: Phaser.GameObjects.Ellipse;
        private laneGuide!: Phaser.GameObjects.Graphics;
        private aimNeedle!: Phaser.GameObjects.Graphics;
        private powerBar!: Phaser.GameObjects.Graphics;
        private powerFill!: Phaser.GameObjects.Graphics;
        private bannerText!: Phaser.GameObjects.Text;
        private helpText!: Phaser.GameObjects.Text;
        private aimPhase: "idle" | "aim" | "power" | "rolling" = "idle";
        private aim = 0;
        private aimDir = 1;
        private power = 0;
        private powerDir = 1;
        private renderedRollCount = 0;
        private busy = false;
        private awaitingRollCount: number | null = null;
        private syncHandler?: () => void;

        preload() {
          this.load.image("moonberry-bowling-bg", "/game-assets/generated/moonberry-bowling-bg.png");
          this.load.image("casper-sprite", "/game-assets/generated/casper-sprite.png");
          this.load.spritesheet("minigame-props", "/game-assets/generated/minigame-props-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
        }

        create() {
          this.add
            .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "moonberry-bowling-bg")
            .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
            .setDepth(-20);
          this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xfffcf3, 0.06).setDepth(-19);
          this.drawLane();

          // Casper mascot.
          const mascot = this.add.container(GAME_WIDTH - 96, GAME_HEIGHT - 120).setDepth(6000);
          mascot.add(this.add.image(0, 0, "casper-sprite").setDisplaySize(118, 118));
          this.tweens.add({ targets: mascot, y: mascot.y - 10, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.inOut" });

          this.createPins();
          this.createBall();

          this.bannerText = this.add
            .text(GAME_WIDTH / 2, 40, "", {
              fontFamily: "Nunito, sans-serif",
              fontSize: "22px",
              fontStyle: "900",
              color: "#5b3f3f",
              align: "center",
            })
            .setOrigin(0.5)
            .setDepth(7000);
          this.helpText = this.add
            .text(GAME_WIDTH / 2, GAME_HEIGHT - 92, "Tap to aim. Tap again to set power.", {
              fontFamily: "Nunito, sans-serif",
              fontSize: "15px",
              fontStyle: "900",
              color: "#6c4d4d",
              align: "center",
            })
            .setOrigin(0.5)
            .setDepth(7000);

          // Power meter (bottom).
          this.laneGuide = this.add.graphics().setDepth(6750);
          this.aimNeedle = this.add.graphics().setDepth(6902);
          this.powerBar = this.add.graphics().setDepth(6900);
          this.powerFill = this.add.graphics().setDepth(6901);
          this.drawAimGuide();
          this.drawPowerMeter();

          this.input.on("pointerdown", () => this.handleTap());

          this.syncHandler = () => this.renderFromLog(true);
          window.addEventListener("hearthaven:bowling-sync", this.syncHandler);

          this.renderFromLog(false);
        }

        shutdown() {
          if (this.syncHandler) window.removeEventListener("hearthaven:bowling-sync", this.syncHandler);
        }

        private createPins() {
          PIN_POSITIONS.forEach(([x, y]) => {
            const pin = this.add.container(x, y).setDepth(y);
            pin.add(this.add.ellipse(0, 31, 34, 10, 0x3a2a2a, 0.14));
            pin.add(this.add.image(0, -10, "minigame-props", 1).setDisplaySize(86, 136));
            this.pins.push(pin);
          });
        }

        private createBall() {
          this.ballShadow = this.add.ellipse(BALL_START.x, BALL_START.y + 30, 84, 24, 0x3a2a2a, 0.16).setDepth(500);
          this.ball = this.add.container(BALL_START.x, BALL_START.y).setDepth(BALL_START.y);
          this.ball.add(this.add.image(0, 0, "minigame-props", 0).setDisplaySize(104, 138));
        }

        private drawLane() {
          const lane = this.add.graphics().setDepth(-10);
          lane.fillStyle(0xf4dba6, 0.58);
          lane.beginPath();
          lane.moveTo(316, 520);
          lane.lineTo(684, 520);
          lane.lineTo(560, 108);
          lane.lineTo(420, 108);
          lane.closePath();
          lane.fillPath();
          lane.lineStyle(5, 0xffffff, 0.42);
          lane.strokePath();

          for (let i = 0; i < 9; i += 1) {
            const x = 342 + i * 46;
            lane.lineStyle(1.5, 0xffffff, 0.22);
            lane.lineBetween(x, 516, 430 + i * 15, 118);
          }

          this.add.rectangle(242, 324, 74, 398, 0x89b5d7, 0.26).setDepth(-11);
          this.add.rectangle(718, 324, 74, 398, 0x89b5d7, 0.26).setDepth(-11);
          this.add.text(178, 512, "gutter", {
            fontFamily: "Nunito, sans-serif",
            fontSize: "13px",
            fontStyle: "900",
            color: "#7d90a8",
          }).setDepth(-9);
          this.add.text(732, 512, "gutter", {
            fontFamily: "Nunito, sans-serif",
            fontSize: "13px",
            fontStyle: "900",
            color: "#7d90a8",
          }).setDepth(-9);
        }

        /** Show `standing` pins upright (toppling the rest). */
        private setStandingPins(standing: number) {
          this.pins.forEach((pin, index) => {
            const upright = index < standing;
            pin.setAlpha(upright ? 1 : 0.18);
            pin.setRotation(upright ? 0 : (index % 2 === 0 ? -1 : 1) * 0.9);
            pin.setY(PIN_POSITIONS[index][1] + (upright ? 0 : 8));
          });
        }

        private resetBallVisual() {
          this.tweens.killTweensOf(this.ball);
          this.tweens.killTweensOf(this.ballShadow);
          this.ball.setPosition(BALL_START.x, BALL_START.y).setAlpha(1);
          this.ballShadow.setPosition(BALL_START.x, BALL_START.y + 30).setAlpha(1);
        }

        private isMyTurn(state: ReturnType<typeof computeBowlingState>) {
          if (rollLockedRef.current || this.awaitingRollCount !== null) return false;
          const seat = mySeatRef.current;
          if (seat === null || seat === undefined) return !sessionIdRef.current && !state.gameOver; // local solo only
          return !state.gameOver && state.currentSeat === seat;
        }

        private renderFromLog(animateNewest: boolean) {
          const state = computeBowlingState(rollsRef.current, seatCountRef.current);
          const names = seatNamesRef.current;

          // Animate the newest roll (someone bowled) by rolling the ball
          // and toppling pins to the new standing count — but ONLY when it
          // was the OPPONENT's roll. My own rolls are already animated
          // optimistically in commitRoll, so re-animating on the echoed
          // log would double-roll the ball.
          const total = rollsRef.current.length;
          const grew = total > this.renderedRollCount;
          this.renderedRollCount = total;
          const newestSeat = total > 0 ? rollsRef.current[total - 1].seat : -1;
          const newestRoll = total > 0 ? rollsRef.current[total - 1] : null;
          const mine = mySeatRef.current;
          const newestIsMine = mine !== null && mine !== undefined && newestSeat === mine;

          if (this.awaitingRollCount !== null && total >= this.awaitingRollCount) {
            this.awaitingRollCount = null;
            this.busy = false;
            this.aimPhase = "idle";
            this.resetBallVisual();
            this.drawAimGuide();
            this.drawPowerMeter();
          }

          if (grew && animateNewest && !newestIsMine) {
            this.animateRoll(state.standingPins, newestRoll?.aim ?? 0);
          } else {
            this.setStandingPins(state.standingPins);
          }

          // Banner.
          if (state.gameOver) {
            const winners = state.winnerSeats.map((s) => names[s] ?? `Player ${s + 1}`);
            this.bannerText.setText(state.winnerSeats.length > 1 ? "It's a tie!" : `${winners[0]} wins the lane!`);
            this.aimPhase = "idle";
            this.helpText.setText("Match complete.");
            this.drawAimGuide();
            this.drawPowerMeter();
            setStatus(state.winnerSeats.length > 1 ? "A friendly tie." : `${winners[0]} takes the lane.`);
            return;
          }

          const turnName = names[state.currentSeat] ?? `Player ${state.currentSeat + 1}`;
          const frameLabel = `Frame ${state.currentFrame + 1}/10`;
          if (rollLockedRef.current) {
            this.bannerText.setText("Confirming your roll on the shared lane");
            this.helpText.setText("Waiting for the online lane to catch up.");
            setStatus("Waiting for the shared lane to confirm your last roll.");
            return;
          }
          if (this.isMyTurn(state)) {
            this.bannerText.setText(`Your roll — ${frameLabel}, ball ${state.ballInFrame + 1}`);
            if (!this.busy) {
              this.helpText.setText("Tap to lock direction. Tap again to lock power.");
              setStatus("Tap once to lock direction, then tap again to set power.");
            }
          } else {
            this.bannerText.setText(`${turnName} is bowling — ${frameLabel}`);
            this.helpText.setText("Watch the lane while your friend bowls.");
            setStatus(`Waiting for ${turnName}…`);
          }
        }

        private animateRoll(finalStanding: number, aim = 0) {
          this.aimPhase = "rolling";
          this.ball.setPosition(BALL_START.x, BALL_START.y);
          this.ballShadow.setPosition(BALL_START.x, BALL_START.y + 30);
          playCozyCue("move");
          const endX = clamp(460 + aim * 170, 260, 660);
          this.tweens.add({
            targets: [this.ball],
            x: endX,
            y: 168,
            duration: 620,
            ease: "Sine.in",
            onComplete: () => {
              playCozyCue("place");
              this.setStandingPins(finalStanding);
              this.tweens.add({ targets: this.ball, alpha: 0, duration: 260, onComplete: () => {
                this.ball.setPosition(BALL_START.x, BALL_START.y).setAlpha(1);
                this.ballShadow.setPosition(BALL_START.x, BALL_START.y + 30);
                this.aimPhase = "idle";
                this.renderFromLog(false);
              } });
            },
          });
          this.tweens.add({ targets: [this.ballShadow], x: endX, y: 198, duration: 620, ease: "Sine.in" });
        }

        private handleTap() {
          const state = computeBowlingState(rollsRef.current, seatCountRef.current);
          if (state.gameOver || this.busy || this.aimPhase === "rolling") return;
          if (!this.isMyTurn(state)) {
            playCozyCue("miss");
            return;
          }
          if (this.aimPhase === "idle") {
            this.aimPhase = "aim";
            this.aim = 0;
            this.aimDir = 1;
            this.helpText.setText("Direction sweeping. Tap to lock your line.");
            this.drawAimGuide();
            return;
          }
          if (this.aimPhase === "aim") {
            this.aimPhase = "power";
            this.power = 0;
            this.powerDir = 1;
            this.helpText.setText("Power meter running. Tap to release the ball.");
            this.drawAimGuide();
            return;
          }
          // Lock power → resolve the roll.
          this.aimPhase = "rolling";
          const standing = state.standingPins;
          const pins = pinsFromAimPower(this.aim, this.power, standing);
          const aim = this.aim;
          const power = this.power;
          this.drawAimGuide();
          this.drawPowerMeter();
          void this.commitRoll(pins, standing, aim, power);
        }

        private async commitRoll(pins: number, standing: number, aim: number, power: number) {
          // Animate my own roll immediately for responsiveness, then submit.
          const expectedRollCount = rollsRef.current.length + 1;
          this.busy = true;
          this.awaitingRollCount = expectedRollCount;
          setStatus("Rolling…");
          this.resetBallVisual();
          const endX = clamp(460 + aim * 170, 260, 660);
          this.tweens.add({
            targets: this.ball,
            x: endX,
            y: 168,
            duration: 600,
            ease: "Sine.in",
            onComplete: () => {
              this.setStandingPins(standing - pins);
              playCozyCue(pins >= standing ? "score" : "place");
              this.time.delayedCall(220, () => {
                this.resetBallVisual();
              });
            },
          });
          this.tweens.add({ targets: [this.ballShadow], x: endX, y: 198, duration: 600, ease: "Sine.in" });

          const result = await onRollRef.current(pins, { aim, power });
          if (!result.ok) {
            this.awaitingRollCount = null;
            this.busy = false;
            this.aimPhase = "idle";
            this.resetBallVisual();
            setStatus(result.reason ?? "Roll could not be saved — try again.");
            this.renderFromLog(false);
            return;
          }
          // Success: the updated log must arrive before the player can
          // roll again. This prevents a fast client from taking a second
          // turn off stale local state while the server has already moved
          // the lane to the next bowler.
          if (rollsRef.current.length >= expectedRollCount) {
            this.awaitingRollCount = null;
            this.busy = false;
            this.aimPhase = "idle";
            this.resetBallVisual();
            this.renderFromLog(false);
          } else {
            setStatus("Roll saved. Waiting for the shared lane to sync.");
          }
        }

        private drawAimGuide() {
          if (!this.laneGuide || !this.aimNeedle) return;
          this.laneGuide.clear();
          this.aimNeedle.clear();

          const activeAim = this.aimPhase === "aim" || this.aimPhase === "power" ? this.aim : 0;
          const endX = clamp(460 + activeAim * 170, 260, 660);
          this.laneGuide.lineStyle(5, 0x8e70bd, this.aimPhase === "idle" ? 0.18 : 0.66);
          this.laneGuide.lineBetween(BALL_START.x, BALL_START.y - 22, endX, 142);
          this.laneGuide.fillStyle(0xffffff, 0.82);
          this.laneGuide.fillCircle(endX, 142, 11);
          this.laneGuide.lineStyle(2, 0x8e70bd, 0.8);
          this.laneGuide.strokeCircle(endX, 142, 11);

          const meterX = 500;
          const meterY = GAME_HEIGHT - 54;
          const meterW = 360;
          this.aimNeedle.fillStyle(0xffffff, 0.72);
          this.aimNeedle.fillRoundedRect(meterX, meterY, meterW, 26, 13);
          this.aimNeedle.lineStyle(2, 0x8e70bd, 0.5);
          this.aimNeedle.strokeRoundedRect(meterX, meterY, meterW, 26, 13);
          this.aimNeedle.fillStyle(0x8e70bd, this.aimPhase === "aim" ? 0.95 : 0.55);
          const markerX = meterX + meterW / 2 + activeAim * (meterW / 2 - 16);
          this.aimNeedle.fillCircle(markerX, meterY + 13, 10);
          this.aimNeedle.lineStyle(1, 0x5b3f3f, 0.24);
          this.aimNeedle.lineBetween(meterX + meterW / 2, meterY + 3, meterX + meterW / 2, meterY + 23);
        }

        private drawPowerMeter() {
          const x = 60;
          const y = GAME_HEIGHT - 54;
          const w = 360;
          const h = 26;
          this.powerBar.clear();
          this.powerBar.fillStyle(0xffffff, 0.7);
          this.powerBar.fillRoundedRect(x, y, w, h, 13);
          this.powerBar.lineStyle(2, 0xd87e8c, 0.6);
          this.powerBar.strokeRoundedRect(x, y, w, h, 13);
          this.powerFill.clear();
          if (this.aimPhase === "power") {
            this.powerFill.fillStyle(0xd87e8c, 0.9);
            this.powerFill.fillRoundedRect(x + 2, y + 2, Math.max(0, (w - 4) * this.power), h - 4, 11);
          }
        }

        update(_time: number, delta: number) {
          if (this.aimPhase === "aim") {
            this.aim += this.aimDir * (delta / 820);
            if (this.aim >= 1) {
              this.aim = 1;
              this.aimDir = -1;
            } else if (this.aim <= -1) {
              this.aim = -1;
              this.aimDir = 1;
            }
            this.drawAimGuide();
          }
          if (this.aimPhase === "power") {
            this.power += this.powerDir * (delta / 900);
            if (this.power >= 1) {
              this.power = 1;
              this.powerDir = -1;
            } else if (this.power <= 0) {
              this.power = 0;
              this.powerDir = 1;
            }
            this.drawPowerMeter();
          }
        }
      }

      game = new PhaserModule.Game({
        type: PhaserModule.AUTO,
        parent: mountRef.current,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        backgroundColor: "#fbf3e2",
        scale: { mode: PhaserModule.Scale.FIT, autoCenter: PhaserModule.Scale.CENTER_BOTH },
        scene: BowlingScene,
      });
    }

    void boot();

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, []);

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-2xl border border-cream-300 bg-cream-50 shadow-sm">
        <div ref={mountRef} className="aspect-[920/600] w-full" />
      </div>
      <p className="rounded-lg border border-honey-500/30 bg-honey-100/60 px-3 py-2 text-sm font-bold text-ink-700">
        {status}
      </p>
    </div>
  );
}
