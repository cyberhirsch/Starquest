// Halcyon Depot: market, shipyard, services.

import { ORES, SALVAGE, TRADE, MODULES, SHIPS, ITEMS, PLAYER_SHIPS } from './data.js';
import { addCargo, removeCargo, cargoUsed, cargoFree, recalc, getLoadout } from './ship.js';
import { rand, clamp } from '../core/math.js';

export class Market {
  constructor(def = {}) {
    this.def = def;
    this.name = def.name || 'DEPOT';
    this.bias = def.priceBias || { ore: 1, goods: 1 };
    this.shipyard = def.shipyard !== false;
    this.mods = {};
    this.stock = {};
    this.roll();
    this.shipStock = PLAYER_SHIPS.filter((id) => SHIPS[id].price > 0);
    this.moduleStock = Object.keys(MODULES);
  }

  /** A station with no belt of its own pays over the odds for ore. */
  biasFor(id) {
    if (ORES[id]) return this.bias.ore ?? 1;
    if (SALVAGE[id]) return this.bias.salvage ?? 1;
    if (TRADE[id]) return this.bias.goods ?? 1;
    return 1;
  }

  roll() {
    for (const id of Object.keys({ ...ORES, ...SALVAGE, ...TRADE })) {
      this.mods[id] = rand(1.16, 0.88);
      this.stock[id] = Math.round(rand(140, 20));
    }
  }

  /** What the station pays you per unit. */
  sellPrice(id) {
    const base = ITEMS[id]?.price ?? 0;
    if (MODULES[id]) return Math.round(base * 0.45);
    return Math.max(1, Math.round(base * (this.mods[id] ?? 1) * this.biasFor(id) * 0.92));
  }

  /** What it charges you per unit. */
  buyPrice(id) {
    const base = ITEMS[id]?.price ?? 0;
    if (MODULES[id]) return base;
    return Math.max(1, Math.round(base * (this.mods[id] ?? 1) * this.biasFor(id) * 1.12));
  }

  shipPrice(classId, player) {
    const base = SHIPS[classId].price;
    const voucher = player.vouchers[classId] || 0;
    return Math.max(0, Math.round(base * (voucher > 0 ? 0.5 : 1)));
  }

  tradeIn(player) {
    const cur = player.hangar[player.active];
    return Math.round(SHIPS[cur.classId].price * 0.6);
  }
}

export function sellCargo(player, market, id, qty) {
  const have = player.ship.cargo[id] || 0;
  const n = Math.min(have, qty);
  if (n <= 0) return { ok: false, msg: 'NOTHING TO SELL' };
  const unit = market.sellPrice(id);
  let gross = unit * n;
  let msg = `SOLD ${n} ${ITEMS[id].name} FOR ${gross} CR`;
  if (ITEMS[id].illegal) {
    if (Math.random() < 0.35) {
      const fine = Math.round(gross * 0.8);
      player.wanted += 900;
      gross -= fine;
      msg = `CUSTOMS FLAGGED THE MANIFEST — FINED ${fine} CR`;
    } else msg += ' (NO QUESTIONS ASKED)';
  }
  removeCargo(player.ship, id, n);
  player.credits += gross;
  player.stats.earned += Math.max(0, gross);
  return { ok: true, msg, credits: gross };
}

export function sellAllOre(player, market) {
  let total = 0, lines = 0;
  for (const id of Object.keys(player.ship.cargo)) {
    if (!ORES[id] && !SALVAGE[id]) continue;
    const r = sellCargo(player, market, id, player.ship.cargo[id]);
    if (r.ok) { total += r.credits; lines++; }
  }
  return lines ? { ok: true, msg: `OFFLOADED ${lines} LOTS FOR ${total} CR` }
    : { ok: false, msg: 'NO ORE OR SALVAGE IN THE HOLD' };
}

export function buyCargo(player, market, id, qty) {
  const unit = market.buyPrice(id);
  const affordable = Math.floor(player.credits / unit);
  const n = Math.min(qty, affordable, cargoFree(player.ship), market.stock[id] ?? 999);
  if (n <= 0) {
    return { ok: false, msg: player.credits < unit ? 'INSUFFICIENT CREDITS' : 'NO ROOM IN THE HOLD' };
  }
  addCargo(player.ship, id, n);
  player.credits -= unit * n;
  market.stock[id] = Math.max(0, (market.stock[id] ?? 0) - n);
  return { ok: true, msg: `BOUGHT ${n} ${ITEMS[id].name} FOR ${unit * n} CR` };
}

export function buyModule(player, market, id) {
  const price = market.buyPrice(id);
  if (player.credits < price) return { ok: false, msg: 'INSUFFICIENT CREDITS' };
  player.credits -= price;
  player.addModule(id);
  return { ok: true, msg: `${MODULES[id].name} DELIVERED TO STORAGE` };
}

export function sellModule(player, market, id) {
  if (!player.takeModule(id)) return { ok: false, msg: 'NOT IN STORAGE' };
  const price = market.sellPrice(id);
  player.credits += price;
  return { ok: true, msg: `SOLD ${MODULES[id].name} FOR ${price} CR` };
}

export function buyShip(player, market, classId, world) {
  if (market.shipyard === false) return { ok: false, msg: 'NO SHIPYARD AT THIS STATION' };
  const price = market.shipPrice(classId, player);
  if (player.credits < price) return { ok: false, msg: 'INSUFFICIENT CREDITS' };
  player.credits -= price;
  if (player.vouchers[classId] > 0) {
    player.vouchers[classId] -= 1;
    if (player.vouchers[classId] <= 0) delete player.vouchers[classId];
  }
  const cls = SHIPS[classId];
  player.hangar.push({
    classId,
    loadout: { hardpoints: new Array(cls.hardpoints).fill(null), utility: new Array(cls.utility).fill(null) },
  });
  player.active = player.hangar.length - 1;
  const old = player.ship;
  player.buildShip(world);
  // move what fits from the old hold
  for (const [id, qty] of Object.entries(old.cargo)) addCargo(player.ship, id, qty);
  return { ok: true, msg: `${cls.name} REGISTERED TO YOU`, price };
}

export function switchShip(player, index, world) {
  if (index === player.active) return { ok: false, msg: 'ALREADY ABOARD' };
  const old = player.ship;
  player.active = index;
  player.buildShip(world);
  for (const [id, qty] of Object.entries(old.cargo)) addCargo(player.ship, id, qty);
  return { ok: true, msg: `TRANSFERRED TO ${SHIPS[player.hangar[index].classId].name}` };
}

export function repairCost(ship) {
  const missing = ship.stats.hullMax - ship.hull;
  return Math.ceil(missing * 14);
}

export function repair(player) {
  const cost = repairCost(player.ship);
  if (cost <= 0) return { ok: false, msg: 'HULL IS INTACT' };
  if (player.credits < cost) return { ok: false, msg: `REPAIR COSTS ${cost} CR` };
  player.credits -= cost;
  player.ship.hull = player.ship.stats.hullMax;
  player.ship.shield = player.ship.stats.shieldMax;
  player.ship.energy = player.ship.stats.energyMax;
  return { ok: true, msg: `HULL RESTORED FOR ${cost} CR` };
}

export function payFines(player) {
  const cost = Math.round(player.wanted * 1.5);
  if (player.wanted <= 0) return { ok: false, msg: 'YOUR RECORD IS CLEAN' };
  if (player.credits < cost) return { ok: false, msg: `SETTLEMENT COSTS ${cost} CR` };
  player.credits -= cost;
  player.wanted = 0;
  return { ok: true, msg: 'RECORD EXPUNGED. TRY TO KEEP IT THAT WAY.' };
}
