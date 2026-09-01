// Line batch: everything the game draws ends up here as glowing segments.
// 16 floats per instance -> [ax,ay,az,mode][bx,by,bz,thickness][r,g,b,a][glow,_,_,_]

import { qrot } from '../core/math.js';

export const STRIDE = 16;

export class LineBatch {
  constructor(capacity = 60000) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    this.count = 0;
    this._v = new Float32Array(3 * 512);   // scratch for transformed verts
    this._q = [0, 0, 0, 1];
    this._p = [0, 0, 0];
  }

  reset() { this.count = 0; }

  get byteLength() { return this.count * STRIDE * 4; }

  _slot() {
    if (this.count >= this.capacity) return -1;
    return this.count++ * STRIDE;
  }

  /** World-space segment. */
  line3(ax, ay, az, bx, by, bz, col, thick = 1.6, alpha = 1, glow = 1) {
    const i = this._slot();
    if (i < 0) return;
    const d = this.data;
    d[i] = ax; d[i + 1] = ay; d[i + 2] = az; d[i + 3] = 0;
    d[i + 4] = bx; d[i + 5] = by; d[i + 6] = bz; d[i + 7] = thick;
    d[i + 8] = col[0]; d[i + 9] = col[1]; d[i + 10] = col[2]; d[i + 11] = alpha;
    d[i + 12] = glow; d[i + 13] = 0; d[i + 14] = 0; d[i + 15] = 0;
  }

  line3v(a, b, col, thick, alpha, glow) {
    this.line3(a[0], a[1], a[2], b[0], b[1], b[2], col, thick, alpha, glow);
  }

  /** Screen-space segment, in CSS-independent device pixels. */
  line2(ax, ay, bx, by, col, thick = 1.6, alpha = 1, glow = 1) {
    const i = this._slot();
    if (i < 0) return;
    const d = this.data;
    d[i] = ax; d[i + 1] = ay; d[i + 2] = 0; d[i + 3] = 1;
    d[i + 4] = bx; d[i + 5] = by; d[i + 6] = 0; d[i + 7] = thick;
    d[i + 8] = col[0]; d[i + 9] = col[1]; d[i + 10] = col[2]; d[i + 11] = alpha;
    d[i + 12] = glow; d[i + 13] = 0; d[i + 14] = 0; d[i + 15] = 0;
  }

  /** Low-poly model with position / orientation / uniform scale. */
  mesh(model, pos, quat, scale, col, thick = 1.6, alpha = 1, glow = 1) {
    const verts = model.verts, edges = model.edges;
    const n = verts.length / 3;
    if (this._v.length < n * 3) this._v = new Float32Array(n * 3);
    const out = this._v, p = this._p;
    for (let i = 0; i < n; i++) {
      p[0] = verts[i * 3] * scale; p[1] = verts[i * 3 + 1] * scale; p[2] = verts[i * 3 + 2] * scale;
      qrot(p, quat, p);
      out[i * 3] = p[0] + pos[0]; out[i * 3 + 1] = p[1] + pos[1]; out[i * 3 + 2] = p[2] + pos[2];
    }
    for (let e = 0; e < edges.length; e += 2) {
      const a = edges[e] * 3, b = edges[e + 1] * 3;
      this.line3(out[a], out[a + 1], out[a + 2], out[b], out[b + 1], out[b + 2],
        col, thick, alpha, glow);
    }
  }

  /** Screen-space circle. */
  circle2(cx, cy, r, col, thick = 1.5, alpha = 1, glow = 1, segs = 28, from = 0, to = Math.PI * 2) {
    let px = cx + Math.cos(from) * r, py = cy + Math.sin(from) * r;
    for (let i = 1; i <= segs; i++) {
      const a = from + (to - from) * (i / segs);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      this.line2(px, py, x, y, col, thick, alpha, glow);
      px = x; py = y;
    }
  }

  rect2(x, y, w, h, col, thick = 1.5, alpha = 1, glow = 1) {
    this.line2(x, y, x + w, y, col, thick, alpha, glow);
    this.line2(x + w, y, x + w, y + h, col, thick, alpha, glow);
    this.line2(x + w, y + h, x, y + h, col, thick, alpha, glow);
    this.line2(x, y + h, x, y, col, thick, alpha, glow);
  }

  /** Corner brackets — the classic vector-HUD target box. */
  bracket2(x, y, w, h, col, thick = 1.6, alpha = 1, glow = 1, frac = 0.28) {
    const cw = w * frac, ch = h * frac;
    const L = x - w / 2, R = x + w / 2, T = y - h / 2, B = y + h / 2;
    this.line2(L, T, L + cw, T, col, thick, alpha, glow);
    this.line2(L, T, L, T + ch, col, thick, alpha, glow);
    this.line2(R, T, R - cw, T, col, thick, alpha, glow);
    this.line2(R, T, R, T + ch, col, thick, alpha, glow);
    this.line2(L, B, L + cw, B, col, thick, alpha, glow);
    this.line2(L, B, L, B - ch, col, thick, alpha, glow);
    this.line2(R, B, R - cw, B, col, thick, alpha, glow);
    this.line2(R, B, R, B - ch, col, thick, alpha, glow);
  }
}
