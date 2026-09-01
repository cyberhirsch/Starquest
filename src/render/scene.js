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

const STARS = (() => {
  const out = [];
  for (let i = 0; i < 420; i++) {
    const d = vrandSphere(v3(), 1);
    out.push({ d, b: 0.25 + Math.random() * 0.9, tw: Math.random() * 6.28 });
  }
  return out;
})();

const SUN_DIR = vnorm(v3(), [0.42, 0.28, 0.86]);
const PLANET = { pos: v3(-9000, -1800, 11000), r: 3100 };

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
  drawSky(batch, eye, world.time);

  // sector boundary — a grid you only see as you near it
  const distOut = vlen(eye);
  if (distOut > SECTOR_R * 0.72) drawBoundary(batch, eye, distOut, world.time);

  if (world.station) drawStation(batch, world.station, eye);

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

function drawSky(batch, eye, time) {
  const R = 9000;
  for (let i = 0; i < STARS.length; i += STAR_STEP) {
    const s = STARS[i];
    const tw = 0.75 + 0.25 * Math.sin(time * 2.1 + s.tw);
    const bx = eye[0] + s.d[0] * R, by = eye[1] + s.d[1] * R, bz = eye[2] + s.d[2] * R;
    const l = R * 0.0040 * (0.6 + s.b * 0.5);   // ~2px on screen
    batch.line3(bx, by, bz, bx + l, by + l * 0.4, bz, C.star, 1.1, s.b * tw * 0.75, 0.9);
  }
  // sun: a hard starburst
  const sx = eye[0] + SUN_DIR[0] * R, sy = eye[1] + SUN_DIR[1] * R, sz = eye[2] + SUN_DIR[2] * R;
  const rays = 8, len = 260;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + time * 0.05;
    const ex = Math.cos(a) * len, ey = Math.sin(a) * len;
    batch.line3(sx, sy, sz, sx + ex, sy + ey, sz, [1, 0.95, 0.8], 2.0, 0.9, 1.4);
  }
  batch.mesh(MODELS.planet, PLANET.pos, [0, 0, 0, 1], PLANET.r, C.planet, 1.2, 0.5, 0.7);
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
  batch.mesh(MODELS.station, st.pos, st.quat, st.scale, C.station, 1.7, a, 1.05);
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
