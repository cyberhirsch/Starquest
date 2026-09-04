// Turns the world into line segments.

import {
  v3, vcopy, vset, vadd, vsub, vscale, vaddScaled, vdot, vlen, vnorm, vdist, vdist2,
  qforward, qright, qup, qrot, clamp, lerp, vrandSphere,
} from '../core/math.js';
import { C, ORE_COLORS } from './palette.js';
import { MODELS } from './models.js';
import { MODULES } from '../game/data.js';
import { SECTOR_R } from '../game/world.js';

let DRAW_DIST = 4200;
let STAR_STEP = 1;

/** Trims draw distance and starfield density on weaker hardware. */
export function setQuality(q) {
  DRAW_DIST = q < 0.75 ? 2600 : q < 0.95 ? 3400 : 4200;
  STAR_STEP = q < 0.75 ? 3 : q < 0.95 ? 2 : 1;
}
const _a = v3(), _b = v3(), _c = v3(), _d = v3(), _e = v3(), _f = v3();

/**
 * Skies are built per sector from the seed in its definition, and cached.
 *
 * They used to be one module-level constant built with Math.random, which meant
 * both sectors shared a sky AND it was a different sky every time the game
 * launched. A belt you fly back to should look like the belt you left, and it
 * should not look like the other one.
 */
const SKIES = new Map();

const DEFAULT_SKY = {
  seed: 1, stars: 420, tint: [0.72, 0.86, 1.00],
  sun: { dir: [0.42, 0.28, 0.86], colour: [1, 0.95, 0.8], rays: 8, len: 260 },
  planet: { pos: [-9000, -1800, 11000], r: 3100, colour: [0.35, 0.45, 0.85] },
};

/** Deterministic PRNG, same shape as the one models.js uses for asteroids. */
function skyRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function skyFor(sector) {
  const def = { ...DEFAULT_SKY, ...(sector?.sky || {}) };
  const key = sector?.id || 'default';
  const cached = SKIES.get(key);
  if (cached) return cached;
  const rnd = skyRng(def.seed);
  const stars = [];
  for (let i = 0; i < def.stars; i++) {
    // a sphere point from the seeded stream, so the field is reproducible
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    stars.push({
      d: v3(Math.cos(a) * r, z, Math.sin(a) * r),
      b: 0.25 + rnd() * 0.9,
      tw: rnd() * 6.28,
    });
  }
  const sky = { ...def, starList: stars };
  SKIES.set(key, sky);
  return sky;
}

export function factionColor(ship) {
  switch (ship.faction) {
    case 'player': return C.player;
    case 'pirate': return C.pirate;
    case 'trader': return C.trader;
    case 'security': return C.security;
    default: return C.civilian;
  }
}

/** Fade distant geometry out instead of popping it. */
function fade(d, near = 1800, far = DRAW_DIST) {
  if (d < near) return 1;
  if (d > far) return 0;
  return 1 - (d - near) / (far - near);
}

export function drawScene(batch, world, cam, opts = {}) {
  const eye = cam.pos;
  drawSky(batch, eye, world.time, world.sector);

  // sector boundary — a grid you only see as you near it
  const distOut = vlen(eye);
  if (distOut > SECTOR_R * 0.72) drawBoundary(batch, eye, distOut, world.time);

  if (world.station) drawStation(batch, world.station, eye);
  for (const g of world.gates || []) drawGate(batch, g, eye, world.time);

  for (const s of world.ships) {
    if (s === opts.hideShip) continue;
    drawShip(batch, s, eye, world.time);
  }
  for (const a of world.asteroids) drawAsteroid(batch, a, eye);
  for (const p of world.pods) drawPod(batch, p, eye, world.time);
  for (const p of world.projectiles) drawProjectile(batch, p, eye);
  for (const b of world.beams) drawBeam(batch, b, eye, world.time);
  drawParticles(batch, world, cam, eye);
}

function drawSky(batch, eye, time, sector) {
  const R = 9000;
  const sky = skyFor(sector);
  const list = sky.starList;
  for (let i = 0; i < list.length; i += STAR_STEP) {
    const s = list[i];
    const tw = 0.75 + 0.25 * Math.sin(time * 2.1 + s.tw);
    const bx = eye[0] + s.d[0] * R, by = eye[1] + s.d[1] * R, bz = eye[2] + s.d[2] * R;
    const l = R * 0.0040 * (0.6 + s.b * 0.5);   // ~2px on screen
    batch.line3(bx, by, bz, bx + l, by + l * 0.4, bz, sky.tint, 1.1, s.b * tw * 0.75, 0.9);
  }
  // sun: a hard starburst
  const { dir, colour, rays, len } = sky.sun;
  vnorm(_a, vset(_a, dir[0], dir[1], dir[2]));
  const sx = eye[0] + _a[0] * R, sy = eye[1] + _a[1] * R, sz = eye[2] + _a[2] * R;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + time * 0.05;
    batch.line3(sx, sy, sz, sx + Math.cos(a) * len, sy + Math.sin(a) * len, sz,
      colour, 2.0, 0.9, 1.4);
  }
  if (sky.planet) {
    batch.mesh(MODELS.planet, sky.planet.pos, [0, 0, 0, 1], sky.planet.r,
      sky.planet.colour, 1.2, 0.5, 0.7);
  }
}

function drawBoundary(batch, eye, dist, time) {
  const t = clamp((dist - SECTOR_R * 0.72) / (SECTOR_R * 0.3), 0, 1);
  const alpha = t * 0.55;
  vnorm(_a, eye);
  vscale(_a, _a, SECTOR_R);                       // nearest point on the shell
  // local tangent frame
  vnorm(_b, _a);
  vset(_c, 0, 1, 0);
  if (Math.abs(vdot(_b, _c)) > 0.9) vset(_c, 1, 0, 0);
  const right = vnorm(v3(), crossv(_c, _b));
  const up = vnorm(v3(), crossv(_b, right));
  const step = 260, n = 6;
  for (let i = -n; i <= n; i++) {
    for (const [ax, bx] of [[right, up], [up, right]]) {
      vaddScaled(_d, _a, ax, i * step);
      vaddScaled(_e, _d, bx, -n * step);
      vaddScaled(_f, _d, bx, n * step);
      batch.line3v(_e, _f, C.grid, 1.2, alpha * (1 - Math.abs(i) / (n + 2)), 0.8);
    }
  }
}

function crossv(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function drawStation(batch, st, eye) {
  const d = vdist(st.pos, eye);
  const a = fade(d, 6000, 9000);
  if (a <= 0) return;
  batch.mesh(MODELS[st.def?.model] || MODELS.station, st.pos, st.quat, st.scale,
    C.station, 1.7, a, 1.05);
  // docking mouth beacons
  qforward(_a, st.quat);
  vaddScaled(_b, st.pos, _a, st.radius * st.scale * 0.92);
  const blink = 0.55 + 0.45 * Math.sin(performance.now() * 0.006);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    qright(_c, st.quat); qup(_d, st.quat);
    vaddScaled(_e, _b, _c, Math.cos(ang) * 16);
    vaddScaled(_e, _e, _d, Math.sin(ang) * 16);
    vaddScaled(_f, _e, _a, 8);
    batch.line3v(_e, _f, C.warn, 2.2, a * blink, 1.4);
  }
}

function drawGate(batch, g, eye, time) {
  const d = vdist(g.pos, eye);
  const a = fade(d, 5000, 8000);
  if (a <= 0) return;
  batch.mesh(MODELS.gate, g.pos, g.quat, g.scale, C.station, 1.8, a, 1.1);
  // the throat, pulsing so it reads as live from a distance
  const pulse = 0.55 + 0.45 * Math.sin(time * 1.7);
  const r = g.radius * g.scale * 0.55;
  qright(_a, g.quat); qup(_b, g.quat);
  const segs = 16;
  let px = 0, py = 0, pz = 0;
  for (let i = 0; i <= segs; i++) {
    const ang = (i / segs) * Math.PI * 2;
    const cx = Math.cos(ang) * r, cy = Math.sin(ang) * r;
    const x = g.pos[0] + _a[0] * cx + _b[0] * cy;
    const y = g.pos[1] + _a[1] * cx + _b[1] * cy;
    const z = g.pos[2] + _a[2] * cx + _b[2] * cy;
    if (i > 0) batch.line3(px, py, pz, x, y, z, [0.5, 0.8, 1], 2.4, a * pulse, 1.5);
    px = x; py = y; pz = z;
  }
}

function drawShip(batch, s, eye, time) {
  const d = vdist(s.pos, eye);
  const a = fade(d, 2200, DRAW_DIST);
  if (a <= 0) return;
  let col = factionColor(s);
  let glow = 1;
  if (s.flash > 0) { col = [1, 1, 1]; glow = 1 + s.flash; }
  if (s.disabled) {
    const flick = Math.sin(time * 9 + s.id) > 0.3 ? 1 : 0.35;
    batch.mesh(s.model, s.pos, s.quat, s.scale, C.hudDim, 1.4, a * flick, 0.85);
    // distress strobe
    const strobe = (time * 1.6 + s.id) % 1 < 0.12 ? 1 : 0;
    if (strobe) {
      vaddScaled(_a, s.pos, qup(_b, s.quat), s.radius * s.scale * 0.9);
      batch.line3v(s.pos, _a, C.warn, 2.4, a, 2.0);
    }
    return;
  }
  batch.mesh(s.model, s.pos, s.quat, s.scale, col, 1.6, a, glow);

  // engine plume
  if (s.throttle > 0.02) {
    qforward(_a, s.quat);
    const back = s.radius * s.scale * 0.85;
    vaddScaled(_b, s.pos, _a, -back);
    const flick = 0.75 + Math.random() * 0.5;
    vaddScaled(_c, _b, _a, -s.throttle * s.radius * 2.2 * flick);
    batch.line3v(_b, _c, C.warn, 2.4, a * 0.9, 1.5);
  }

  // turret barrels, so you can see the auto-mounts tracking
  for (const hp of s.hardpoints) {
    const m = MODULES[hp.moduleId];
    if (!m || m.mount !== 'auto') continue;
    qrot(_a, s.quat, hp.offset);
    vscale(_a, _a, s.scale);
    vadd(_a, _a, s.pos);
    const len = s.radius * s.scale * 0.42;
    vaddScaled(_b, _a, hp.aim, len);
    const hot = hp.target ? C.warn : C.hudDim;
    batch.line3v(_a, _b, hot, 1.6, a * 0.95, hp.target ? 1.3 : 0.8);
  }
}

function drawAsteroid(batch, r, eye) {
  const d = vdist(r.pos, eye);
  const a = fade(d, 2400, DRAW_DIST);
  if (a <= 0) return;
  const shape = d > 900 ? r.shapeLow : r.shape;
  let col = ORE_COLORS[r.type.ore] || C.rock;
  let glow = 0.8;
  const wounded = 1 - r.hp / r.hpMax;
  if (r.flash > 0) { col = [1, 1, 1]; glow = 1 + r.flash * 1.2; }
  else if (wounded > 0.35) glow = 0.8 + wounded * 0.9;
  batch.mesh(shape, r.pos, r.quat, r.size, col, 1.4, a * (0.55 + 0.45 * (1 - wounded * 0.4)), glow);
}

function drawPod(batch, p, eye, time) {
  const d = vdist(p.pos, eye);
  const a = fade(d, 900, 1800);
  if (a <= 0) return;
  const pulse = 0.7 + 0.3 * Math.sin(time * 5 + p.pos[0]);
  const col = ORE_COLORS[p.item] || C.pod;
  batch.mesh(MODELS.pod, p.pos, p.quat, 2.4, col, 1.5, a, 1.1 * pulse);
}

function drawProjectile(batch, p, eye) {
  const d = vdist(p.pos, eye);
  if (d > DRAW_DIST) return;
  const col = C[p.color] || C.laser;
  vnorm(_a, p.dir);
  vaddScaled(_b, p.pos, _a, -p.len);
  batch.line3v(p.pos, _b, col, 2.6, 1, 1.9);
}

function drawBeam(batch, b, eye, time) {
  const col = C[b.color] || C.mining;
  batch.line3v(b.a, b.b, col, 2.8, 1, 1.9);
  // ragged inner core
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    for (let k = 0; k < 3; k++) {
      _c[k] = lerp(b.a[k], b.b[k], t0) + (Math.random() - 0.5) * 1.6;
      _d[k] = lerp(b.a[k], b.b[k], t1) + (Math.random() - 0.5) * 1.6;
    }
    batch.line3v(_c, _d, [1, 1, 1], 1.2, 0.55, 1.4);
  }
  if (b.hit) {
    const r = 2 + Math.random() * 3;
    for (let i = 0; i < 4; i++) {
      vrandSphere(_c, r);
      vadd(_c, _c, b.b);
      batch.line3v(b.b, _c, col, 1.8, 0.9, 1.7);
    }
  }
}

function drawParticles(batch, world, cam, eye) {
  for (const p of world.particles) {
    const d = vdist(p.pos, eye);
    if (d > DRAW_DIST) continue;
    const t = clamp(p.life / (p.maxLife || 1), 0, 1);
    vnorm(_a, p.vel);
    vaddScaled(_b, p.pos, _a, -p.len * t);
    batch.line3v(p.pos, _b, p.color || C.boom, 2.0, t * fade(d), 1.2 + t);
  }
  // billboarded shock rings
  const right = cam.right, up = cam.up;
  for (const r of world.rings) {
    const t = clamp(r.life / r.maxLife, 0, 1);
    const segs = 14;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i <= segs; i++) {
      const ang = (i / segs) * Math.PI * 2;
      const cx = Math.cos(ang) * r.r, cy = Math.sin(ang) * r.r;
      const x = r.pos[0] + right[0] * cx + up[0] * cy;
      const y = r.pos[1] + right[1] * cx + up[1] * cy;
      const z = r.pos[2] + right[2] * cx + up[2] * cy;
      if (i > 0) batch.line3(px, py, pz, x, y, z, r.color || C.boom, 2.0, t * 0.85, 1.4);
      px = x; py = y; pz = z;
    }
  }
}
