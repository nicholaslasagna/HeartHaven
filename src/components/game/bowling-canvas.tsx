"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { computeBowlingState, type BowlingRoll } from "@/lib/game/bowling-scoring";

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
  onRoll: (pins: number) => Promise<{ ok: boolean; reason?: string }>;
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

/** Map a locked power value (0–1) to pins knocked, capped at standing. */
function pinsFromPower(power: number, standing: number): number {
  // Sweet spot near the top of the meter scores big. A little jitter so
  // identical taps aren't perfectly deterministic (keeps it lively) — the
  // RESULT is what's logged + replayed, so both clients still agree.
  const accuracy = 1 - Math.abs(power - 0.92) / 0.92; // 1.0 at power≈0.92
  const base = Math.round(standing * Math.max(0, accuracy));
  const jitter = Math.random() < 0.25 ? -1 : 0;
  return Math.max(0, Math.min(standing, base + jitter));
}

export function BowlingCanvas({
  rolls,
  mySeatIndex,
  seatCount,
  seatNames,
  onRoll,
  sessionId,
}: BowlingCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rollsRef = useRef(rolls);
  const mySeatRef = useRef(mySeatIndex);
  const seatCountRef = useRef(seatCount);
  const seatNamesRef = useRef(seatNames);
  const onRollRef = useRef(onRoll);
  const sessionIdRef = useRef(sessionId);
  const [status, setStatus] = useState("Tap to start the power meter, tap again to roll.");

  useEffect(() => {
    rollsRef.current = rolls;
    mySeatRef.current = mySeatIndex;
    seatCountRef.current = seatCount;
    seatNamesRef.current = seatNames;
    onRollRef.current = onRoll;
    sessionIdRef.current = sessionId;
    // Tell the live scene that the roll log changed so it can re-render
    // pins / turn / animate the newest roll.
    window.dispatchEvent(new CustomEvent("hearthaven:bowling-sync"));
  }, [rolls, mySeatIndex, seatCount, seatNames, onRoll, sessionId]);

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
        private powerBar!: Phaser.GameObjects.Graphics;
        private powerFill!: Phaser.GameObjects.Graphics;
        private bannerText!: Phaser.GameObjects.Text;
        private aimPhase: "idle" | "power" | "rolling" = "idle";
        private power = 0;
        private powerDir = 1;
        private renderedRollCount = 0;
        private busy = false;
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

          // Power meter (bottom).
          this.powerBar = this.add.graphics().setDepth(6900);
          this.powerFill = this.add.graphics().setDepth(6901);
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

        /** Show `standing` pins upright (toppling the rest). */
        private setStandingPins(standing: number) {
          this.pins.forEach((pin, index) => {
            const upright = index < standing;
            pin.setAlpha(upright ? 1 : 0.18);
            pin.setRotation(upright ? 0 : (index % 2 === 0 ? -1 : 1) * 0.9);
            pin.setY(PIN_POSITIONS[index][1] + (upright ? 0 : 8));
          });
        }

        private isMyTurn(state: ReturnType<typeof computeBowlingState>) {
          const seat = mySeatRef.current;
          if (seat === null || seat === undefined) return !state.gameOver; // local solo
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
          const mine = mySeatRef.current;
          const newestIsMine = mine !== null && mine !== undefined && newestSeat === mine;

          if (grew && animateNewest && !newestIsMine) {
            this.busy = false;
            this.animateRoll(state.standingPins);
          } else {
            this.setStandingPins(state.standingPins);
          }

          // Banner.
          if (state.gameOver) {
            const winners = state.winnerSeats.map((s) => names[s] ?? `Player ${s + 1}`);
            this.bannerText.setText(
              state.winnerSeats.length > 1 ? "It's a tie! 🎀" : `${winners[0]} wins! 🎳`,
            );
            this.aimPhase = "idle";
            this.drawPowerMeter();
            setStatus(state.winnerSeats.length > 1 ? "A friendly tie." : `${winners[0]} takes the lane.`);
            return;
          }

          const turnName = names[state.currentSeat] ?? `Player ${state.currentSeat + 1}`;
          const frameLabel = `Frame ${state.currentFrame + 1}/10`;
          if (this.isMyTurn(state)) {
            this.bannerText.setText(`Your roll — ${frameLabel}, ball ${state.ballInFrame + 1}`);
            if (!this.busy) setStatus("Tap to start the power meter, tap again to roll.");
          } else {
            this.bannerText.setText(`${turnName} is bowling — ${frameLabel}`);
            setStatus(`Waiting for ${turnName}…`);
          }
        }

        private animateRoll(finalStanding: number) {
          this.aimPhase = "rolling";
          this.ball.setPosition(BALL_START.x, BALL_START.y);
          this.ballShadow.setPosition(BALL_START.x, BALL_START.y + 30);
          playCozyCue("move");
          this.tweens.add({
            targets: [this.ball],
            x: 460,
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
          this.tweens.add({ targets: [this.ballShadow], x: 460, y: 198, duration: 620, ease: "Sine.in" });
        }

        private handleTap() {
          const state = computeBowlingState(rollsRef.current, seatCountRef.current);
          if (state.gameOver || this.busy || this.aimPhase === "rolling") return;
          if (!this.isMyTurn(state)) {
            playCozyCue("miss");
            return;
          }
          if (this.aimPhase === "idle") {
            this.aimPhase = "power";
            this.power = 0;
            this.powerDir = 1;
            return;
          }
          // Lock power → resolve the roll.
          this.aimPhase = "rolling";
          const standing = state.standingPins;
          const pins = pinsFromPower(this.power, standing);
          this.drawPowerMeter();
          void this.commitRoll(pins, standing);
        }

        private async commitRoll(pins: number, standing: number) {
          // Animate my own roll immediately for responsiveness, then submit.
          this.busy = true;
          setStatus("Rolling…");
          this.ball.setPosition(BALL_START.x, BALL_START.y).setAlpha(1);
          this.tweens.add({
            targets: this.ball,
            x: 460,
            y: 168,
            duration: 600,
            ease: "Sine.in",
            onComplete: () => {
              this.setStandingPins(standing - pins);
              playCozyCue(pins >= standing ? "score" : "place");
            },
          });

          const result = await onRollRef.current(pins);
          if (!result.ok) {
            this.busy = false;
            this.aimPhase = "idle";
            this.ball.setPosition(BALL_START.x, BALL_START.y).setAlpha(1);
            setStatus(result.reason ?? "Roll could not be saved — try again.");
            this.renderFromLog(false);
            return;
          }
          // Success: the updated log will arrive via the sync event and
          // renderFromLog will reconcile the authoritative state. Clear
          // busy after a short grace so the meter re-enables.
          this.busy = false;
          this.aimPhase = "idle";
          this.ball.setAlpha(0);
          this.time.delayedCall(200, () => {
            this.ball.setPosition(BALL_START.x, BALL_START.y).setAlpha(1);
            this.renderFromLog(false);
          });
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
