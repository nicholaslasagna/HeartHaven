"use client";

import { useEffect, useRef } from "react";
import {
  getKeeperCharacterPreset,
  getKeeperHairColor,
  getKeeperSkinTone,
  isKeeperPresetExactMatch,
  keeperFrame,
  keeperHairFrame,
  keeperSkinFrame,
  type KeeperBodyId,
  type KeeperCharacterId,
  type KeeperHairColorId,
  type KeeperHairStyleId,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperPose,
  type KeeperSkinId,
} from "@/lib/game/avatar-customization";

type KeeperAvatarPreviewProps = {
  characterId: KeeperCharacterId;
  bodyId: KeeperBodyId;
  skinId: KeeperSkinId;
  hairStyleId: KeeperHairStyleId;
  hairColorId: KeeperHairColorId;
  paletteId: KeeperPaletteId;
  outfitId: KeeperOutfitId;
  pose?: KeeperPose;
  className?: string;
};

const frameWidth = 256;
const frameHeight = 384;
const baseSheetPath = "/game-assets/generated/keeper-custom-base-sheet.png";
const skinSheetPath = "/game-assets/generated/keeper-skin-mask-sheet.png";
const hairSheetPath = "/game-assets/generated/keeper-hair-style-sheet.png";

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const tintCanvas =
  typeof document === "undefined"
    ? null
    : Object.assign(document.createElement("canvas"), { width: frameWidth, height: frameHeight });

function loadPreviewImage(src: string) {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

export function KeeperAvatarPreview(props: KeeperAvatarPreviewProps) {
  const { bodyId, characterId, hairColorId, hairStyleId, outfitId, paletteId, pose = "idle", skinId, className } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    async function renderPreview() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const usePresetArt = isKeeperPresetExactMatch({
        bodyId,
        characterId,
        hairColorId,
        hairStyleId,
        outfitId,
        paletteId,
        skinId,
      });
      const [baseImage, skinImage, hairImage] = usePresetArt
        ? [await loadPreviewImage(getKeeperCharacterPreset(characterId).image), null, null]
        : await Promise.all([
          loadPreviewImage(baseSheetPath),
          loadPreviewImage(skinSheetPath),
          loadPreviewImage(hairSheetPath),
        ]);
      if (!active) return;
      ctx.clearRect(0, 0, frameWidth, frameHeight);
      ctx.save();
      const verticalOffset = pose === "sit" ? 16 : pose === "walk1" || pose === "walk2" ? -4 : 0;
      const rotation = pose === "wave" ? -0.035 : pose === "heart" ? 0.025 : 0;
      const scaleY = pose === "sit" ? 0.92 : 1;
      ctx.translate(frameWidth / 2, frameHeight / 2 + verticalOffset);
      ctx.rotate(rotation);
      ctx.scale(1, scaleY);
      if (usePresetArt) {
        ctx.drawImage(baseImage, -frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight);
      } else if (skinImage && hairImage) {
        drawSheetFrame(ctx, baseImage, keeperFrame(paletteId, pose, outfitId, bodyId), -frameWidth / 2, -frameHeight / 2);
        drawTintedSheetFrame(
          ctx,
          skinImage,
          keeperSkinFrame(pose, outfitId, bodyId),
          getKeeperSkinTone(skinId).color,
          -frameWidth / 2,
          -frameHeight / 2,
          0.86,
        );
        drawTintedSheetFrame(
          ctx,
          hairImage,
          keeperHairFrame(hairStyleId, pose, bodyId),
          getKeeperHairColor(hairColorId).color,
          -frameWidth / 2,
          -frameHeight / 2,
          0.94,
        );
      }
      ctx.restore();
    }
    void renderPreview();
    return () => {
      active = false;
    };
  }, [bodyId, characterId, hairColorId, hairStyleId, outfitId, paletteId, pose, skinId]);

  return (
    <canvas
      aria-label="Painted chibi keeper avatar preview"
      className={className}
      height={frameHeight}
      ref={canvasRef}
      width={frameWidth}
    />
  );
}

function frameSource(frame: number) {
  return {
    sx: (frame % 6) * frameWidth,
    sy: Math.floor(frame / 6) * frameHeight,
  };
}

function drawSheetFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frame: number,
  dx: number,
  dy: number,
) {
  const { sx, sy } = frameSource(frame);
  ctx.drawImage(image, sx, sy, frameWidth, frameHeight, dx, dy, frameWidth, frameHeight);
}

function drawTintedSheetFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frame: number,
  color: string,
  dx: number,
  dy: number,
  alpha: number,
) {
  if (!tintCanvas) return;
  const tintCtx = tintCanvas.getContext("2d");
  if (!tintCtx) return;
  tintCtx.clearRect(0, 0, frameWidth, frameHeight);
  drawSheetFrame(tintCtx, image, frame, 0, 0);
  tintCtx.globalCompositeOperation = "source-in";
  tintCtx.fillStyle = color;
  tintCtx.fillRect(0, 0, frameWidth, frameHeight);
  tintCtx.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(tintCanvas, dx, dy, frameWidth, frameHeight);
  ctx.restore();
}
