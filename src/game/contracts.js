// Contracts: the reason to leave the dock. Each one watches a single signal —
// a kill, a boarding, or cargo in the hold when you next dock.

import { ORES, TRADE, ITEMS } from './data.js';
import { SECTORS, sectorOf } from './sectors.js';
import { addCargo, removeCargo, cargoFree } from './ship.js';
import { rand, randi, pick } from '../core/math.js';

/** Sealed freight only a contract can give you, and only a station will take. */
export const CONTRACT_GOODS = {
  crate: { id: 'crate', name: 'SEALED CRATE', kind: 'goods', price: 0, contract: true },
};
Object.assign(ITEMS, CONTRACT_GOODS);

let NEXT = 1;

const money = (n) => Math.round(n / 50) * 50;

function bountyContract(world, player) {
  const count = 2 + randi(3);
  const tier = 1 + player.threat * 0.5;
  return {
    id: `c${NEXT++}`, type: 'bounty', need: count, progress: 0,
    title: `BOUNTY — ${count} PIRATE HULLS`,
    brief: `The Authority is paying a flat rate on pirate hulls destroyed anywhere in the belt. Bring back ${count}.`,
    reward: money(count * rand(1500, 900) * tier),
    station: world.station.def.id,
  };
}

function supplyContract(world, player) {
  const pool = world.sector.id === 'halcyon'
    ? ['iron', 'silicon', 'ice', 'gold']
    : ['alloy', 'cells', 'iron', 'platinum'];
  const item = pick(pool);
  // never ask for more than the hold can take in one run, or it cannot be flown
  const hold = player.ship?.stats?.cargoMax ?? 30;
  const count = Math.max(8, Math.min(20 + randi(45), Math.floor(hold * 0.8)));
  const unit = ITEMS[item].price;
  return {
    id: `c${NEXT++}`, type: 'supply', need: count, progress: 0, item,
    title: `SUPPLY — ${count} ${ITEMS[item].name}`,
    brief: `${world.station.name} needs ${count} units of ${ITEMS[item].name}. Dock with them aboard and the contract settles itself.`,
    reward: money(count * unit * rand(3.4, 2.4)),
    station: world.station.def.id,
  };
}

function courierContract(world, player) {
  const others = Object.values(SECTORS).filter((s) => s.station.id !== world.station.def.id);
  if (!others.length) return null;
  const dest = pick(others);
  const hold = player.ship?.stats?.cargoMax ?? 30;
  const units = Math.max(3, Math.min(4 + randi(8), Math.floor(hold * 0.4)));
  return {
    id: `c${NEXT++}`, type: 'courier', need: units, progress: 0, units,
    to: dest.station.id, toName: dest.station.name, toSector: dest.id,
    title: `COURIER — ${dest.station.name}`,
    brief: `${units} sealed crates, loaded on acceptance, delivered to ${dest.station.name} in ${dest.name}. Do not ask what is in them.`,
    reward: money(units * rand(1400, 900)),
    station: world.station.def.id,
  };
}

function salvageContract(world, player) {
  const count = 1 + randi(3);
  return {
    id: `c${NEXT++}`, type: 'salvage', need: count, progress: 0,
    title: `SALVAGE — BOARD ${count} ADRIFT HULL${count > 1 ? 'S' : ''}`,
    brief: `The yard wants manifests off ${count} adrift hull${count > 1 ? 's' : ''}. Board them and the paperwork follows. A breaching rig is not optional.`,
    reward: money(count * rand(4200, 2600)),
    station: world.station.def.id,
  };
}

const MAKERS = {
  halcyon: [bountyContract, supplyContract, supplyContract, courierContract],
  cinder: [salvageContract, salvageContract, bountyContract, courierContract, supplyContract],
};

/** Refresh the board a station is offering. */
export function rollBoard(world, player, n = 4) {
  const makers = MAKERS[world.sector.id] || MAKERS.halcyon;
  const out = [];
  // two near-identical jobs on one board reads as a bug, so keep titles unique
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const c = pick(makers)(world, player);
    if (c && !out.some((x) => x.title === c.title)) out.push(c);
  }
  return out;
}

export const MAX_ACTIVE = 3;

export function accept(player, contract, world) {
  if (player.contracts.length >= MAX_ACTIVE) {
    return { ok: false, msg: `NO MORE THAN ${MAX_ACTIVE} CONTRACTS AT ONCE` };
  }
  if (contract.type === 'courier') {
    if (cargoFree(player.ship) < contract.units) {
      return { ok: false, msg: `NEEDS ${contract.units} FREE CARGO UNITS` };
    }
    addCargo(player.ship, 'crate', contract.units);
  }
  player.contracts.push({ ...contract, accepted: world.time });
  return { ok: true, msg: `ACCEPTED — ${contract.title}` };
}

export function abandon(player, id) {
  const i = player.contracts.findIndex((c) => c.id === id);
  if (i < 0) return { ok: false, msg: 'NO SUCH CONTRACT' };
  const c = player.contracts[i];
  if (c.type === 'courier') removeCargo(player.ship, 'crate', c.units);
  player.contracts.splice(i, 1);
  player.wanted += 200;
  return { ok: true, msg: `ABANDONED — ${c.title}. THE BOARD REMEMBERS.` };
}

function pay(player, c, world) {
  player.credits += c.reward;
  player.stats.earned += c.reward;
  player.stats.contracts = (player.stats.contracts || 0) + 1;
  player.contracts = player.contracts.filter((x) => x.id !== c.id);
  world.log(`CONTRACT SETTLED — ${c.reward} CR`, 'good');
}

/* ------------------------------------------------------------- signals -- */

export function onKill(player, world, ship) {
  for (const c of [...player.contracts]) {
    if (c.type !== 'bounty' || ship.faction !== 'pirate') continue;
    c.progress++;
    if (c.progress >= c.need) pay(player, c, world);
    else world.log(`BOUNTY ${c.progress}/${c.need}`, 'good');
  }
}

export function onBoard(player, world, ship) {
  for (const c of [...player.contracts]) {
    if (c.type !== 'salvage') continue;
    c.progress++;
    if (c.progress >= c.need) pay(player, c, world);
    else world.log(`SALVAGE ${c.progress}/${c.need}`, 'good');
  }
}

/** Called on docking: delivery contracts settle out of the hold. */
export function onDock(player, world) {
  const here = world.station.def.id;
  for (const c of [...player.contracts]) {
    if (c.type === 'supply' && c.station === here) {
      const have = player.ship.cargo[c.item] || 0;
      if (have >= c.need) {
        removeCargo(player.ship, c.item, c.need);
        pay(player, c, world);
      }
    } else if (c.type === 'courier' && c.to === here) {
      const have = player.ship.cargo.crate || 0;
      if (have >= c.units) {
        removeCargo(player.ship, 'crate', c.units);
        pay(player, c, world);
      } else {
        world.log(`${c.toName} WANTED ${c.units} CRATES — YOU HAVE ${have}`, 'warn');
      }
    }
  }
}

/** One line of progress for the HUD. */
export function tracked(player, world) {
  const c = player.contracts[0];
  if (!c) return null;
  let body;
  if (c.type === 'supply') {
    const have = player.ship.cargo[c.item] || 0;
    body = `${have}/${c.need} ${ITEMS[c.item].name} — deliver to ${stationName(c.station)}`;
  } else if (c.type === 'courier') {
    body = `${player.ship.cargo.crate || 0}/${c.units} crates — deliver to ${c.toName}`;
  } else {
    body = `${c.progress}/${c.need} — reward ${c.reward.toLocaleString('en-US')} cr`;
  }
  return { id: `contract-${c.id}`, title: c.title, body, contract: true };
}

export function stationName(id) {
  for (const s of Object.values(SECTORS)) if (s.station.id === id) return s.station.name;
  return id.toUpperCase();
}
