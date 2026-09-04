// Low-poly hulls. Every model is vertices + an edge list; the renderer only
// ever draws edges, so these are built as wireframe silhouettes.

class MeshBuilder {
  constructor() { this.v = []; this.e = []; this.set = new Set(); }
  vert(x, y, z) { this.v.push(x, y, z); return this.v.length / 3 - 1; }
  edge(a, b) {
    if (a === b) return;
    const k = a < b ? a * 65536 + b : b * 65536 + a;
    if (this.set.has(k)) return;
    this.set.add(k); this.e.push(a, b);
  }
  loop(idx) { for (let i = 0; i < idx.length; i++) this.edge(idx[i], idx[(i + 1) % idx.length]); }
  chain(idx) { for (let i = 0; i < idx.length - 1; i++) this.edge(idx[i], idx[i + 1]); }
  /** Elliptical ring of `sides` verts on the XY plane at depth z. */
  ring(z, w, h, yOff = 0, sides = 4, phase = 0) {
    const idx = [];
    for (let i = 0; i < sides; i++) {
      const a = phase + (i / sides) * Math.PI * 2;
      idx.push(this.vert(Math.cos(a) * w, Math.sin(a) * h + yOff, z));
    }
    this.loop(idx);
    return idx;
  }
  connect(a, b) { for (let i = 0; i < a.length; i++) this.edge(a[i], b[i % b.length]); }
  fan(p, ring) { for (const i of ring) this.edge(p, i); }
  face(pts) {
    const idx = pts.map((p) => this.vert(p[0], p[1], p[2]));
    this.loop(idx);
    return idx;
  }
  mirrorX() {
    // duplicate every vert/edge mirrored across X (built parts must be one side)
    const n = this.v.length / 3, base = n;
    for (let i = 0; i < n; i++) this.vert(-this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]);
    const m = this.e.length;
    for (let i = 0; i < m; i += 2) this.edge(this.e[i] + base, this.e[i + 1] + base);
    return this;
  }
  build() {
    let r = 0;
    for (let i = 0; i < this.v.length; i += 3) {
      r = Math.max(r, Math.hypot(this.v[i], this.v[i + 1], this.v[i + 2]));
    }
    return {
      verts: new Float32Array(this.v),
      edges: new Uint16Array(this.e),
      radius: r,
      edgeCount: this.e.length / 2,
    };
  }
}

export const mb = () => new MeshBuilder();

/** Hull from a spine of [z, halfWidth, halfHeight, yOffset] sections. */
function hull(sections, sides = 4, phase = Math.PI / 4) {
  const b = mb();
  let prev = null;
  for (const [z, w, h, y = 0] of sections) {
    let cur;
    if (w <= 0 && h <= 0) cur = [b.vert(0, y, z)];
    else cur = b.ring(z, w, h, y, sides, phase);
    if (prev) {
      if (prev.length === 1) b.fan(prev[0], cur);
      else if (cur.length === 1) b.fan(cur[0], prev);
      else b.connect(prev, cur);
    }
    prev = cur;
  }
  return b;
}

/* ------------------------------------------------------------------ ships */

function shuttle() {
  const b = hull([[-3.4, 0, 0], [-1.6, 0.85, 0.6], [0.6, 1.05, 0.8], [2.4, 0.75, 0.6], [3.0, 0.35, 0.3]]);
  // stub wings + fin
  const wr = [b.vert(1.0, 0.1, 0.4), b.vert(2.9, -0.1, 2.2), b.vert(1.0, -0.1, 2.4)];
  b.loop(wr);
  const wl = [b.vert(-1.0, 0.1, 0.4), b.vert(-2.9, -0.1, 2.2), b.vert(-1.0, -0.1, 2.4)];
  b.loop(wl);
  b.loop([b.vert(0, 0.8, 1.0), b.vert(0, 2.0, 2.4), b.vert(0, 0.6, 2.6)]);
  return b.build();
}

function prospector() {
  const b = hull([[-4.2, 0, 0], [-3.0, 0.6, 0.6], [-1.0, 1.3, 1.1], [2.2, 1.5, 1.3], [3.6, 1.1, 1.0]], 6);
  // mining rig arms
  for (const s of [1, -1]) {
    const a = b.vert(s * 1.4, 0.2, -1.2), c = b.vert(s * 2.6, 0.0, -3.0), d = b.vert(s * 2.6, 0.0, -1.6);
    b.loop([a, c, d]);
    const e = b.vert(s * 1.5, -0.6, 2.0), f = b.vert(s * 2.4, -0.6, 3.4), g = b.vert(s * 1.2, -0.6, 3.4);
    b.loop([e, f, g]);
  }
  // ore hopper
  const t = b.ring(1.0, 1.1, 0.7, 1.7, 4), u = b.ring(3.0, 0.9, 0.6, 1.7, 4);
  b.connect(t, u);
  return b.build();
}

function corsair() {
  const b = hull([[-5.0, 0, 0], [-3.4, 0.55, 0.45], [-0.6, 1.15, 0.85], [2.0, 1.0, 0.8], [3.4, 0.5, 0.45]]);
  for (const s of [1, -1]) {
    const a = b.vert(s * 0.9, 0.0, -1.0);
    const c = b.vert(s * 3.8, -0.2, 1.4);
    const d = b.vert(s * 3.4, -0.2, 3.2);
    const e = b.vert(s * 0.9, 0.0, 2.6);
    b.loop([a, c, d, e]);
    // engine pod
    const p1 = b.ring(1.6, 0.42, 0.42, 0, 4), p2 = b.ring(3.6, 0.34, 0.34, 0, 4);
    for (const i of p1) b.v[i * 3] += s * 2.4;
    for (const i of p2) b.v[i * 3] += s * 2.4;
    b.connect(p1, p2);
  }
  b.loop([b.vert(0, 0.7, 0.6), b.vert(0, 2.2, 2.8), b.vert(0, 0.5, 3.0)]);
  return b.build();
}

function hauler() {
  const b = hull([[-7.0, 0, 0], [-5.4, 1.2, 1.2], [-3.0, 2.2, 2.0], [4.0, 2.4, 2.2], [6.0, 1.6, 1.6], [7.0, 0.8, 0.8]], 6);
  // container racks
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const z = -1.5 + i * 2.4;
      const r1 = b.ring(z, 0.9, 0.9, 0, 4), r2 = b.ring(z + 1.9, 0.9, 0.9, 0, 4);
      for (const k of r1) b.v[k * 3] += s * 3.4;
      for (const k of r2) b.v[k * 3] += s * 3.4;
      b.connect(r1, r2);
      b.edge(r1[0], r1[2]);
    }
  }
  const e1 = b.ring(6.2, 1.0, 1.0, 0, 6), e2 = b.ring(7.6, 0.7, 0.7, 0, 6);
  b.connect(e1, e2);
  return b.build();
}

function bastion() {
  const b = hull([[-11, 0, 0], [-8.5, 1.6, 1.2], [-5, 3.0, 2.2], [3, 3.8, 2.8], [7, 3.2, 2.4], [9.5, 1.8, 1.4]], 6);
  for (const s of [1, -1]) {
    const a = b.vert(s * 2.6, 0.4, -4.0), c = b.vert(s * 6.4, 0.2, 0.5),
      d = b.vert(s * 6.0, 0.2, 5.0), e = b.vert(s * 2.6, 0.4, 5.5);
    b.loop([a, c, d, e]);
    const p1 = b.ring(4.0, 0.9, 0.9, 0, 4), p2 = b.ring(8.5, 0.7, 0.7, 0, 4);
    for (const i of p1) b.v[i * 3] += s * 5.2;
    for (const i of p2) b.v[i * 3] += s * 5.2;
    b.connect(p1, p2);
  }
  // dorsal spine + towers
  b.loop([b.vert(0, 2.6, -3.0), b.vert(0, 5.2, 1.0), b.vert(0, 2.6, 4.0)]);
  const t1 = b.ring(-1.0, 1.2, 1.2, 4.2, 4), t2 = b.ring(1.4, 1.0, 1.0, 4.2, 4);
  b.connect(t1, t2);
  return b.build();
}

function marauder() { // pirate raider — asymmetric, spiky
  const b = hull([[-5.6, 0, 0], [-3.6, 0.7, 0.5], [-0.4, 1.4, 0.9], [2.6, 1.1, 0.8], [3.8, 0.4, 0.4]]);
  for (const s of [1, -1]) {
    const a = b.vert(s * 1.1, 0.2, -0.6), c = b.vert(s * 4.6, 0.6, 2.0),
      d = b.vert(s * 2.2, -0.6, 3.4), e = b.vert(s * 0.9, 0.0, 2.8);
    b.loop([a, c, d, e]);
    b.edge(a, d);
  }
  b.loop([b.vert(0, 1.0, -1.0), b.vert(0, 2.6, 1.6), b.vert(0, 0.6, 2.4)]);
  b.loop([b.vert(0, -1.0, -1.0), b.vert(0, -2.4, 1.6), b.vert(0, -0.6, 2.4)]);
  return b.build();
}

function sentinel() { // security interceptor — clean, symmetric, cross-winged
  const b = hull([[-4.6, 0, 0], [-2.8, 0.6, 0.6], [0.4, 1.2, 1.0], [2.8, 0.9, 0.8], [3.6, 0.4, 0.4]], 6);
  for (const [ax, ay] of [[1, 0.35], [-1, 0.35], [0.35, 1], [-0.35, 1]]) {
    const a = b.vert(ax * 1.0, ay * 1.0, 0.2);
    const c = b.vert(ax * 3.6, ay * 3.6, 2.0);
    const d = b.vert(ax * 1.0, ay * 1.0, 3.0);
    b.loop([a, c, d]);
  }
  return b.build();
}

/* --------------------------------------------------------------- station */

function station() {
  const b = mb();
  // core spindle
  const core = [];
  for (const [z, r] of [[-26, 0], [-18, 5], [0, 7], [18, 5], [26, 0]]) {
    core.push(r <= 0 ? [b.vert(0, 0, z)] : b.ring(z, r, r, 0, 6));
  }
  for (let i = 1; i < core.length; i++) {
    if (core[i - 1].length === 1) b.fan(core[i - 1][0], core[i]);
    else if (core[i].length === 1) b.fan(core[i][0], core[i - 1]);
    else b.connect(core[i - 1], core[i]);
  }
  // habitation ring (two octagons + rim)
  const inner = [], outer = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    inner.push(b.vert(Math.cos(a) * 20, Math.sin(a) * 20, -3));
    outer.push(b.vert(Math.cos(a) * 20, Math.sin(a) * 20, 3));
  }
  b.loop(inner); b.loop(outer); b.connect(inner, outer);
  // spokes
  for (let i = 0; i < N; i += 2) {
    const a = (i / N) * Math.PI * 2;
    const h1 = b.vert(Math.cos(a) * 7, Math.sin(a) * 7, 0);
    b.edge(h1, inner[i]); b.edge(h1, outer[i]);
  }
  // docking bay mouth at -Z end of the core
  const m1 = b.ring(-24, 3.4, 3.4, 0, 8), m2 = b.ring(-19, 4.2, 4.2, 0, 8);
  b.connect(m1, m2);
  // antenna masts
  for (const s of [1, -1]) {
    b.chain([b.vert(0, s * 7, 4), b.vert(0, s * 13, 10), b.vert(0, s * 13, 14)]);
  }
  return b.build();
}

/**
 * Tallow Yard: a dead freighter with a dock cut into its flank and scaffolding
 * bolted on. The Depot's ring says "licensed and maintained"; this has to say
 * "somebody moved into a wreck", or the second sector is the first one with
 * different numbers.
 */
function yard() {
  const b = mb();
  // the hull of the freighter that used to be here — a long broken box
  const front = b.ring(-30, 9, 6, 0, 6);
  const mid1 = b.ring(-8, 11, 8, 0, 6);
  const mid2 = b.ring(10, 10, 7, 0, 6);
  const stern = b.ring(26, 6, 5, 0, 6);
  b.connect(front, mid1); b.connect(mid1, mid2); b.connect(mid2, stern);
  // the spine is snapped: a gap and a bent strut where it gave way
  b.chain([b.vert(0, 9, -4), b.vert(2, 15, 2), b.vert(-1, 13, 9)]);
  // dock cut into the flank, lit and squared off — the one maintained part
  const lip = [];
  for (const [x, y, z] of [[-12, -2, -14], [-12, 5, -14], [-12, 5, 4], [-12, -2, 4]]) {
    lip.push(b.vert(x, y, z));
  }
  b.loop(lip);
  const deep = lip.map((_, i) => {
    const p = [[-5, -2, -14], [-5, 5, -14], [-5, 5, 4], [-5, -2, 4]][i];
    return b.vert(p[0], p[1], p[2]);
  });
  b.loop(deep); b.connect(lip, deep);
  // scaffolding and cargo booms clamped to the outside
  for (const [z, s] of [[-20, 1], [-2, -1], [16, 1]]) {
    const a1 = b.vert(0, s * 11, z);
    const a2 = b.vert(s * 6, s * 19, z + 3);
    const a3 = b.vert(s * 14, s * 19, z - 2);
    b.chain([a1, a2, a3]);
    b.edge(a2, b.vert(s * 6, s * 19, z - 8));
  }
  return b.build();
}

/* --------------------------------------------------------- misc geometry */

function icosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { raw, faces };
}

const OCTA = {
  raw: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  faces: [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]],
};

/** Deterministic small PRNG so asteroid shapes are stable per seed. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function makeAsteroid(seed, detail = 1) {
  const src = detail > 0 ? icosahedron() : OCTA;
  const r = rng(seed);
  const b = mb();
  for (const p of src.raw) {
    const l = Math.hypot(p[0], p[1], p[2]);
    const k = (0.62 + r() * 0.55) / l;
    b.vert(p[0] * k, p[1] * k * (0.8 + r() * 0.4), p[2] * k);
  }
  for (const f of src.faces) { b.edge(f[0], f[1]); b.edge(f[1], f[2]); b.edge(f[2], f[0]); }
  return b.build();
}

function sphereWire(rings = 5, segs = 10) {
  const b = mb();
  const rows = [];
  for (let i = 1; i < rings; i++) {
    const phi = (i / rings) * Math.PI;
    const y = Math.cos(phi), r = Math.sin(phi);
    const row = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      row.push(b.vert(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    b.loop(row); rows.push(row);
  }
  const top = b.vert(0, 1, 0), bot = b.vert(0, -1, 0);
  for (let i = 0; i < rows.length - 1; i++) b.connect(rows[i], rows[i + 1]);
  for (let j = 0; j < segs; j += 2) { b.edge(top, rows[0][j]); b.edge(bot, rows[rows.length - 1][j]); }
  return b.build();
}

/** Jump gate: a ring you fly through, big enough to see from a long way off. */
function gate() {
  const b = mb();
  const N = 12;
  const inner = [], outer = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    inner.push(b.vert(Math.cos(a) * 8, Math.sin(a) * 8, 0));
    outer.push(b.vert(Math.cos(a) * 10, Math.sin(a) * 10, 0));
  }
  b.loop(inner); b.loop(outer); b.connect(inner, outer);
  // depth ring, so it reads as a throat rather than a flat hoop
  const back = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    back.push(b.vert(Math.cos(a) * 9, Math.sin(a) * 9, -2.4));
  }
  b.loop(back);
  for (let i = 0; i < N; i += 2) b.edge(outer[i], back[i]);
  // pylons
  for (let i = 0; i < N; i += 3) {
    const a = (i / N) * Math.PI * 2;
    const tip = b.vert(Math.cos(a) * 13.5, Math.sin(a) * 13.5, -1.2);
    b.edge(outer[i], tip);
    b.edge(back[i], tip);
  }
  return b.build();
}

function pod() {
  const b = mb();
  const a = b.ring(-1.0, 0.7, 0.7, 0, 4), c = b.ring(1.0, 0.7, 0.7, 0, 4);
  b.connect(a, c);
  b.edge(a[0], c[2]); b.edge(a[1], c[3]);
  return b.build();
}

function missile() {
  return hull([[-1.2, 0, 0], [-0.5, 0.16, 0.16], [0.8, 0.16, 0.16], [1.1, 0.08, 0.08]], 4).build();
}

function buoy() {
  const b = mb();
  const a = b.ring(-1.2, 0.6, 0.6, 0, 3), c = b.ring(1.2, 0.6, 0.6, 0, 3);
  b.connect(a, c);
  b.chain([b.vert(0, 1.6, 0), b.vert(0, 3.2, 0)]);
  return b.build();
}

export const MODELS = {
  shuttle: shuttle(),
  prospector: prospector(),
  corsair: corsair(),
  hauler: hauler(),
  bastion: bastion(),
  marauder: marauder(),
  sentinel: sentinel(),
  station: station(),
  yard: yard(),
  pod: pod(),
  gate: gate(),
  missile: missile(),
  buoy: buoy(),
  planet: sphereWire(6, 12),
};

/** Shared pool of asteroid shapes — cheaper than a mesh per rock. */
export const ASTEROID_SHAPES = Array.from({ length: 12 }, (_, i) => makeAsteroid(i * 7919 + 13, 1));
export const ASTEROID_SHAPES_LOW = Array.from({ length: 6 }, (_, i) => makeAsteroid(i * 104729 + 3, 0));
