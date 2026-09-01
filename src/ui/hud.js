// The HUD is drawn with the same vector pipeline as the world: screen-space
// segments in device pixels.

import {
  v3, vsub, vadd, vscale, vaddScaled, vdot, vlen, vnorm, vdist, project, clamp, lerp,
  qforward, qright, qup, qconj, qrot, leadTarget,
} from '../core/math.js';
import { C, ORE_COLORS } from '../render/palette.js';
import { MODULES } from '../game/data.js';
import { factionColor } from '../render/scene.js';
import { BOARD_RANGE } from '../game/boarding.js';

const _p = [0, 0, 0], _a = v3(), _b = v3(), _c = v3(), _q = [0, 0, 0, 1];

export function drawHUD(batch, g) {
  const { world, player, cam, W, H, time } = g;
  const ship = player.ship;
  const u = Math.min(W, H) / 900;                 // one HUD unit
  const cx = W / 2, cy = H / 2;
  const gunner = player.mode === 'gunner';
  const dim = C.hudDim, hud = C.hud;

  cockpit(batch, W, H, u, ship, gunner);

  /* reticle ------------------------------------------------------------- */
  const rr = 26 * u;
  if (gunner) {
    batch.circle2(cx, cy, rr, C.warn, 1.6, 0.9, 1.2, 24);
    batch.line2(cx - rr * 1.7, cy, cx - rr * 0.55, cy, C.warn, 1.8, 0.95, 1.3);
    batch.line2(cx + rr * 0.55, cy, cx + rr * 1.7, cy, C.warn, 1.8, 0.95, 1.3);
    batch.line2(cx, cy - rr * 1.7, cx, cy - rr * 0.55, C.warn, 1.8, 0.95, 1.3);
    batch.line2(cx, cy + rr * 0.55, cx, cy + rr * 1.7, C.warn, 1.8, 0.95, 1.3);
    // where the hull is actually pointing
    qforward(_a, ship.quat);
    vaddScaled(_b, cam.pos, _a, 900);
    if (project(_p, _b, cam.viewProj, W, H)) {
      batch.circle2(_p[0], _p[1], 9 * u, C.player, 1.4, 0.7, 0.9, 12);
      batch.line2(_p[0] - 13 * u, _p[1], _p[0] + 13 * u, _p[1], C.player, 1.2, 0.5, 0.8);
    }
  } else {
    batch.circle2(cx, cy, rr * 0.42, hud, 1.5, 0.75, 1.0, 16);
    for (const s of [-1, 1]) {
      batch.line2(cx + s * rr * 0.6, cy, cx + s * rr * 1.5, cy, hud, 1.6, 0.9, 1.1);
      batch.line2(cx + s * rr * 1.5, cy, cx + s * rr * 1.5, cy - 7 * u, hud, 1.6, 0.9, 1.1);
    }
    batch.line2(cx, cy - rr * 1.5, cx, cy - rr * 0.6, hud, 1.6, 0.9, 1.1);
  }

  /* velocity vector ----------------------------------------------------- */
  const speed = vlen(ship.vel);
  if (speed > 4) {
    vnorm(_a, ship.vel);
    vaddScaled(_b, cam.pos, _a, 700);
    if (project(_p, _b, cam.viewProj, W, H)) {
      const r = 7 * u;
      batch.circle2(_p[0], _p[1], r, C.player, 1.3, 0.55, 0.8, 10);
      batch.line2(_p[0] - r * 2, _p[1], _p[0] - r, _p[1], C.player, 1.2, 0.45, 0.7);
      batch.line2(_p[0] + r, _p[1], _p[0] + r * 2, _p[1], C.player, 1.2, 0.45, 0.7);
      batch.line2(_p[0], _p[1] - r * 2, _p[0], _p[1] - r, C.player, 1.2, 0.45, 0.7);
    }
  }

  /* target reticle, lead pip and off-screen arrow ----------------------- */
  const t = player.target;
  if (t && !t.dead) {
    const d = vdist(t.pos, cam.pos);
    const tcol = t.kind === 'ship' ? (world.isHostile(ship, t) ? C.danger : factionColor(t))
      : t.kind === 'asteroid' ? (ORE_COLORS[t.type.ore] || C.rock) : C.station;
    const radius = (t.radius ? t.radius * (t.scale || 1) : t.size) || 20;
    if (project(_p, t.pos, cam.viewProj, W, H)) {
      const px = clamp(_p[0], 0, W), py = clamp(_p[1], 0, H);
      const scr = clamp((radius / Math.max(d, 1)) * (H * 0.9), 22 * u, 260 * u);
      batch.bracket2(px, py, scr, scr, tcol, 1.8, 0.95, 1.2);
      // lock ring
      if (t.kind === 'ship') {
        const seg = Math.floor(((time * 0.6) % 1) * 24);
        batch.circle2(px, py, scr * 0.78, tcol, 1.3, 0.5, 0.9, 24,
          (seg / 24) * 6.28, (seg / 24) * 6.28 + 1.2);
      }
      // boarding cue
      if (t.kind === 'ship' && t.disabled && !t.looted) {
        const near = d - radius < BOARD_RANGE;
        batch.circle2(px, py, scr * 0.55, near ? C.warn : C.hudDim, 1.6,
          near ? 0.9 : 0.5, near ? 1.4 : 0.8, 6);
      }
    }
    // lead pip for the fitted manual gun
    const hp = ship.hardpoints[ship.manualIndex];
    const m = hp && MODULES[hp.moduleId];
    if (m && !m.beam && t.vel) {
      leadTarget(_a, cam.pos, t.pos, t.vel, m.speed);
      if (project(_p, _a, cam.viewProj, W, H) && d < m.range * 1.2) {
        const r = 6 * u;
        batch.line2(_p[0] - r, _p[1] - r, _p[0] + r, _p[1] + r, C.warn, 1.6, 0.9, 1.3);
        batch.line2(_p[0] - r, _p[1] + r, _p[0] + r, _p[1] - r, C.warn, 1.6, 0.9, 1.3);
      }
    }
    offscreenArrow(batch, t.pos, cam, W, H, u, tcol);
  }

  /* station bearing ----------------------------------------------------- */
  if (world.station) {
    const st = world.station;
    const pr = project(_p, st.pos, cam.viewProj, W, H);
    if (pr && _p[0] > 0 && _p[0] < W && _p[1] > 0 && _p[1] < H) {
      batch.rect2(_p[0] - 9 * u, _p[1] - 9 * u, 18 * u, 18 * u, C.station, 1.3, 0.6, 0.9);
      batch.line2(_p[0] - 14 * u, _p[1], _p[0] - 9 * u, _p[1], C.station, 1.3, 0.6, 0.9);
      batch.line2(_p[0] + 9 * u, _p[1], _p[0] + 14 * u, _p[1], C.station, 1.3, 0.6, 0.9);
    } else if (!player.target) {
      offscreenArrow(batch, st.pos, cam, W, H, u, C.station);
    }
  }

  /* status arcs: hull left, shield right -------------------------------- */
  const s = ship.stats;
  const ay = g.touch ? H - 250 * u : H - 150 * u;
  arc(batch, g.touch ? 118 * u : 44 * u, ay, 34 * u, ship.hull / s.hullMax, C.hud, C.danger, u);
  arc(batch, W - 44 * u, ay, 34 * u, ship.shield / Math.max(1, s.shieldMax), C.player, C.hudDim, u, true);

  // energy bar under the reticle
  const ew = 150 * u, e = ship.energy / s.energyMax;
  batch.line2(cx - ew / 2, cy + 70 * u, cx + ew / 2, cy + 70 * u, dim, 1.4, 0.45, 0.7);
  batch.line2(cx - ew / 2, cy + 70 * u, cx - ew / 2 + ew * e, cy + 70 * u,
    e < 0.2 ? C.warn : C.hud, 3.0, 0.95, 1.3);

  // throttle ladder, bottom-left of the reticle
  if (!g.touch) throttleGauge(batch, 34 * u, H * 0.5, 130 * u, ship.throttle, speed / s.maxSpeed, u);

  const rlift = g.touch ? 210 : 120;
  radar(batch, g, W - 118 * u, H - rlift * u, 92 * u, u);
}

function arc(batch, x, y, r, frac, col, low, u, mirror = false) {
  const from = mirror ? -Math.PI * 0.35 : Math.PI * 1.35;
  const to = mirror ? Math.PI * 0.35 : Math.PI * 0.65;
  batch.circle2(x, y, r, C.hudDim, 1.3, 0.35, 0.6, 18, from, to);
  const f = clamp(frac, 0, 1);
  const end = from + (to - from) * f;
  if (f > 0.001) batch.circle2(x, y, r, f < 0.3 ? low : col, 3.2, 0.95, 1.3, 18, from, end);
}

function throttleGauge(batch, x, y, h, throttle, speedFrac, u) {
  const top = y - h / 2, bot = y + h / 2, mid = y;
  batch.line2(x, top, x, bot, C.hudDim, 1.4, 0.5, 0.7);
  for (let i = -2; i <= 2; i++) {
    const ty = mid + (h / 2) * (i / 2);
    const w = i === 0 ? 11 * u : 6 * u;
    batch.line2(x - w, ty, x + w, ty, C.hudDim, 1.2, 0.45, 0.6);
  }
  const ty = mid - throttle * (h / 2);
  batch.line2(x - 13 * u, ty, x + 13 * u, ty, throttle < 0 ? C.warn : C.hud, 3.0, 1, 1.4);
  // speed fill
  const sy = bot - clamp(speedFrac, 0, 1) * h;
  batch.line2(x + 17 * u, bot, x + 17 * u, sy, C.player, 2.6, 0.85, 1.1);
}

function offscreenArrow(batch, worldPos, cam, W, H, u, col) {
  const pr = project(_p, worldPos, cam.viewProj, W, H);
  const margin = 46 * u;
  let x, y;
  if (pr && _p[0] > margin && _p[0] < W - margin && _p[1] > margin && _p[1] < H - margin) return;
  if (pr) { x = _p[0]; y = _p[1]; }
  else {
    // behind the camera: mirror the direction into screen space
    vsub(_a, worldPos, cam.pos);
    qconj(_q, cam.quat);
    qrot(_b, _q, _a);
    x = W / 2 + _b[0] * 1000;
    y = H / 2 - _b[1] * 1000;
  }
  const dx = x - W / 2, dy = y - H / 2;
  const ang = Math.atan2(dy, dx);
  const rx = (W / 2 - margin), ry = (H / 2 - margin);
  const k = Math.min(rx / Math.max(Math.abs(Math.cos(ang)), 1e-3), ry / Math.max(Math.abs(Math.sin(ang)), 1e-3));
  const ax = W / 2 + Math.cos(ang) * k, ay = H / 2 + Math.sin(ang) * k;
  const s = 13 * u;
  const p1x = ax + Math.cos(ang) * s, p1y = ay + Math.sin(ang) * s;
  const p2x = ax + Math.cos(ang + 2.5) * s, p2y = ay + Math.sin(ang + 2.5) * s;
  const p3x = ax + Math.cos(ang - 2.5) * s, p3y = ay + Math.sin(ang - 2.5) * s;
  batch.line2(p1x, p1y, p2x, p2y, col, 1.8, 0.9, 1.2);
  batch.line2(p2x, p2y, p3x, p3y, col, 1.8, 0.9, 1.2);
  batch.line2(p3x, p3y, p1x, p1y, col, 1.8, 0.9, 1.2);
}

/** Elite-style scanner: contacts plotted on a disc with height stalks. */
function radar(batch, g, cx, cy, r, u) {
  const { world, player, cam } = g;
  const ship = player.ship;
  const RANGE = 2600;
  const squash = 0.42;
  ellipse(batch, cx, cy, r, r * squash, C.hudDim, 1.3, 0.5, 0.7);
  ellipse(batch, cx, cy, r * 0.5, r * 0.5 * squash, C.hudDim, 1.1, 0.3, 0.6);
  batch.line2(cx - r, cy, cx + r, cy, C.hudDim, 1.1, 0.25, 0.5);
  batch.line2(cx, cy - r * squash, cx, cy + r * squash, C.hudDim, 1.1, 0.25, 0.5);

  qconj(_q, ship.quat);
  const plot = (obj, col, size) => {
    vsub(_a, obj.pos, ship.pos);
    const d = vlen(_a);
    if (d > RANGE) return;
    qrot(_b, _q, _a);
    const k = r / RANGE;
    const px = cx + _b[0] * k;
    const py = cy + (-_b[2]) * k * squash;      // forward = up on the disc
    const hy = py - _b[1] * k * 0.55;
    batch.line2(px, py, px, hy, col, 1.2, 0.55, 0.8);
    batch.line2(px - size, hy, px + size, hy, col, 2.2, 0.95, 1.3);
  };
  for (const s of world.ships) {
    if (s === ship || s.dead) continue;
    plot(s, s.disabled ? C.hudDim : world.isHostile(ship, s) ? C.danger : factionColor(s), 2.6 * u);
  }
  for (const p of world.pods) plot(p, ORE_COLORS[p.item] || C.pod, 1.6 * u);
  if (world.station) plot(world.station, C.station, 3.4 * u);
  if (player.target && !player.target.dead) plot(player.target, C.warn, 3.6 * u);
}

function ellipse(batch, cx, cy, rx, ry, col, thick, alpha, glow, segs = 34) {
  let px = cx + rx, py = cy;
  for (let i = 1; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    batch.line2(px, py, x, y, col, thick, alpha, glow);
    px = x; py = y;
  }
}

/** Canopy struts — the first-person frame you fly inside. */
function cockpit(batch, W, H, u, ship, gunner) {
  const col = gunner ? [0.35, 0.5, 0.6] : [0.30, 0.55, 0.50];
  const a = 0.55, t = 1.6;
  const top = H * 0.09, bot = H * 0.965, sx = W * 0.035;
  // canopy arch
  batch.line2(sx, top + 40 * u, W * 0.20, top, col, t, a, 0.7);
  batch.line2(W * 0.20, top, W * 0.80, top, col, t, a * 0.8, 0.7);
  batch.line2(W * 0.80, top, W - sx, top + 40 * u, col, t, a, 0.7);
  // side pillars
  batch.line2(sx, top + 40 * u, sx, bot - 120 * u, col, t, a, 0.7);
  batch.line2(W - sx, top + 40 * u, W - sx, bot - 120 * u, col, t, a, 0.7);
  // dash
  batch.line2(sx, bot - 120 * u, W * 0.26, bot - 46 * u, col, t, a, 0.7);
  batch.line2(W * 0.26, bot - 46 * u, W * 0.74, bot - 46 * u, col, t, a, 0.7);
  batch.line2(W * 0.74, bot - 46 * u, W - sx, bot - 120 * u, col, t, a, 0.7);
  // console detail
  for (let i = 0; i < 5; i++) {
    const x = W * 0.30 + i * W * 0.10;
    batch.line2(x, bot - 40 * u, x + W * 0.06, bot - 40 * u, col, 1.3, a * 0.6, 0.6);
  }
  if (gunner) {
    // gunnery cage overlay
    batch.line2(W * 0.5 - 200 * u, top + 18 * u, W * 0.5 + 200 * u, top + 18 * u, col, 1.2, 0.35, 0.6);
  }
}
