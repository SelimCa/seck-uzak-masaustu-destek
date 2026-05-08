const fs = require('node:fs');
const path = require('node:path');
const { Jimp, rgbaToInt } = require('jimp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const ICON_DIR = path.join(__dirname, '../src/assets/icons');
const PNG_PATH = path.join(ICON_DIR, 'app-icon.png');
const ICO_PATH = path.join(ICON_DIR, 'app-icon.ico');
const TRAY_PATH = path.join(ICON_DIR, 'tray-icon.png');

function setPixelSafe(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.bitmap.width || y >= image.bitmap.height) {
    return;
  }

  image.setPixelColor(color, x, y);
}

function drawFilledCircle(image, cx, cy, radius, color) {
  const r2 = radius * radius;
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if ((dx * dx) + (dy * dy) <= r2) {
        setPixelSafe(image, x, y, color);
      }
    }
  }
}

function drawLine(image, x1, y1, x2, y2, thickness, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    const x = x1 + (dx * t);
    const y = y1 + (dy * t);
    drawFilledCircle(image, x, y, thickness / 2, color);
  }
}

function drawRoundedPanel(image, size) {
  const panelRadius = Math.floor(size * 0.22);
  const outer = rgbaToInt(7, 17, 29, 255);
  const inner = rgbaToInt(14, 35, 56, 255);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = x;
      const right = size - 1 - x;
      const top = y;
      const bottom = size - 1 - y;
      const minEdge = Math.min(left, right, top, bottom);

      const cornerX = x < panelRadius ? panelRadius : (x >= size - panelRadius ? size - panelRadius - 1 : x);
      const cornerY = y < panelRadius ? panelRadius : (y >= size - panelRadius ? size - panelRadius - 1 : y);
      const cx = x - cornerX;
      const cy = y - cornerY;
      const inCorner = (cx * cx) + (cy * cy) <= (panelRadius * panelRadius);

      if (!inCorner && (x < panelRadius || x >= size - panelRadius || y < panelRadius || y >= size - panelRadius)) {
        continue;
      }

      const shade = Math.max(0, Math.min(1, y / size));
      const r = Math.round(14 + (24 * (1 - shade)));
      const g = Math.round(35 + (28 * (1 - shade)));
      const b = Math.round(56 + (34 * (1 - shade)));
      const gradientColor = rgbaToInt(r, g, b, 255);

      if (minEdge < 8) {
        setPixelSafe(image, x, y, outer);
      }
      else {
        setPixelSafe(image, x, y, gradientColor || inner);
      }
    }
  }
}

async function main() {
  fs.mkdirSync(ICON_DIR, { recursive: true });

  const size = 512;
  const image = await new Jimp({ width: size, height: size, color: 0x00000000 });

  drawRoundedPanel(image, size);

  const coreFill = rgbaToInt(246, 252, 255, 255);
  const lineColor = rgbaToInt(220, 243, 255, 255);
  const accent = rgbaToInt(44, 208, 255, 255);

  const nodes = [
    { x: 138, y: 162, r: 30 },
    { x: 360, y: 120, r: 22 },
    { x: 388, y: 308, r: 26 },
    { x: 250, y: 392, r: 24 },
    { x: 126, y: 286, r: 20 },
  ];

  drawLine(image, nodes[0].x, nodes[0].y, nodes[1].x, nodes[1].y, 16, lineColor);
  drawLine(image, nodes[1].x, nodes[1].y, nodes[2].x, nodes[2].y, 16, lineColor);
  drawLine(image, nodes[0].x, nodes[0].y, nodes[4].x, nodes[4].y, 16, lineColor);
  drawLine(image, nodes[4].x, nodes[4].y, nodes[3].x, nodes[3].y, 16, lineColor);
  drawLine(image, nodes[3].x, nodes[3].y, nodes[2].x, nodes[2].y, 16, lineColor);

  nodes.forEach((node, index) => {
    drawFilledCircle(image, node.x, node.y, node.r, coreFill);
    drawFilledCircle(image, node.x, node.y, Math.max(6, Math.floor(node.r * 0.4)), index % 2 === 0 ? accent : rgbaToInt(9, 22, 38, 255));
  });

  await image.write(PNG_PATH);

  const tray = image.clone().resize({ w: 32, h: 32 });
  await tray.write(TRAY_PATH);

  const icoBuffer = await pngToIco(PNG_PATH);
  fs.writeFileSync(ICO_PATH, icoBuffer);

  process.stdout.write(`Generated: ${PNG_PATH}\nGenerated: ${ICO_PATH}\nGenerated: ${TRAY_PATH}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
