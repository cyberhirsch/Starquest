// Boarding a disabled hull: cut the collar, then strip the hold.

import { SHIPS, ITEMS } from './data.js';
import { addCargo, cargoFree, damageShip } from './ship.js';
import { clamp, vdist } from '../core/math.js';

export const BOARD_RANGE = 140;
export const BOARD_SPEED = 45;

/** Why you can't board right now — or null if you can. */
export function boardBlocker(player, target) {
  if (!target || target.kind !== 'ship') return 'NO HULL SELECTED';
  if (target === player.ship) return null;
  if (target.dead) return 'TARGET DESTROYED';
  if (!target.disabled) return 'TARGET STILL UNDER POWER';
  if (target.looted) return 'HOLD ALREADY STRIPPED';
  if (player.ship.stats.boarding <= 0) return 'NO BREACHING RIG FITTED';
  const d = vdist(player.ship.pos, target.pos) - target.radius * target.scale;
  if (d > BOARD_RANGE) return `CLOSE TO ${Math.round(BOARD_RANGE)}M (${Math.round(d)}M)`;
  const rel = Math.hypot(
    player.ship.vel[0] - target.vel[0],
    player.ship.vel[1] - target.vel[1],
    player.ship.vel[2] - target.vel[2]);
  if (rel > BOARD_SPEED) return `MATCH VELOCITY (${Math.round(rel)} M/S)`;
  return null;
}

export class Boarding {
  constructor(world, player, target) {
    this.world = world;
    this.player = player;
    this.target = target;
    this.rig = player.ship.stats.boarding;
    this.stage = 'breach';
    this.round = 0;
    this.rounds = 3;
    this.fails = 0;
    this.maxFails = 1 + this.rig;
    this.marker = 0;
    this.dir = 1;
    this.result = null;
    this.log = [];
    const tier = SHIPS[target.classId].price / 60000;
    this.baseSpeed = 0.85 + tier * 0.5 - this.rig * 0.12;
    this.zoneW = 0.20 + this.rig * 0.07;
    this.placeZone();
    this.say(`COLLAR ATTACHED TO ${target.name}`);
    this.say(`CUTTING CHARGE ${this.round + 1} OF ${this.rounds}`);
  }

  say(text) {
    this.log.push(text);
    if (this.log.length > 7) this.log.shift();
  }

  placeZone() {
    const w = this.zoneW * (1 - this.round * 0.12);
    this.zone0 = 0.08 + Math.random() * (0.84 - w);
    this.zone1 = this.zone0 + w;
    this.speed = this.baseSpeed * (1 + this.round * 0.35);
  }

  tick(dt) {
    if (this.stage !== 'breach') return;
    this.marker += this.dir * this.speed * dt;
    if (this.marker > 1) { this.marker = 1; this.dir = -1; }
    if (this.marker < 0) { this.marker = 0; this.dir = 1; }
  }

  /** Player hits the trigger on the moving marker. */
  strike() {
    if (this.stage !== 'breach') return;
    const hit = this.marker >= this.zone0 && this.marker <= this.zone1;
    if (hit) {
      this.round++;
      this.world.fx.sparks(this.target.pos, 6, 3);
      if (this.round >= this.rounds) {
        this.stage = 'loot';
        this.say('BULKHEAD BREACHED — BOARDING PARTY IS ABOARD');
        this.prepareLoot();
        return;
      }
      this.say(`CHARGE ${this.round} SET — ${this.rounds - this.round} TO GO`);
      this.placeZone();
    } else {
      this.fails++;
      this.say(this.fails >= this.maxFails ? 'CHARGE MISFIRED — COLLAR BLOWN' : 'MISFIRE — RESETTING CHARGE');
      // Tag the cause, or a botched breach reads as a generic 'TAKING DAMAGE'
      // and the death screen cannot tell you that you cut your own hull open.
      damageShip(this.player.ship, 14 + this.rig * 4, this.world,
        { point: this.player.ship.pos, cause: 'breach' });
      if (this.fails >= this.maxFails) {
        this.stage = 'done';
        this.result = { ok: false, msg: 'BOARDING REPELLED' };
        return;
      }
      this.placeZone();
    }
  }

  prepareLoot() {
    const t = this.target;
    this.manifest = Object.entries(t.cargo).map(([id, qty]) => ({ id, qty }));
    this.cash = Math.round(t.credits * (0.55 + this.rig * 0.2));
    this.taken = 0;
    this.cashTaken = false;
    this.claimable = SHIPS[t.classId].price > 0 && this.fails === 0;
  }

  takeCash() {
    if (this.stage !== 'loot' || this.cashTaken || this.cash <= 0) return null;
    this.cashTaken = true;
    this.player.credits += this.cash;
    this.player.stats.earned += this.cash;
    this.target.credits = Math.max(0, this.target.credits - this.cash);
    this.say(`SHIP'S SAFE CRACKED — ${this.cash} CR`);
    return `+${this.cash} CR`;
  }

  take(id) {
    if (this.stage !== 'loot') return null;
    const line = this.manifest.find((m) => m.id === id);
    if (!line || line.qty <= 0) return null;
    const free = cargoFree(this.player.ship);
    if (free <= 0) { this.say('YOUR HOLD IS FULL'); return 'HOLD FULL'; }
    const n = addCargo(this.player.ship, id, Math.min(line.qty, free));
    line.qty -= n;
    this.target.cargo[id] = Math.max(0, (this.target.cargo[id] || 0) - n);
    if (this.target.cargo[id] === 0) delete this.target.cargo[id];
    this.taken += n;
    this.say(`+${n} ${ITEMS[id]?.name || id}`);
    return `+${n}`;
  }

  takeAll() {
    for (const line of [...this.manifest]) this.take(line.id);
    this.takeCash();
  }

  /** Full, clean board on an intact hull leaves you a claim on the ship. */
  claimHull() {
    if (!this.claimable || this.stage !== 'loot') return null;
    const id = this.target.classId;
    this.player.vouchers[id] = (this.player.vouchers[id] || 0) + 1;
    this.claimable = false;
    this.say(`REGISTRY TRANSFERRED — ${SHIPS[id].name} CLAIM FILED`);
    return `${SHIPS[id].name} CLAIM — REDEEM AT ANY SHIPYARD FOR HALF PRICE`;
  }

  finish() {
    if (this.stage === 'loot') {
      this.target.looted = true;
      this.player.stats.boarded++;
      this.world.onContractBoard?.(this.target);
      this.stage = 'done';
      this.result = { ok: true, msg: `BOARDED ${this.target.name} — ${this.taken} UNITS TAKEN` };
      // pirate hulls are fair game; anyone else files a report
      if (this.target.faction !== 'pirate') {
        this.player.wanted += 1200;
        this.world.log('PIRACY LOGGED — BOUNTY RAISED', 'danger');
      }
    } else if (!this.result) {
      this.stage = 'done';
      this.result = { ok: false, msg: 'BOARDING ABORTED' };
    }
    return this.result;
  }
}
