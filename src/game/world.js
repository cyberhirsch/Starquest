// The sector: entities, spawning, collisions, effects and the spawn director.

import {
  v3, vcopy, vset, vadd, vsub, vscale, vaddScaled, vdot, vlen, vlen2, vnorm, vdist, vdist2,
  vrandSphere, vcross, qid, qaxis, qmul, qnorm, qrot, qforward, qlook, clamp, lerp, rand, randi, pick,
} from '../core/math.js';
import { MODULES, ORES, TRADE, rollAsteroidType, SHIPS } from './data.js';
import { SECTORS, START_SECTOR, sectorOf, arrivalGate } from './sectors.js';
import { Market } from './station.js';
import { ASTEROID_SHAPES, ASTEROID_SHAPES_LOW } from '../render/models.js';
import { ORE_COLORS } from '../render/palette.js';
import {
  createShip, flyShip, regen, updateTurrets, damageShip, destroyShip, disableShip,
  addCargo, cargoFree, recalc, salvagePool,
} from './ship.js';
import { runAI } from './ai.js';

export const SECTOR_R = 5200;

class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(x, y, z) {
    const c = this.cell;
    return `${Math.floor(x / c)},${Math.floor(y / c)},${Math.floor(z / c)}`;
  }
  rebuild(items) {
    this.map.clear();
    for (const it of items) {
      const k = this.key(it.pos[0], it.pos[1], it.pos[2]);
      let b = this.map.get(k);
      if (!b) this.map.set(k, (b = []));
      b.push(it);
    }
  }
  near(pos, radius, out) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((pos[0] - radius) / c), x1 = Math.floor((pos[0] + radius) / c);
    const y0 = Math.floor((pos[1] - radius) / c), y1 = Math.floor((pos[1] + radius) / c);
    const z0 = Math.floor((pos[2] - radius) / c), z1 = Math.floor((pos[2] + radius) / c);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const b = this.map.get(`${x},${y},${z}`);
      if (b) for (const it of b) out.push(it);
    }
    return out;
  }
}

const _a = v3(), _b = v3(), _c = v3(), _d = v3(), _e = v3();

export class World {
  constructor(player) {
    this.time = 0;
    this.player = player;
    this.ships = [];
    this.asteroids = [];
    this.projectiles = [];
    this.pods = [];
    this.particles = [];
    this.rings = [];
    this.beams = [];
    this.station = null;
    this.sector = null;
    this.gates = [];
    this.markets = {};              // one per station, kept between visits
    this.messages = [];
    this.grid = new Grid(420);
    this._near = [];
    this.oreAccum = {};
    this.spawnTimer = 4;
    this.traderTimer = 6;
    this.grace = 75;            // seconds before the belt turns hostile
    this.lastHit = null;
    this.kills = 0;
    this.onLog = null;
    this.onKill = null;
    this.fx = {
      explode: (p, v, size, power) => this.explode(p, v, size, power),
      sparks: (p, n, size) => this.sparks(p, n, size),
      shieldHit: (ship, point) => this.shieldFlash(ship, point),
    };
  }

  /** New pilots take a fraction of every hit until they have some standing. */
  playerDamageScale() {
    const t = clamp(this.player.threat, 0, 1.5);
    return lerp(0.45, 1, t / 1.5);
  }

  /** Tell the player what just hit them, and from where. */
  notePlayerDamage(amount, shieldBefore, opts = {}) {
    const ship = this.player.ship;
    const src = opts.from && opts.from !== ship ? opts.from : null;
    this.lastHit = {
      t: this.time,
      from: src,
      cause: opts.cause || (src ? 'fire' : 'impact'),
      dir: src ? vnorm(v3(), vsub(v3(), src.pos, ship.pos)) : null,
      amount,
    };
    this.onPlayerDamage?.(this.lastHit);

    const key = opts.cause === 'collision' ? 'collision' : src ? `s${src.id}` : 'unknown';
    this._hitLog = this._hitLog || new Map();
    if (this.time - (this._hitLog.get(key) ?? -99) > 3.5) {
      this._hitLog.set(key, this.time);
      if (opts.cause === 'collision') this.log('HULL IMPACT — WATCH THE ROCKS', 'warn');
      else if (src) this.log(`UNDER FIRE FROM ${src.name}`, 'danger');
      else this.log('TAKING DAMAGE', 'danger');
    }
    if (shieldBefore > 0 && ship.shield <= 0) this.log('SHIELDS DOWN', 'danger');
    const frac = ship.hull / ship.stats.hullMax;
    if (frac < 0.35 && this.time - (this._hullWarn ?? -99) > 6) {
      this._hullWarn = this.time;
      this.log(`HULL AT ${Math.round(frac * 100)}% — DISENGAGE OR DOCK`, 'danger');
    }
  }

  log(text, kind = 'info') {
    this.messages.push({ text, kind, t: this.time });
    if (this.messages.length > 60) this.messages.shift();
    this.onLog?.(text, kind);
  }

  /* ------------------------------------------------------------- build -- */

  /** Build a sector from its definition. Everything else is sector-agnostic. */
  generate(sectorId = START_SECTOR) {
    const def = sectorOf(sectorId);
    this.sector = def;
    this.asteroidTarget = def.asteroids;

    const st = def.station;
    this.station = {
      kind: 'station', name: st.name, def: st,
      pos: vcopy(v3(), st.pos), quat: qid(), radius: st.radius, scale: st.scale,
      spin: 0.06, dockRadius: 130,
      market: this.markets[st.id] || (this.markets[st.id] = new Market(st)),
    };

    this.gates = def.gates.map((g) => ({
      kind: 'gate', to: g.to, name: `GATE — ${sectorOf(g.to).name}`,
      pos: vcopy(v3(), g.pos), quat: qid(), radius: 14, scale: 3.4,
      spin: 0.14,
    }));

    for (let i = 0; i < def.asteroids; i++) this.spawnAsteroid();
    this.spawnPirate(true);          // one, and it starts far away
    for (let i = 0; i < Math.round(2 * def.traders); i++) this.spawnTrader();
    for (let i = 0; i < def.miners; i++) this.spawnMiner();
    for (let i = 0; i < def.derelicts; i++) this.spawnDerelict();
  }

  /** Clear the sector out, keeping the player's ship and anything flying with it. */
  clear() {
    const keep = this.ships.filter((s) => s.faction === 'player' && !s.dead);
    this.ships = keep;
    this.asteroids.length = 0;
    this.projectiles.length = 0;
    this.pods.length = 0;
    this.particles.length = 0;
    this.rings.length = 0;
    this.beams.length = 0;
    this.grace = 45;
  }

  /** Move everything player-side to a new sector and rebuild around it. */
  jumpTo(sectorId) {
    const from = this.sector?.id;
    this.clear();
    this.generate(sectorId);
    const gate = arrivalGate(this.sector, from);
    const here = vcopy(v3(), gate.pos);
    for (const s of this.ships) {
      if (s.faction !== 'player') continue;
      vaddScaled(s.pos, here, vrandSphere(_a, 1), rand(140, 40));
      vscale(s.vel, s.vel, 0.25);
    }
    this.log(`ARRIVED — ${this.sector.name}`, 'good');
    this.log(this.sector.blurb, 'info');
    return this.sector;
  }

  /** A hull that never made it home: adrift, powerless, and worth boarding. */
  spawnDerelict() {
    const cls = pick(['hauler', 'prospector', 'corsair', 'shuttle']);
    // a hull is only worth cutting up if it was fitted out when it died
    // weighted toward workaday gear — a dead prospector is not carrying a flak turret
    const guns = ['pulse', 'pulse', 'pulse', 'pulse', 'mining1', 'mining1', 'mining1',
      'auto1', 'auto1', 'auto1', 'burst', 'burst', 'auto2', 'mining2', 'rail', 'disruptor'];
    const kit = ['shield1', 'shield1', 'shield1', 'hold1', 'hold1', 'hold1', 'tractor', 'tractor',
      'scanner', 'scanner', 'thruster', 'thruster', 'armour', 'repair', 'shield2', 'hold2'];
    const s = createShip(cls, 'civilian', {
      pos: this.randomEdgePoint(v3()),
      name: pick(['THE LONG SILENCE', 'ASHFALL', 'MOTHER OF SPARROWS', 'DEAD RECKONING',
        'LAST TUESDAY', 'COLD COMFORT', 'NO SUCH LUCK']),
      credits: Math.round(rand(5200, 400)),
      loadout: {
        hardpoints: Array.from({ length: SHIPS[cls].hardpoints },
          () => (Math.random() < 0.7 ? pick(guns) : null)),
        utility: Array.from({ length: SHIPS[cls].utility },
          () => (Math.random() < 0.6 ? pick(kit) : null)),
      },
    });
    for (let i = 0; i < 3; i++) {
      const [id, n] = pick([['alloy', 30], ['cells', 22], ['meds', 14], ['gold', 18],
        ['platinum', 10], ['contraband', 12], ['xenite', 8]]);
      addCargo(s, id, randi(n) + 3);
    }
    s.disabled = true;
    s.salvage = salvagePool(s);
    s.hull = s.stats.hullMax * rand(0.3, 0.08);
    s.shield = 0;
    vrandSphere(s.vel, rand(9, 1));
    s.ai = null;
    this.ships.push(s);
    return s;
  }

  spawnAsteroid(opts = {}) {
    const type = opts.type || rollAsteroidType(this.sector?.oreBias);
    const size = opts.size ?? rand(46, 12);
    const pos = opts.pos ? vcopy(v3(), opts.pos) : this.beltPoint(v3());
    const a = {
      kind: 'asteroid', type, size,
      pos,
      vel: opts.vel ? vcopy(v3(), opts.vel) : vrandSphere(v3(), rand(6, 0.5)),
      quat: qnorm(qaxis(qid(), vrandSphere(v3(), 1), rand(Math.PI * 2))),
      spinAxis: vrandSphere(v3(), 1),
      spinRate: rand(0.5, 0.05) * (Math.random() < 0.5 ? -1 : 1),
      shape: ASTEROID_SHAPES[randi(ASTEROID_SHAPES.length)],
      shapeLow: ASTEROID_SHAPES_LOW[randi(ASTEROID_SHAPES_LOW.length)],
      hp: size * 9,
      hpMax: size * 9,
      ore: Math.ceil(size * 0.55 * type.yieldMul),
      flash: 0,
    };
    this.asteroids.push(a);
    return a;
  }

  /** A point inside the belt torus that rings the station. */
  beltPoint(out) {
    const ang = rand(Math.PI * 2);
    const r = rand(4300, 900);
    const y = rand(520, -520);
    return vset(out, Math.cos(ang) * r, y, Math.sin(ang) * r - 400);
  }

  randomEdgePoint(out) {
    vrandSphere(out, 1);
    out[1] *= 0.35;
    return vscale(out, out, rand(SECTOR_R * 0.95, SECTOR_R * 0.6));
  }

  /* ------------------------------------------------------------ spawns -- */

  spawnPirate(far = false) {
    const tier = Math.min(3, Math.floor(this.player.threat));
    const cls = tier >= 2 && Math.random() < 0.35 ? 'marauder' : pick(['corsair', 'marauder', 'shuttle']);
    const guns = tier >= 2 ? ['burst', 'auto2', 'auto1'] : tier >= 1 ? ['pulse', 'auto1', null] : ['pulse', null, null];
    const s = createShip(cls, 'pirate', {
      pos: far ? this.randomEdgePoint(v3()) : this.nearPlayerPoint(v3(), tier < 1 ? 2600 : 1500),
      loadout: { hardpoints: guns, utility: ['shield1', tier >= 2 ? 'thruster' : null, null] },
      credits: Math.round(rand(3200, 400) * (1 + tier)),
      name: pick(['RED VESPER', 'GRAVE JACKAL', 'HOLLOW CROWN', 'NINE TEETH', 'SALT WIDOW', 'BLACK MERIDIAN']),
    });
    for (const [id, q] of [[pick(['iron', 'silicon', 'gold']), randi(14) + 2], ['contraband', randi(6)]]) {
      if (q > 0) addCargo(s, id, q);
    }
    s.ai = { role: 'pirate', state: 'hunt', t: 0, orbit: rand(420, 220), sign: Math.random() < 0.5 ? 1 : -1 };
    this.ships.push(s);
    return s;
  }

  spawnTrader() {
    const cls = Math.random() < 0.4 ? 'hauler' : 'prospector';
    const s = createShip(cls, 'trader', {
      pos: this.randomEdgePoint(v3()),
      loadout: { hardpoints: ['pulse', 'auto1', null, null], utility: ['shield1', 'hold1', null, null] },
      credits: Math.round(rand(9000, 1500)),
      name: pick(['CANDLE OF ARETH', 'LONG PATIENCE', 'MERIDIAN TRUST', 'FAT MARGIN', 'SEVEN SISTERS']),
    });
    const holds = [['alloy', 40], ['cells', 26], ['meds', 16], ['luxuries', 10], ['iron', 60]];
    for (let i = 0; i < 3; i++) { const h = pick(holds); addCargo(s, h[0], randi(h[1]) + 6); }
    if (Math.random() < 0.3) addCargo(s, 'contraband', randi(12) + 3);
    s.ai = { role: 'trader', state: 'travel', t: 0, dest: this.randomEdgePoint(v3()) };
    this.ships.push(s);
    return s;
  }

  spawnMiner() {
    const s = createShip('prospector', 'civilian', {
      pos: this.beltPoint(v3()),
      loadout: { hardpoints: ['mining1', 'auto1'], utility: ['hold1', null, null] },
      credits: Math.round(rand(2600, 300)),
      name: pick(['DUSTY HOPE', 'ROCKHOUND', 'SLOW FORTUNE', 'PIT CANARY']),
    });
    addCargo(s, pick(['iron', 'ice', 'silicon']), randi(30) + 8);
    s.ai = { role: 'miner', state: 'seek', t: 0 };
    this.ships.push(s);
    return s;
  }

  spawnSecurity() {
    const s = createShip('sentinel', 'security', {
      pos: this.nearPlayerPoint(v3(), 2200),
      loadout: { hardpoints: ['rail', 'auto2', 'auto2'], utility: ['shield2', 'thruster', null] },
      name: 'HALCYON PATROL',
    });
    s.ai = { role: 'security', state: 'hunt', t: 0, orbit: rand(520, 300), sign: Math.random() < 0.5 ? 1 : -1 };
    this.ships.push(s);
    this.log('HALCYON PATROL RESPONDING TO YOUR SIGNAL', 'danger');
    return s;
  }

  nearPlayerPoint(out, dist) {
    vrandSphere(out, 1);
    vscale(out, out, dist);
    return vadd(out, out, this.player.ship.pos);
  }

  /* ------------------------------------------------------- projectiles -- */

  spawnProjectile({ pos, dir, speed, owner, module, inherit, target }) {
    const p = {
      pos: vcopy(v3(), pos),
      vel: vaddScaled(v3(), inherit || [0, 0, 0], dir, speed),
      dir: vcopy(v3(), dir),
      life: (module.range || 1200) / speed,
      dmg: module.dmg,
      ion: module.ion || 0,
      oreMul: module.oreMul || 0.15,
      owner, faction: owner.faction, color: module.color,
      len: clamp(speed * 0.018, 4, 26),
      target,
    };
    this.projectiles.push(p);
    return p;
  }

  /** Continuous beam weapon: instant hit test, kept alive for one frame. */
  fireBeam(ship, hp, module, origin, dir) {
    const range = module.range;
    let best = null, bestT = range, bestKind = null;
    this.grid.near(origin, range + 60, this._near);
    for (const a of this._near) {
      const t = rayHit(origin, dir, a.pos, a.size);
      if (t >= 0 && t < bestT) { bestT = t; best = a; bestKind = 'asteroid'; }
    }
    for (const s of this.ships) {
      if (s === ship || s.dead) continue;
      const t = rayHit(origin, dir, s.pos, s.radius * s.scale * 1.15);
      if (t >= 0 && t < bestT) { bestT = t; best = s; bestKind = 'ship'; }
    }
    const end = vaddScaled(v3(), origin, dir, bestT);
    this.beams.push({ a: vcopy(v3(), origin), b: end, color: module.color, hit: !!best });
    if (!best) return;

    const dt = 1 / 60;
    if (bestKind === 'asteroid') {
      this.mineAsteroid(best, module, ship, dt, end);
    } else if (module.cut) {
      this.stripHulk(best, module, ship, dt, end);
    } else {
      damageShip(best, module.dmg * dt * 2.2, this, { from: ship, point: end, ion: (module.ion || 0) * dt });
      if (Math.random() < 0.4) this.sparks(end, 1, 2);
    }
  }

  mineAsteroid(a, module, ship, dt, point) {
    const bonus = ship.stats?.miningBonus ?? 1;
    a.hp -= module.dmg * dt * 6 * bonus;
    a.flash = 1;
    if (Math.random() < 0.35) this.sparks(point, 1, 3, ORE_COLORS[a.type.ore]);
    // steady trickle straight into the hold
    const gain = module.dmg * dt * 0.045 * (module.oreMul || 1) * a.type.yieldMul * bonus;
    if (ship === this.player.ship) {
      const key = a.type.ore;
      this.oreAccum[key] = (this.oreAccum[key] || 0) + gain;
      while (this.oreAccum[key] >= 1) {
        this.oreAccum[key] -= 1;
        if (addCargo(ship, key, 1) === 0) { this.warnHoldFull(); break; }
      }
    }
    if (a.hp <= 0) this.breakAsteroid(a, ship);
  }

  /** Cut a dead hull apart: scrap into the hold, fittings out whole. */
  stripHulk(hulk, module, by, dt, point) {
    if (!hulk.disabled || hulk.dead) {
      if (this.time - (this._cutWarn || -99) > 4) {
        this._cutWarn = this.time;
        this.log('CUTTER NEEDS A HULL WITH ITS POWER DOWN', 'warn');
      }
      return;
    }
    hulk.salvage = hulk.salvage || salvagePool(hulk);
    const pool = hulk.salvage;
    const cut = Math.min(module.cut * dt, pool.integrity);
    pool.integrity -= cut;
    hulk.flash = 1;
    if (Math.random() < 0.5) this.sparks(point, 1, 3, [1, 0.75, 0.3]);

    const mine = by === this.player.ship;
    const frac = cut / pool.max;

    if (mine) {
      this.scrapAccum = (this.scrapAccum || 0) + frac * pool.scrap;
      while (this.scrapAccum >= 1) {
        this.scrapAccum -= 1;
        if (addCargo(by, 'scrap', 1) === 0) { this.warnHoldFull(); break; }
      }
      // fittings come out whole, spaced through the cut
      const step = pool.max / (pool.modules.length + 1);
      while (pool.modules.length && pool.integrity < step * pool.modules.length) {
        const id = pool.modules.pop();
        this.player.addModule(id);
        this.player.stats.salvaged = (this.player.stats.salvaged || 0) + 1;
        this.log(`RECOVERED — ${MODULES[id]?.name || id}`, 'good');
      }
    }

    if (pool.integrity <= 0) this.breakHulk(hulk, by, mine);
  }

  breakHulk(hulk, by, mine) {
    if (mine && hulk.salvage?.cores) addCargo(by, 'cores', hulk.salvage.cores);
    for (const [id, qty] of Object.entries(hulk.cargo)) {
      if (qty > 0) this.spawnPod(hulk.pos, hulk.vel, id, qty);
    }
    hulk.cargo = {};
    hulk.dead = true;
    hulk.deadAt = this.time;
    this.explode(hulk.pos, hulk.vel, hulk.radius * 2.2, 0.8);
    this.log(`${hulk.name} STRIPPED TO SPARS`, 'good');
    this.onHulkStripped?.(hulk);
  }

  warnHoldFull() {
    if (this.time - (this._holdWarn || -99) > 4) {
      this._holdWarn = this.time;
      this.log('CARGO HOLD FULL', 'warn');
    }
  }

  breakAsteroid(a, by) {
    const i = this.asteroids.indexOf(a);
    if (i >= 0) this.asteroids.splice(i, 1);
    this.explode(a.pos, a.vel, a.size * 1.6, 0.5, ORE_COLORS[a.type.ore]);
    const drops = Math.max(1, Math.round(a.ore * 0.5));
    let left = drops;
    while (left > 0) {
      const n = Math.min(left, 3 + randi(5));
      this.spawnPod(a.pos, a.vel, a.type.ore, n);
      left -= n;
    }
    if (a.size > 20) {
      const n = 2 + randi(2);
      for (let k = 0; k < n; k++) {
        const child = this.spawnAsteroid({
          type: a.type, size: a.size * rand(0.55, 0.35),
          pos: vaddScaled(v3(), a.pos, vrandSphere(_a, 1), a.size * 0.6),
          vel: vaddScaled(v3(), a.vel, vrandSphere(_b, 1), rand(22, 8)),
        });
        child.flash = 1;
      }
    }
    if (by === this.player.ship) this.player.stats.rocks++;
    // keep the belt populated
    if (this.asteroids.length < (this.asteroidTarget ?? 190)) this.spawnAsteroid();
  }

  spawnPod(pos, vel, item, qty) {
    this.pods.push({
      kind: 'pod', item, qty,
      pos: vaddScaled(v3(), pos, vrandSphere(_a, 1), rand(14, 3)),
      vel: vaddScaled(v3(), vel || [0, 0, 0], vrandSphere(_b, 1), rand(18, 4)),
      quat: qnorm(qaxis(qid(), vrandSphere(v3(), 1), rand(6.28))),
      spinAxis: vrandSphere(v3(), 1), spinRate: rand(2.2, 0.4),
      life: 150,
    });
  }

  /* ----------------------------------------------------------- effects -- */

  explode(pos, vel, size, power = 1, color = null) {
    const n = Math.round(clamp(size * 0.7, 6, 26));
    for (let i = 0; i < n; i++) {
      const dir = vrandSphere(v3(), 1);
      this.particles.push({
        pos: vaddScaled(v3(), pos, dir, size * 0.2),
        vel: vaddScaled(v3(), vel || [0, 0, 0], dir, rand(size * 3.2, size * 0.8)),
        len: rand(size * 0.5, size * 0.12),
        life: rand(1.5, 0.5) * (0.6 + power), maxLife: 0, color, spin: rand(6, -6),
      });
    }
    for (const p of this.particles) if (p.maxLife === 0) p.maxLife = p.life;
    this.rings.push({ pos: vcopy(v3(), pos), r: size * 0.3, rMax: size * 3.4, life: 0.55, maxLife: 0.55, color });
  }

  sparks(pos, n = 6, size = 3, color = null) {
    for (let i = 0; i < n; i++) {
      const dir = vrandSphere(v3(), 1);
      this.particles.push({
        pos: vcopy(v3(), pos),
        vel: vscale(v3(), dir, rand(size * 9, size * 2)),
        len: rand(size * 0.9, size * 0.3),
        life: rand(0.5, 0.15), maxLife: 0.5, color, spin: 0,
      });
    }
  }

  shieldFlash(ship, point) {
    this.rings.push({
      pos: vcopy(v3(), point || ship.pos), r: ship.radius * ship.scale * 0.5,
      rMax: ship.radius * ship.scale * 1.5, life: 0.22, maxLife: 0.22, color: [0.4, 0.8, 1],
    });
  }

  /* -------------------------------------------------------- targeting -- */

  isHostile(a, b) {
    if (!a || !b || a === b || b.dead) return false;
    if (b.disabled) return false;
    if (a.faction === b.faction) return false;
    const A = a.faction, B = b.faction;
    if (A === 'pirate') return B !== 'pirate';
    if (B === 'pirate') return true;
    if (A === 'security') return B === 'player' && this.player.wanted > 0;
    if (B === 'security') return A === 'player' && this.player.wanted > 0;
    if (a.angryAt === b || b.angryAt === a) return true;
    return false;
  }

  findTurretTarget(ship, module) {
    let best = null, bestD = module.range * module.range;
    if (module.minesRocks) {
      this.grid.near(ship.pos, module.range, this._near);
      for (const a of this._near) {
        const d = vdist2(ship.pos, a.pos);
        if (d < bestD) { bestD = d; best = a; }
      }
      if (best) return best;
    }
    for (const s of this.ships) {
      if (s === ship || s.dead || s.disabled) continue;
      if (!this.isHostile(ship, s)) continue;
      const d = vdist2(ship.pos, s.pos);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Nearest lockable contact to the player's crosshair. */
  pickTarget(from, dir, maxAngle = 0.35) {
    let best = null, bestScore = Infinity;
    const check = (o, r) => {
      vsub(_a, o.pos, from);
      const d = vlen(_a);
      if (d < 1) return;
      vscale(_b, _a, 1 / d);
      const cos = vdot(_b, dir);
      if (cos < Math.cos(maxAngle)) return;
      const score = d * (1.2 - cos);
      if (score < bestScore) { bestScore = score; best = o; }
    };
    for (const s of this.ships) if (!s.dead) check(s, s.radius);
    for (const a of this.asteroids) check(a, a.size);
    if (this.station) check(this.station, this.station.radius * this.station.scale);
    for (const g of this.gates) check(g, g.radius * g.scale);
    return best;
  }

  cycleTarget(current) {
    const list = this.ships.filter((s) => !s.dead)
      .sort((x, y) => vdist2(this.player.ship.pos, x.pos) - vdist2(this.player.ship.pos, y.pos));
    if (!list.length) return null;
    const i = list.indexOf(current);
    return list[(i + 1) % list.length];
  }

  onPlayerKill(ship) {
    this.kills++;
    this.player.stats.kills++;
    if (ship.faction === 'pirate') {
      const bounty = Math.round(600 + ship.cls.price * 0.05 + Math.random() * 400);
      this.player.credits += bounty;
      this.player.wanted = Math.max(0, this.player.wanted - 150);
      this.log(`BOUNTY PAID +${bounty} CR — ${ship.name} DESTROYED`, 'good');
    } else {
      const fine = ship.faction === 'security' ? 4000 : 1800;
      this.player.wanted += fine;
      this.log(`UNLAWFUL KILL — BOUNTY ON YOU +${fine} CR`, 'danger');
    }
    this.onKill?.(ship);
    this.onContractKill?.(ship);
  }

  /* ------------------------------------------------------------ update -- */

  update(dt) {
    this.time += dt;
    this.beams.length = 0;
    const player = this.player.ship;

    this.grid.rebuild(this.asteroids);

    // ships
    for (const s of this.ships) {
      if (s.dead) continue;
      if (s !== player) runAI(s, this, dt);
      updateTurrets(s, this, dt);
      regen(s, dt, this.time - s.lastHitAt < 5);
      if (s !== player) flyShip(s, s.control || { throttle: s.throttle }, dt);
      this.confine(s, dt);
    }
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      if (s.dead && this.time - s.deadAt > 0.2) this.ships.splice(i, 1);
    }

    // asteroids
    for (const a of this.asteroids) {
      vaddScaled(a.pos, a.pos, a.vel, dt);
      qmul(a.quat, a.quat, qaxis(_qtmp, a.spinAxis, a.spinRate * dt));
      qnorm(a.quat);
      a.flash = Math.max(0, a.flash - dt * 2.5);
      if (vlen2(a.pos) > SECTOR_R * SECTOR_R * 1.3) {
        vnorm(_a, a.pos); vscale(a.vel, _a, -Math.abs(vlen(a.vel)) || -5);
      }
    }

    this.updateProjectiles(dt);
    this.updatePods(dt);
    this.updateParticles(dt);
    this.collideShips(dt);

    if (this.station) {
      const q = qaxis(_qtmp, [0, 0, 1], this.station.spin * dt);
      qmul(this.station.quat, this.station.quat, q);
      qnorm(this.station.quat);
    }
    for (const g of this.gates) {
      qmul(g.quat, g.quat, qaxis(_qtmp, [0, 0, 1], g.spin * dt));
      qnorm(g.quat);
    }

    this.director(dt);
  }

  confine(s, dt) {
    const d2 = vlen2(s.pos);
    if (d2 > SECTOR_R * SECTOR_R) {
      const d = Math.sqrt(d2);
      vnorm(_a, s.pos);
      const pull = (d - SECTOR_R) * 0.6;
      vaddScaled(s.vel, s.vel, _a, -pull * dt);
      if (s === this.player.ship && this.time - (this._edgeWarn || -99) > 6) {
        this._edgeWarn = this.time;
        this.log('NAV BUOY LIMIT — TURN BACK', 'warn');
      }
    }
  }

  updateProjectiles(dt) {
    const list = this.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      vcopy(_a, p.pos);
      vaddScaled(p.pos, p.pos, p.vel, dt);
      p.life -= dt;
      let hit = null, hitPoint = null;

      // ships
      for (const s of this.ships) {
        if (s === p.owner || s.dead) continue;
        const r = s.radius * s.scale * 1.1;
        const t = segSphere(_a, p.pos, s.pos, r);
        if (t >= 0) { hit = s; hitPoint = vaddScaled(v3(), _a, vsub(_b, p.pos, _a), t); break; }
      }
      // asteroids
      if (!hit) {
        this.grid.near(p.pos, 90, this._near);
        for (const a of this._near) {
          const t = segSphere(_a, p.pos, a.pos, a.size);
          if (t >= 0) { hit = a; hitPoint = vaddScaled(v3(), _a, vsub(_b, p.pos, _a), t); break; }
        }
      }

      if (hit) {
        if (hit.kind === 'ship') {
          damageShip(hit, p.dmg, this, { from: p.owner, point: hitPoint, ion: p.ion });
          if (hit.faction !== 'pirate' && p.owner === this.player.ship) this.provoke(hit);
        } else {
          hit.hp -= p.dmg * (p.oreMul > 1 ? p.oreMul * 0.4 : 1);
          hit.flash = 1;
          this.sparks(hitPoint, 2, 2.5, ORE_COLORS[hit.type.ore]);
          if (p.owner === this.player.ship && p.oreMul > 1) {
            const key = hit.type.ore;
            this.oreAccum[key] = (this.oreAccum[key] || 0) + p.dmg * 0.02 * p.oreMul;
            while (this.oreAccum[key] >= 1) {
              this.oreAccum[key] -= 1;
              if (addCargo(this.player.ship, key, 1) === 0) break;
            }
          }
          if (hit.hp <= 0) this.breakAsteroid(hit, p.owner);
        }
        this.sparks(hitPoint, 3, 2.4);
        list.splice(i, 1);
        continue;
      }
      if (p.life <= 0) list.splice(i, 1);
    }
  }

  /** Shooting a neutral makes it — and the law — take an interest. */
  provoke(ship) {
    if (ship.faction === 'pirate' || ship.faction === 'player') return;
    if (ship.angryAt !== this.player.ship) {
      ship.angryAt = this.player.ship;
      if (ship.ai) { ship.ai.state = ship.faction === 'security' ? 'hunt' : 'flee'; ship.ai.t = 0; }
      this.player.wanted += 250;
      this.log(`${ship.name} BROADCASTS A DISTRESS CALL`, 'warn');
    }
  }

  updatePods(dt) {
    const p = this.player.ship;
    const tractor = p.stats.tractor;
    for (let i = this.pods.length - 1; i >= 0; i--) {
      const pod = this.pods[i];
      pod.life -= dt;
      vsub(_a, p.pos, pod.pos);
      const d = vlen(_a);
      if (d < tractor) {
        vscale(_a, _a, 1 / Math.max(d, 1e-4));
        const pull = lerp(90, 12, d / tractor);
        vaddScaled(pod.vel, pod.vel, _a, pull * dt);
        vscale(pod.vel, pod.vel, Math.exp(-1.1 * dt));
      }
      vaddScaled(pod.pos, pod.pos, pod.vel, dt);
      qmul(pod.quat, pod.quat, qaxis(_qtmp, pod.spinAxis, pod.spinRate * dt));
      if (d < 26 + p.radius * p.scale) {
        const got = addCargo(p, pod.item, pod.qty);
        if (got > 0) {
          this.log(`+${got} ${(ORES[pod.item] || TRADE[pod.item] || { name: pod.item }).name}`, 'good');
          this.player.stats.mined += got;
          pod.qty -= got;
        } else this.warnHoldFull();
        if (pod.qty <= 0) { this.pods.splice(i, 1); continue; }
      }
      if (pod.life <= 0) this.pods.splice(i, 1);
    }
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      vaddScaled(p.pos, p.pos, p.vel, dt);
      vscale(p.vel, p.vel, Math.exp(-0.7 * dt));
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      r.r = lerp(r.rMax, r.r, Math.exp(-6 * dt));
      if (r.life <= 0) this.rings.splice(i, 1);
    }
  }

  /** Hulls bounce off rocks (and each other) and take the bruise. */
  collideShips(dt) {
    for (const s of this.ships) {
      if (s.dead) continue;
      const sr = s.radius * s.scale;
      this.grid.near(s.pos, sr + 60, this._near);
      for (const a of this._near) {
        const min = sr + a.size;
        const d2 = vdist2(s.pos, a.pos);
        if (d2 > min * min) continue;
        const d = Math.max(Math.sqrt(d2), 1e-3);
        vsub(_a, s.pos, a.pos);
        vscale(_a, _a, 1 / d);
        const overlap = min - d;
        vaddScaled(s.pos, s.pos, _a, overlap);
        const vn = vdot(s.vel, _a);
        if (vn < 0) {
          vaddScaled(s.vel, s.vel, _a, -vn * 1.5);
          const impact = Math.abs(vn);
          if (impact > 34) {
            damageShip(s, impact * 0.20, this, { point: s.pos, cause: 'collision' });
            this.sparks(s.pos, 4, 3);
          }
        }
        vaddScaled(a.vel, a.vel, _a, -8 * dt * (s.cls.mass / a.size));
      }
    }
  }

  director(dt) {
    this.grace = Math.max(0, this.grace - dt);
    this.spawnTimer -= dt;
    this.traderTimer -= dt;
    const pirates = this.ships.filter((s) => s.faction === 'pirate' && !s.dead).length;
    const want = this.grace > 0 ? 0
      : Math.round((2 + Math.floor(this.player.threat)) * (this.sector?.pirates ?? 1));
    if (this.spawnTimer <= 0) {
      this.spawnTimer = rand(26, 14);
      // early on they always arrive from a distance, so you see them coming
      if (pirates < want) this.spawnPirate(this.player.threat < 1 ? true : Math.random() < 0.5);
    }
    if (this.traderTimer <= 0) {
      this.traderTimer = rand(50, 25);
      const civ = this.ships.filter((s) => s.faction !== 'pirate' && s.faction !== 'security').length;
      const wantCiv = Math.round(6 * (this.sector?.traders ?? 1));
      if (civ < wantCiv) (Math.random() < 0.5 ? this.spawnTrader() : this.spawnMiner()).ai.t = 0;
    }
    // the graveyard restocks, or the salvage trade dries up
    this.derelictTimer = (this.derelictTimer ?? 40) - dt;
    if (this.derelictTimer <= 0) {
      this.derelictTimer = rand(70, 40);
      const want = this.sector?.derelicts ?? 0;
      const have = this.ships.filter((s) => s.disabled && !s.dead && !s.looted).length;
      if (want && have < want) this.spawnDerelict();
    }

    // the law turns up when you have a price on your head
    this.secTimer = (this.secTimer ?? 20) - dt;
    if (this.secTimer <= 0) {
      this.secTimer = 30;
      const sec = this.ships.filter((s) => s.faction === 'security' && !s.dead).length;
      if (this.sector?.lawful && this.player.wanted > 1200 && sec < 2) this.spawnSecurity();
    }
  }
}

const _qtmp = [0, 0, 0, 1];

/** Ray/sphere: returns distance along dir, or -1. */
function rayHit(org, dir, center, radius) {
  const ox = org[0] - center[0], oy = org[1] - center[1], oz = org[2] - center[2];
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq, t1 = -b + sq;
  if (t0 >= 0) return t0;
  if (t1 >= 0) return t1;
  return -1;
}

/** Segment/sphere test: returns 0..1 along the segment, or -1. */
function segSphere(a, b, center, radius) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return -1;
  const t = rayHit(a, [dx / len, dy / len, dz / len], center, radius);
  if (t < 0 || t > len) return -1;
  return t / len;
}
