"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CircleDot } from "lucide-react";
import type Phaser from "phaser";
import { Button } from "@/components/ui/button";
import { playCozyCue } from "@/lib/game/cozy-audio";
import {
  BOWLING_PIN_IDS,
  computeBowlingStandingPinIds,
  computeBowlingState,
  getBowlingImpact,
  getBowlingPinReactions,
  selectBowlingKnockedPinIds,
  type BowlingRoll,
} from "@/lib/game/bowling-scoring";

type BowlingCanvasProps = {
  rolls: BowlingRoll[];
  mySeatIndex: number | null;
  seatCount: number;
  seatNames: string[];
  onRoll: (details: { aim: number; power: number }) => Promise<{ ok: boolean; reason?: string }>;
  rollLocked?: boolean;
  sessionId?: string | null;
};

const GAME_WIDTH = 920;
const GAME_HEIGHT = 560;
const BALL_START = { x: 460, y: 485 };
const PIN_POSITIONS = [
  [460, 128], [430, 162], [490, 162], [400, 196], [460, 196],
  [520, 196], [370, 230], [430, 230], [490, 230], [550, 230],
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function describeRoll(pins: number, standingBeforeRoll: number, roll: BowlingRoll) {
  if (standingBeforeRoll === 10 && pins === 10) return "Strike!";
  if (standingBeforeRoll < 10 && pins === standingBeforeRoll) return "Spare!";
  if (pins === 0) return "Gutter ball";
  const impact = getBowlingImpact(roll.aim ?? 0, roll.power ?? 0, roll.rollSeed ?? 0);
  if ((roll.power ?? 0) < 0.4) return `Too soft · ${pins} pin${pins === 1 ? "" : "s"}`;
  if (Math.abs(impact.effectiveAim) > 0.58) return `A little wide · ${pins} pin${pins === 1 ? "" : "s"}`;
  if (impact.pocketError <= 0.11 && (roll.power ?? 0) >= 0.68 && (roll.power ?? 0) <= 0.97) {
    return `Great pocket hit · ${pins} pins`;
  }
  if (standingBeforeRoll === 10 && pins >= 7) return `Spare chance · ${pins} pins`;
  return `${pins} pin${pins === 1 ? "" : "s"}`;
}

function aimLabel(aim: number) {
  if (aim < -0.12) return `${Math.round(Math.abs(aim) * 100)}% left`;
  if (aim > 0.12) return `${Math.round(aim * 100)}% right`;
  return "Center line";
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
  const seatCountRef = useRef(seatCount);
  const seatNamesRef = useRef(seatNames);
  const aimRef = useRef(0);
  const powerRef = useRef(0);
  const [aim, setAim] = useState(0);
  const [power, setPower] = useState(0);
  const [powerTouched, setPowerTouched] = useState(false);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [status, setStatus] = useState("Aim for the pocket and release with steady power.");

  const state = useMemo(() => computeBowlingState(rolls, seatCount), [rolls, seatCount]);
  const isMyTurn = !state.gameOver && (
    mySeatIndex === null ? !sessionId : state.currentSeat === mySeatIndex
  );
  const canAdjust = isMyTurn && !rollLocked && !sceneBusy;
  const canRoll = canAdjust && powerTouched && power >= 0.12;

  useEffect(() => {
    rollsRef.current = rolls;
    seatCountRef.current = seatCount;
    seatNamesRef.current = seatNames;
    window.dispatchEvent(new CustomEvent("hearthaven:bowling-sync"));
  }, [rolls, seatCount, seatNames]);

  useEffect(() => {
    aimRef.current = aim;
    powerRef.current = power;
    window.dispatchEvent(new CustomEvent("hearthaven:bowling-controls"));
  }, [aim, power]);

  async function handleRoll() {
    if (!canRoll) return;
    setStatus("Sending your roll to the shared lane...");
    const result = await onRoll({ aim, power });
    if (!result.ok) setStatus(result.reason ?? "That roll could not be saved. Try again.");
    else {
      setPower(0);
      setPowerTouched(false);
      setStatus("Roll accepted. Waiting for the shared lane animation.");
    }
  }

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
        private bannerText!: Phaser.GameObjects.Text;
        private helpText!: Phaser.GameObjects.Text;
        private resultCallout?: Phaser.GameObjects.Text;
        private renderedRollCount = 0;
        private animating = false;
        private syncQueued = false;
        private syncHandler?: () => void;
        private controlsHandler?: () => void;

        preload() {
          this.load.image("moonberry-bowling-bg", "/game-assets/generated/moonberry-bowling-bg.png");
          this.load.image("casper-sprite", "/game-assets/generated/casper-sprite.png");
          this.load.spritesheet("minigame-props", "/game-assets/generated/minigame-props-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
        }

        create() {
          this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "moonberry-bowling-bg")
            .setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-20);
          this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xfffcf3, 0.08).setDepth(-19);
          this.drawLane();
          const mascot = this.add.container(GAME_WIDTH - 92, GAME_HEIGHT - 104).setDepth(6000);
          mascot.add(this.add.image(0, 0, "casper-sprite").setDisplaySize(108, 108));
          this.tweens.add({ targets: mascot, y: mascot.y - 7, duration: 1650, yoyo: true, repeat: -1, ease: "Sine.inOut" });

          this.createPins();
          this.createBall();
          this.bannerText = this.add.text(GAME_WIDTH / 2, 38, "", {
            fontFamily: "Nunito, sans-serif", fontSize: "22px", fontStyle: "900", color: "#5b3f3f", align: "center",
          }).setOrigin(0.5).setDepth(7000);
          this.helpText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 34, "Set aim and power below, then roll.", {
            fontFamily: "Nunito, sans-serif", fontSize: "15px", fontStyle: "900", color: "#6c4d4d", align: "center",
          }).setOrigin(0.5).setDepth(7000);
          this.laneGuide = this.add.graphics().setDepth(6750);

          this.renderedRollCount = rollsRef.current.length;
          this.syncHandler = () => this.syncFromCanonicalLog(true);
          this.controlsHandler = () => this.drawAimGuide();
          window.addEventListener("hearthaven:bowling-sync", this.syncHandler);
          window.addEventListener("hearthaven:bowling-controls", this.controlsHandler);
          this.syncFromCanonicalLog(false);
        }

        shutdown() {
          if (this.syncHandler) window.removeEventListener("hearthaven:bowling-sync", this.syncHandler);
          if (this.controlsHandler) window.removeEventListener("hearthaven:bowling-controls", this.controlsHandler);
        }

        private drawLane() {
          const lane = this.add.graphics().setDepth(-10);
          lane.fillStyle(0xf4dba6, 0.68);
          lane.beginPath();
          lane.moveTo(306, 510); lane.lineTo(694, 510); lane.lineTo(560, 105); lane.lineTo(420, 105);
          lane.closePath(); lane.fillPath();
          lane.lineStyle(5, 0xffffff, 0.52); lane.strokePath();
          for (let i = 0; i < 9; i += 1) {
            lane.lineStyle(1.5, 0xffffff, 0.24);
            lane.lineBetween(330 + i * 42, 505, 425 + i * 16, 116);
          }
          this.add.rectangle(238, 310, 78, 390, 0x89b5d7, 0.34).setDepth(-11);
          this.add.rectangle(722, 310, 78, 390, 0x89b5d7, 0.34).setDepth(-11);
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
          this.ballShadow = this.add.ellipse(BALL_START.x, BALL_START.y + 28, 84, 24, 0x3a2a2a, 0.16).setDepth(500);
          this.ball = this.add.container(BALL_START.x, BALL_START.y).setDepth(BALL_START.y);
          this.ball.add(this.add.image(0, 0, "minigame-props", 0).setDisplaySize(104, 138));
        }

        private resetBallVisual() {
          this.tweens.killTweensOf(this.ball);
          this.tweens.killTweensOf(this.ballShadow);
          this.ball.setPosition(BALL_START.x, BALL_START.y).setAlpha(1).setRotation(0).setScale(1);
          this.ballShadow.setPosition(BALL_START.x, BALL_START.y + 28).setAlpha(1).setScale(1);
        }

        private setStandingPinIds(ids: readonly number[]) {
          const standing = new Set(ids);
          this.pins.forEach((pin, index) => {
            this.tweens.killTweensOf(pin);
            const [x, y] = PIN_POSITIONS[index];
            pin.setPosition(x, y).setRotation(0).setScale(1).setAlpha(standing.has(index) ? 1 : 0);
          });
        }

        private syncFromCanonicalLog(animateNewest: boolean) {
          if (this.animating) {
            this.syncQueued = true;
            return;
          }
          const canonicalRolls = rollsRef.current;
          const total = canonicalRolls.length;
          if (animateNewest && total > this.renderedRollCount) {
            this.animateCanonicalRoll(canonicalRolls, total - 1);
            return;
          }
          this.renderedRollCount = total;
          this.setStandingPinIds(computeBowlingStandingPinIds(canonicalRolls, seatCountRef.current));
          this.resetBallVisual();
          this.drawAimGuide();
          this.renderTurnText();
        }

        private renderTurnText() {
          const state = computeBowlingState(rollsRef.current, seatCountRef.current);
          const names = seatNamesRef.current;
          if (state.gameOver) {
            const winners = state.winnerSeats.map((seat) => names[seat] ?? `Player ${seat + 1}`);
            this.bannerText.setText(winners.length > 1 ? "Friendly tie!" : `${winners[0]} wins the lane!`);
            this.helpText.setText("Match complete.");
            setStatus(winners.length > 1 ? "The match ended in a tie." : `${winners[0]} won the match.`);
            return;
          }
          const turnName = names[state.currentSeat] ?? `Player ${state.currentSeat + 1}`;
          this.bannerText.setText(`${turnName} · frame ${state.currentFrame + 1}, ball ${state.ballInFrame + 1}`);
          this.helpText.setText("Aim → choose power → roll → score → next ball.");
        }

        private animateCanonicalRoll(canonicalRolls: BowlingRoll[], newestIndex: number) {
          const newestRoll = canonicalRolls[newestIndex];
          const beforeRolls = canonicalRolls.slice(0, newestIndex);
          const beforeState = computeBowlingState(beforeRolls, seatCountRef.current);
          const beforeIds = computeBowlingStandingPinIds(beforeRolls, seatCountRef.current);
          const knockedIds = selectBowlingKnockedPinIds(beforeIds, newestRoll);
          const reactions = getBowlingPinReactions(beforeIds, newestRoll);
          const reactionById = new Map(reactions.map((reaction) => [reaction.id, reaction]));
          const afterIds = computeBowlingStandingPinIds(canonicalRolls, seatCountRef.current);
          const label = describeRoll(newestRoll.pins, beforeState.standingPins, newestRoll);
          const bowler = seatNamesRef.current[newestRoll.seat] ?? `Player ${newestRoll.seat + 1}`;
          const impact = getBowlingImpact(newestRoll.aim ?? 0, newestRoll.power ?? 0, newestRoll.rollSeed ?? 0);
          const endX = clamp(460 + impact.effectiveAim * 170, 260, 660);
          const duration = Math.round(1080 - clamp(newestRoll.power ?? 0.7, 0, 1) * 260);

          this.animating = true;
          setSceneBusy(true);
          this.setStandingPinIds(beforeIds);
          this.resetBallVisual();
          this.bannerText.setText(`${bowler} is rolling...`);
          this.helpText.setText("The shared lane is resolving the pins.");
          playCozyCue("roll");

          const travel = { progress: 0 };
          this.tweens.add({
            targets: travel,
            progress: 1,
            duration,
            ease: "Sine.in",
            onUpdate: () => {
              const t = travel.progress;
              const curve = Math.sin(t * Math.PI) * (newestRoll.aim ?? 0) * 28;
              const x = PhaserModule.Math.Linear(BALL_START.x, endX, t) + curve;
              const y = PhaserModule.Math.Linear(BALL_START.y, 166, t);
              const scale = PhaserModule.Math.Linear(1, 0.78, t);
              this.ball.setPosition(x, y).setScale(scale).setRotation(t * Math.PI * 5);
              this.ballShadow.setPosition(x, y + 27).setScale(scale).setAlpha(0.16 - t * 0.09);
            },
            onComplete: () => {
              playCozyCue(label === "Strike!" ? "strike" : label === "Spare!" ? "spare" : label === "Gutter ball" ? "gutter" : "pin");
              knockedIds.forEach((pinId, order) => {
                const pin = this.pins[pinId];
                const reaction = reactionById.get(pinId);
                const direction = reaction?.directionX || ((PIN_POSITIONS[pinId][0] - endX) >= 0 ? 1 : -1);
                const strength = reaction?.strength ?? 0.55;
                this.tweens.add({
                  targets: pin,
                  x: pin.x + direction * (24 + strength * 38),
                  y: pin.y + 18 + (reaction?.directionY ?? 0.6) * 32,
                  rotation: direction * (0.72 + strength * 0.72),
                  alpha: 0,
                  delay: Math.max(order * 18, reaction?.delay ?? 0),
                  duration: 430 + Math.round(strength * 120),
                  ease: "Cubic.out",
                });
              });
              reactions
                .filter((reaction) => !knockedIds.includes(reaction.id) && reaction.strength > 0.28)
                .forEach((reaction) => {
                  const pin = this.pins[reaction.id];
                  this.tweens.add({
                    targets: pin,
                    x: pin.x + reaction.directionX * 5,
                    rotation: reaction.directionX * 0.055,
                    duration: 110,
                    yoyo: true,
                    repeat: 1,
                    delay: reaction.delay,
                  });
                });
              this.showRollCallout(label);
              setStatus(`${bowler} rolled: ${label}`);
              this.tweens.add({ targets: this.ball, alpha: 0, duration: 240 });
              this.time.delayedCall(920, () => {
                this.renderedRollCount = canonicalRolls.length;
                this.setStandingPinIds(afterIds);
                this.resetBallVisual();
                this.animating = false;
                setSceneBusy(false);
                this.renderTurnText();
                this.drawAimGuide();
                if (this.syncQueued || rollsRef.current.length > this.renderedRollCount) {
                  this.syncQueued = false;
                  this.syncFromCanonicalLog(true);
                }
              });
            },
          });
        }

        private showRollCallout(label: string) {
          this.resultCallout?.destroy();
          const isBig = label === "Strike!" || label === "Spare!";
          const color = label === "Strike!" ? "#D9A53E" : label === "Spare!" ? "#8E70BD" : "#5B3F3F";
          this.resultCallout = this.add.text(GAME_WIDTH / 2, 92, label, {
            fontFamily: "Caprasimo, Georgia, serif", fontSize: isBig ? "37px" : "26px", color,
            align: "center", stroke: "#fffdf6", strokeThickness: 8,
          }).setOrigin(0.5).setDepth(7600).setAlpha(0).setScale(0.84);
          this.tweens.add({ targets: this.resultCallout, alpha: 1, scale: 1, y: 80, duration: 180, ease: "Back.out" });
          this.tweens.add({
            targets: this.resultCallout, alpha: 0, y: 62, delay: 1050, duration: 380,
            onComplete: () => { this.resultCallout?.destroy(); this.resultCallout = undefined; },
          });
        }

        private drawAimGuide() {
          if (!this.laneGuide) return;
          this.laneGuide.clear();
          const endX = clamp(460 + aimRef.current * 170, 260, 660);
          this.laneGuide.lineStyle(5, 0x8e70bd, this.animating ? 0.14 : 0.68);
          this.laneGuide.lineBetween(BALL_START.x, BALL_START.y - 20, endX, 142);
          this.laneGuide.fillStyle(0xffffff, 0.88); this.laneGuide.fillCircle(endX, 142, 11);
          this.laneGuide.lineStyle(2, 0x8e70bd, 0.86); this.laneGuide.strokeCircle(endX, 142, 11);
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
    return () => { destroyed = true; game?.destroy(true); };
  }, []);

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-lg border border-cream-300 bg-cream-50 shadow-sm">
        <div ref={mountRef} className="aspect-[920/560] w-full" />
      </div>

      <div className="grid gap-4 rounded-lg border border-lavender-300/45 bg-white/88 p-4 shadow-sm md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="grid gap-2 text-sm font-extrabold text-ink-800">
          <span className="flex items-center justify-between gap-2"><span>Aim</span><span className="text-xs text-lavender-600">{aimLabel(aim)}</span></span>
          <span className="grid grid-cols-[40px_1fr_40px] items-center gap-2">
            <Button type="button" size="icon" variant="outline" aria-label="Aim left" disabled={!canAdjust} onClick={() => setAim((value) => clamp(value - 0.1, -1, 1))}><ChevronLeft /></Button>
            <input aria-label="Bowling aim" type="range" min={-1} max={1} step={0.02} value={aim} disabled={!canAdjust} onChange={(event) => setAim(Number(event.target.value))} className="h-10 w-full accent-[#8E70BD]" />
            <Button type="button" size="icon" variant="outline" aria-label="Aim right" disabled={!canAdjust} onClick={() => setAim((value) => clamp(value + 0.1, -1, 1))}><ChevronRight /></Button>
          </span>
          <span className="text-[11px] font-bold text-ink-500">Aim just beside the head pin to find either pocket.</span>
        </label>

        <label className="grid gap-2 text-sm font-extrabold text-ink-800">
          <span className="flex items-center justify-between gap-2"><span>Power</span><span className="text-xs text-blush-600">{Math.round(power * 100)}%</span></span>
          <input
            aria-label="Bowling power"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={power}
            disabled={!canAdjust}
            onChange={(event) => {
              setPower(Number(event.target.value));
              setPowerTouched(true);
            }}
            className="h-10 w-full accent-[#D87E8C]"
          />
          <span className="flex justify-between text-[11px] font-bold text-ink-500"><span>Soft</span><span>Balanced</span><span>Full</span></span>
        </label>

        <Button type="button" size="lg" disabled={!canRoll} onClick={() => void handleRoll()} className="w-full md:w-auto">
          <CircleDot /> {sceneBusy ? "Pins falling..." : rollLocked ? "Confirming..." : !isMyTurn ? "Friend's turn" : !powerTouched || power < 0.12 ? "Choose power" : "Roll ball"}
        </Button>
      </div>

      <p aria-live="polite" className="rounded-lg border border-honey-500/30 bg-honey-100/60 px-3 py-2 text-sm font-bold text-ink-700">
        {status}
      </p>
    </div>
  );
}
