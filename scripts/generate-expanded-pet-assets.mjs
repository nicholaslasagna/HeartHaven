import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const generatedDir = path.join(root, "public", "game-assets", "generated");
const petsDir = path.join(generatedDir, "pets");
const sheetPath = path.join(generatedDir, "pet-art-sheet.png");
const sheetTempPath = path.join(generatedDir, "pet-art-sheet.tmp.png");

const frameWidth = 256;
const frameHeight = 288;
const columns = 6;

const speciesRows = [
  { id: "fox", label: "Cloud Fox" },
  {
    id: "bunny",
    label: "Moonberry Bunny",
    body: "#FFF3DD",
    shadow: "#D9B5F2",
    accent: "#A985CF",
    inner: "#F6B7C8",
    eye: "#694B88",
    kind: "bunny",
  },
  {
    id: "bear",
    label: "Honey Bear",
    body: "#F8D792",
    shadow: "#A96B37",
    accent: "#8C5530",
    inner: "#F2B79F",
    eye: "#5B3828",
    kind: "bear",
  },
  {
    id: "duck",
    label: "Sky Duck",
    body: "#FFE7A3",
    shadow: "#6CAED0",
    accent: "#F1A94C",
    inner: "#F4C067",
    eye: "#3D3A57",
    kind: "duck",
  },
  {
    id: "kitten",
    label: "Casper Cat",
    body: "#FFF6E6",
    shadow: "#7C6D61",
    accent: "#4A403A",
    inner: "#F3B5B9",
    eye: "#5A453D",
    kind: "kitten",
  },
  {
    id: "puppy",
    label: "Cocoa Puppy",
    body: "#F7DFC3",
    shadow: "#B87748",
    accent: "#7A513E",
    inner: "#F6B7AF",
    eye: "#5B382D",
    kind: "puppy",
  },
  {
    id: "calico",
    label: "Garden Calico",
    body: "#FFF1D7",
    shadow: "#D58B4D",
    accent: "#3D3029",
    inner: "#F7AEBB",
    eye: "#7B4E2D",
    kind: "calico",
  },
  {
    id: "lamb",
    label: "Cloud Lamb",
    body: "#FFF8E8",
    shadow: "#DECDEF",
    accent: "#C99B62",
    inner: "#F7C6CE",
    eye: "#6A4A42",
    kind: "lamb",
  },
  {
    id: "panda",
    label: "Moon Panda",
    body: "#FFF9EC",
    shadow: "#3A302F",
    accent: "#2E2728",
    inner: "#F1B6C4",
    eye: "#2B2425",
    kind: "panda",
  },
  {
    id: "dragon",
    label: "Lantern Dragon",
    body: "#DCCBF4",
    shadow: "#8E70BD",
    accent: "#7DBB84",
    inner: "#F8C77E",
    eye: "#4D3B73",
    kind: "dragon",
  },
];

const poseConfig = [
  { id: "idle", dx: 0, dy: 0, tilt: 0, legA: 0, legB: 0, eye: "open" },
  { id: "walk1", dx: -4, dy: -3, tilt: -3, legA: -8, legB: 7, eye: "open" },
  { id: "walk2", dx: 4, dy: -3, tilt: 3, legA: 7, legB: -8, eye: "open" },
  { id: "sit", dx: 0, dy: 14, tilt: 0, legA: 8, legB: 8, eye: "open" },
  { id: "sleep", dx: -2, dy: 20, tilt: -8, legA: 10, legB: 10, eye: "sleep" },
  { id: "happy", dx: 0, dy: -8, tilt: 6, legA: -10, legB: -10, eye: "happy" },
];

function esc(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function petSvg(species, poseIndex) {
  const pose = poseConfig[poseIndex];
  const sit = pose.id === "sit";
  const sleep = pose.id === "sleep";
  const happy = pose.id === "happy";
  const scaleY = sit ? 0.88 : sleep ? 0.8 : 1;
  const headX = 129 + pose.dx;
  const headY = 92 + pose.dy + (sit ? 6 : sleep ? 22 : 0);
  const bodyX = 128 + pose.dx;
  const bodyY = 166 + pose.dy + (sit ? 14 : sleep ? 24 : 0);
  const tailLift = happy ? -20 : pose.id === "walk1" ? -10 : pose.id === "walk2" ? -4 : 0;
  const wink = pose.eye === "happy";
  const closed = pose.eye === "sleep";
  const body = species.body;
  const shadow = species.shadow;
  const accent = species.accent;
  const inner = species.inner;
  const eye = species.eye;
  const label = esc(species.label);

  const earsByKind = {
    fox: `
      <path d="M82 74 L58 24 L110 53 Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M174 74 L199 25 L148 53 Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M84 60 L70 34 L100 53 Z" fill="${inner}" opacity=".82"/>
      <path d="M172 60 L186 34 L156 53 Z" fill="${inner}" opacity=".82"/>
    `,
    bunny: `
      <path d="M92 72 C71 22 83 -7 113 47 C115 63 107 73 92 72Z" fill="${body}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M164 72 C185 22 173 -7 143 47 C141 63 149 73 164 72Z" fill="${body}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M96 60 C85 25 91 13 108 49 Z" fill="${inner}" opacity=".86"/>
      <path d="M160 60 C171 25 165 13 148 49 Z" fill="${inner}" opacity=".86"/>
    `,
    bear: `
      <circle cx="82" cy="66" r="25" fill="${body}" stroke="#5b3b34" stroke-width="4"/>
      <circle cx="174" cy="66" r="25" fill="${body}" stroke="#5b3b34" stroke-width="4"/>
      <circle cx="82" cy="66" r="13" fill="${inner}" opacity=".72"/>
      <circle cx="174" cy="66" r="13" fill="${inner}" opacity=".72"/>
    `,
    duck: `
      <path d="M80 81 C60 64 59 43 78 31 C94 48 98 69 80 81Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M176 81 C196 64 197 43 178 31 C162 48 158 69 176 81Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4"/>
    `,
    kitten: `
      <path d="M82 74 L58 24 L110 53 Z" fill="${body}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M174 74 L199 25 L148 53 Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M84 60 L70 33 L101 52 Z" fill="${inner}" opacity=".85"/>
      <path d="M172 60 L186 35 L155 52 Z" fill="${inner}" opacity=".85"/>
    `,
    puppy: `
      <path d="M82 74 C52 72 44 111 65 130 C89 111 92 91 82 74Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M174 74 C204 72 212 111 191 130 C167 111 164 91 174 74Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4"/>
    `,
    calico: `
      <path d="M82 74 L58 24 L110 53 Z" fill="${body}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M174 74 L199 25 L148 53 Z" fill="${body}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M84 60 L70 33 L101 52 Z" fill="${inner}" opacity=".85"/>
      <path d="M172 60 L186 35 L155 52 Z" fill="${inner}" opacity=".85"/>
    `,
    lamb: `
      <path d="M85 82 C50 84 48 116 73 126 C88 113 94 96 85 82Z" fill="${accent}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M171 82 C206 84 208 116 183 126 C168 113 162 96 171 82Z" fill="${accent}" stroke="#5b3b34" stroke-width="4"/>
    `,
    panda: `
      <circle cx="82" cy="64" r="25" fill="${accent}" stroke="#5b3b34" stroke-width="4"/>
      <circle cx="174" cy="64" r="25" fill="${accent}" stroke="#5b3b34" stroke-width="4"/>
    `,
    dragon: `
      <path d="M84 78 L72 30 L110 58 Z" fill="${accent}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M172 78 L184 30 L146 58 Z" fill="${accent}" stroke="#5b3b34" stroke-width="4"/>
      <path d="M72 154 C29 121 28 94 61 103 C86 116 91 138 72 154Z" fill="#B7DDB1" stroke="#5b3b34" stroke-width="4" opacity=".96"/>
      <path d="M184 154 C227 121 228 94 195 103 C170 116 165 138 184 154Z" fill="#B7DDB1" stroke="#5b3b34" stroke-width="4" opacity=".96"/>
    `,
  };

  const specialByKind = {
    fox: `
      <path d="M84 101 C94 82 119 80 129 96 C112 96 100 108 84 101Z" fill="${shadow}" opacity=".44"/>
      <path d="M128 138 C116 134 112 123 128 120 C144 123 140 134 128 138Z" fill="#FFF9EF" opacity=".92"/>
    `,
    bunny: `
      <circle cx="95" cy="66" r="10" fill="#FFFDF6" opacity=".55"/>
      <circle cx="161" cy="66" r="10" fill="#FFFDF6" opacity=".55"/>
      <circle cx="190" cy="${bodyY + 26}" r="20" fill="#FFFDF6" stroke="#5b3b34" stroke-width="3"/>
    `,
    bear: `
      <ellipse cx="128" cy="${headY + 30}" rx="28" ry="18" fill="#FFF2D7" opacity=".94"/>
      <ellipse cx="88" cy="${bodyY + 36}" rx="17" ry="21" fill="${accent}" opacity=".45"/>
      <ellipse cx="168" cy="${bodyY + 36}" rx="17" ry="21" fill="${accent}" opacity=".45"/>
    `,
    duck: `
      <path d="M112 ${headY + 20} C124 ${headY + 7} 145 ${headY + 8} 157 ${headY + 20} C146 ${headY + 32} 123 ${headY + 32} 112 ${headY + 20}Z" fill="${accent}" stroke="#5b3b34" stroke-width="3"/>
      <path d="M78 ${bodyY - 3} C38 ${bodyY - 23} 45 ${bodyY + 37} 86 ${bodyY + 30} C75 ${bodyY + 17} 73 ${bodyY + 8} 78 ${bodyY - 3}Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4" opacity=".92"/>
      <path d="M178 ${bodyY - 3} C218 ${bodyY - 23} 211 ${bodyY + 37} 170 ${bodyY + 30} C181 ${bodyY + 17} 183 ${bodyY + 8} 178 ${bodyY - 3}Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4" opacity=".92"/>
    `,
    kitten: `
      <path d="M80 82 C96 58 126 57 130 85 C111 88 99 98 80 82Z" fill="${accent}" opacity=".72"/>
      <path d="M146 92 C166 72 192 83 191 112 C174 107 160 105 146 92Z" fill="${shadow}" opacity=".82"/>
      <path d="M87 119 H70 M89 129 H68 M167 119 H186 M165 129 H188" stroke="#6A4C42" stroke-width="3" stroke-linecap="round" opacity=".68"/>
    `,
    puppy: `
      <path d="M80 105 C86 91 101 88 116 99 C102 104 93 112 80 105Z" fill="${shadow}" opacity=".62"/>
      <path d="M141 104 C154 92 171 94 180 109 C166 112 154 109 141 104Z" fill="${shadow}" opacity=".55"/>
    `,
    calico: `
      <path d="M80 82 C94 58 126 57 130 85 C111 87 100 99 80 82Z" fill="${shadow}" opacity=".86"/>
      <path d="M157 95 C171 78 191 87 190 113 C176 108 166 106 157 95Z" fill="${accent}" opacity=".82"/>
      <path d="M104 168 C123 152 156 155 169 176 C149 182 126 180 104 168Z" fill="${shadow}" opacity=".45"/>
    `,
    lamb: `
      <circle cx="95" cy="61" r="16" fill="#FFFDF6" stroke="#E8D8C0" stroke-width="3"/>
      <circle cx="120" cy="51" r="20" fill="#FFFDF6" stroke="#E8D8C0" stroke-width="3"/>
      <circle cx="145" cy="55" r="18" fill="#FFFDF6" stroke="#E8D8C0" stroke-width="3"/>
      <circle cx="163" cy="73" r="15" fill="#FFFDF6" stroke="#E8D8C0" stroke-width="3"/>
    `,
    panda: `
      <ellipse cx="101" cy="99" rx="24" ry="30" fill="${accent}" opacity=".94"/>
      <ellipse cx="155" cy="99" rx="24" ry="30" fill="${accent}" opacity=".94"/>
      <ellipse cx="94" cy="167" rx="26" ry="41" fill="${accent}" opacity=".92"/>
      <ellipse cx="162" cy="167" rx="26" ry="41" fill="${accent}" opacity=".92"/>
    `,
    dragon: `
      <path d="M126 39 L137 58 L116 58 Z" fill="${inner}" stroke="#5b3b34" stroke-width="3"/>
      <path d="M145 51 L154 68 L136 66 Z" fill="${inner}" stroke="#5b3b34" stroke-width="3"/>
      <path d="M112 51 L102 68 L120 66 Z" fill="${inner}" stroke="#5b3b34" stroke-width="3"/>
      <path d="M179 171 C219 175 230 213 196 227 C187 207 180 190 179 171Z" fill="${accent}" stroke="#5b3b34" stroke-width="4"/>
    `,
  };

  const tailByKind = species.kind === "dragon"
    ? ""
    : species.kind === "duck" || species.kind === "bear" || species.kind === "panda"
      ? ""
      : species.kind === "bunny"
        ? `<circle cx="194" cy="${bodyY + 18}" r="20" fill="#FFFDF6" stroke="#5b3b34" stroke-width="4"/>`
      : `<path d="M183 ${bodyY - 22 + tailLift} C232 ${bodyY - 62 + tailLift} 239 ${bodyY + 18} 190 ${bodyY + 22} C218 ${bodyY - 5} 208 ${bodyY - 26} 183 ${bodyY - 22 + tailLift}Z" fill="${shadow}" stroke="#5b3b34" stroke-width="4"/>`;

  const eyeMarkup = closed
    ? `
      <path d="M96 105 Q109 113 122 105" fill="none" stroke="${eye}" stroke-width="5" stroke-linecap="round"/>
      <path d="M136 105 Q149 113 162 105" fill="none" stroke="${eye}" stroke-width="5" stroke-linecap="round"/>
    `
    : wink
      ? `
        <path d="M95 104 Q108 112 121 104" fill="none" stroke="${eye}" stroke-width="5" stroke-linecap="round"/>
        <circle cx="148" cy="103" r="12" fill="${eye}"/>
        <circle cx="152" cy="99" r="4" fill="#fff"/>
      `
      : `
        <circle cx="106" cy="103" r="12" fill="${eye}"/>
        <circle cx="150" cy="103" r="12" fill="${eye}"/>
        <circle cx="110" cy="99" r="4" fill="#fff"/>
        <circle cx="154" cy="99" r="4" fill="#fff"/>
      `;

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${frameWidth}" height="${frameHeight}" viewBox="0 0 ${frameWidth} ${frameHeight}" aria-label="${label}">
    <defs>
      <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="10" stdDeviation="7" flood-color="#5B3F3F" flood-opacity=".24"/>
      </filter>
      <radialGradient id="bodyGlow" cx="35%" cy="25%" r="70%">
        <stop offset="0" stop-color="#fff" stop-opacity=".68"/>
        <stop offset=".62" stop-color="${body}"/>
        <stop offset="1" stop-color="${shadow}" stop-opacity=".72"/>
      </radialGradient>
    </defs>
    <ellipse cx="128" cy="241" rx="${sleep ? 62 : 72}" ry="${sleep ? 13 : 18}" fill="#3A2A2A" opacity=".15"/>
    <g filter="url(#softShadow)" transform="rotate(${pose.tilt} ${bodyX} ${bodyY}) scale(1 ${scaleY})">
      ${tailByKind}
      <ellipse cx="${bodyX}" cy="${bodyY}" rx="${sleep ? 68 : sit ? 63 : 71}" ry="${sleep ? 43 : sit ? 58 : 64}" fill="url(#bodyGlow)" stroke="#5b3b34" stroke-width="4"/>
      <ellipse cx="${bodyX - 35}" cy="${bodyY + 46 + pose.legA}" rx="20" ry="13" fill="${body}" stroke="#5b3b34" stroke-width="3"/>
      <ellipse cx="${bodyX + 35}" cy="${bodyY + 46 + pose.legB}" rx="20" ry="13" fill="${body}" stroke="#5b3b34" stroke-width="3"/>
      <ellipse cx="${bodyX - 45}" cy="${bodyY + 2 + pose.legB}" rx="16" ry="26" fill="${body}" stroke="#5b3b34" stroke-width="3"/>
      <ellipse cx="${bodyX + 45}" cy="${bodyY + 2 + pose.legA}" rx="16" ry="26" fill="${body}" stroke="#5b3b34" stroke-width="3"/>
      ${specialByKind[species.kind] ?? ""}
      ${earsByKind[species.kind] ?? ""}
      <ellipse cx="${headX}" cy="${headY}" rx="58" ry="${sleep ? 45 : 53}" fill="url(#bodyGlow)" stroke="#5b3b34" stroke-width="4"/>
      <ellipse cx="${headX - 22}" cy="${headY + 21}" rx="16" ry="10" fill="#F6B7BA" opacity=".66"/>
      <ellipse cx="${headX + 22}" cy="${headY + 21}" rx="16" ry="10" fill="#F6B7BA" opacity=".66"/>
      ${eyeMarkup}
      <path d="M121 ${headY + 21} Q128 ${headY + 28} 135 ${headY + 21}" fill="none" stroke="#5b3b34" stroke-width="3" stroke-linecap="round"/>
      <path d="M128 ${headY + 15} c-8 0 -8 9 0 11 c8-2 8-11 0-11Z" fill="#D68E91"/>
      ${happy ? `<text x="178" y="67" font-family="Georgia, serif" font-size="23" fill="#D87E8C">♡</text><text x="197" y="86" font-family="Georgia, serif" font-size="17" fill="#D9A53E">✦</text>` : ""}
      ${closed ? `<text x="168" y="77" font-family="Nunito, Arial" font-size="18" font-weight="900" fill="#8E70BD">Z</text><text x="185" y="59" font-family="Nunito, Arial" font-size="14" font-weight="900" fill="#8E70BD">z</text>` : ""}
    </g>
  </svg>`;
}

await fs.mkdir(petsDir, { recursive: true });

const metadata = await sharp(sheetPath).metadata();
if (metadata.width !== frameWidth * columns || !metadata.height || metadata.height < frameHeight * 5) {
  throw new Error(`Unexpected pet sheet size: ${metadata.width}x${metadata.height}`);
}

const sheetHeight = frameHeight * speciesRows.length;
const originalFoxRow = await sharp(sheetPath)
  .extract({ left: 0, top: 0, width: frameWidth * columns, height: frameHeight })
  .png()
  .toBuffer();
const composites = [{ input: originalFoxRow, left: 0, top: 0 }];

for (let row = 1; row < speciesRows.length; row += 1) {
  const species = speciesRows[row];
  for (let column = 0; column < columns; column += 1) {
    composites.push({
      input: await sharp(Buffer.from(petSvg(species, column))).png().toBuffer(),
      left: column * frameWidth,
      top: row * frameHeight,
    });
  }
}

await sharp({
  create: {
    width: frameWidth * columns,
    height: sheetHeight,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toFile(sheetTempPath);

await fs.rename(sheetTempPath, sheetPath);

for (const [row, species] of speciesRows.entries()) {
  const previewPath = path.join(generatedDir, `pet-art-preview-${species.id}.png`);
  const petPath = path.join(petsDir, `${species.id}.png`);
  const frame = await sharp(sheetPath)
    .extract({ left: 0, top: row * frameHeight, width: frameWidth, height: frameHeight })
    .png()
    .toBuffer();
  await sharp(frame).png().toFile(previewPath);
  await sharp(frame).resize(384, 432, { fit: "contain" }).png().toFile(petPath);
}

console.log(`Generated expanded companion sheet and previews for ${speciesRows.length} species.`);
