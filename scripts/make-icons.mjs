// Generates public/icons/icon-{16,32,48,128}.png with no dependencies (zlib + hand-rolled PNG).
// Design: charcoal rounded square with three stacked tab cards, the front one in cobalt.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// Signed distance to a rounded rectangle (x0,y0)-(x1,y1) with radius r.
function roundRect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return Math.hypot(px - cx, py - cy) - r;
}

const layers = [
  // [x0, y0, x1, y1, radius, rgba] in a 0..1 unit square
  { rect: [0.04, 0.04, 0.96, 0.96, 0.22], color: [30, 32, 38, 255] },
  { rect: [0.3, 0.2, 0.8, 0.5, 0.07], color: [92, 98, 112, 255] },
  { rect: [0.24, 0.32, 0.76, 0.64, 0.07], color: [150, 156, 170, 255] },
  { rect: [0.18, 0.44, 0.82, 0.8, 0.08], color: [58, 108, 240, 255] },
  { rect: [0.27, 0.57, 0.6, 0.64, 0.035], color: [235, 240, 255, 235] },
];

function render(size) {
  const ss = 4; // supersampling
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const { rect, color } of layers) {
            const [x0, y0, x1, y1, rad] = rect;
            if (roundRect(u, v, x0, y0, x1, y1, rad) <= 0) {
              const la = color[3] / 255;
              cr = color[0] * la + cr * (1 - la);
              cg = color[1] * la + cg * (1 - la);
              cb = color[2] * la + cb * (1 - la);
              ca = la + ca * (1 - la);
            }
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      px[i] = alpha ? Math.round(r / n / alpha) : 0;
      px[i + 1] = alpha ? Math.round(g / n / alpha) : 0;
      px[i + 2] = alpha ? Math.round(b / n / alpha) : 0;
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(out, `icon-${size}.png`), render(size));
  console.log(`icon-${size}.png`);
}
