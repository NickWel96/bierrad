/** Original vector-style icons, rasterized deterministically without dependencies. */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const destination = new URL("../docs/slack-emoji/", import.meta.url);
await mkdir(destination, { recursive: true });
const size = 128, samples = 4;
// Original geometry and highlights inspired by the owner's Slack :star: reference.
// Soft tips, yellow body and pale bevels; no contrasting outline on the filled part.
const points = [
  [64, 7], [85, 43], [119, 44], [94, 80], [101, 119],
  [64, 102], [27, 119], [33, 80], [9, 44], [44, 43],
];
const highlights = [
  [[64, 16], [60, 37], [67, 47], [73, 46]],
  [[109, 51], [94, 57], [85, 72], [93, 68]],
];
const bevels = [
  [[64, 7], [85, 43], [80, 48], [65, 19]],
  [[94, 80], [101, 119], [93, 112], [87, 83]],
];
const left = Math.min(...points.map(([x]) => x));
const right = Math.max(...points.map(([x]) => x));
function inside(x, y, polygon = points) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function edgeDistance(x, y) {
  return Math.min(...points.map(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    const dx = bx - ax, dy = by - ay;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  }));
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}
const pngHeader = Buffer.alloc(13);
pngHeader.writeUInt32BE(size, 0);
pngHeader.writeUInt32BE(size, 4);
pngHeader[8] = 8;
pngHeader[9] = 6; // RGBA
for (let tenth = 0; tenth <= 9; tenth++) {
  const cutoff = left + (right - left) * tenth / 10;
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let alpha = 0;
    const rgb = [0, 0, 0];
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const px = x + (sx + 0.5) / samples, py = y + (sy + 0.5) / samples;
      const stroke = edgeDistance(px, py) <= 2;
      if (!stroke && !inside(px, py)) continue;
      const filled = tenth > 0 && px < cutoff;
      const highlight = highlights.some((shape) => inside(px, py, shape));
      const bevel = bevels.some((shape) => inside(px, py, shape));
      const color = filled
        ? highlight ? [255, 249, 182] : bevel ? [255, 234, 108] : [255, 221, 48]
        : highlight ? [250, 251, 252] : stroke ? [135, 144, 155] : [217, 222, 230];
      alpha++;
      color.forEach((c, i) => { rgb[i] += c; });
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    rgb.forEach((c, i) => { raw[offset + i] = alpha ? Math.round(c / alpha) : 0; });
    raw[offset + 3] = Math.round(255 * alpha / (samples * samples));
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", pngHeader), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
  const name = tenth === 0 ? "bierrad_star_empty" : `bierrad_star_${tenth}`;
  await writeFile(new URL(`${name}.png`, destination), png);
}
console.log(`10 transparent 128×128 PNGs saved to ${fileURLToPath(destination)}`);
