import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.join(process.cwd(), "public/game-assets/generated/room-surfaces");
const SIZE = 512;

function svgShell(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <filter id="paper" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="4" seed="12" result="noise"/>
      <feColorMatrix in="noise" type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="table" tableValues="0 0.08"/>
      </feComponentTransfer>
      <feBlend mode="multiply" in2="SourceGraphic"/>
    </filter>
  </defs>
  ${body}
</svg>`;
}

function rect(x, y, w, h, fill, stroke = "", opacity = 1, radius = 0) {
  const strokeAttrs = stroke ? ` stroke="${stroke}" stroke-width="2"` : "";
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" opacity="${opacity}"${strokeAttrs}/>`;
}

function circle(cx, cy, r, fill, opacity = 1) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}"/>`;
}

function pathEl(d, fill, stroke = "", opacity = 1, width = 2) {
  const strokeAttrs = stroke ? ` stroke="${stroke}" stroke-width="${width}"` : "";
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"${strokeAttrs}/>`;
}

const assets = [
  {
    file: "floor-cream-checker.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#fbf3df")}
      ${Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => rect(x * 64, y * 64, 64, 64, (x + y) % 2 ? "#f2dfc0" : "#fff8ea", "#e4cfa7", 0.92)).join("")).join("")}
      ${Array.from({ length: 9 }, (_, i) => `<path d="M${i * 64} 0V512M0 ${i * 64}H512" stroke="#d7bb8b" stroke-width="1" opacity="0.42"/>`).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "floor-lavender-diamond.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#eee4f8")}
      ${Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => {
        const cx = x * 92 - 20 + (y % 2 ? 46 : 0);
        const cy = y * 84 - 10;
        return `<path d="M${cx} ${cy - 38}L${cx + 46} ${cy}L${cx} ${cy + 38}L${cx - 46} ${cy}Z" fill="${(x + y) % 2 ? "#d7c3ef" : "#f9f2ff"}" stroke="#bda2d8" stroke-width="2" opacity="0.92"/>`;
      }).join("")).join("")}
      ${Array.from({ length: 24 }, (_, i) => circle((i * 73) % 512, (i * 113) % 512, 3, "#fff9e8", 0.5)).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "floor-honey-oak.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#d9a85b")}
      ${Array.from({ length: 9 }, (_, y) => {
        const h = 58;
        const offset = y % 2 ? 96 : 0;
        return `${rect(-offset, y * h, 192, h, "#e6bd78", "#b77f35", 0.92)}
        ${rect(192 - offset, y * h, 192, h, "#d89d55", "#b77f35", 0.92)}
        ${rect(384 - offset, y * h, 192, h, "#edc987", "#b77f35", 0.92)}
        ${rect(576 - offset, y * h, 192, h, "#d89d55", "#b77f35", 0.92)}`;
      }).join("")}
      ${Array.from({ length: 36 }, (_, i) => pathEl(`M${(i * 53) % 512} ${(i * 97) % 512}c34 -18 72 -12 108 0`, "none", "#8b5e2f", 0.16, 2)).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "floor-blush-mosaic.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#f8dedf")}
      ${Array.from({ length: 10 }, (_, y) => Array.from({ length: 10 }, (_, x) => {
        const colors = ["#fff6ea", "#f3c9cf", "#ead7f8", "#f6d999", "#dceccd"];
        return rect(x * 52 - 4, y * 52 - 4, 48, 48, colors[(x * 3 + y * 5) % colors.length], "#d6b1aa", 0.9, 10);
      }).join("")).join("")}
      ${Array.from({ length: 16 }, (_, i) => circle((i * 83 + 29) % 512, (i * 61 + 43) % 512, 5, "#ffffff", 0.35)).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "floor-garden-stone.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#dfe8cf")}
      ${Array.from({ length: 34 }, (_, i) => {
        const x = (i * 89 + 31) % 560 - 40;
        const y = (i * 53 + 17) % 560 - 40;
        const w = 68 + (i % 4) * 18;
        const h = 42 + (i % 3) * 12;
        return `<ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${h / 2}" fill="${i % 3 ? "#f4eddc" : "#cadab7"}" stroke="#aebd9c" stroke-width="2" opacity="0.9"/>`;
      }).join("")}
      ${Array.from({ length: 70 }, (_, i) => circle((i * 41) % 512, (i * 73) % 512, 2, "#ffffff", 0.28)).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "wall-cream-plaster.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#fff3df")}
      ${Array.from({ length: 38 }, (_, i) => circle((i * 47) % 512, (i * 83) % 512, 22 + (i % 5) * 8, i % 2 ? "#f6e0be" : "#ffffff", 0.14)).join("")}
      ${Array.from({ length: 18 }, (_, i) => pathEl(`M${-80 + i * 36} ${(i * 71) % 512}c90 36 160 -28 250 10`, "none", "#d5b98c", 0.12, 3)).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "wall-blush-floral.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#fde8e7")}
      ${Array.from({ length: 30 }, (_, i) => {
        const x = (i * 83 + 26) % 512;
        const y = (i * 59 + 44) % 512;
        return `${circle(x, y, 13, "#f1aab7", 0.48)}${circle(x - 11, y + 3, 9, "#ffd8dc", 0.62)}${circle(x + 10, y - 5, 8, "#e8d6f6", 0.55)}${pathEl(`M${x - 4} ${y + 16}c-8 22 -20 32 -34 44`, "none", "#8bb173", 0.34, 3)}`;
      }).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "wall-lavender-stripe.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#f3eafd")}
      ${Array.from({ length: 12 }, (_, i) => `${rect(i * 48, 0, 18, SIZE, "#d8c1f1", "", 0.58)}${rect(i * 48 + 24, 0, 6, SIZE, "#fff7e7", "", 0.86)}`).join("")}
      ${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${i * 64 + 18}H512" stroke="#bba4da" stroke-width="1" opacity="0.24"/>`).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "wall-sage-beadboard.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#dfead0")}
      ${Array.from({ length: 17 }, (_, i) => `${rect(i * 32, 0, 28, SIZE, i % 2 ? "#d5e4c3" : "#e9f2db", "#b7c79d", 0.9, 8)}<path d="M${i * 32 + 14} 0V512" stroke="#ffffff" stroke-width="2" opacity="0.22"/>`).join("")}
      ${rect(0, 354, SIZE, 26, "#c4d5aa", "#9aae82", 0.96, 0)}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "wall-night-stars.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#3b315f")}
      ${Array.from({ length: 52 }, (_, i) => {
        const x = (i * 67 + 19) % 512;
        const y = (i * 97 + 29) % 512;
        const r = 2 + (i % 3);
        return `<path d="M${x} ${y - r * 2}L${x + r} ${y - r}L${x + r * 2} ${y}L${x + r} ${y + r}L${x} ${y + r * 2}L${x - r} ${y + r}L${x - r * 2} ${y}L${x - r} ${y - r}Z" fill="${i % 4 ? "#fff1b8" : "#d8c6ff"}" opacity="${0.5 + (i % 4) * 0.1}"/>`;
      }).join("")}
      ${circle(400, 112, 42, "#f4e7aa", 0.7)}
      ${circle(382, 96, 42, "#3b315f", 0.98)}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
  {
    file: "wall-honey-stucco.png",
    body: svgShell(`
      ${rect(0, 0, SIZE, SIZE, "#fae0a9")}
      ${Array.from({ length: 48 }, (_, i) => circle((i * 71 + 7) % 512, (i * 37 + 19) % 512, 18 + (i % 6) * 6, i % 2 ? "#f7ca74" : "#fff3d7", 0.18)).join("")}
      ${Array.from({ length: 15 }, (_, i) => pathEl(`M${(i * 42) - 80} ${80 + (i * 53) % 430}c66 -34 128 -26 202 4`, "none", "#be843b", 0.1, 4)).join("")}
      <rect width="512" height="512" fill="transparent" filter="url(#paper)"/>
    `),
  },
];

await fs.mkdir(OUT_DIR, { recursive: true });

for (const asset of assets) {
  const out = path.join(OUT_DIR, asset.file);
  await sharp(Buffer.from(asset.body)).png({ compressionLevel: 9 }).toFile(out);
  console.log(out);
}
