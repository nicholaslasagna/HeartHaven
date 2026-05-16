import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const generatedDir = path.join(root, "public", "game-assets", "generated");
const sourcePath = path.join(generatedDir, "keeper-custom-sheet.png");
const baseOut = path.join(generatedDir, "keeper-custom-base-sheet.png");
const skinOut = path.join(generatedDir, "keeper-skin-mask-sheet.png");
const hairOut = path.join(generatedDir, "keeper-hair-style-sheet.png");

const frameWidth = 256;
const frameHeight = 384;
const columns = 6;
const sourceRows = 8;
const hairStyleRows = 8;
const channels = 4;

const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

if (info.width !== frameWidth * columns || info.height !== frameHeight * sourceRows) {
  throw new Error(`Unexpected keeper sheet size: ${info.width}x${info.height}`);
}

const base = Buffer.from(data);
const skinMask = Buffer.alloc(data.length);
const hairReference = Buffer.alloc(data.length);
const hairStyleSheet = Buffer.alloc(info.width * frameHeight * hairStyleRows * channels);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: lightness };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === rn) hue = (gn - bn) / delta + (gn < bn ? 6 : 0);
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return { h: hue * 60, s: saturation, l: lightness };
}

function sourceIndex(x, y) {
  return (y * info.width + x) * channels;
}

function styleIndex(x, y) {
  return (y * info.width + x) * channels;
}

function frameBody(row) {
  return row < 4 ? "female" : "male";
}

function localPosition(x, y) {
  return {
    x: x % frameWidth,
    y: y % frameHeight,
    row: Math.floor(y / frameHeight),
    column: Math.floor(x / frameWidth),
  };
}

function isLikelyHair(r, g, b, a, x, y, body) {
  if (a < 24) return false;
  const { h, s, l } = hsl(r, g, b);
  const hairRegion = y <= (body === "female" ? 260 : 190);
  const brownHue = h >= 8 && h <= 42;
  const darkEnough = l >= 0.04 && l <= 0.56;
  const saturated = s >= 0.16;
  const brownRatio = r > b + 18 && g > b + 5 && r >= g * 0.82;
  const eyeRegion = x >= 72 && x <= 186 && y >= 92 && y <= 164 && l <= 0.22;
  return hairRegion && brownHue && darkEnough && saturated && brownRatio && !eyeRegion;
}

function writeMaskPixel(buffer, index, shade, alpha) {
  buffer[index] = shade;
  buffer[index + 1] = shade;
  buffer[index + 2] = shade;
  buffer[index + 3] = alpha;
}

function isLikelyVisibleSkinPixel(r, g, b, a) {
  if (a < 24) return false;
  const { h, s, l } = hsl(r, g, b);
  const warmHue = h >= 0 && h <= 58;
  const readableSkinLightness = l >= 0.48 && l <= 0.9;
  const balancedWarmth = r >= g * 0.92 && g >= b * 0.78 && r >= b + 18;
  return warmHue && readableSkinLightness && s >= 0.08 && balancedWarmth;
}

for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    const index = sourceIndex(x, y);
    const local = localPosition(x, y);
    const body = frameBody(local.row);
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];
    const { l } = hsl(r, g, b);
    const hair = isLikelyHair(r, g, b, a, local.x, local.y, body);

    if (hair) {
      const shade = clamp(Math.round(78 + l * 220), 68, 255);
      writeMaskPixel(hairReference, index, shade, a);
      base[index] = 0;
      base[index + 1] = 0;
      base[index + 2] = 0;
      base[index + 3] = 0;
    }
  }
}

function paintSkinEllipse(frameColumn, row, cx, cy, rx, ry, shade = 245, alpha = 192) {
  const startX = Math.floor(cx - rx - 2);
  const endX = Math.ceil(cx + rx + 2);
  const startY = Math.floor(cy - ry - 2);
  const endY = Math.ceil(cy + ry + 2);
  for (let localY = startY; localY <= endY; localY += 1) {
    for (let localX = startX; localX <= endX; localX += 1) {
      const nx = (localX - cx) / rx;
      const ny = (localY - cy) / ry;
      const distance = nx * nx + ny * ny;
      if (distance > 1.12) continue;
      const softness = clamp((1.12 - distance) / 0.18, 0, 1);
      const x = frameColumn * frameWidth + localX;
      const y = row * frameHeight + localY;
      if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
      if (localY < (frameBody(row) === "female" ? 84 : 76)) continue;
      const target = sourceIndex(x, y);
      if (data[target + 3] < 20 || hairReference[target + 3] > 0) continue;
      if (!isLikelyVisibleSkinPixel(data[target], data[target + 1], data[target + 2], data[target + 3])) continue;
      const nextAlpha = Math.round(alpha * softness);
      if (nextAlpha <= skinMask[target + 3]) continue;
      skinMask[target] = shade;
      skinMask[target + 1] = shade;
      skinMask[target + 2] = shade;
      skinMask[target + 3] = nextAlpha;
    }
  }
}

const handByPose = [
  [[58, 220], [198, 220]],
  [[76, 210], [185, 198]],
  [[62, 200], [184, 212]],
  [[96, 252], [158, 252]],
  [[68, 220], [196, 112]],
  [[108, 218], [148, 218]],
];

for (let row = 0; row < sourceRows; row += 1) {
  const body = frameBody(row);
  const outfit = row % 4;
  for (let column = 0; column < columns; column += 1) {
    const bodyShift = body === "female" ? 0 : -2;
    paintSkinEllipse(column, row, 128, 112 + bodyShift, body === "female" ? 44 : 42, body === "female" ? 52 : 48, 247, 222);
    paintSkinEllipse(column, row, 76, 122 + bodyShift, 9, 14, 235, 185);
    paintSkinEllipse(column, row, 180, 122 + bodyShift, 9, 14, 235, 185);
    paintSkinEllipse(column, row, 128, 166 + bodyShift, 17, 19, 232, 160);
    handByPose[column].forEach(([x, y]) => {
      paintSkinEllipse(column, row, x, y + (body === "female" ? 0 : -6), 12, 15, 238, 205);
    });
    if (body === "female" || outfit === 1) {
      paintSkinEllipse(column, row, 104, column === 3 ? 292 : 304, 12, 28, 226, 160);
      paintSkinEllipse(column, row, 152, column === 3 ? 292 : 304, 12, 28, 226, 160);
    }
  }
}

function copyHairPixel(fromX, fromY, toX, toY, alphaScale = 1) {
  if (toX < 0 || toY < 0 || toX >= info.width || toY >= frameHeight * hairStyleRows) return;
  const source = sourceIndex(fromX, fromY);
  const target = styleIndex(toX, toY);
  const alpha = Math.round(hairReference[source + 3] * alphaScale);
  if (alpha <= 0) return;
  hairStyleSheet[target] = hairReference[source];
  hairStyleSheet[target + 1] = hairReference[source + 1];
  hairStyleSheet[target + 2] = hairReference[source + 2];
  hairStyleSheet[target + 3] = Math.max(hairStyleSheet[target + 3], alpha);
}

function buildHairStyle(bodyIndex, styleIndexInBody, poseColumn, sourceRow, mode) {
  const targetRow = bodyIndex * 4 + styleIndexInBody;
  const sourceFrameY = sourceRow * frameHeight;
  const targetFrameY = targetRow * frameHeight;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const isSideHair = x < 72 || x > 184;
      const isLowerSideHair = y > (bodyIndex === 0 ? 170 : 132) && isSideHair;
      const isFaceFringe = y < (bodyIndex === 0 ? 170 : 134);
      const isSideTail = isSideHair && y > (bodyIndex === 0 ? 130 : 104) && y < (bodyIndex === 0 ? 258 : 184);
      const isShortBody = y < (bodyIndex === 0 ? 214 : 156);
      const isSidePartFall = x > (bodyIndex === 0 ? 144 : 138) && y < (bodyIndex === 0 ? 226 : 172);
      const shouldCopy =
        mode === "long-waves" ||
        (mode === "soft-curls"
          ? isShortBody || (isSideHair && y < (bodyIndex === 0 ? 230 : 168))
          : mode === "braids"
            ? isFaceFringe || isSideTail || !isLowerSideHair
            : isFaceFringe || isSidePartFall || (!isSideHair && y < (bodyIndex === 0 ? 196 : 152)));
      if (!shouldCopy) continue;
      const alphaScale = mode === "side-part" ? 0.96 : mode === "braids" && isSideTail ? 0.92 : 1;
      copyHairPixel(poseColumn * frameWidth + x, sourceFrameY + y, poseColumn * frameWidth + x, targetFrameY + y, alphaScale);
    }
  }
}

const hairModes = ["long-waves", "soft-curls", "braids", "side-part"];
for (let bodyIndex = 0; bodyIndex < 2; bodyIndex += 1) {
  const sourceRow = bodyIndex * 4;
  for (let style = 0; style < hairModes.length; style += 1) {
    for (let pose = 0; pose < columns; pose += 1) {
      buildHairStyle(bodyIndex, style, pose, sourceRow, hairModes[style]);
    }
  }
}

await sharp(base, { raw: { width: info.width, height: info.height, channels } }).png().toFile(baseOut);
await sharp(skinMask, { raw: { width: info.width, height: info.height, channels } }).png().toFile(skinOut);
await sharp(hairStyleSheet, { raw: { width: info.width, height: frameHeight * hairStyleRows, channels } }).png().toFile(hairOut);

console.log(`Generated:
- ${path.relative(root, baseOut)}
- ${path.relative(root, skinOut)}
- ${path.relative(root, hairOut)}`);
