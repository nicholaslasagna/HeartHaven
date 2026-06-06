"use client";

import { useEffect, useRef } from "react";
import {
  KEEPER_PRESET_ANIMATION_SHEET_PATH,
  keeperPresetFrame,
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
const presetSheetPath = KEEPER_PRESET_ANIMATION_SHEET_PATH;

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

export function KeeperAvatarPreview(props: KeeperAvatarPreviewProps) {
  const { characterId, pose = "idle", className } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    async function renderPreview() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const baseImage = await loadPreviewImage(presetSheetPath);
      if (!active) return;
      ctx.clearRect(0, 0, frameWidth, frameHeight);
      ctx.save();
      ctx.translate(frameWidth / 2, frameHeight / 2);
      drawSheetFrame(ctx, baseImage, keeperPresetFrame(characterId, pose), -frameWidth / 2, -frameHeight / 2);
      ctx.restore();
    }
    void renderPreview();
    return () => {
      active = false;
    };
  }, [characterId, pose]);

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
