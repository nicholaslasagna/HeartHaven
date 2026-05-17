import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "public", "game-assets", "generated", "pet-foods");

const foods = [
  { id: "moonberry-biscuit", main: "#D8C4ED", accent: "#8E70BD", detail: "#FFF8D7", shape: "biscuit" },
  { id: "honey-oat-bites", main: "#E2AD3A", accent: "#A87124", detail: "#FFF2C7", shape: "cluster" },
  { id: "garden-crisp", main: "#8FBA68", accent: "#527A3D", detail: "#F6C7CF", shape: "leaf" },
  { id: "starlight-soup", main: "#C9E1ED", accent: "#5E94B0", detail: "#FFF8D7", shape: "bowl" },
  { id: "salmon-moon-bites", main: "#EE9B91", accent: "#B95E67", detail: "#FFF4D6", shape: "fish" },
];

function svg(food) {
  const special =
    food.shape === "biscuit"
      ? `<circle cx="92" cy="96" r="30" fill="${food.main}" stroke="${food.accent}" stroke-width="8"/><circle cx="83" cy="86" r="4" fill="${food.detail}"/><circle cx="99" cy="101" r="4" fill="${food.detail}"/><path d="M76 117 Q92 130 108 117" fill="none" stroke="${food.accent}" stroke-width="5" stroke-linecap="round"/>`
      : food.shape === "cluster"
        ? `<circle cx="78" cy="100" r="18" fill="${food.main}" stroke="${food.accent}" stroke-width="5"/><circle cx="101" cy="87" r="19" fill="${food.main}" stroke="${food.accent}" stroke-width="5"/><circle cx="108" cy="112" r="17" fill="${food.main}" stroke="${food.accent}" stroke-width="5"/><circle cx="88" cy="115" r="15" fill="${food.detail}" opacity=".72"/>`
        : food.shape === "leaf"
          ? `<path d="M58 119 C52 66 111 44 130 89 C112 120 82 136 58 119Z" fill="${food.main}" stroke="${food.accent}" stroke-width="7"/><path d="M66 113 C89 96 104 83 124 58" fill="none" stroke="${food.detail}" stroke-width="5" stroke-linecap="round"/><circle cx="108" cy="112" r="11" fill="${food.detail}" opacity=".78"/>`
          : food.shape === "bowl"
            ? `<path d="M50 91 H134 C131 132 58 132 50 91Z" fill="${food.main}" stroke="${food.accent}" stroke-width="7"/><ellipse cx="92" cy="91" rx="43" ry="13" fill="${food.detail}" stroke="${food.accent}" stroke-width="5"/><path d="M72 66 C61 48 87 49 75 32" fill="none" stroke="${food.accent}" stroke-width="5" stroke-linecap="round"/><path d="M101 64 C90 46 116 48 105 30" fill="none" stroke="${food.accent}" stroke-width="5" stroke-linecap="round"/>`
            : `<path d="M54 100 C82 59 129 66 145 100 C125 134 83 139 54 100Z" fill="${food.main}" stroke="${food.accent}" stroke-width="7"/><path d="M145 100 L170 76 V124 Z" fill="${food.main}" stroke="${food.accent}" stroke-width="7"/><circle cx="82" cy="94" r="5" fill="${food.detail}"/><path d="M102 78 Q117 100 102 122" fill="none" stroke="${food.detail}" stroke-width="5" stroke-linecap="round"/>`;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#5B3F3F" flood-opacity=".24"/>
        </filter>
        <radialGradient id="plate" cx="35%" cy="25%" r="70%">
          <stop offset="0" stop-color="#FFFFFF"/>
          <stop offset="1" stop-color="#FFF7E6"/>
        </radialGradient>
      </defs>
      <ellipse cx="96" cy="143" rx="58" ry="15" fill="#3A2A2A" opacity=".13"/>
      <g filter="url(#shadow)">
        <circle cx="96" cy="98" r="62" fill="url(#plate)" stroke="#EAD8AB" stroke-width="6"/>
        ${special}
        <circle cx="132" cy="57" r="7" fill="#FFFFFF" opacity=".8"/>
        <path d="M139 40 L145 53 L158 59 L145 65 L139 78 L133 65 L120 59 L133 53 Z" fill="#D9A53E" opacity=".82"/>
      </g>
    </svg>`;
}

await fs.mkdir(outDir, { recursive: true });
for (const food of foods) {
  await sharp(Buffer.from(svg(food))).png().toFile(path.join(outDir, `${food.id}.png`));
}

console.log(`Generated ${foods.length} pet food icons in ${path.relative(root, outDir)}.`);
