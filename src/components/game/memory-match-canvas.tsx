"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { GameReward } from "@/lib/game/rewards";
import { playCozyCue } from "@/lib/game/cozy-audio";
import {
  MEMORY_MATCH_PAIR_DATA,
  type MemoryMatchPairId,
} from "@/lib/game/memory-match-deck";
import {
  buildTurnLabels,
  parseMemoryMatchState,
  scoreForSeat,
  seatDisplayName,
  type MemoryMatchMode,
} from "@/lib/game/memory-match-state";
import type { GameSessionSeat } from "@/lib/game/use-game-session";

export type { MemoryMatchMode };

type MemoryMatchCanvasProps = {
  mode: MemoryMatchMode;
  onReward?: (reward: GameReward) => void;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
  seats?: GameSessionSeat[];
  mySeatIndex?: number | null;
  submitFlip?: (cardIndex: number) => Promise<{ ok: boolean; reason?: string }>;
};

type MatchCard = {
  index: number;
  pair: MemoryMatchPairId;
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

export function MemoryMatchCanvas({
  mode,
  metadata,
  mySeatIndex,
  onReward,
  seats = [],
  sessionId,
  submitFlip,
}: MemoryMatchCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const metadataRef = useRef(metadata);
  const seatsRef = useRef(seats);
  const mySeatIndexRef = useRef(mySeatIndex);
  const onRewardRef = useRef(onReward);
  const submitFlipRef = useRef(submitFlip);
  const sessionIdRef = useRef(sessionId);
  const rewardedRef = useRef(false);
  const [status, setStatus] = useState("Connecting to the live board...");

  useEffect(() => {
    metadataRef.current = metadata;
    seatsRef.current = seats;
    mySeatIndexRef.current = mySeatIndex;
    onRewardRef.current = onReward;
    submitFlipRef.current = submitFlip;
    sessionIdRef.current = sessionId;
    if (metadata) {
      window.dispatchEvent(new CustomEvent("hearthaven:memory-match-sync", { detail: metadata }));
    }
  }, [metadata, mySeatIndex, seats, sessionId, submitFlip]);

  useEffect(() => {
    rewardedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class MemoryMatchScene extends PhaserModule.Scene {
        private cards: MatchCard[] = [];
        private busy = false;
        private lastSyncedMoves = -1;
        private memoryMatchSyncHandler?: (event: Event) => void;
        private scoreText!: Phaser.GameObjects.Text;
        private turnText!: Phaser.GameObjects.Text;
        private moveText!: Phaser.GameObjects.Text;
        private resultLayer?: Phaser.GameObjects.Container;

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
          this.memoryMatchSyncHandler = (event: Event) => {
            const detail = (event as CustomEvent<Record<string, unknown>>).detail;
            if (detail) this.syncFromServer(detail);
          };
          window.addEventListener("hearthaven:memory-match-sync", this.memoryMatchSyncHandler);
          this.syncFromServer(metadataRef.current ?? {});
        }

        shutdown() {
          if (this.memoryMatchSyncHandler) {
            window.removeEventListener("hearthaven:memory-match-sync", this.memoryMatchSyncHandler);
          }
        }

        private syncFromServer(meta: Record<string, unknown>) {
          const state = parseMemoryMatchState(meta);
          if (!state) {
            setStatus(sessionIdRef.current ? "Waiting for the server board..." : "Sign in for online Memory Match.");
            return;
          }

          if (this.cards.length === 0) {
            this.createCards(state.board);
          }

          const prevMoves = this.lastSyncedMoves;
          const missResolve = prevMoves >= 0 && state.moves > prevMoves && state.lastResult === "miss";

          for (const card of this.cards) {
            const matched = state.matched.includes(card.index);
            const revealed = matched || state.revealed.includes(card.index);
            card.matched = matched;
            if (!missResolve || matched || state.revealed.includes(card.index)) {
              this.revealCard(card, revealed, false);
            }
          }

          if (missResolve) {
            this.time.delayedCall(720, () => {
              for (const card of this.cards) {
                if (!card.matched) this.revealCard(card, false, false);
              }
              playCozyCue("miss");
            });
          } else if (state.lastResult === "match" && state.moves > prevMoves && prevMoves >= 0) {
            playCozyCue("match");
          }

          this.lastSyncedMoves = state.moves;
          this.updateHud(state);

          const mySeat = mySeatIndexRef.current;
          const isMyTurn = mySeat != null && mySeat === state.currentTurnSeat;
          const currentName = seatDisplayName(
            seatsRef.current,
            state.currentTurnSeat,
            `Seat ${state.currentTurnSeat + 1}`,
          );

          if (state.gameOver) {
            this.showResults(state);
          } else if (isMyTurn) {
            setStatus(
              state.revealed.length === 1
                ? "Pick the second card."
                : `${currentName}'s turn — find a pair.`,
            );
          } else {
            setStatus(`${currentName}'s turn.`);
          }
        }

        private createCards(board: MemoryMatchPairId[]) {
          const startX = 178;
          const startY = 160;
          const gapX = 188;
          const gapY = 102;

          board.forEach((pair, index) => {
            const data = MEMORY_MATCH_PAIR_DATA[pair];
            const x = startX + (index % 4) * gapX;
            const y = startY + Math.floor(index / 4) * gapY;
            const card = this.createCard(index, pair, data.label, data.color, x, y);
            this.cards.push(card);
          });
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
        }

        private updateHud(state: ReturnType<typeof parseMemoryMatchState>) {
          if (!state) return;
          const labels = buildTurnLabels(state, seatsRef.current);
          const currentName = seatDisplayName(
            seatsRef.current,
            state.currentTurnSeat,
            labels[0] ?? "Keeper",
          );
          this.turnText.setText(`Turn: ${currentName}`);
          this.moveText.setText(`Moves ${state.moves}`);
          this.scoreText.setText(
            labels
              .map((label, index) => {
                const seat = state.turnOrder[index] ?? index;
                return `${label}: ${state.scores[index] ?? scoreForSeat(state, seat)}`;
              })
              .join("   "),
          );
        }

        private createCard(
          index: number,
          pair: MemoryMatchPairId,
          label: string,
          color: number,
          x: number,
          y: number,
        ): MatchCard {
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
            index,
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

          container.on("pointerdown", () => void this.flipCard(card));
          container.on("pointerover", () => {
            if (!card.matched && !card.revealed) back.setFillStyle(0xefe6f7);
          });
          container.on("pointerout", () => {
            if (!card.matched && !card.revealed) back.setFillStyle(0xfbe3e3);
          });

          return card;
        }

        private async flipCard(card: MatchCard) {
          const state = parseMemoryMatchState(metadataRef.current ?? {});
          if (!state || state.gameOver || this.busy) return;
          if (card.matched || card.revealed) return;

          const mySeat = mySeatIndexRef.current;
          if (mySeat == null || mySeat !== state.currentTurnSeat) {
            setStatus("Wait for your turn.");
            return;
          }

          const flip = submitFlipRef.current;
          if (!sessionIdRef.current || !flip) {
            setStatus("Online session required.");
            return;
          }

          this.busy = true;
          const result = await flip(card.index);
          this.busy = false;

          if (!result.ok) {
            setStatus(result.reason ?? "Move rejected.");
            return;
          }

          playCozyCue("cardFlip");
        }

        private revealCard(card: MatchCard, revealed: boolean, animate: boolean) {
          card.revealed = revealed;
          card.front.setVisible(revealed);
          card.frontGlow.setVisible(revealed);
          card.art.setVisible(revealed);
          card.label.setVisible(revealed);
          card.back.setVisible(!revealed);
          if (!animate) return;
          this.tweens.add({
            targets: card.container,
            scaleX: revealed ? 1.08 : 1,
            scaleY: revealed ? 1.08 : 1,
            duration: 130,
            yoyo: true,
            ease: "Sine.out",
          });
        }

        private createCardArt(pair: MemoryMatchPairId) {
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

        private showResults(state: NonNullable<ReturnType<typeof parseMemoryMatchState>>) {
          if (this.resultLayer) return;

          const labels = buildTurnLabels(state, seatsRef.current);
          let maxScore = -1;
          for (let index = 0; index < labels.length; index += 1) {
            maxScore = Math.max(maxScore, state.scores[index] ?? 0);
          }
          const winners = labels
            .filter((_label, index) => (state.scores[index] ?? 0) === maxScore)
            .join(" + ");
          const finalScore = state.finalScore ?? Math.max(0, maxScore * 100 - state.moves);

          this.resultLayer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(8000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-210, -132, 420, 264, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-210, -132, 420, 264, 24);
          this.resultLayer.add(bg);
          this.resultLayer.add(
            this.add.text(0, -80, "Memory Match Complete", {
              color: "#3A2A2A",
              fontFamily: "Caprasimo, Georgia, serif",
              fontSize: "25px",
            }).setOrigin(0.5),
          );
          this.resultLayer.add(
            this.add.text(
              0,
              -18,
              `Winner: ${winners}\nMoves: ${state.moves}\nScore: ${finalScore}`,
              {
                align: "center",
                color: "#5B3F3F",
                fontFamily: "Nunito, sans-serif",
                fontSize: "17px",
                fontStyle: "800",
                lineSpacing: 8,
                wordWrap: { width: 340 },
              },
            ).setOrigin(0.5),
          );
          playCozyCue("reward");
          setStatus(`Winner: ${winners}. Claiming server-validated reward...`);

          if (!rewardedRef.current) {
            rewardedRef.current = true;
            onRewardRef.current?.({
              gameId: "memory-match",
              label: mode === "couples" ? "Couple Memory Match" : "Party Memory Match",
              score: finalScore,
              coins: 0,
              hearts: 0,
            });
          }
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
  }, [mode]);

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
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Live turns</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Server board</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Synced flips</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive multiplayer Memory Match game canvas with server-synced turns"
        className="mx-auto block overflow-hidden bg-cream-100"
        role="application"
        style={{
          width: "min(100%, calc((100dvh - 300px) * 1.5333), 920px)",
          aspectRatio: "920 / 600",
        }}
        tabIndex={0}
      />
      <div className="border-t border-lavender-300/50 bg-white/70 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}
