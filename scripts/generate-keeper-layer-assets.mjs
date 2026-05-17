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
const hairRows = 16;

const metadata = await sharp(sourcePath).metadata();

if (metadata.width !== frameWidth * columns || metadata.height !== frameHeight * sourceRows) {
  throw new Error(`Unexpected keeper sheet size: ${metadata.width}x${metadata.height}`);
}

const channels = 4;
const transparentBackground = { r: 0, g: 0, b: 0, alpha: 0 };

// The visible keeper art must stay painterly. Earlier generated mask layers
// tried to recolor skin/hair procedurally, but they broke faces, outlines,
// and hair silhouettes. Use the finished painted sprites as the canonical
// runtime sheet and keep the experimental recolor layers transparent.
const { data: baseSheet, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

function frameOffset(column, row, x, y) {
  return ((row * frameHeight + y) * info.width + column * frameWidth + x) * channels;
}

function extractFrameAlphaComponents(row, column) {
  const candidates = new Uint8Array(frameWidth * frameHeight);
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const index = frameOffset(column, row, x, y);
      if (baseSheet[index + 3] > 12) candidates[y * frameWidth + x] = 1;
    }
  }

  const seen = new Uint8Array(candidates.length);
  const components = [];
  const queue = [];
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let start = 0; start < candidates.length; start += 1) {
    if (!candidates[start] || seen[start]) continue;
    const pixels = [];
    let minX = frameWidth;
    let minY = frameHeight;
    let maxX = 0;
    let maxY = 0;
    queue.length = 0;
    queue.push(start);
    seen[start] = 1;

    while (queue.length > 0) {
      const current = queue.pop();
      pixels.push(current);
      const x = current % frameWidth;
      const y = Math.floor(current / frameWidth);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= frameWidth || ny >= frameHeight) continue;
        const next = ny * frameWidth + nx;
        if (!candidates[next] || seen[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }

    components.push({ pixels, minX, minY, maxX, maxY });
  }

  return components.sort((a, b) => b.pixels.length - a.pixels.length);
}

function frameBounds(row, column) {
  const components = extractFrameAlphaComponents(row, column);
  return components[0] ?? { pixels: [], minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function repairSeparatedFrame(row, column, referenceColumn, cutoffY = frameHeight) {
  const [mainComponent] = cutoffY >= frameHeight
    ? extractFrameAlphaComponents(row, column)
    : [
        (() => {
          const pixels = [];
          let minX = frameWidth;
          let minY = frameHeight;
          let maxX = 0;
          let maxY = 0;
          for (let y = 0; y < cutoffY; y += 1) {
            for (let x = 0; x < frameWidth; x += 1) {
              const source = frameOffset(column, row, x, y);
              if (baseSheet[source + 3] <= 12) continue;
              const pixel = y * frameWidth + x;
              pixels.push(pixel);
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          return { pixels, minX, minY, maxX, maxY };
        })(),
      ];
  const reference = frameBounds(row, referenceColumn);
  if (!mainComponent || reference.pixels.length === 0) return;

  const frameBuffer = Buffer.alloc(frameWidth * frameHeight * channels);
  const dy = Math.max(0, Math.min(frameHeight - 1, reference.maxY - mainComponent.maxY));

  for (const pixel of mainComponent.pixels) {
    const x = pixel % frameWidth;
    const y = Math.floor(pixel / frameWidth);
    const targetY = y + dy;
    if (targetY < 0 || targetY >= frameHeight) continue;
    const source = frameOffset(column, row, x, y);
    const target = (targetY * frameWidth + x) * channels;
    frameBuffer[target] = baseSheet[source];
    frameBuffer[target + 1] = baseSheet[source + 1];
    frameBuffer[target + 2] = baseSheet[source + 2];
    frameBuffer[target + 3] = baseSheet[source + 3];
  }

  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const target = frameOffset(column, row, x, y);
      const source = (y * frameWidth + x) * channels;
      baseSheet[target] = frameBuffer[source];
      baseSheet[target + 1] = frameBuffer[source + 1];
      baseSheet[target + 2] = frameBuffer[source + 2];
      baseSheet[target + 3] = frameBuffer[source + 3];
    }
  }
}

repairSeparatedFrame(2, 4, 0, 276);

await sharp(baseSheet, { raw: { width: info.width, height: info.height, channels } }).png().toFile(baseOut);
await sharp({
  create: {
    width: frameWidth * columns,
    height: frameHeight * sourceRows,
    channels: 4,
    background: transparentBackground,
  },
})
  .png()
  .toFile(skinOut);
await sharp({
  create: {
    width: frameWidth * columns,
    height: frameHeight * hairRows,
    channels: 4,
    background: transparentBackground,
  },
})
  .png()
  .toFile(hairOut);

console.log(`Generated painterly keeper runtime sheets:
- ${path.relative(root, baseOut)}
- ${path.relative(root, skinOut)}
- ${path.relative(root, hairOut)}`);
