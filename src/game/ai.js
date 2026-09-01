// Ship brains. Each role fills ship.control and pulls its own triggers.

import {
  v3, vcopy, vset, vsub, vadd, vscale, vaddScaled, vdot, vlen, vlen2, vnorm, vdist,
  vcross, vrandSphere, qconj, qrot, qforward, clamp, lerp, rand, leadTarget,
} from '../core/math.js';
import { MODULES } from './data.js';
import { fireMount, mountWorldPos, cargoFree } from './ship.js';

const _dir = v3(), _loc = v3(), _lead = v3(), _tmp = v3(), _mz = v3(), _q = [0, 0, 0, 1];

/** Point the nose at a world-space direction. Returns the angle error (rad). */
function steer(ship, dirWorld, control, gain = 1.8) {
  qconj(_q, ship.quat);
  qrot(_loc, _q, dirWorld);
  const fwd = -_loc[2];
  const yaw = Math.atan2(_loc[0], fwd === 0 ? 1e-4 : fwd);
  const pitch = Math.atan2(_loc[1], Math.hypot(_loc[0], _loc[2]) || 1e-4);
  control.yaw = clamp(-yaw * gain, -1, 1);
  control.pitch = clamp(pitch * gain, -1, 1);
  control.roll = clamp(-yaw * 0.35, -1, 1);
  return Math.acos(clamp(vdot(dirWorld, qforward(_tmp, ship.quat)), -1, 1));
}

function steerTo(ship, pos, control, gain) {
  vsub(_dir, pos, ship.pos);
  vnorm(_dir, _dir);
  return steer(ship, _dir, control, gain);
}

/** Fire every pilot-operated mount that is lined up on the target. */
function shoot(ship, world, target, err, dist) {
  for (const hp of ship.hardpoints) {
    const m = MODULES[hp.moduleId];
    if (!m || m.mount !== 'manual') continue;
    if (dist > (m.range || 1200) * 0.95) continue;
    if (m.beam) {
      if (err < 0.09) fireMount(ship, hp, qforward(_tmp, ship.quat), world, target);
      continue;
    }
    mountWorldPos(_mz, ship, hp);
    leadTarget(_lead, _mz, target.pos, target.vel || [0, 0, 0], m.speed);
    vsub(_dir, _lead, _mz);
    vnorm(_dir, _dir);
    if (vdot(_dir, qforward(_tmp, ship.quat)) > 0.985) fireMount(ship, hp, _dir, world, target);
  }
}

function findPrey(ship, world) {
  let best = null, bestD = Infinity;
  for (const s of world.ships) {
    if (s === ship || s.dead || s.disabled) continue;
    if (!world.isHostile(ship, s)) continue;
    const d = vlen2(vsub(_tmp, s.pos, ship.pos));
    const bias = s === world.player.ship ? 0.45 : 1;   // pirates prefer the player
    if (d * bias < bestD) { bestD = d * bias; best = s; }
  }
  return best;
}

function nearestRock(ship, world, max = 2600) {
  let best = null, bestD = max * max;
  for (const a of world.asteroids) {
    const d = vlen2(vsub(_tmp, a.pos, ship.pos));
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

export function runAI(ship, world, dt) {
  const ai = ship.ai;
  if (!ai) return;
  const control = ship.control || (ship.control = { pitch: 0, yaw: 0, roll: 0, throttle: 0 });
  control.pitch = control.yaw = control.roll = 0;
  if (ship.disabled || ship.dead) { control.throttle = 0; return; }
  ai.t += dt;

  switch (ai.role) {
    case 'pirate': combat(ship, world, dt, control, 0.35); break;
    case 'security': combat(ship, world, dt, control, 0.15); break;
    case 'trader': trader(ship, world, dt, control); break;
    case 'miner': miner(ship, world, dt, control); break;
    default: control.throttle = 0;
  }
}

function combat(ship, world, dt, control, fleeAt) {
  const ai = ship.ai;
  if (!ship.target || ship.target.dead || ship.target.disabled || ai.t > 4) {
    ai.t = 0;
    ship.target = ship.angryAt && !ship.angryAt.dead ? ship.angryAt : findPrey(ship, world);
  }
  const t = ship.target;
  if (!t) {   // idle patrol
    if (!ai.patrol || vdist(ship.pos, ai.patrol) < 260) ai.patrol = world.randomEdgePoint(v3());
    steerTo(ship, ai.patrol, control, 1.2);
    control.throttle = 0.55;
    return;
  }

  const hullFrac = ship.hull / ship.stats.hullMax;
  if (hullFrac < fleeAt && ai.state !== 'flee') { ai.state = 'flee'; ai.t = 0; }
  const dist = vdist(ship.pos, t.pos);

  if (ai.state === 'flee') {
    vsub(_dir, ship.pos, t.pos);
    vnorm(_dir, _dir);
    steer(ship, _dir, control, 1.6);
    control.throttle = 1;
    if (dist > 2600 || hullFrac > fleeAt + 0.25) ai.state = 'hunt';
    return;
  }

  // orbit: aim slightly off the target so they arc past instead of ramming
  const orbit = ai.orbit || 380;
  vsub(_dir, t.pos, ship.pos);
  vnorm(_dir, _dir);
  if (dist < orbit * 1.6) {
    vcross(_tmp, _dir, [0, 1, 0]);
    vnorm(_tmp, _tmp);
    vaddScaled(_dir, _dir, _tmp, (ai.sign || 1) * 0.85);
    vnorm(_dir, _dir);
  }
  steer(ship, _dir, control, 2.0);
  control.throttle = dist > orbit ? 1 : clamp(0.15 + (dist / orbit) * 0.6, 0, 1);

  vnorm(_lead, vsub(_lead, t.pos, ship.pos));
  const aimErr = Math.acos(clamp(vdot(qforward(_tmp, ship.quat), _lead), -1, 1));
  shoot(ship, world, t, aimErr, dist);
}

function trader(ship, world, dt, control) {
  const ai = ship.ai;
  if (ship.angryAt && !ship.angryAt.dead) {
    const d = vdist(ship.pos, ship.angryAt.pos);
    if (d < 2200) {
      vsub(_dir, ship.pos, ship.angryAt.pos);
      vnorm(_dir, _dir);
      steer(ship, _dir, control, 1.5);
      control.throttle = 1;
      return;
    }
    if (d > 3600) ship.angryAt = null;
  }
  if (!ai.dest || vdist(ship.pos, ai.dest) < 320) {
    ai.dest = Math.random() < 0.5 && world.station
      ? vaddScaled(v3(), world.station.pos, vrandSphere(_tmp, 1), 320)
      : world.randomEdgePoint(v3());
  }
  steerTo(ship, ai.dest, control, 1.1);
  control.throttle = 0.75;
}

function miner(ship, world, dt, control) {
  const ai = ship.ai;
  if (ship.angryAt && !ship.angryAt.dead && vdist(ship.pos, ship.angryAt.pos) < 1800) {
    vsub(_dir, ship.pos, ship.angryAt.pos);
    vnorm(_dir, _dir);
    steer(ship, _dir, control, 1.5);
    control.throttle = 1;
    return;
  }
  if (!ai.rock || ai.rock.hp <= 0 || world.asteroids.indexOf(ai.rock) < 0 || ai.t > 25) {
    ai.rock = nearestRock(ship, world);
    ai.t = 0;
  }
  if (!ai.rock) { control.throttle = 0.3; return; }
  const dist = vdist(ship.pos, ai.rock.pos);
  const err = steerTo(ship, ai.rock.pos, control, 1.4);
  const want = ai.rock.size + 110;
  control.throttle = dist > want ? 0.7 : -0.15;
  if (dist < 380 && err < 0.14 && cargoFree(ship) > 0) {
    for (const hp of ship.hardpoints) {
      const m = MODULES[hp.moduleId];
      if (m && m.beam) fireMount(ship, hp, qforward(_tmp, ship.quat), world, ai.rock);
    }
  }
}
