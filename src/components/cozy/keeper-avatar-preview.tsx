"use client";

import { useEffect, useRef } from "react";
import {
  getKeeperCharacterPreset,
  keeperFrame,
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

export function KeeperAvatarPreview(props: KeeperAvatarPreviewProps) {
  const { bodyId, characterId, paletteId, outfitId, pose = "idle", className } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    async function renderPreview() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const preset = getKeeperCharacterPreset(characterId);
      if (pose === "idle") {
        const image = await loadPreviewImage(preset.image);
        if (!active) return;
        ctx.clearRect(0, 0, frameWidth, frameHeight);
        ctx.drawImage(image, 0, 0, frameWidth, frameHeight);
        return;
      }
      const base = await loadPreviewImage("/game-assets/generated/keeper-custom-base-sheet.png");
      if (!active) return;
      ctx.clearRect(0, 0, frameWidth, frameHeight);
      drawFrame(ctx, base, keeperFrame(paletteId, pose, outfitId, bodyId));
    }
    void renderPreview();
    return () => {
      active = false;
    };
  }, [bodyId, characterId, outfitId, paletteId, pose]);

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
