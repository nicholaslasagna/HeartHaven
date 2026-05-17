import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const generatedDir = path.join(root, "public", "game-assets", "generated");
const furnitureDir = path.join(generatedDir, "furniture");
const sourcePath = path.join(generatedDir, "source", "interactive-furniture-v1-chroma.png");
const sheetOut = path.join(generatedDir, "interactive-furniture-sheet.png");

const items = [
  { id: "canopy-bed", col: 0, row: 0 },
  { id: "blush-loveseat", col: 1, row: 0 },
  { id: "moonberry-pet-bed", col: 2, row: 0 },
  { id: "garden-swing-bench", col: 0, row: 1 },
  { id: "honey-tea-set", col: 1, row: 1 },
  { id: "lavender-armchair-v2", col: 2, row: 1 },
];

function isChromaGreen(r, g, b) {
  return g > 120 && g > r * 1.48 && g > b * 1.48;
}

function matteAlpha(r, g, b, a) {
  if (a === 0) return 0;
  if (isChromaGreen(r, g, b)) return 0;
  const greenDominance = g - Math.max(r, b);
  if (g > 80 && greenDominance > 34) {
    return Math.max(0, Math.min(255, Math.round(255 - greenDominance * 4.2)));
  }
  return a;
}

async function removeChroma(inputPath, outputPath) {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = Buffer.from(data);

  for (let index = 0; index < output.length; index += 4) {
    const r = output[index];
    const g = output[index + 1];
    const b = output[index + 2];
    const a = output[index + 3];
    const nextAlpha = matteAlpha(r, g, b, a);
    output[index + 3] = nextAlpha;

    if (nextAlpha > 0 && g > r && g > b) {
      const spill = Math.min(g - Math.max(r, b), 48);
      output[index + 1] = Math.max(Math.max(r, b), g - spill);
    }
  }

  await sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(outputPath);
  return info;
}

function cellBounds(info, col, row) {
  const colStarts = [0, Math.round(info.width / 3), Math.round((info.width / 3) * 2), info.width];
  const rowStarts = [0, Math.round(info.height / 2), info.height];
  return {
    left: colStarts[col],
    top: rowStarts[row],
    width: colStarts[col + 1] - colStarts[col],
    height: rowStarts[row + 1] - rowStarts[row],
  };
}

function removeTinyAlphaIslands(buffer, width, height, minArea = 220) {
  const alphaAt = (x, y) => buffer[(y * width + x) * 4 + 3];
  const seen = new Uint8Array(width * height);
  const queue = [];
  const components = [];
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let start = 0; start < width * height; start += 1) {
    if (seen[start]) continue;
    const sx = start % width;
    const sy = Math.floor(start / width);
    if (alphaAt(sx, sy) <= 12) {
      seen[start] = 1;
      continue;
    }

    const pixels = [];
    queue.length = 0;
    queue.push(start);
    seen[start] = 1;

    while (queue.length > 0) {
      const current = queue.pop();
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (seen[next] || alphaAt(nx, ny) <= 12) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }

    components.push(pixels);
  }

  for (const pixels of components) {
    if (pixels.length >= minArea) continue;
    for (const pixel of pixels) buffer[pixel * 4 + 3] = 0;
  }

  return buffer;
}

await sharp(sourcePath).metadata();
const info = await removeChroma(sourcePath, sheetOut);

await Promise.all(
  items.map(async (item) => {
    const crop = cellBounds(info, item.col, item.row);
    const destination = path.join(furnitureDir, `${item.id}.png`);
    const { data, info: cropInfo } = await sharp(sheetOut)
      .extract(crop)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cleaned = removeTinyAlphaIslands(Buffer.from(data), cropInfo.width, cropInfo.height);
    if (item.id === "canopy-bed") {
      for (let y = Math.round(cropInfo.height * 0.965); y < cropInfo.height; y += 1) {
        for (let x = 0; x < cropInfo.width; x += 1) {
          cleaned[(y * cropInfo.width + x) * 4 + 3] = 0;
        }
      }
    }
    await sharp(cleaned, { raw: { width: cropInfo.width, height: cropInfo.height, channels: 4 } })
      .png()
      .toFile(destination);
  }),
);

console.log(`Generated interactive furniture assets:
- ${path.relative(root, sheetOut)}
${items.map((item) => `- public/game-assets/generated/furniture/${item.id}.png`).join("\n")}`);
