// Player state: hangar, credits, wanted level, module storage, persistence.

import { createShip, applyLoadout, getLoadout, recalc, cargoUsed } from './ship.js';
import { SHIPS, MODULES, ITEMS } from './data.js';
import { qid, v3 } from '../core/math.js';

const SAVE_KEY = 'starquest.save.v1';

const STARTER = {
  classId: 'shuttle',
  loadout: { hardpoints: ['pulse', 'mining1'], utility: ['tractor', null] },
};

/** Old saves predate hull changes: pad or trim a loadout to the current slots. */
function migrateHull(entry) {
  const cls = SHIPS[entry.classId];
  const src = entry.loadout || {};
  const fit = (list, n) => {
    const out = (list || []).slice(0, n);
    while (out.length < n) out.push(null);
    return out;
  };
  return {
    classId: entry.classId,
    loadout: {
      hardpoints: fit(src.hardpoints, cls.hardpoints),
      utility: fit(src.utility, cls.utility),
    },
  };
}

/** A save from before the starter kit changed can leave a pilot unable to mine. */
function grantMissingBasics(p) {
  const owns = (pred) => Object.keys(p.storage).some(pred)
    || p.hangar.some((h) => h.loadout.hardpoints.some((id) => id && pred(id))
      || h.loadout.utility.some((id) => id && pred(id)));
  const active = p.hangar[p.active];
  const fitInto = (list, id) => {
    const slot = list.indexOf(null);
    if (slot >= 0) { list[slot] = id; return true; }
    return false;
  };
  if (!owns((id) => MODULES[id]?.beam)) {
    if (!fitInto(active.loadout.hardpoints, 'mining1')) p.addModule('mining1');
  }
  if (!owns((id) => MODULES[id]?.tractor)) {
    if (!fitInto(active.loadout.utility, 'tractor')) p.addModule('tractor');
  }
}

export class Player {
  constructor() {
    this.credits = 4500;
    this.wanted = 0;
    this.hangar = [{
      classId: 'shuttle',
      loadout: { hardpoints: ['pulse', 'mining1'], utility: ['tractor', null] },
    }];
    this.active = 0;
    this.storage = {};                              // modules owned but not fitted
    this.tutorial = { step: 0, done: false };
    this.sector = 'halcyon';
    this.contracts = [];
    this.crew = [];
    this.distress = null;
    this.tracked = null;                            // the contract on the HUD
    this.lastSaved = 0;
    this.stats = { kills: 0, mined: 0, rocks: 0, boarded: 0, earned: 0, docked: 0 };
    this.vouchers = {};                             // classId -> discount claims from boarding
    this.mode = 'pilot';                            // 'pilot' | 'gunner'
    this.docked = false;
    this.target = null;
    this.ship = null;
    this.gunner = qid();                            // free-look turret orientation
    this.gunnerYaw = 0;
    this.gunnerPitch = 0;
    this.assist = true;
  }

  get threat() {
    const value = SHIPS[this.hangar[this.active].classId].price;
    return Math.min(3, value / 55000 + this.stats.kills / 14 + this.wanted / 6000);
  }

  buildShip(world) {
    const entry = this.hangar[this.active];
    const keepCargo = this.ship ? this.ship.cargo : {};
    const pos = this.ship ? this.ship.pos : v3(0, 0, -1000);
    const quat = this.ship ? this.ship.quat : qid();
    const s = createShip(entry.classId, 'player', { pos, quat, loadout: entry.loadout, name: 'YOUR SHIP' });
    s.cargo = keepCargo;
    s.assist = this.assist;
    recalc(s, true);
    this.ship = s;
    if (world) {
      const i = world.ships.findIndex((x) => x.faction === 'player');
      if (i >= 0) world.ships[i] = s; else world.ships.push(s);
    }
    return s;
  }

  syncLoadout() {
    this.hangar[this.active].loadout = getLoadout(this.ship);
  }

  /* ------------------------------------------------------------ modules */

  ownedCount(id) { return this.storage[id] || 0; }

  addModule(id, n = 1) { this.storage[id] = (this.storage[id] || 0) + n; }

  takeModule(id) {
    if (!this.storage[id]) return false;
    this.storage[id] -= 1;
    if (this.storage[id] <= 0) delete this.storage[id];
    return true;
  }

  /** Fit a module from storage into a slot; returns a status string. */
  install(id, slotKind, index) {
    const m = MODULES[id];
    if (!m) return 'UNKNOWN MODULE';
    if (m.slot !== slotKind) return `${m.name} DOES NOT FIT THAT SLOT`;
    const ship = this.ship;
    const list = slotKind === 'hardpoint' ? ship.hardpoints : ship.utility;
    if (index < 0 || index >= list.length) return 'NO SUCH SLOT';
    if (!this.takeModule(id)) return 'NOT IN STORAGE';
    const prev = slotKind === 'hardpoint' ? list[index].moduleId : list[index];
    if (prev) this.addModule(prev);
    if (slotKind === 'hardpoint') { list[index].moduleId = id; list[index].target = null; }
    else list[index] = id;
    recalc(ship);
    this.syncLoadout();
    return `${m.name} INSTALLED`;
  }

  uninstall(slotKind, index) {
    const ship = this.ship;
    const list = slotKind === 'hardpoint' ? ship.hardpoints : ship.utility;
    const cur = slotKind === 'hardpoint' ? list[index]?.moduleId : list[index];
    if (!cur) return 'SLOT EMPTY';
    this.addModule(cur);
    if (slotKind === 'hardpoint') list[index].moduleId = null; else list[index] = null;
    recalc(ship);
    this.syncLoadout();
    return `${MODULES[cur].name} STOWED`;
  }

  /* --------------------------------------------------------- persistence */

  serialize() {
    this.syncLoadout();
    return {
      v: 1, credits: this.credits, wanted: this.wanted, hangar: this.hangar,
      active: this.active, storage: this.storage, stats: this.stats,
      vouchers: this.vouchers, cargo: this.ship ? this.ship.cargo : {},
      tutorial: this.tutorial, sector: this.sector, contracts: this.contracts, crew: this.crew,
      tracked: this.tracked, assist: this.assist, mode: this.mode,
    };
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize()));
      this.lastSaved = Date.now();
      return true;
    } catch { return false; }
  }

  static hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const p = new Player();
      p.credits = d.credits ?? p.credits;
      p.wanted = d.wanted ?? 0;
      p.hangar = (d.hangar || p.hangar).filter((h) => SHIPS[h.classId]).map(migrateHull);
      if (!p.hangar.length) p.hangar = [{ ...STARTER }];
      p.active = Math.min(d.active ?? 0, p.hangar.length - 1);
      p.storage = d.storage || {};
      p.stats = { ...p.stats, ...(d.stats || {}) };
      p.vouchers = d.vouchers || {};
      p.tutorial = d.tutorial || { step: 0, done: false };
      p.sector = d.sector || 'halcyon';
      p.contracts = d.contracts || [];
      p.tracked = d.tracked || null;
      if (typeof d.assist === 'boolean') p.assist = d.assist;
      if (d.mode === 'pilot' || d.mode === 'gunner') p.mode = d.mode;
      p.crew = d.crew || [];
      p._cargo = d.cargo || {};
      p.lastSaved = Date.now();
      grantMissingBasics(p);
      return p;
    } catch { return null; }
  }

  static clear() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
}
