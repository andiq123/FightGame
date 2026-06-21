// Dependency-free PWA icon generator. Rasterises a clean stick-defender mark on a
// dark gradient into a 1024² PNG (then sips downsizes it to 512/192/180). Run:
//   node tools/make-icons.mjs   (then the sips resizes in the npm script / shell)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 1024;
const buf = new Uint8ClampedArray(S * S * 4);

function setPx(x, y, r, g, b, a = 1) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const ia = 1 - a;
  buf[i]   = buf[i]   * ia + r * a;
  buf[i+1] = buf[i+1] * ia + g * a;
  buf[i+2] = buf[i+2] * ia + b * a;
  buf[i+3] = Math.max(buf[i+3], a * 255);
}

// Soft-edged disc (a little anti-aliasing via the 1px falloff).
function disc(cx, cy, rad, [r, g, b], a = 1) {
  const r0 = Math.floor(cx - rad - 1), r1 = Math.ceil(cx + rad + 1);
  const c0 = Math.floor(cy - rad - 1), c1 = Math.ceil(cy + rad + 1);
  for (let y = c0; y <= c1; y++) for (let x = r0; x <= r1; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const edge = Math.min(1, Math.max(0, rad + 0.6 - d));
    if (edge > 0) setPx(x, y, r, g, b, edge * a);
  }
}

// Capsule (thick rounded line) = many discs stamped along the segment.
function capsule(x0, y0, x1, y1, w, color, a = 1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, color, a);
  }
}

// Background: subtle vertical gradient (matches the app theme).
for (let y = 0; y < S; y++) {
  const t = y / S;
  const r = Math.round(17 + (11 - 17) * t);
  const g = Math.round(22 + (14 - 22) * t);
  const b = Math.round(31 + (20 - 31) * t);
  for (let x = 0; x < S; x++) { const i = (y * S + x) * 4; buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = 255; }
}

// Stick-defender mark, kept inside the maskable safe zone (centred, ~62%).
const cx = 512, cyan = [40, 214, 200], glow = [40, 214, 200];
capsule(cx, 250, cx, 250, 0, glow); // (noop placeholder to keep ordering clear)
// faint glow underlay
disc(cx, 330, 92, glow, 0.18);
capsule(cx, 392, cx, 642, 70, glow, 0.16);
// head
disc(cx, 330, 74, cyan);
// torso
capsule(cx, 392, cx, 632, 50, cyan);
// arms (a confident outward stance)
capsule(cx, 438, cx - 120, 372, 40, cyan); // raised left arm
capsule(cx, 438, cx + 126, 520, 40, cyan); // right arm forward
// legs
capsule(cx, 632, cx - 96, 786, 44, cyan);
capsule(cx, 632, cx + 96, 786, 44, cyan);

// ── PNG encode (truecolor+alpha, single IDAT) ──
function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
// filtered raw scanlines (filter byte 0 per row)
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S * 4; x++) raw[y * (S * 4 + 1) + 1 + x] = buf[y * S * 4 + x];
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../icon-1024.png', import.meta.url), png);
console.log('wrote icon-1024.png');
