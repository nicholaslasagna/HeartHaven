"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import {
  getPetTone,
  KEEPER_PRESET_ANIMATION_SHEET_PATH,
  keeperGaitPose,
  keeperPresetFrame,
  petFrame,
  readKeeperCustomization,
  readPetCustomization,
  type KeeperCustomization,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperPose,
  type PetPose,
} from "@/lib/game/avatar-customization";
import { playCozyCue } from "@/lib/game/cozy-audio";
import type { GameReward } from "@/lib/game/rewards";

type FashionShowCanvasProps = {
  onReward?: (reward: GameReward) => void;
};

type FashionTheme = {
  title: string;
  prompt: string;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  pose: KeeperPose;
};

type FashionChoice = {
  id: string;
  title: string;
  note: string;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  pose: KeeperPose;
  petPose: PetPose;
  accent: number;
};

type FashionChoiceCard = {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  choice: FashionChoice;
};

const GAME_WIDTH = 920;
const GAME_HEIGHT = 600;
const MAX_ROUNDS = 3;

const fashionThemes: FashionTheme[] = [
  {
    title: "Garden Gala",
    prompt: "Judges want soft green, garden layers, and a sweet wave.",
    paletteId: "garden",
    outfitId: "overalls",
    pose: "wave",
  },
  {
    title: "Moonlit Promise",
    prompt: "A lavender evening look with a dramatic cape and heart pose.",
    paletteId: "lavender",
    outfitId: "cape",
    pose: "heart",
  },
  {
    title: "Honey Arcade Night",
    prompt: "A warm honey party fit with cozy sparkle energy.",
    paletteId: "honey",
    outfitId: "sweater",
    pose: "wave",
  },
];

const fashionChoices: FashionChoice[] = [
  {
    id: "garden-dream",
    title: "Garden Dream",
    note: "Overalls, flower crown, soft green accents.",
    paletteId: "garden",
    outfitId: "overalls",
    pose: "wave",
    petPose: "happy",
    accent: 0x6e9651,
  },
  {
    id: "moonlit-cape",
    title: "Moonlit Cape",
    note: "Lavender cape, big runway heart pose.",
    paletteId: "lavender",
    outfitId: "cape",
    pose: "heart",
    petPose: "sit",
    accent: 0x8e70bd,
  },
  {
    id: "honey-star",
    title: "Honey Star",
    note: "Party sweater, golden bow, bright stage smile.",
    paletteId: "honey",
    outfitId: "sweater",
    pose: "wave",
    petPose: "happy",
    accent: 0xd9a53e,
  },
  {
    id: "blush-cardigan",
    title: "Blush Classic",
    note: "Cozy cardigan, romantic soft blush styling.",
    paletteId: "blush",
    outfitId: "cardigan",
    pose: "heart",
    petPose: "idle",
    accent: 0xd87e8c,
  },
];

export function FashionShowCanvas({ onReward }: FashionShowCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const onRewardRef = useRef(onReward);
  const [status, setStatus] = useState("Pick a look, then walk the runway.");

  useEffect(() => {
    onRewardRef.current = onReward;
  }, [onReward]);

  useEffect(() => {
    let destroyed = false;
    let game: Phaser.Game | null = null;

    async function boot() {
      const PhaserModule = await import("phaser");
      if (!mountRef.current || destroyed) return;

      class FashionShowScene extends PhaserModule.Scene {
        private roundIndex = 0;
        private totalScore = 0;
        private selectedChoice?: FashionChoice;
        private walking = false;
        private finished = false;
        private keeperSprite!: Phaser.GameObjects.Sprite;
        private keeperSkinSprite!: Phaser.GameObjects.Sprite;
        private keeperHairSprite!: Phaser.GameObjects.Sprite;
        private petSprite!: Phaser.GameObjects.Sprite;
        private runwayGlow!: Phaser.GameObjects.Ellipse;
        private themeText!: Phaser.GameObjects.Text;
        private promptText!: Phaser.GameObjects.Text;
        private scoreText!: Phaser.GameObjects.Text;
        private feedbackText!: Phaser.GameObjects.Text;
        private walkButton!: Phaser.GameObjects.Container;
        private keeperCustomization: KeeperCustomization = readKeeperCustomization();
        private choiceCards: FashionChoiceCard[] = [];
        private rewardLayer?: Phaser.GameObjects.Container;

        constructor() {
          super("FashionShow");
        }

        preload() {
          this.load.spritesheet("keeper-preset-animation-sheet", KEEPER_PRESET_ANIMATION_SHEET_PATH, {
            frameWidth: 256,
            frameHeight: 384,
          });
          this.load.spritesheet("keeper-skin-mask-sheet", "/game-assets/generated/keeper-skin-mask-sheet.png", {
            frameWidth: 256,
            frameHeight: 384,
          });
          this.load.spritesheet("keeper-hair-style-sheet", "/game-assets/generated/keeper-hair-style-sheet.png", {
            frameWidth: 256,
            frameHeight: 384,
          });
          this.load.spritesheet("pet-animation-sheet", "/game-assets/generated/pet-art-sheet.png", {
            frameWidth: 256,
            frameHeight: 288,
          });
          this.load.spritesheet("minigame-props", "/game-assets/generated/minigame-props-sprites.png", {
            frameWidth: 384,
            frameHeight: 512,
          });
          this.load.image("moonberry-garden-bg", "/game-assets/generated/moonberry-garden-bg.png");
        }

        create() {
          this.drawStage();
          this.createHud();
          this.createPerformer();
          this.createChoiceCards();
          this.createWalkButton();
          this.applyRound();
          setStatus("Round 1: choose the look that best matches the theme.");
        }

        private drawStage() {
          this.cameras.main.setBackgroundColor("#fbf3e2");
          this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "moonberry-garden-bg").setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-30).setAlpha(0.42);

          const bg = this.add.graphics();
          bg.fillGradientStyle(0xfdf8ee, 0xfbe3e3, 0xefe6f7, 0xe4efd7, 0.92);
          bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
          bg.fillStyle(0xffffff, 0.44);
          bg.fillRoundedRect(44, 54, 832, 494, 30);
          bg.lineStyle(4, 0xf6cfd2, 0.58);
          bg.strokeRoundedRect(44, 54, 832, 494, 30);

          const curtain = this.add.graphics();
          curtain.fillGradientStyle(0xf6cfd2, 0xddceec, 0xf4b5be, 0x8e70bd, 0.68);
          curtain.fillRoundedRect(72, 78, 776, 128, 30);
          for (let index = 0; index < 12; index += 1) {
            curtain.lineStyle(3, index % 2 === 0 ? 0xffffff : 0x8e70bd, 0.16);
            curtain.lineBetween(94 + index * 64, 82, 126 + index * 64, 206);
          }

          const runway = this.add.graphics();
          runway.fillGradientStyle(0xfffcf3, 0xf6cfd2, 0xead9b5, 0xddceec, 0.95);
          runway.fillPoints(
            [
              new PhaserModule.Geom.Point(318, 216),
              new PhaserModule.Geom.Point(602, 216),
              new PhaserModule.Geom.Point(752, 492),
              new PhaserModule.Geom.Point(168, 492),
            ],
            true,
          );
          runway.lineStyle(4, 0xd87e8c, 0.34);
          runway.strokePoints(
            [
              new PhaserModule.Geom.Point(318, 216),
              new PhaserModule.Geom.Point(602, 216),
              new PhaserModule.Geom.Point(752, 492),
              new PhaserModule.Geom.Point(168, 492),
            ],
            true,
          );

          this.runwayGlow = this.add.ellipse(460, 384, 310, 74, 0xfaebc2, 0.2).setDepth(0);
          this.tweens.add({
            targets: this.runwayGlow,
            alpha: 0.42,
            scaleX: 1.08,
            duration: 1300,
            yoyo: true,
            repeat: -1,
            ease: "Sine.inOut",
          });

          [164, 286, 634, 756].forEach((x, index) => {
            const light = this.add.triangle(x, 86, -48, 0, 48, 0, 0, 360, index % 2 === 0 ? 0xfae3a8 : 0xddceec, 0.16).setDepth(-1);
            this.tweens.add({
              targets: light,
              rotation: index % 2 === 0 ? 0.08 : -0.08,
              alpha: 0.28,
              duration: 1600 + index * 180,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          });

          for (let index = 0; index < 32; index += 1) {
            const sparkle = this.add.star(
              PhaserModule.Math.Between(80, 840),
              PhaserModule.Math.Between(86, 520),
              4,
              2,
              PhaserModule.Math.Between(5, 10),
              index % 3 === 0 ? 0xfae3a8 : 0xffffff,
              PhaserModule.Math.FloatBetween(0.16, 0.48),
            ).setDepth(120);
            this.tweens.add({
              targets: sparkle,
              y: sparkle.y + PhaserModule.Math.Between(-12, 18),
              alpha: PhaserModule.Math.FloatBetween(0.24, 0.72),
              duration: PhaserModule.Math.Between(1100, 2600),
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          }

          this.drawAudience();
        }

        private drawAudience() {
          const seats = [
            [122, 502, 0xf6cfd2],
            [210, 524, 0xddceec],
            [704, 524, 0xe4efd7],
            [798, 502, 0xfae3a8],
            [108, 430, 0xddceec],
            [812, 430, 0xf6cfd2],
          ] as const;

          seats.forEach(([x, y, color], index) => {
            const guest = this.add.container(x, y).setDepth(y);
            guest.add(this.add.ellipse(0, 26, 44, 14, 0x3a2a2a, 0.12));
            guest.add(this.add.circle(0, -10, 22, color, 0.86).setStrokeStyle(3, 0xffffff, 0.42));
            guest.add(this.add.circle(-8, -14, 3, 0x3a2a2a, 0.72));
            guest.add(this.add.circle(8, -14, 3, 0x3a2a2a, 0.72));
            guest.add(this.add.arc(0, -7, 8, 0, Math.PI, false, 0x3a2a2a, 0).setStrokeStyle(2, 0x3a2a2a, 0.6));
            this.tweens.add({
              targets: guest,
              y: y - 5,
              duration: 900 + index * 90,
              yoyo: true,
              repeat: -1,
              ease: "Sine.inOut",
            });
          });
        }

        private createHud() {
          this.themeText = this.add.text(80, 92, "", {
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "25px",
          }).setDepth(6000);
          this.promptText = this.add.text(80, 126, "", {
            color: "#5B3F3F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "13px",
            fontStyle: "900",
            wordWrap: { width: 420 },
          }).setDepth(6000);
          this.scoreText = this.add.text(GAME_WIDTH - 236, 96, "Score 0", {
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "18px",
            fontStyle: "900",
          }).setDepth(6000);
          this.feedbackText = this.add.text(GAME_WIDTH / 2, 502, "Select a look below.", {
            align: "center",
            color: "#84675F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "14px",
            fontStyle: "900",
          }).setOrigin(0.5).setDepth(6000);
        }

        private createPerformer() {
          const keeperCustomization = readKeeperCustomization();
          this.keeperCustomization = keeperCustomization;
          const petCustomization = readPetCustomization();
          this.keeperSkinSprite = this.add
            .sprite(332, 382, "keeper-skin-mask-sheet", 0)
            .setDisplaySize(150, 225)
            .setDepth(421)
            .setAlpha(0);
          this.keeperSprite = this.add
            .sprite(
              332,
              382,
              "keeper-preset-animation-sheet",
              keeperPresetFrame(keeperCustomization.characterId, "idle"),
            )
            .setDisplaySize(150, 225)
            .setDepth(420);
          this.keeperHairSprite = this.add
            .sprite(332, 382, "keeper-hair-style-sheet", 0)
            .setDisplaySize(150, 225)
            .setDepth(422)
            .setAlpha(0);
          this.applyKeeperLayerTints();
          this.petSprite = this.add
            .sprite(574, 428, "pet-animation-sheet", petFrame(petCustomization.speciesId, "idle"))
            .setDisplaySize(120, 135)
            .setDepth(430);

          const tone = getPetTone(petCustomization.toneId);
          if (petCustomization.toneId !== "cream") {
            this.petSprite.setTint(PhaserModule.Display.Color.HexStringToColor(tone.color).color);
          }

          this.add.ellipse(332, 496, 86, 24, 0x3a2a2a, 0.14).setDepth(390);
          this.add.ellipse(574, 492, 74, 20, 0x3a2a2a, 0.13).setDepth(389);
          this.tweens.add({ targets: [this.keeperSkinSprite, this.keeperSprite, this.keeperHairSprite, this.petSprite], y: "-=5", duration: 1080, yoyo: true, repeat: -1, ease: "Sine.inOut" });
        }

        private applyKeeperLayerTints() {
          this.keeperSkinSprite?.clearTint().setAlpha(0);
          this.keeperSprite?.clearTint().setAlpha(1);
          this.keeperHairSprite?.clearTint().setAlpha(0);
        }

        private setKeeperLook(paletteId: KeeperPaletteId, pose: KeeperPose, outfitId: KeeperOutfitId) {
          this.keeperSprite.setTexture(
            "keeper-preset-animation-sheet",
            keeperPresetFrame(this.keeperCustomization.characterId, pose),
          );
          this.applyKeeperLayerTints();
        }

        private createChoiceCards() {
          fashionChoices.forEach((choice, index) => {
            const x = 132 + index * 218;
            const card = this.add.container(x, 552).setDepth(6100);
            const bg = this.add.rectangle(0, 0, 196, 72, 0xfffcf3, 0.94).setStrokeStyle(3, choice.accent, 0.32);
            card.add(bg);
            card.add(this.add.circle(-70, -12, 17, choice.accent, 0.82).setStrokeStyle(3, 0xffffff, 0.52));
            card.add(this.add.text(-40, -20, choice.title, {
              color: "#3A2A2A",
              fontFamily: "Nunito, sans-serif",
              fontSize: "13px",
              fontStyle: "900",
            }));
            card.add(this.add.text(-40, 1, choice.note, {
              color: "#84675F",
              fontFamily: "Nunito, sans-serif",
              fontSize: "10px",
              fontStyle: "800",
              wordWrap: { width: 132 },
            }));
            card.setSize(196, 72);
            card.setInteractive({ useHandCursor: true });
            card.on("pointerdown", () => this.selectChoice(choice));
            card.on("pointerover", () => bg.setStrokeStyle(4, choice.accent, 0.82));
            card.on("pointerout", () => {
              if (this.selectedChoice?.id !== choice.id) bg.setStrokeStyle(3, choice.accent, 0.32);
            });
            this.choiceCards.push({ container: card, bg, choice });
          });
        }

        private createWalkButton() {
          this.walkButton = this.add.container(GAME_WIDTH - 172, 154).setDepth(6200);
          const bg = this.add.rectangle(0, 0, 182, 48, 0xd87e8c, 0.92).setStrokeStyle(3, 0xffffff, 0.5);
          this.walkButton.add(bg);
          this.walkButton.add(this.add.text(0, 0, "Walk runway", {
            color: "#FFFFFF",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
          }).setOrigin(0.5));
          this.walkButton.setSize(182, 48);
          this.walkButton.setInteractive({ useHandCursor: true });
          this.walkButton.on("pointerdown", () => this.walkRunway());
          this.walkButton.on("pointerover", () => bg.setFillStyle(0x8e70bd, 0.94));
          this.walkButton.on("pointerout", () => bg.setFillStyle(0xd87e8c, 0.92));
        }

        private applyRound() {
          const theme = fashionThemes[this.roundIndex];
          this.themeText.setText(`Round ${this.roundIndex + 1}: ${theme.title}`);
          this.promptText.setText(theme.prompt);
          this.scoreText.setText(`Score ${this.totalScore}`);
          this.feedbackText.setText("Pick a look that matches the judges' theme.");
          this.selectedChoice = undefined;
          this.choiceCards.forEach(({ bg, choice }) => bg.setStrokeStyle(3, choice.accent, 0.32));
          this.setWalkButtonEnabled(false);
        }

        private selectChoice(choice: FashionChoice) {
          if (this.walking || this.finished) return;
          this.selectedChoice = choice;
          this.setKeeperLook(choice.paletteId, choice.pose, choice.outfitId);
          this.petSprite.setFrame(petFrame(readPetCustomization().speciesId, choice.petPose));
          this.choiceCards.forEach(({ bg, choice: cardChoice }) => {
            bg.setStrokeStyle(cardChoice.id === choice.id ? 5 : 3, cardChoice.accent, cardChoice.id === choice.id ? 0.92 : 0.32);
          });
          this.feedbackText.setText(`${choice.title} selected. Send them down the runway.`);
          this.setWalkButtonEnabled(true);
          playCozyCue("ui");
          setStatus(`${choice.title} selected for ${fashionThemes[this.roundIndex].title}.`);
        }

        private setWalkButtonEnabled(enabled: boolean) {
          this.walkButton.setAlpha(enabled ? 1 : 0.56);
        }

        private walkRunway() {
          if (!this.selectedChoice || this.walking || this.finished) return;

          this.walking = true;
          this.setWalkButtonEnabled(false);
          const choice = this.selectedChoice;
          const theme = fashionThemes[this.roundIndex];
          const roundScore = this.scoreChoice(choice, theme);
          this.totalScore += roundScore;
          this.feedbackText.setText(`Judges gave ${roundScore} points for ${choice.title}.`);
          playCozyCue(roundScore >= 86 ? "reward" : "heart");

          this.setKeeperLook(choice.paletteId, "walk1", choice.outfitId);
          this.tweens.add({
            targets: [this.keeperSkinSprite, this.keeperSprite, this.keeperHairSprite],
            x: 690,
            y: 364,
            duration: 980,
            ease: "Sine.inOut",
            onUpdate: () => {
              const pose = keeperGaitPose(this.time.now);
              this.setKeeperLook(choice.paletteId, pose, choice.outfitId);
            },
            onComplete: () => {
              this.setKeeperLook(choice.paletteId, choice.pose, choice.outfitId);
              this.petSprite.setFrame(petFrame(readPetCustomization().speciesId, choice.petPose));
              this.spawnApplause(choice.accent);
              this.time.delayedCall(760, () => this.finishRound(choice));
            },
          });
          this.tweens.add({ targets: this.petSprite, x: 526, y: 430, duration: 840, ease: "Sine.inOut" });
        }

        private scoreChoice(choice: FashionChoice, theme: FashionTheme) {
          let score = 54;
          if (choice.paletteId === theme.paletteId) score += 18;
          if (choice.outfitId === theme.outfitId) score += 18;
          if (choice.pose === theme.pose) score += 10;
          score += PhaserModule.Math.Between(0, 6);
          return Math.min(100, score);
        }

        private finishRound(choice: FashionChoice) {
          this.roundIndex += 1;
          this.scoreText.setText(`Score ${this.totalScore}`);
          if (this.roundIndex >= MAX_ROUNDS) {
            this.endShow();
            return;
          }

          [this.keeperSkinSprite, this.keeperSprite, this.keeperHairSprite].forEach((sprite) => sprite.setPosition(332, 382));
          this.petSprite.setPosition(574, 428);
          this.setKeeperLook(choice.paletteId, "idle", choice.outfitId);
          this.petSprite.setFrame(petFrame(readPetCustomization().speciesId, "idle"));
          this.walking = false;
          this.applyRound();
          setStatus(`Round ${this.roundIndex + 1}: choose the next runway look.`);
        }

        private spawnApplause(color: number) {
          for (let index = 0; index < 18; index += 1) {
            const heart = this.add.image(
              PhaserModule.Math.Between(230, 720),
              PhaserModule.Math.Between(210, 420),
              "minigame-props",
              3,
            ).setDisplaySize(46, 58).setTint(index % 2 === 0 ? color : 0xd87e8c).setDepth(6500);
            this.tweens.add({
              targets: heart,
              y: heart.y - PhaserModule.Math.Between(40, 104),
              x: heart.x + PhaserModule.Math.Between(-30, 30),
              alpha: 0,
              scale: 0.38,
              duration: 920 + index * 24,
              ease: "Sine.out",
              onComplete: () => heart.destroy(),
            });
          }
        }

        private endShow() {
          this.finished = true;
          this.walking = false;
          const coins = 130 + this.totalScore * 2;
          const hearts = this.totalScore >= 260 ? 7 : this.totalScore >= 230 ? 6 : 4;
          this.rewardLayer?.destroy(true);
          const layer = this.add.container(GAME_WIDTH / 2, 292).setDepth(7600);
          layer.add(this.add.rectangle(0, 0, 396, 176, 0xfffcf3, 0.96).setStrokeStyle(4, 0xd87e8c, 0.52));
          layer.add(this.add.text(0, -52, "Runway complete", {
            align: "center",
            color: "#3A2A2A",
            fontFamily: "Caprasimo, Georgia, serif",
            fontSize: "28px",
          }).setOrigin(0.5));
          layer.add(this.add.text(0, 10, `Final score ${this.totalScore}\nReward ${coins} coins + ${hearts} hearts\nCasper saved a fashion sticker for the memory book.`, {
            align: "center",
            color: "#5B3F3F",
            fontFamily: "Nunito, sans-serif",
            fontSize: "15px",
            fontStyle: "900",
            lineSpacing: 6,
          }).setOrigin(0.5));
          this.rewardLayer = layer;
          this.feedbackText.setText("Fashion Show complete. Refresh or revisit to play again.");
          playCozyCue("reward");
          onRewardRef.current?.({
            gameId: "fashion-show",
            label: "Fashion Show",
            score: this.totalScore,
            coins,
            hearts,
          });
          setStatus(`Fashion Show complete: ${coins} coins and ${hearts} hearts awarded.`);
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
        scene: FashionShowScene,
      });
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load Fashion Show.");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, []);

  return (
    <section className="overflow-hidden rounded-lg border border-blush-300/50 bg-blush-100 shadow-[0_24px_70px_rgba(216,126,140,0.16)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blush-300/40 bg-white/70 px-4 py-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">Runway mini-game</p>
          <p className="text-sm font-black text-ink-900">Theme matching, animated poses, pet companion, judging, and rewards</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-ink-700">
          <span className="rounded-md bg-blush-100 px-2.5 py-1">Pick outfit</span>
          <span className="rounded-md bg-lavender-100 px-2.5 py-1">Walk runway</span>
          <span className="rounded-md bg-honey-100 px-2.5 py-1">Earn rewards</span>
        </div>
      </div>
      <div
        ref={mountRef}
        aria-label="Interactive HeartHaven Fashion Show canvas with outfit selection, animated avatar runway poses, pet companion, judging, score, and rewards"
        className="mx-auto block overflow-hidden bg-blush-100"
        role="application"
        style={{
          width: "min(100%, calc((100dvh - 300px) * 1.5333), 920px)",
          aspectRatio: "920 / 600",
        }}
        tabIndex={0}
      />
      <div className="border-t border-blush-300/40 bg-white/72 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </section>
  );
}
