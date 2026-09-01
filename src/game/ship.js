// Ship construction, derived stats, flight model, gunnery and damage.

import {
  v3, qid, vcopy, vset, vadd, vsub, vscale, vaddScaled, vdot, vlen, vnorm, vlen2,
  vdist, qforward, qright, qup, qrot, qspin, qnorm, clamp, lerp, leadTarget, vcross,
  vrandSphere, rand,
} from '../core/math.js';
import { SHIPS, MODULES } from './data.js';
import { MODELS } from '../render/models.js';

let NEXT_ID = 1;

/** Ceiling on any computer-flown hull, whatever it has fitted. */
export const AI_TOP_SPEED = 150;

/** Mount positions, spread over the hull so turret fire visibly converges. */
function hardpointOffsets(cls) {
  const r = cls.radius;
  const base = [
    [0, -0.25 * r, -0.7 * r],
    [0.75 * r, -0.1 * r, -0.1 * r],
    [-0.75 * r, -0.1 * r, -0.1 * r],
    [0, 0.55 * r, 0.1 * r],
    [0, -0.55 * r, 0.1 * r],
    [0.6 * r, 0.15 * r, 0.5 * r],
    [-0.6 * r, 0.15 * r, 0.5 * r],
    [0, 0, 0.7 * r],
  ];
  return base.slice(0, cls.hardpoints).map((p) => v3(p[0], p[1], p[2]));
}

export function createShip(classId, faction = 'civilian', opts = {}) {
  const cls = SHIPS[classId];
  const offsets = hardpointOffsets(cls);
  const ship = {
    id: NEXT_ID++,
    kind: 'ship',
    classId, cls, faction,
    name: opts.name || cls.name,
    model: MODELS[cls.model],
    pos: opts.pos ? vcopy(v3(), opts.pos) : v3(),
    vel: opts.vel ? vcopy(v3(), opts.vel) : v3(),
    quat: opts.quat ? [...opts.quat] : qid(),
    rate: v3(),                       // local pitch / yaw / roll rate (rad/s)
    throttle: 0,
    assist: true,
    hardpoints: offsets.map((off, i) => ({
      index: i, offset: off, moduleId: null, cd: 0, aim: v3(0, 0, -1),
      target: null, heat: 0, firing: false,
    })),
    utility: new Array(cls.utility).fill(null),
    manualIndex: 0,
    cargo: {},
    credits: opts.credits ?? 0,
    hull: 1, shield: 1, energy: 1,
    stats: null,
    ion: 0,
    disabled: false, dead: false, looted: false,
    lastHitBy: null, lastHitAt: -99, deadAt: 0, flash: 0,
    ai: null, target: null,
    scale: cls.scale ?? 1,
    radius: cls.radius,
    beam: null,                       // active mining beam endpoint, for rendering
  };
  if (opts.loadout) applyLoadout(ship, opts.loadout);
  recalc(ship, true);
  return ship;
}

/** loadout = { hardpoints:[id|null], utility:[id|null] } */
export function applyLoadout(ship, loadout) {
  (loadout.hardpoints || []).forEach((id, i) => {
    if (ship.hardpoints[i]) ship.hardpoints[i].moduleId = id && MODULES[id] ? id : null;
  });
  (loadout.utility || []).forEach((id, i) => {
    if (i < ship.utility.length) ship.utility[i] = id && MODULES[id] ? id : null;
  });
}

export function getLoadout(ship) {
  return {
    hardpoints: ship.hardpoints.map((h) => h.moduleId),
    utility: [...ship.utility],
  };
}

/** Recompute derived stats from hull class + fitted utility modules. */
export function recalc(ship, refill = false) {
  const c = ship.cls;
  const s = {
    hullMax: c.hull, shieldMax: c.shield, shieldRate: c.shieldRate,
    cargoMax: c.cargo, energyMax: c.energy, energyRate: c.energyRate,
    accel: c.thrust, turn: c.turn, reverse: c.reverse,
    tractor: 55, boarding: 0, repair: 0, scanner: 0, massMul: 1,
    miningBonus: c.miningBonus ?? 1,
  };
  let thrustMul = 1, turnMul = 1;
  for (const id of ship.utility) {
    const m = id && MODULES[id];
    if (!m) continue;
    if (m.hull) s.hullMax += m.hull;
    if (m.shield) s.shieldMax += m.shield;
    if (m.shieldRate) s.shieldRate += m.shieldRate;
    if (m.cargo) s.cargoMax += m.cargo;
    if (m.thrustMul) thrustMul *= m.thrustMul;
    if (m.turnMul) turnMul *= m.turnMul;
    if (m.tractor) s.tractor = Math.max(s.tractor, m.tractor);
    if (m.boarding) s.boarding = Math.max(s.boarding, m.boarding);
    if (m.repair) s.repair += m.repair;
    if (m.scanner) s.scanner = 1;
    if (m.massMul) s.massMul *= m.massMul;
  }
  s.accel = (s.accel * thrustMul) / s.massMul;
  s.turn = (s.turn * turnMul) / Math.sqrt(s.massMul);
  s.maxSpeed = 60 + s.accel * 3.4;

  // Hulls the computer flies are throttled back so a runner can always be run
  // down. Without this a fleeing Corsair does 271 m/s against a starter
  // shuttle's 176 and the chase is arithmetically unwinnable. Player-owned
  // hulls keep their full rating, so buying a fast ship still means something.
  if (ship.faction !== 'player') {
    s.maxSpeed = Math.min(s.maxSpeed * 0.72, AI_TOP_SPEED);
    s.accel *= 0.9;
  }
  ship.stats = s;
  if (refill) { ship.hull = s.hullMax; ship.shield = s.shieldMax; ship.energy = s.energyMax; }
  ship.hull = Math.min(ship.hull, s.hullMax);
  ship.shield = Math.min(ship.shield, s.shieldMax);
  return s;
}

export const cargoUsed = (ship) => Object.values(ship.cargo).reduce((a, b) => a + b, 0);
export const cargoFree = (ship) => Math.max(0, ship.stats.cargoMax - cargoUsed(ship));

export function addCargo(ship, id, qty) {
  const take = Math.min(qty, cargoFree(ship));
  if (take <= 0) return 0;
  ship.cargo[id] = (ship.cargo[id] || 0) + take;
  return take;
}

export function removeCargo(ship, id, qty) {
  const have = ship.cargo[id] || 0;
  const take = Math.min(have, qty);
  if (take <= 0) return 0;
  ship.cargo[id] = have - take;
  if (ship.cargo[id] <= 0) delete ship.cargo[id];
  return take;
}

/* ---------------------------------------------------------------- flight */

const _f = v3(), _r = v3(), _u = v3(), _tmp = v3(), _lat = v3();

/** control = { pitch, yaw, roll, throttle } with inputs in -1..1 */
export function flyShip(ship, control, dt) {
  const s = ship.stats;
  const dead = ship.disabled || ship.dead;
  const turn = dead ? 0 : s.turn;

  // angular: smooth toward the demanded rate, then integrate the quaternion
  const k = 1 - Math.exp(-7 * dt);
  ship.rate[0] = lerp(ship.rate[0], (control.pitch || 0) * turn, k);
  ship.rate[1] = lerp(ship.rate[1], (control.yaw || 0) * turn, k);
  ship.rate[2] = lerp(ship.rate[2], (control.roll || 0) * turn * 1.3, k);
  if (dead) {
    ship.rate[0] *= Math.exp(-0.35 * dt);
    ship.rate[1] *= Math.exp(-0.35 * dt);
    ship.rate[2] *= Math.exp(-0.35 * dt);
  }
  if (Math.abs(ship.rate[0]) > 1e-5) qspin(ship.quat, [1, 0, 0], ship.rate[0] * dt);
  if (Math.abs(ship.rate[1]) > 1e-5) qspin(ship.quat, [0, 1, 0], ship.rate[1] * dt);
  if (Math.abs(ship.rate[2]) > 1e-5) qspin(ship.quat, [0, 0, 1], ship.rate[2] * dt);
  qnorm(ship.quat);

  // linear
  qforward(_f, ship.quat);
  const th = dead ? 0 : clamp(control.throttle ?? ship.throttle, -1, 1);
  ship.throttle = th;
  const accel = th >= 0 ? s.accel * th : s.accel * th * s.reverse;
  vaddScaled(ship.vel, ship.vel, _f, accel * dt);

  if (ship.assist && !dead) {
    // bleed off sideways drift and clamp to the hull's rated speed
    const along = vdot(ship.vel, _f);
    vscale(_lat, _f, along);
    vsub(_lat, ship.vel, _lat);
    const damp = Math.exp(-1.9 * dt);
    vscale(_lat, _lat, damp);                            // sideways component decays
    vscale(_tmp, _f, along);                             // forward component is kept
    vadd(ship.vel, _lat, _tmp);
    const sp = vlen(ship.vel);
    if (sp > s.maxSpeed) vscale(ship.vel, ship.vel, s.maxSpeed / sp);
  } else {
    vscale(ship.vel, ship.vel, Math.exp(-0.02 * dt));
    const sp = vlen(ship.vel);
    const hard = s.maxSpeed * 1.8;
    if (sp > hard) vscale(ship.vel, ship.vel, hard / sp);
  }

  vaddScaled(ship.pos, ship.pos, ship.vel, dt);
}

export function regen(ship, dt, inCombat) {
  const s = ship.stats;
  ship.energy = Math.min(s.energyMax, ship.energy + s.energyRate * dt);
  if (!ship.disabled) {
    if (!inCombat) ship.shield = Math.min(s.shieldMax, ship.shield + s.shieldRate * dt);
    else ship.shield = Math.min(s.shieldMax, ship.shield + s.shieldRate * 0.25 * dt);
    if (s.repair && !inCombat) ship.hull = Math.min(s.hullMax, ship.hull + s.repair * dt);
  }
  ship.ion = Math.max(0, ship.ion - dt * 6);
  ship.flash = Math.max(0, ship.flash - dt * 3);
}

/* -------------------------------------------------------------- gunnery */

const _muzzle = v3(), _dir = v3(), _lead = v3(), _rel = v3();

export function mountWorldPos(out, ship, hp) {
  qrot(out, ship.quat, hp.offset);
  vscale(out, out, ship.scale);
  return vadd(out, out, ship.pos);
}

/** Fire one hardpoint down `dir`. Returns true when a shot went out. */
export function fireMount(ship, hp, dir, world, forceTarget = null) {
  const m = MODULES[hp.moduleId];
  if (!m || hp.cd > 0) return false;
  if (ship.energy < m.energy * (m.beam ? 0.2 : 1)) return false;
  mountWorldPos(_muzzle, ship, hp);
  vnorm(_dir, dir);

  if (m.beam) {
    ship.energy -= m.energy * (1 / 60);
    hp.cd = 0;
    hp.firing = true;
    world.fireBeam(ship, hp, m, _muzzle, _dir);
    return true;
  }

  ship.energy -= m.energy;
  hp.cd = m.rate;
  const spread = m.spread || 0;
  const vx = _dir[0] + (Math.random() - 0.5) * spread;
  const vy = _dir[1] + (Math.random() - 0.5) * spread;
  const vz = _dir[2] + (Math.random() - 0.5) * spread;
  vnorm(_dir, vset(_tmp, vx, vy, vz));
  world.spawnProjectile({
    pos: _muzzle, dir: _dir, speed: m.speed, owner: ship, module: m,
    inherit: ship.vel, target: forceTarget,
  });
  return true;
}

/** Auto-turrets: acquire, track, and shoot without the pilot. */
export function updateTurrets(ship, world, dt) {
  for (const hp of ship.hardpoints) {
    hp.cd = Math.max(0, hp.cd - dt);
    if (hp.firing) hp.firing = false;
    const m = MODULES[hp.moduleId];
    if (!m || m.mount !== 'auto') continue;
    if (ship.disabled || ship.dead) continue;

    // retarget periodically
    hp.retarget = (hp.retarget || 0) - dt;
    if (!hp.target || hp.target.dead || hp.retarget <= 0 ||
        vdist(hp.target.pos, ship.pos) > m.range * 1.15) {
      hp.target = world.findTurretTarget(ship, m);
      hp.retarget = 0.4 + Math.random() * 0.4;
    }
    const t = hp.target;
    if (!t) continue;

    mountWorldPos(_muzzle, ship, hp);
    leadTarget(_lead, _muzzle, t.pos, t.vel || [0, 0, 0], m.speed);
    vsub(_dir, _lead, _muzzle);
    const dist = vlen(_dir);
    if (dist > m.range) { hp.target = null; continue; }
    vnorm(_dir, _dir);

    // servo tracking within the mount's arc
    const track = 1 - Math.exp(-(m.track || 2.5) * dt);
    hp.aim[0] = lerp(hp.aim[0], _dir[0], track);
    hp.aim[1] = lerp(hp.aim[1], _dir[1], track);
    hp.aim[2] = lerp(hp.aim[2], _dir[2], track);
    vnorm(hp.aim, hp.aim);

    qforward(_f, ship.quat);
    if (vdot(hp.aim, _f) < Math.cos((m.arc || 2.6) / 2 + 0.35)) continue;   // outside the arc
    if (vdot(hp.aim, _dir) < 0.995) continue;                               // still slewing
    fireMount(ship, hp, hp.aim, world, t);
  }
}

/* ---------------------------------------------------------------- damage */

export function damageShip(ship, amount, world, opts = {}) {
  if (ship.dead) return;
  const isPlayer = ship === world.player.ship;
  ship.lastHitAt = world.time;
  ship.flash = 1;
  if (opts.from) ship.lastHitBy = opts.from;
  if (opts.ion) {
    ship.ion += opts.ion;
    if (ship.ion > 40 && !ship.disabled && !isPlayer) disableShip(ship, world);
  }
  let dmg = amount * (isPlayer ? world.playerDamageScale() : 1);
  const shieldBefore = ship.shield;
  if (ship.shield > 0) {
    const absorbed = Math.min(ship.shield, dmg);
    ship.shield -= absorbed;
    dmg -= absorbed;
    world.fx.shieldHit(ship, opts.point);
  }
  if (isPlayer) world.notePlayerDamage(amount, shieldBefore, opts);
  if (dmg <= 0) return;
  ship.hull -= dmg;

  // wounded civilian hulls strike their colours instead of blowing up
  const frac = ship.hull / ship.stats.hullMax;
  if (frac <= 0.22 && !ship.disabled && !isPlayer) {
    const surrenders = ship.faction === 'trader' || ship.faction === 'civilian'
      ? 0.95 : ship.faction === 'pirate' ? 0.35 : 0.5;
    if (Math.random() < surrenders) { disableShip(ship, world); ship.hull = Math.max(1, ship.hull); return; }
  }
  if (ship.hull <= 0) destroyShip(ship, world, opts.from);
}

export function disableShip(ship, world) {
  ship.disabled = true;
  ship.throttle = 0;
  ship.shield = 0;
  ship.ion = 0;
  world.log(`${ship.name} IS ADRIFT — SYSTEMS DOWN`, 'warn');
  world.fx.sparks(ship.pos, 18, ship.radius);
}

export function destroyShip(ship, world, killer) {
  if (ship.dead) return;
  ship.dead = true;
  ship.deadAt = world.time;
  world.fx.explode(ship.pos, ship.vel, ship.radius * 2.4, 1);
  // scatter part of the hold
  const items = Object.entries(ship.cargo);
  for (const [id, qty] of items) {
    let left = Math.ceil(qty * 0.45);
    while (left > 0) {
      const n = Math.min(left, 4 + Math.floor(Math.random() * 6));
      world.spawnPod(ship.pos, ship.vel, id, n);
      left -= n;
    }
  }
  if (killer === world.player.ship) world.onPlayerKill(ship);
}

/** Direction the pilot's own gun points (ship nose or free-look turret). */
export function aimDirection(out, ship, gunnerQuat) {
  if (gunnerQuat) return qforward(out, gunnerQuat);
  return qforward(out, ship.quat);
}
