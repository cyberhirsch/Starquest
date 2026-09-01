// Generates the PWA / home-screen icons by rendering the game's own ship mesh
// with the same glow falloff the real renderer uses. Zero dependencies.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { MODELS } from '../src/render/models.js';

/* ------------------------------------------------------------------ png -- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* --------------------------------------------------------------- raster -- */
function rotate(v, yaw, pitch) {
  const [x, y, z] = v;
  const x1 = x * Math.cos(yaw) - z * Math.sin(yaw);
  const z1 = x * Math.sin(yaw) + z * Math.cos(yaw);
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return [x1, y2, z2];
}

function render(size, { pad = 0.16, model = MODELS.corsair, yaw = -0.9, pitch = 0.55 } = {}) {
  const acc = new Float32Array(size * size * 3);
  const n = model.verts.length / 3;
  const pts = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = rotate([model.verts[i * 3], model.verts[i * 3 + 1], model.verts[i * 3 + 2]], yaw, pitch);
    pts.push(p);
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
  }
  // fit the projected silhouette, not the raw model origin
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const scale = (size * (1 - pad * 2)) / Math.max(x1 - x0, y1 - y0);
  const cx = size / 2, cy = size / 2;
  const sp = pts.map((p) => [cx + (p[0] - mx) * scale, cy - (p[1] - my) * scale]);

  const thick = Math.max(1.2, size * 0.011);
  const glowW = thick * 4.5;
  const col = [0.35, 1.0, 0.62];

  for (let e = 0; e < model.edges.length; e += 2) {
    const a = sp[model.edges[e]], b = sp[model.edges[e + 1]];
    const minx = Math.max(0, Math.floor(Math.min(a[0], b[0]) - glowW));
    const maxx = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0]) + glowW));
    const miny = Math.max(0, Math.floor(Math.min(a[1], b[1]) - glowW));
    const maxy = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1]) + glowW));
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
        const d = Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
        const r = d / (thick * 0.5);
        const core = Math.exp(-r * r * 2.2);
        const halo = Math.exp(-r * 1.35) * 0.30;
        const i = (y * size + x) * 3;
        const white = Math.pow(core, 3) * 0.55;
        acc[i] += col[0] * (core + halo) + white;
        acc[i + 1] += col[1] * (core + halo) + white;
        acc[i + 2] += col[2] * (core + halo) + white;
      }
    }
  }

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3, o = (y * size + x) * 4;
      const dx = (x / size - 0.5), dy = (y / size - 0.5);
      const vig = 1 - Math.min(1, Math.hypot(dx, dy) * 1.5);
      const scan = 0.9 + 0.1 * Math.sin((y / size) * Math.PI * size * 0.5);
      for (let c = 0; c < 3; c++) {
        const bg = [0.006, 0.028, 0.020][c] * vig;
        const v = 1 - Math.exp(-(acc[i + c] + bg) * 1.25);
        out[o + c] = Math.round(Math.max(0, Math.min(1, Math.pow(v, 0.85) * scan)) * 255);
      }
      out[o + 3] = 255;
    }
  }
  return png(size, size, out);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const write = (name, buf) => {
  writeFileSync(new URL(`../icons/${name}`, import.meta.url), buf);
  console.log(`icons/${name}  ${(buf.length / 1024).toFixed(1)} kB`);
};

write('icon-192.png', render(192));
write('icon-512.png', render(512));
write('icon-1024.png', render(1024));
write('icon-maskable-512.png', render(512, { pad: 0.26 }));   // safe zone for adaptive masks
write('apple-touch-icon.png', render(180, { pad: 0.14 }));
write('favicon-32.png', render(32, { pad: 0.1 }));
