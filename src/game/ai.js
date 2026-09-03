// Ship brains. Each role fills ship.control and pulls its own triggers.

import {
  v3, vcopy, vset, vsub, vadd, vscale, vaddScaled, vdot, vlen, vlen2, vnorm, vdist,
  vcross, vrandSphere, qconj, qrot, qforward, qright, clamp, lerp, rand, leadTarget,
} from '../core/math.js';
import { MODULES } from './data.js';
import { fireMount, mountWorldPos, cargoFree } from './ship.js';
import { chatter } from './comms.js';

const _dir = v3(), _loc = v3(), _lead = v3(), _tmp = v3(), _mz = v3(), _evade = v3(),
  _los = v3(), _q = [0, 0, 0, 1];

/** Point the nose at a world-space direction. Returns the angle error (rad). */
export function steer(ship, dirWorld, control, gain = 1.8) {
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

export function steerTo(ship, pos, control, gain) {
  vsub(_dir, pos, ship.pos);
  vnorm(_dir, _dir);
  return steer(ship, _dir, control, gain);
}

/** Fire every pilot-operated mount that is lined up on the target. */
function shoot(ship, world, target, err, dist, dt) {
  for (const hp of ship.hardpoints) {
    const m = MODULES[hp.moduleId];
    if (!m || m.mount !== 'manual') continue;
    if (dist > (m.range || 1200) * 0.95) continue;
    if (m.beam) {
      if (err < 0.09) fireMount(ship, hp, qforward(_tmp, ship.quat), world, target, dt);
      continue;
    }
    mountWorldPos(_mz, ship, hp);
    leadTarget(_lead, _mz, target.pos, target.vel || [0, 0, 0], m.speed);
    vsub(_dir, _lead, _mz);
    vnorm(_dir, _dir);
    if (vdot(_dir, qforward(_tmp, ship.quat)) > 0.985) fireMount(ship, hp, _dir, world, target, dt);
  }
}

/**
 * How long a bought-off or bluffed pirate leaves you alone. Without this the
 * money bought nothing: findPrey re-picked the player on the very next tick and
 * combat()'s flee-exit flipped a healthy hull straight back to hunting, so a
 * tribute was ~16 ms of peace. Shooting them voids it (see damageShip).
 */
export const TRUCE = 75;

export const inTruce = (ship, world) =>
  ship.paidOff != null && world.time - ship.paidOff < TRUCE;

/**
 * How long after a hit a pilot keeps jinking. Long enough to cover the gap
 * between bursts, short enough that they settle and fight once you stop.
 */
const EVADE_FOR = 2.5;

/**
 * Break up a heading so it cannot be led. leadTarget solves constant velocity
 * exactly, so the only thing that beats it is changing direction — not speed,
 * and not a curve smooth enough to extrapolate. Hence a random axis held for a
 * short, irregular beat rather than a sine wave.
 *
 * Only pilots who have been shot at in the last EVADE_FOR seconds do this, so a
 * pirate that has not noticed you still flies its ordinary approach.
 */
function jink(ship, world, dt, dir) {
  const ai = ship.ai;
  if (!ai.evade || world.time - ship.lastHitAt > EVADE_FOR) return dir;
  ai.jinkT = (ai.jinkT ?? 0) - dt;
  if (ai.jinkT <= 0) {
    ai.jinkT = rand(0.9, 0.35);
    ai.jinkAxis = vrandSphere(ai.jinkAxis || v3(), 1);
    // Reversing the orbit now and then matters more than the wobble: a fixed
    // arc is close enough to a straight line over a bolt's flight time to be
    // led exactly, and the sign was previously rolled once at spawn and kept
    // for the ship's whole life.
    if (Math.random() < 0.35) ai.sign = -(ai.sign || 1);
  }
  // Only the part of the jink across the shooter's line of sight does anything:
  // movement along it changes the range, which a lead solution does not care
  // about. A plain random axis spends most of itself that way, which is why the
  // first version of this barely moved the orbit case — 98% of shots to 88%.
  const from = ship.lastHitBy && !ship.lastHitBy.dead ? ship.lastHitBy : ship.target;
  vcopy(_evade, ai.jinkAxis);
  if (from) {
    vnorm(_los, vsub(_los, ship.pos, from.pos));
    vaddScaled(_evade, _evade, _los, -vdot(_evade, _los));
    if (vlen2(_evade) < 1e-4) return dir;          // axis was straight down it
    vnorm(_evade, _evade);
  }
  vaddScaled(_evade, _evade, dir, 1 / 0.75);       // dir plus 0.75 of the jink
  return vnorm(_evade, _evade);
}

function findPrey(ship, world, truce = false) {
  let best = null, bestD = Infinity;
  for (const s of world.ships) {
    if (s === ship || s.dead || s.disabled) continue;
    if (truce && s === world.player.ship) continue;   // we took your money
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
    case 'wing': wing(ship, world, dt, control); break;
    default: control.throttle = 0;
  }
}

function combat(ship, world, dt, control, fleeAt) {
  const ai = ship.ai;
  const truce = inTruce(ship, world);
  if (truce && ship.target === world.player.ship) ship.target = null;
  if (!ship.target || ship.target.dead || ship.target.disabled || ai.t > 4) {
    ai.t = 0;
    const grudge = ship.angryAt && !ship.angryAt.dead
      && !(truce && ship.angryAt === world.player.ship) ? ship.angryAt : null;
    ship.target = grudge || findPrey(ship, world, truce);
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
  if (ship.faction === 'pirate' && t === world.player.ship && ai.state !== 'flee') {
    chatter(world, ship, 'pirateEngage');
  }
  const dist = vdist(ship.pos, t.pos);

  if (ai.state === 'flee') {
    chatter(world, ship, ship.faction === 'pirate' ? 'pirateFlee' : 'traderFlee');
    vsub(_dir, ship.pos, t.pos);
    vnorm(_dir, _dir);
    steer(ship, jink(ship, world, dt, _dir), control, 1.6);
    control.throttle = 1;
    // A truce keeps them running until it lapses. Otherwise a hull that has
    // actually recovered turns around — but a badly hurt one commits to leaving
    // rather than coming back for more.
    //
    // Distance used to end a flee on its own, at 2600 m. That is why beaten
    // pirates circled the belt forever: they broke off, got clear, immediately
    // stopped fleeing, turned round and came back, so no fight ever finished and
    // no runner ever actually left. Now they run for the sector edge and are
    // gone (see World.confine) unless a repair module patches them up first.
    if (!(truce && t === world.player.ship)
      && (hullFrac > fleeAt + 0.25 || (dist > 2600 && hullFrac > fleeAt))) ai.state = 'hunt';
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
  steer(ship, jink(ship, world, dt, _dir), control, 2.0);
  control.throttle = dist > orbit ? 1 : clamp(0.15 + (dist / orbit) * 0.6, 0, 1);

  vnorm(_lead, vsub(_lead, t.pos, ship.pos));
  const aimErr = Math.acos(clamp(vdot(qforward(_tmp, ship.quat), _lead), -1, 1));
  shoot(ship, world, t, aimErr, dist, dt);
}

/** Hired guns: hold formation on the player, break to fight what threatens them. */
function wing(ship, world, dt, control) {
  const ai = ship.ai;
  const lead = world.player.ship;
  if (!lead || lead.dead) { control.throttle = 0; return; }

  // a standing order from the channel overrides their own judgement
  if (ai.order === 'hold') {
    control.throttle = Math.abs(vlen(ship.vel)) > 12 ? -0.4 : 0;
    return;
  }
  if (ai.order === 'engage' && ai.orderTarget && !ai.orderTarget.dead) {
    ship.target = ai.orderTarget;
    combat(ship, world, dt, control, 0.05);
    return;
  }

  if (!ship.target || ship.target.dead || ship.target.disabled || ai.t > 3) {
    ai.t = 0;
    ship.target = findPrey(ship, world);
  }
  // only break formation for something actually near the one they are paid to guard
  const threat = ship.target && vdist(ship.target.pos, lead.pos) < 1800 ? ship.target : null;
  if (threat) {
    ship.target = threat;
    combat(ship, world, dt, control, 0.12);
    return;
  }

  // form up off the leader's wing
  const slot = ai.slot ?? 0;
  qright(_tmp, lead.quat);
  vaddScaled(_dir, lead.pos, _tmp, (slot % 2 === 0 ? 1 : -1) * (110 + slot * 40));
  qforward(_tmp, lead.quat);
  vaddScaled(_dir, _dir, _tmp, -90);

  const gap = vdist(ship.pos, _dir);
  steerTo(ship, _dir, control, 1.5);
  control.throttle = gap > 260 ? 1 : gap > 90 ? 0.55 : -0.1;
}

function trader(ship, world, dt, control) {
  const ai = ship.ai;
  if (ship.angryAt && !ship.angryAt.dead) {
    const d = vdist(ship.pos, ship.angryAt.pos);
    if (d < 2200) {
      chatter(world, ship, 'traderFlee');
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
      if (m && m.beam) fireMount(ship, hp, qforward(_tmp, ship.quat), world, ai.rock, dt);
    }
  }
}
