"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { GameReward } from "@/lib/game/rewards";
import { playCozyCue } from "@/lib/game/cozy-audio";
import {
  petalRelayKindLabel,
  type PetalRelayResult,
  type PetalRelayState,
} from "@/lib/game/petal-catch-relay";
import type { GameSessionSeat } from "@/lib/game/use-game-session";

type FallingItem = {
  node: Phaser.GameObjects.Container;
  speed: number;
  value: number;
  kind: "petal" | "heart" | "thorn";
  spin: number;
};

const GAME_WIDTH = 900;
const GAME_HEIGHT = 560;

type PetalCatchCanvasProps = {
  onReward?: (reward: GameReward) => void;
  mode?: "solo" | "relay";
  relayState?: PetalRelayState;
  seats?: GameSessionSeat[];
  mySeatIndex?: number | null;
  pendingRelayMove?: boolean;
  onRelayMove?: (result: PetalRelayResult) => void;
};

export function PetalCatchCanvas({
  onReward,
  mode = "solo",
  relayState,
  seats = [],
  mySeatIndex = null,
  pendingRelayMove = false,
  onRelayMove,
}: PetalCatchCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const onRewardRef = useRef(onReward);
  const onRelayMoveRef = useRef(onRelayMove);
  const modeRef = useRef(mode);
  const relayStateRef = useRef(relayState);
  const seatsRef = useRef(seats);
  const mySeatIndexRef = useRef(mySeatIndex);
  const pendingRelayMoveRef = useRef(pendingRelayMove);
  const [status, setStatus] = useState("Catch petals and hearts. Avoid thorns.");

  useEffect(() => {
    onRewardRef.current = onReward;
  }, [onReward]);

  useEffect(() => {
    onRelayMoveRef.current = onRelayMove;
  }, [onRelayMove]);

  useEffect(() => {
    modeRef.current = mode;
    relayStateRef.current = relayState;
    seatsRef.current = seats;
    mySeatIndexRef.current = mySeatIndex;
    pendingRelayMoveRef.current = pendingRelayMove;
  }, [mode, relayState, seats, mySeatIndex, pendingRelayMove]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class PetalCatchScene extends PhaserModule.Scene {
        private basket!: Phaser.GameObjects.Container;
        private basketGlow!: Phaser.GameObjects.Ellipse;
        private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
        private wasd?: Record<"left" | "right", Phaser.Input.Keyboard.Key>;
        private falling: FallingItem[] = [];
        private score = 0;
        private combo = 0;
        private timeLeft = 60;
        private elapsed = 0;
        private spawnElapsed = 0;
        private gameOver = false;
        private scoreText!: Phaser.GameObjects.Text;
        private comboText!: Phaser.GameObjects.Text;
        private timerText!: Phaser.GameObjects.Text;
        private rewardLayer?: Phaser.GameObjects.Container;
        private relayItemNode?: Phaser.GameObjects.Container;
        private relayItemKey: string | null = null;
        private relayItemY = -30;
        private relayItemElapsed = 0;
        private relaySubmittedItemIndex = -1;
        private relayStatusKey = "";

        constructor() {
          super("PetalCatch");
        }

        preload() {
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
          this.createBasket();
          this.createHud();
          this.cursors = this.input.keyboard?.createCursorKeys();
          this.wasd = this.input.keyboard?.addKeys({
            left: PhaserModule.Input.Keyboard.KeyCodes.A,
            right: PhaserModule.Input.Keyboard.KeyCodes.D,
          }) as Record<"left" | "right", Phaser.Input.Keyboard.Key> | undefined;
          if (modeRef.current === "relay") {
            setStatus("Petal Catch Relay connected. Wait for your turn, then catch petals and dodge thorns.");
          } else {
            setStatus("Move the basket with mouse, touch, arrows, or A/D.");
          }
        }

        update(_time: number, delta: number) {
          if (this.gameOver) return;

          if (modeRef.current === "relay") {
            this.updateRelay(delta);
            return;
          }

          this.elapsed += delta;
          this.timeLeft = Math.max(0, 60 - this.elapsed / 1000);
          this.spawnElapsed += delta;

          this.updateBasket(delta);
          this.updateSpawner();
          this.updateFalling(delta);
          this.updateHud();

          if (this.timeLeft <= 0) {
            this.endRound();
          }
        }

        private setRelayStatus(key: string, copy: string) {
          if (this.relayStatusKey === key) return;
          this.relayStatusKey = key;
          setStatus(copy);
        }

        private activeSeatName(state: PetalRelayState) {
          const seat = seatsRef.current.find((candidate) => candidate.seat_index === state.currentSeat);
          return seat?.display_name ?? `Seat ${state.currentSeat + 1}`;
        }

        private canTakeRelayTurn(state: PetalRelayState) {
          return (
            mySeatIndexRef.current !== null &&
            mySeatIndexRef.current === state.currentSeat &&
            !pendingRelayMoveRef.current &&
            !state.gameOver
          );
        }

        private updateRelay(delta: number) {
          const state = relayStateRef.current;
          if (!state) {
            this.setRelayStatus("relay-loading", "Connecting the shared relay session...");
            return;
          }

          this.score = state.score;
          this.combo = state.combo;
          this.updateRelayHud(state);

          if (state.gameOver) {
            this.basket.setAlpha(0.55);
            this.basketGlow.setAlpha(0.1);
            this.destroyRelayItem();
            this.showRelayComplete(state);
            this.setRelayStatus("relay-complete", `${state.success ? "Relay complete" : "Relay ended"}: ${state.finalScore} team points.`);
            return;
          }

          this.rewardLayer?.destroy(true);
          this.rewardLayer = undefined;

          const canAct = this.canTakeRelayTurn(state);
          this.basket.setAlpha(canAct ? 1 : 0.58);
          this.basketGlow.setAlpha(canAct ? 0.16 : 0.08);

          this.syncRelayItem(state);
          if (!state.currentItem || !this.relayItemNode) return;

          if (this.relaySubmittedItemIndex !== state.itemIndex && state.itemIndex > this.relaySubmittedItemIndex) {
            this.relaySubmittedItemIndex = -1;
          }

          if (!canAct) {
            const activeName = this.activeSeatName(state);
            this.basket.x = PhaserModule.Math.Linear(this.basket.x, state.currentItem.x, 0.04);
            this.basketGlow.x = this.basket.x;
            this.relayItemElapsed += delta;
            this.relayItemNode.y = 82 + Math.sin(this.relayItemElapsed * 0.004) * 8;
            this.relayItemNode.x = state.currentItem.x + Math.sin(this.relayItemElapsed * 0.003) * 10;
            this.setRelayStatus(`relay-wait-${state.itemIndex}-${activeName}`, `Waiting for ${activeName} to handle the ${petalRelayKindLabel(state.currentItem.kind).toLowerCase()}.`);
            return;
          }

          this.updateBasket(delta);
          this.relayItemElapsed += delta;
          this.relayItemY += state.currentItem.speed * (delta / 1000);
          this.relayItemNode.y = this.relayItemY;
          this.relayItemNode.x = state.currentItem.x + Math.sin(this.relayItemElapsed * 0.004) * state.currentItem.sway * 24;
          this.relayItemNode.rotation += state.currentItem.kind === "thorn" ? 0.0035 * delta : 0.002 * delta;
          this.setRelayStatus(
            `relay-act-${state.itemIndex}`,
            state.currentItem.kind === "thorn"
              ? "Your turn: dodge the thorn. Let it fall past the basket."
              : `Your turn: catch the ${petalRelayKindLabel(state.currentItem.kind).toLowerCase()}.`,
          );

          const caught = PhaserModule.Math.Distance.Between(this.relayItemNode.x, this.relayItemNode.y, this.basket.x, this.basket.y) < 66;
          if (caught) {
            this.submitRelayResult("catch");
            return;
          }

          if (this.relayItemNode.y > GAME_HEIGHT + 48) {
            this.submitRelayResult("miss");
          }
        }

        private updateRelayHud(state: PetalRelayState) {
          this.scoreText.setText(`Team ${state.score}`);
          this.comboText.setText(`Combo x${state.combo} · Misses ${state.misses}`);
          this.timerText.setText(`${Math.max(0, 24 - state.itemIndex)} drops`);
        }

        private destroyRelayItem() {
          this.relayItemNode?.destroy();
          this.relayItemNode = undefined;
          this.relayItemKey = null;
        }

        private syncRelayItem(state: PetalRelayState) {
          const item = state.currentItem;
          if (!item) {
            this.destroyRelayItem();
            return;
          }
          const key = `${state.itemIndex}:${item.id}`;
          if (this.relayItemKey === key) return;

          this.destroyRelayItem();
          this.relayItemKey = key;
          this.relayItemY = -34;
          this.relayItemElapsed = 0;
          this.relaySubmittedItemIndex = -1;

          const node = this.add.container(item.x, this.relayItemY).setDepth(100);
          const frame = item.kind === "heart" ? 3 : item.kind === "thorn" ? 5 : 4;
          const size =
            item.kind === "thorn"
              ? { width: 88, height: 104 }
              : item.kind === "heart"
                ? { width: 86, height: 118 }
                : item.kind === "golden"
                  ? { width: 104, height: 128 }
                  : { width: 92, height: 116 };
          const sprite = this.add.image(0, 0, "minigame-props", frame).setDisplaySize(size.width, size.height);
          if (item.kind === "golden") sprite.setTint(0xffd76f);
          node.add(sprite);
          this.relayItemNode = node;
        }

        private submitRelayResult(result: PetalRelayResult) {
          const state = relayStateRef.current;
          if (!state?.currentItem || pendingRelayMoveRef.current) return;
          if (this.relaySubmittedItemIndex === state.itemIndex) return;
          this.relaySubmittedItemIndex = state.itemIndex;
          this.setRelayStatus(
            `relay-submit-${state.itemIndex}-${result}`,
            result === "catch" ? "Saving that catch..." : state.currentItem.kind === "thorn" ? "Nice dodge. Saving..." : "Saving that miss...",
          );
          playCozyCue(
            result === "catch"
              ? state.currentItem.kind === "thorn"
                ? "thorn"
                : state.currentItem.kind === "heart"
                  ? "heart"
                  : "catch"
              : state.currentItem.kind === "thorn"
                ? "combo"
                : "miss",
          );
          onRelayMoveRef.current?.(result);
        }

        private showRelayComplete(state: PetalRelayState) {
          if (this.rewardLayer) return;
          const layer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(7000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-208, -130, 416, 260, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-208, -130, 416, 260, 24);
          layer.add(bg);
          layer.add(
            this.add.text(0, -82, state.success ? "Relay Complete" : "Relay Finished", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "25px",
            }).setOrigin(0.5),
          );
          layer.add(
            this.add.text(0, -24, `Team score ${state.finalScore}\nCombo x${state.combo} · Misses ${state.misses}`, {
              align: "center",
              color: "#5B3F3F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "18px",
              fontStyle: "800",
              lineSpacing: 8,
            }).setOrigin(0.5),
          );
          layer.add(
            this.add.text(0, 72, "Claim from the co-op panel", {
              color: "#8E70BD",
              fontFamily: "Nunito, sans-serif",
              fontSize: "15px",
              fontStyle: "900",
              backgroundColor: "#EFE6F7",
              padding: { x: 18, y: 10 },
            }).setOrigin(0.5),
          );
          this.rewardLayer = layer;
          playCozyCue("reward");
        }

        private drawBackdrop() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "moonberry-garden-bg").setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-20);
          this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xfffcf3, 0.14).setDepth(-19);

          const sky = this.add.graphics();
          sky.fillGradientStyle(0xfbe3e3, 0xefe6f7, 0xfdf8ee, 0xe4efd7, 0.12);
          sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

          const sun = this.add.circle(748, 92, 62, 0xfaebc2, 0.55);
          this.tweens.add({
            targets: sun,
            scale: 1.08,
            alpha: 0.72,
            duration: 1800,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });

          const hills = this.add.graphics();
          hills.fillStyle(0xe4efd7, 0.95);
          hills.fillEllipse(220, 448, 520, 210);
          hills.fillStyle(0xd8e9c8, 0.92);
          hills.fillEllipse(660, 452, 620, 230);
          hills.fillStyle(0xfdf8ee, 0.9);
          hills.fillRoundedRect(0, 452, GAME_WIDTH, 108, 28);

          for (let index = 0; index < 34; index += 1) {
            const sparkle = this.add.star(
              PhaserModule.Math.Between(30, GAME_WIDTH - 30),
              PhaserModule.Math.Between(20, 390),
              4,
              2,
              PhaserModule.Math.Between(4, 8),
              0xffffff,
              PhaserModule.Math.FloatBetween(0.12, 0.42),
            );
            this.tweens.add({
              targets: sparkle,
              y: sparkle.y + PhaserModule.Math.Between(10, 28),
              alpha: PhaserModule.Math.FloatBetween(0.2, 0.75),
              duration: PhaserModule.Math.Between(1500, 3200),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private createCasperMascot() {
          const casper = this.add.container(104, 448).setDepth(448);
          casper.add(this.add.ellipse(0, 42, 86, 22, 0x3a2a2a, 0.15));
          casper.add(this.add.image(0, -18, "casper-sprite").setDisplaySize(110, 110));
          this.tweens.add({
            targets: casper,
            y: casper.y - 5,
            duration: 980,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createBasket() {
          this.basketGlow = this.add.ellipse(450, 518, 132, 30, 0x3a2a2a, 0.16);
          this.basket = this.add.container(450, 484);
          this.basket.add(this.add.image(0, -16, "minigame-props", 2).setDisplaySize(172, 150));
        }

        private createHud() {
          const style = {
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "18px",
            fontStyle: "900",
          };
          this.scoreText = this.add.text(28, 24, "Score 0", style).setDepth(5000);
          this.comboText = this.add.text(28, 52, "Combo x0", { ...style, color: "#8E70BD", fontSize: "15px" }).setDepth(5000);
          this.timerText = this.add.text(GAME_WIDTH - 150, 24, "60s", style).setDepth(5000);
        }

        private updateBasket(delta: number) {
          const pointer = this.input.activePointer;
          const left = Boolean(this.cursors?.left.isDown || this.wasd?.left.isDown);
          const right = Boolean(this.cursors?.right.isDown || this.wasd?.right.isDown);
          const keyboardDirection = Number(right) - Number(left);

          if (keyboardDirection !== 0) {
            this.basket.x += keyboardDirection * delta * 0.44;
          } else if (pointer.isDown || pointer.x > 0) {
            this.basket.x = PhaserModule.Math.Linear(this.basket.x, pointer.x, 0.16);
          }

          this.basket.x = PhaserModule.Math.Clamp(this.basket.x, 82, GAME_WIDTH - 82);
          this.basketGlow.x = this.basket.x;
        }

        private updateSpawner() {
          const progress = 1 - this.timeLeft / 60;
          const interval = PhaserModule.Math.Linear(760, 260, progress);
          if (this.spawnElapsed < interval) return;
          this.spawnElapsed = 0;
          this.spawnItem(progress);
        }

        private spawnItem(progress: number) {
          const roll = PhaserModule.Math.FloatBetween(0, 1);
          const kind: FallingItem["kind"] = roll > 0.9 ? "thorn" : roll > 0.7 ? "heart" : "petal";
          const x = PhaserModule.Math.Between(60, GAME_WIDTH - 60);
          const node = this.add.container(x, -30).setDepth(100);
          const frame = kind === "heart" ? 3 : kind === "thorn" ? 5 : 4;
          const size = kind === "thorn" ? { width: 88, height: 104 } : kind === "heart" ? { width: 86, height: 118 } : { width: 92, height: 116 };
          node.add(this.add.image(0, 0, "minigame-props", frame).setDisplaySize(size.width, size.height));

          this.falling.push({
            node,
            speed: PhaserModule.Math.Linear(118, 250, progress) + PhaserModule.Math.Between(-18, 32),
            value: kind === "heart" ? 25 : kind === "thorn" ? -30 : 10,
            kind,
            spin: PhaserModule.Math.FloatBetween(-0.003, 0.004),
          });
        }

        private updateFalling(delta: number) {
          const remaining: FallingItem[] = [];

          this.falling.forEach((item) => {
            item.node.y += item.speed * (delta / 1000);
            item.node.x += Math.sin((this.elapsed + item.node.x) * 0.004) * 0.42;
            item.node.rotation += item.spin * delta;

            const caught = PhaserModule.Math.Distance.Between(item.node.x, item.node.y, this.basket.x, this.basket.y) < 66;
            if (caught) {
              this.catchItem(item);
              item.node.destroy();
              return;
            }

            if (item.node.y > GAME_HEIGHT + 40) {
              if (item.kind !== "thorn") {
                this.combo = 0;
                setStatus("Missed petal. Combo reset.");
              }
              item.node.destroy();
              return;
            }

            remaining.push(item);
          });

          this.falling = remaining;
        }

        private catchItem(item: FallingItem) {
          if (item.kind === "thorn") {
            this.combo = 0;
            this.score = Math.max(0, this.score + item.value);
            this.screenPulse(0x84675f);
            playCozyCue("thorn");
            setStatus("Thorn caught. Combo reset.");
            return;
          }

          this.combo += 1;
          const comboBonus = Math.floor(this.combo / 5) * 5;
          this.score += item.value + comboBonus;
          this.screenPulse(item.kind === "heart" ? 0xd87e8c : 0xfaebc2);
          playCozyCue(this.combo > 0 && this.combo % 5 === 0 ? "combo" : item.kind === "heart" ? "heart" : "catch");
          setStatus(`${item.kind === "heart" ? "Heart" : "Petal"} caught. Combo x${this.combo}.`);
        }

        private screenPulse(color: number) {
          const pulse = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, color, 0.1).setDepth(4500);
          this.tweens.add({
            targets: pulse,
            alpha: 0,
            duration: 260,
            onComplete: () => pulse.destroy(),
          });
        }

        private updateHud() {
          this.scoreText.setText(`Score ${this.score}`);
          this.comboText.setText(`Combo x${this.combo}`);
          this.timerText.setText(`${Math.ceil(this.timeLeft)}s`);
        }

        private endRound() {
          this.gameOver = true;
          this.falling.forEach((item) => item.node.destroy());
          this.falling = [];
          const coins = 60 + Math.floor(this.score / 8);
          const hearts = this.score >= 500 ? 3 : this.score >= 300 ? 2 : 1;

          const layer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(7000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.95);
          bg.fillRoundedRect(-190, -128, 380, 256, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-190, -128, 380, 256, 24);
          layer.add(bg);
          layer.add(
            this.add.text(0, -82, "Petal Catch Complete", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "25px",
            }).setOrigin(0.5),
          );
          layer.add(
            this.add.text(0, -28, `Score ${this.score}\nReward ${coins} coins + ${hearts} hearts`, {
              align: "center",
              color: "#5B3F3F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "18px",
              fontStyle: "800",
              lineSpacing: 8,
            }).setOrigin(0.5),
          );
          const restart = this.add
            .text(0, 72, "Play again", {
              color: "#FFFDF6",
              fontFamily: "Nunito, sans-serif",
              fontSize: "15px",
              fontStyle: "900",
              backgroundColor: "#D87E8C",
              padding: { x: 18, y: 10 },
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
          restart.on("pointerdown", () => this.restartRound());
          layer.add(restart);
          this.rewardLayer = layer;

          setStatus(`Round complete: ${coins} coins and ${hearts} hearts ready to award.`);
          playCozyCue("reward");
          onRewardRef.current?.({
            gameId: "petal-catch",
            label: "Petal Catch",
            score: this.score,
            coins,
            hearts,
          });
          // TODO: Persist mini-game rewards to game_reward_events and wallets through Supabase.
        }

        private restartRound() {
          this.rewardLayer?.destroy(true);
          this.rewardLayer = undefined;
          this.score = 0;
          this.combo = 0;
          this.timeLeft = 60;
          this.elapsed = 0;
          this.spawnElapsed = 0;
          this.gameOver = false;
          setStatus("New round started.");
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
        scene: PetalCatchScene,
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load Petal Catch");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, []);

  return (
    <section className="overflow-hidden rounded-lg border border-blush-300/50 bg-cream-100 shadow-[0_24px_70px_rgba(216,126,140,0.16)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blush-200/80 bg-white/70 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">Playable mini-game</p>
          <p className="text-sm font-black text-ink-900">Petal Catch</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Catch petals</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Build combos</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Avoid thorns</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive Petal Catch mini-game canvas with basket control, falling petals, score, timer, and rewards"
        className="mx-auto block overflow-hidden bg-cream-100"
        role="application"
        style={{
          width: "min(100%, calc((100dvh - 300px) * 1.6071), 900px)",
          aspectRatio: "900 / 560",
        }}
        tabIndex={0}
      />
      <div className="border-t border-blush-200 bg-white/70 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}
