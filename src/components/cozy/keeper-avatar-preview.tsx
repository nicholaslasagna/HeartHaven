"use client";

import { useEffect, useRef } from "react";
import {
  getKeeperHairColor,
  getKeeperSkinTone,
  keeperFrame,
  keeperHairFrame,
  keeperSkinFrame,
  type KeeperBodyId,
  type KeeperHairColorId,
  type KeeperHairStyleId,
  type KeeperOutfitId,
  type KeeperPaletteId,
  type KeeperPose,
  type KeeperSkinId,
} from "@/lib/game/avatar-customization";

type KeeperAvatarPreviewProps = {
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
const columns = 6;

const imageCache = new Map<string, Promise<HTMLImageElement>>();

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

function drawFrame(ctx: CanvasRenderingContext2D, image: HTMLImageElement, frame: number) {
  const sx = (frame % columns) * frameWidth;
  const sy = Math.floor(frame / columns) * frameHeight;
  ctx.drawImage(image, sx, sy, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
}

function drawTintedFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frame: number,
  color: string,
  blendMode: GlobalCompositeOperation,
  alpha = 1,
) {
  const layer = document.createElement("canvas");
  layer.width = frameWidth;
  layer.height = frameHeight;
  const layerCtx = layer.getContext("2d");
  if (!layerCtx) return;
  drawFrame(layerCtx, image, frame);
  layerCtx.globalCompositeOperation = "source-in";
  layerCtx.fillStyle = color;
  layerCtx.fillRect(0, 0, frameWidth, frameHeight);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blendMode;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

export function KeeperAvatarPreview({
  bodyId,
  skinId,
  hairStyleId,
  hairColorId,
  paletteId,
  outfitId,
  pose = "idle",
  className,
}: KeeperAvatarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    async function renderPreview() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const [base, skin, hair] = await Promise.all([
        loadPreviewImage("/game-assets/generated/keeper-custom-base-sheet.png"),
        loadPreviewImage("/game-assets/generated/keeper-skin-mask-sheet.png"),
        loadPreviewImage("/game-assets/generated/keeper-hair-style-sheet.png"),
      ]);
      if (!active) return;
      ctx.clearRect(0, 0, frameWidth, frameHeight);
      drawFrame(ctx, base, keeperFrame(paletteId, pose, outfitId, bodyId));
      drawTintedFrame(ctx, skin, keeperSkinFrame(pose, outfitId, bodyId), getKeeperSkinTone(skinId).color, "source-over", 0.9);
      drawTintedFrame(ctx, hair, keeperHairFrame(hairStyleId, pose, bodyId), getKeeperHairColor(hairColorId).color, "source-over", 0.96);
    }
    void renderPreview();
    return () => {
      active = false;
    };
  }, [bodyId, hairColorId, hairStyleId, outfitId, paletteId, pose, skinId]);

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
