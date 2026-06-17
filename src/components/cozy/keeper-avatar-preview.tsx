"use client";

import { useEffect, useRef } from "react";
import {
  KEEPER_PRESET_FRAME_COLUMNS,
  KEEPER_PRESET_ANIMATION_SHEET_PATH,
  keeperTimedAnimationFrame,
  type KeeperAnimationId,
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
    let frameRequest = 0;
    const startedAt = performance.now();

    async function renderPreview() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const baseImage = await loadPreviewImage(presetSheetPath);
      if (!active) return;

      const paint = (time: number) => {
        if (!active) return;
        ctx.clearRect(0, 0, frameWidth, frameHeight);
        ctx.save();
        ctx.translate(frameWidth / 2, frameHeight / 2);
        drawSheetFrame(
          ctx,
          baseImage,
          keeperTimedAnimationFrame(characterId, previewAnimationForPose(pose), time - startedAt, previewFrameDuration(pose)),
          -frameWidth / 2,
          -frameHeight / 2,
        );
        ctx.restore();
        frameRequest = requestAnimationFrame(paint);
      };

      frameRequest = requestAnimationFrame(paint);
    }
    void renderPreview();
    return () => {
      active = false;
      if (frameRequest) cancelAnimationFrame(frameRequest);
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
    sx: (frame % KEEPER_PRESET_FRAME_COLUMNS) * frameWidth,
    sy: Math.floor(frame / KEEPER_PRESET_FRAME_COLUMNS) * frameHeight,
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

function previewAnimationForPose(pose: KeeperPose): KeeperAnimationId {
  if (pose === "walk1" || pose === "walk2") return "walk";
  if (pose === "wave") return "wave";
  if (pose === "heart") return "heart";
  if (pose === "sit") return "sit";
  return "idle";
}

function previewFrameDuration(pose: KeeperPose) {
  if (pose === "walk1" || pose === "walk2") return 115;
  if (pose === "wave") return 170;
  if (pose === "heart") return 260;
  if (pose === "sit") return 520;
  return 520;
}
