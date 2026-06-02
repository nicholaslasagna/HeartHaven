"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import { playCozyCue } from "@/lib/game/cozy-audio";
import type { GameReward } from "@/lib/game/rewards";
import { parseGardenFourState, type GardenFourWinningCell } from "@/lib/game/garden-four-state";

type GardenFourCanvasProps = {
  onReward?: (reward: GameReward) => void;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
  mySeatIndex?: number | null;
  submitDrop?: (column: number) => Promise<{ ok: boolean; reason?: string }>;
};

type GardenToken = 0 | 1 | 2;

const GAME_WIDTH = 920;
const GAME_HEIGHT = 600;
const COLUMNS = 7;
const ROWS = 6;
const CELL = 64;
const BOARD_X = 236;
const BOARD_Y = 134;
const players = [
  { id: 1 as const, name: "Blush Team", color: 0xd87e8c, frame: 3 },
  { id: 2 as const, name: "Moonberry Team", color: 0x8e70bd, frame: 7 },
];

export function GardenFourCanvas({
  metadata,
  mySeatIndex,
  onReward,
  sessionId,
  submitDrop,
}: GardenFourCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const metadataRef = useRef(metadata);
  const mySeatIndexRef = useRef(mySeatIndex);
  const submitDropRef = useRef(submitDrop);
  const sessionIdRef = useRef(sessionId);
  const rewardedRef = useRef(false);
  const [status, setStatus] = useState("Drop keepsakes into the arbor. First team to connect four wins.");

  useEffect(() => {
    rewardedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    metadataRef.current = metadata;
    mySeatIndexRef.current = mySeatIndex;
    submitDropRef.current = submitDrop;
    sessionIdRef.current = sessionId;
    if (metadata) {
      window.dispatchEvent(new CustomEvent("hearthaven:garden-four-sync", { detail: metadata }));
    }
  }, [metadata, mySeatIndex, sessionId, submitDrop]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class GardenFourScene extends PhaserModule.Scene {
        private board: GardenToken[][] = [];
        private currentPlayer: 1 | 2 = 1;
        private moves = 0;
        private gameOver = false;
        private lastSyncedMoveCount = 0;
        private tokens: Phaser.GameObjects.Image[] = [];
        private winHighlights: Phaser.GameObjects.Arc[] = [];
        private gardenFourSyncHandler?: (event: Event) => void;
        private turnText!: Phaser.GameObjects.Text;
        private movesText!: Phaser.GameObjects.Text;
        private rewardLayer?: Phaser.GameObjects.Container;

        constructor() {
          super("GardenFour");
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
          this.resetBoard();
          this.drawBackdrop();
          this.createCasper();
          this.createHud();
          this.createBoard();
          this.updateHud();
          setStatus(`${players[0].name} starts. Pick a column.`);
          this.gardenFourSyncHandler = (event: Event) => {
            const detail = (event as CustomEvent<Record<string, unknown>>).detail;
            if (detail) this.syncFromServer(detail);
          };
          window.addEventListener("hearthaven:garden-four-sync", this.gardenFourSyncHandler);
        }

        shutdown() {
          if (this.gardenFourSyncHandler) {
            window.removeEventListener("hearthaven:garden-four-sync", this.gardenFourSyncHandler);
          }
        }

        private syncFromServer(meta: Record<string, unknown>) {
          const boardRaw = meta.board;
          if (!Array.isArray(boardRaw)) return;
          const moveCount = Number(meta.moveCount ?? 0);
          if (moveCount < this.lastSyncedMoveCount) return;

          this.board = boardRaw.map((row) =>
            Array.isArray(row) ? row.map((cell) => Number(cell) as GardenToken) : Array.from({ length: COLUMNS }, () => 0 as GardenToken),
          ) as GardenToken[][];
          this.moves = moveCount;
          this.gameOver = Boolean(meta.gameOver);
          const currentSeat = Number(meta.currentSeat ?? 0);
          this.currentPlayer = ((currentSeat % 2) + 1) as 1 | 2;

          this.tokens.forEach((token) => token.destroy());
          this.tokens = [];
          for (let row = 0; row < ROWS; row += 1) {
            for (let column = 0; column < COLUMNS; column += 1) {
              const value = this.board[row]?.[column] ?? 0;
              if (value === 0) continue;
              const player = players[value - 1];
              const token = this.add
                .image(BOARD_X + column * CELL, BOARD_Y + row * CELL, "minigame-props", player.frame)
                .setDisplaySize(54, 70)
                .setDepth(4200);
              this.tokens.push(token);
            }
          }

          this.lastSyncedMoveCount = moveCount;
          this.updateHud();

          const serverState = parseGardenFourState(meta);
          if (serverState?.gameOver) {
            this.highlightWinningCells(serverState.winningCells);
            this.showResultsFromServer(serverState);
          } else if (this.gameOver) {
            setStatus("Garden Four — game over.");
          } else {
            const mine = this.myPlayerNumber();
            const turnName = players[this.currentPlayer - 1].name;
            if (mine !== null) {
              setStatus(
                mine === this.currentPlayer
                  ? "Your turn — drop a keepsake into a column."
                  : `Waiting for ${turnName} to play…`,
              );
            } else {
              setStatus(`${turnName}'s turn.`);
            }
          }
        }

        private highlightWinningCells(cells: GardenFourWinningCell[]) {
          this.winHighlights.forEach((ring) => ring.destroy());
          this.winHighlights = [];
          for (const [row, column] of cells) {
            const ring = this.add
              .circle(BOARD_X + column * CELL, BOARD_Y + row * CELL, 30, 0xfaebc2, 0.42)
              .setStrokeStyle(4, 0xd9a53e, 0.95)
              .setDepth(4300);
            this.winHighlights.push(ring);
          }
        }

        private showResultsFromServer(
          state: NonNullable<ReturnType<typeof parseGardenFourState>>,
        ) {
          if (this.rewardLayer) return;

          const tie = state.isDraw;
          const winnerSeat = state.winnerSeat ?? 0;
          const winnerName = tie ? "Friendship tie" : players[(winnerSeat % 2)].name;
          const finalScore = state.finalScore ?? (tie ? 250 : Math.max(0, 500 - state.moveCount));
          this.gameOver = true;
          playCozyCue(tie ? "heart" : "reward");
          this.spawnWinBurst();

          const layer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(8000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-216, -138, 432, 276, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-216, -138, 432, 276, 24);
          layer.add(bg);
          layer.add(this.add.text(0, -86, tie ? "Garden Four Complete" : `${winnerName} wins`, {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "25px",
          }).setOrigin(0.5));
          layer.add(
            this.add.text(
              0,
              -18,
              `Moves ${state.moveCount}\nScore ${finalScore}${state.completedAt ? `\nCompleted ${state.completedAt}` : ""}`,
              {
                align: "center",
                color: "#5B3F3F",
                fontFamily: "Nunito, sans-serif",
                fontSize: "17px",
                fontStyle: "800",
                lineSpacing: 8,
                wordWrap: { width: 360 },
              },
            ).setOrigin(0.5),
          );
          if (!sessionIdRef.current) {
            const restart = this.add.text(0, 92, "Play again", {
              color: "#FFFDF6",
              fontFamily: "Nunito, sans-serif",
              fontSize: "15px",
              fontStyle: "900",
              backgroundColor: "#D87E8C",
              padding: { x: 18, y: 10 },
            }).setOrigin(0.5).setInteractive({ useHandCursor: true });
            restart.on("pointerdown", () => this.restartRound());
            layer.add(restart);
          }
          this.rewardLayer = layer;
          setStatus(tie ? "The garden called it a friendship tie." : `${winnerName} connected four keepsakes.`);

          if (!rewardedRef.current && sessionIdRef.current) {
            rewardedRef.current = true;
            onReward?.({
              gameId: "garden-four",
              label: "Garden Four",
              score: finalScore,
              coins: 0,
              hearts: 0,
            });
          }
        }

        private resetBoard() {
          this.board = Array.from({ length: ROWS }, () => Array.from({ length: COLUMNS }, () => 0 as GardenToken));
          this.currentPlayer = 1;
          this.moves = 0;
          this.gameOver = false;
        }

        private drawBackdrop() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "moonberry-garden-bg").setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-20);
          this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xfffcf3, 0.12).setDepth(-19);

          const glow = this.add.graphics();
          glow.fillStyle(0xfffcf3, 0.72);
          glow.fillRoundedRect(82, 82, GAME_WIDTH - 164, 468, 30);
          glow.lineStyle(3, 0xf6cfd2, 0.42);
          glow.strokeRoundedRect(82, 82, GAME_WIDTH - 164, 468, 30);
          glow.fillStyle(0xfbe3e3, 0.26);
          glow.fillEllipse(460, 390, 620, 250);

          for (let index = 0; index < 28; index += 1) {
            const spark = this.add.star(
              PhaserModule.Math.Between(96, GAME_WIDTH - 96),
              PhaserModule.Math.Between(94, GAME_HEIGHT - 64),
              4,
              2,
              PhaserModule.Math.Between(4, 8),
              index % 2 === 0 ? 0xffffff : 0xfaebc2,
              PhaserModule.Math.FloatBetween(0.1, 0.32),
            );
            this.tweens.add({
              targets: spark,
              alpha: PhaserModule.Math.FloatBetween(0.24, 0.68),
              y: spark.y + PhaserModule.Math.Between(8, 22),
              duration: PhaserModule.Math.Between(1300, 2600),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }
        }

        private createCasper() {
          const casper = this.add.container(126, 476).setDepth(476);
          casper.add(this.add.ellipse(0, 42, 88, 22, 0x3a2a2a, 0.14));
          casper.add(this.add.image(0, -18, "casper-sprite").setDisplaySize(112, 112));
          this.tweens.add({
            targets: casper,
            y: casper.y - 5,
            duration: 1080,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });
        }

        private createHud() {
          this.add.text(28, 24, "Garden Four", {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "26px",
          }).setDepth(7000);
          this.turnText = this.add.text(30, 58, "", {
            color: "#8E70BD",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
          }).setDepth(7000);
          this.movesText = this.add.text(GAME_WIDTH - 138, 58, "", {
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
          }).setDepth(7000);
        }

        private createBoard() {
          const frame = this.add.graphics().setDepth(100);
          frame.fillGradientStyle(0xfdf8ee, 0xfbe3e3, 0xead9b5, 0xe4efd7, 0.95);
          frame.fillRoundedRect(BOARD_X - 32, BOARD_Y - 28, COLUMNS * CELL + 64, ROWS * CELL + 62, 28);
          frame.lineStyle(5, 0xc9a998, 0.5);
          frame.strokeRoundedRect(BOARD_X - 32, BOARD_Y - 28, COLUMNS * CELL + 64, ROWS * CELL + 62, 28);

          for (let column = 0; column < COLUMNS; column += 1) {
            const zone = this.add.zone(BOARD_X + column * CELL, BOARD_Y + ROWS * CELL / 2 - 30, CELL, ROWS * CELL + 80).setInteractive({ useHandCursor: true });
            zone.on("pointerover", () => this.previewColumn(column));
            zone.on("pointerout", () => this.clearPreview());
            zone.on("pointerdown", () => this.dropToken(column));
          }

          for (let row = 0; row < ROWS; row += 1) {
            for (let column = 0; column < COLUMNS; column += 1) {
              const x = BOARD_X + column * CELL;
              const y = BOARD_Y + row * CELL;
              frame.fillStyle(0xfffcf3, 0.86);
              frame.fillCircle(x, y, 24);
              frame.lineStyle(3, 0xffffff, 0.42);
              frame.strokeCircle(x, y, 24);
            }
          }
        }

        private previewColumn(column: number) {
          if (this.gameOver || Boolean(metadataRef.current?.gameOver)) return;
          const row = this.findOpenRow(column);
          if (row === -1) return;
          this.clearPreview();
          const player = players[this.currentPlayer - 1];
          const preview = this.add
            .image(BOARD_X + column * CELL, BOARD_Y + row * CELL, "minigame-props", player.frame)
            .setDisplaySize(54, 70)
            .setAlpha(0.48)
            .setDepth(3000)
            .setName("garden-four-preview");
          this.tweens.add({ targets: preview, scale: 1.08, duration: 420, yoyo: true, repeat: -1, ease: "Sine.inOut" });
        }

        private clearPreview() {
          this.children.getByName("garden-four-preview")?.destroy();
        }

        private dropToken(column: number) {
          if (this.gameOver || Boolean(metadataRef.current?.gameOver)) return;
          if (submitDropRef.current && sessionIdRef.current) {
            const currentSeat = Number(metadataRef.current?.currentSeat ?? 0);
            if (mySeatIndexRef.current !== null && mySeatIndexRef.current !== currentSeat) {
              setStatus("Not your turn — wait for the other team.");
              playCozyCue("miss");
              return;
            }
            void submitDropRef.current(column).then((result) => {
              if (!result.ok) setStatus(result.reason ?? "Move could not be saved.");
            });
            return;
          }
          const row = this.findOpenRow(column);
          if (row === -1) {
            playCozyCue("miss");
            setStatus("That arbor column is full.");
            return;
          }

          this.clearPreview();
          const player = players[this.currentPlayer - 1];
          this.board[row][column] = this.currentPlayer;
          this.moves += 1;
          const token = this.add
            .image(BOARD_X + column * CELL, BOARD_Y - 64, "minigame-props", player.frame)
            .setDisplaySize(54, 70)
            .setDepth(4200);
          this.tokens.push(token);
          playCozyCue("place");
          this.tweens.add({
            targets: token,
            y: BOARD_Y + row * CELL,
            duration: 360,
            ease: "Bounce.out",
            onComplete: () => this.afterTokenSettles(row, column),
          });
        }

        private afterTokenSettles(row: number, column: number) {
          if (sessionIdRef.current) return;
          if (this.hasWon(row, column, this.currentPlayer)) {
            this.finishGame(players[this.currentPlayer - 1].name);
            return;
          }

          if (this.moves >= ROWS * COLUMNS) {
            this.finishGame("Friendship tie");
            return;
          }

          this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
          this.updateHud();
          setStatus(`${players[this.currentPlayer - 1].name}'s turn.`);
          playCozyCue("score");
        }

        private findOpenRow(column: number) {
          for (let row = ROWS - 1; row >= 0; row -= 1) {
            if (this.board[row][column] === 0) return row;
          }
          return -1;
        }

        private hasWon(row: number, column: number, player: 1 | 2) {
          const directions = [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1],
          ];

          return directions.some(([dx, dy]) => {
            let count = 1;
            count += this.countDirection(row, column, dx, dy, player);
            count += this.countDirection(row, column, -dx, -dy, player);
            return count >= 4;
          });
        }

        private countDirection(row: number, column: number, dx: number, dy: number, player: 1 | 2) {
          let count = 0;
          let nextRow = row + dy;
          let nextColumn = column + dx;
          while (
            nextRow >= 0 &&
            nextRow < ROWS &&
            nextColumn >= 0 &&
            nextColumn < COLUMNS &&
            this.board[nextRow][nextColumn] === player
          ) {
            count += 1;
            nextRow += dy;
            nextColumn += dx;
          }
          return count;
        }

        private finishGame(winner: string) {
          this.gameOver = true;
          const tie = winner === "Friendship tie";
          const coins = tie ? 90 : 140 + Math.max(0, 42 - this.moves) * 2;
          const hearts = tie ? 2 : 4;
          playCozyCue(tie ? "heart" : "reward");
          this.spawnWinBurst();

          const layer = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(8000);
          const bg = this.add.graphics();
          bg.fillStyle(0xfffcf3, 0.96);
          bg.fillRoundedRect(-216, -138, 432, 276, 24);
          bg.lineStyle(3, 0xf6cfd2, 0.9);
          bg.strokeRoundedRect(-216, -138, 432, 276, 24);
          layer.add(bg);
          layer.add(this.add.text(0, -86, tie ? "Garden Four Complete" : `${winner} wins`, {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "25px",
          }).setOrigin(0.5));
          layer.add(this.add.text(0, -18, `Moves ${this.moves}\nReward ${coins} coins + ${hearts} hearts\nCasper tucked a keepsake under the arbor.`, {
            align: "center",
            color: "#5B3F3F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "17px",
            fontStyle: "800",
            lineSpacing: 8,
            wordWrap: { width: 360 },
          }).setOrigin(0.5));
          const restart = this.add.text(0, 92, "Play again", {
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
          setStatus(tie ? "The garden called it a friendship tie." : `${winner} connected four keepsakes.`);
          onReward?.({
            gameId: "garden-four",
            label: "Garden Four",
            score: tie ? 250 : 500 - this.moves,
            coins,
            hearts,
          });
        }

        private spawnWinBurst() {
          for (let index = 0; index < 22; index += 1) {
            const spark = this.add.star(GAME_WIDTH / 2, 310, 5, 4, 14, index % 2 === 0 ? 0xf6cfd2 : 0xfaebc2, 0.92).setDepth(7600);
            this.tweens.add({
              targets: spark,
              x: spark.x + PhaserModule.Math.Between(-260, 260),
              y: spark.y + PhaserModule.Math.Between(-170, 128),
              alpha: 0,
              scale: 0.18,
              duration: 1100,
              ease: "Sine.out",
              onComplete: () => spark.destroy(),
            });
          }
        }

        private restartRound() {
          this.rewardLayer?.destroy(true);
          this.rewardLayer = undefined;
          this.tokens.forEach((token) => token.destroy());
          this.tokens = [];
          this.clearPreview();
          this.resetBoard();
          this.updateHud();
          setStatus(`${players[0].name} starts. Pick a column.`);
        }

        /** My player number (1 or 2) in an online session, or null for
         *  local pass-and-play. seat 0 → player 1, seat 1 → player 2. */
        private myPlayerNumber(): 1 | 2 | null {
          const seat = mySeatIndexRef.current;
          if (seat === null || seat === undefined || !sessionIdRef.current) return null;
          return (((seat % 2) + 1) as 1 | 2);
        }

        private updateHud() {
          const turnName = players[this.currentPlayer - 1].name;
          const mine = this.myPlayerNumber();
          if (mine !== null) {
            // Online: make it unmistakable whose turn it is from this
            // player's perspective, and which team they are.
            const yourTeam = players[mine - 1].name;
            const isMyTurn = mine === this.currentPlayer;
            this.turnText?.setText(
              isMyTurn ? `Your turn (${yourTeam})` : `${turnName}'s turn — you are ${yourTeam}`,
            );
          } else {
            this.turnText?.setText(`Turn: ${turnName}`);
          }
          this.movesText?.setText(`Moves ${this.moves}`);
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
        scene: GardenFourScene,
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load Garden Four");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [metadata, mySeatIndex, onReward, sessionId, submitDrop]);

  return (
    <section className="overflow-hidden rounded-lg border border-garden-300/50 bg-garden-100 shadow-[0_24px_70px_rgba(76,110,54,0.14)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-garden-300/40 bg-white/68 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-garden-700">Playable party board game</p>
          <p className="text-sm font-black text-ink-900">Garden Four</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Drop tokens</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Connect four</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Party rewards</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive Garden Four board game canvas with pass-and-play turns, token drops, win detection, and rewards"
        className="mx-auto block overflow-hidden bg-garden-100"
        role="application"
        style={{
          width: "min(100%, calc((100dvh - 300px) * 1.5333), 920px)",
          aspectRatio: "920 / 600",
        }}
        tabIndex={0}
      />
      <div className="border-t border-garden-300/40 bg-white/72 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}
