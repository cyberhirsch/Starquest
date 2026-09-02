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

/**
 * Contract ids are handed out by a module counter that resets with the page,
 * while accepted jobs keep the ids they were saved with. After a reload the
 * next board reissued c1, c2..., so a fresh offer could collide with a job you
 * were already carrying and the board would hide it. Called on load.
 */
export function reseed(player) {
  for (const c of player.contracts || []) {
    const n = parseInt(String(c.id).slice(1), 10);
    if (Number.isFinite(n) && n >= NEXT) NEXT = n + 1;
  }
}

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
    : ['scrap', 'scrap', 'cores', 'alloy', 'iron'];
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

function stripContract(world, player) {
  const count = 1 + randi(3);
  return {
    id: `c${NEXT++}`, type: 'strip', need: count, progress: 0,
    title: `BREAKERS — CUT UP ${count} HULL${count > 1 ? 'S' : ''}`,
    brief: `The yard wants ${count} adrift hull${count > 1 ? 's' : ''} taken down to spars, not merely emptied. Bring a cutting head.`,
    reward: money(count * rand(6800, 4200)),
    station: world.station.def.id,
  };
}

const MAKERS = {
  halcyon: [bountyContract, supplyContract, supplyContract, courierContract],
  cinder: [stripContract, stripContract, salvageContract, bountyContract, courierContract, supplyContract],
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
  if (player.tracked === id) player.tracked = null;
  player.wanted += 200;
  return { ok: true, msg: `ABANDONED — ${c.title}. THE BOARD REMEMBERS.` };
}

function pay(player, c, world) {
  player.credits += c.reward;
  player.stats.earned += c.reward;
  player.stats.contracts = (player.stats.contracts || 0) + 1;
  player.contracts = player.contracts.filter((x) => x.id !== c.id);
  if (player.tracked === c.id) player.tracked = null;
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

export function onStrip(player, world, ship) {
  for (const c of [...player.contracts]) {
    if (c.type !== 'strip') continue;
    c.progress++;
    if (c.progress >= c.need) pay(player, c, world);
    else world.log(`BREAKERS ${c.progress}/${c.need}`, 'good');
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
/**
 * The job on the HUD. `player.tracked` names it; the first accepted job stands
 * in when nothing is chosen.
 *
 * The id folds in the live count, because screens.setObjective repaints only
 * when the id changes — with a constant id the card froze at whatever it said
 * the moment you accepted and never moved again.
 */
export function tracked(player, world) {
  const list = player.contracts;
  if (!list.length) return null;
  const c = list.find((x) => x.id === player.tracked) || list[0];
  let body, count;
  if (c.type === 'supply') {
    count = player.ship.cargo[c.item] || 0;
    body = `${count}/${c.need} ${ITEMS[c.item].name} — deliver to ${stationName(c.station)}`;
  } else if (c.type === 'courier') {
    count = player.ship.cargo.crate || 0;
    body = `${count}/${c.units} crates — deliver to ${c.toName}`;
  } else {
    count = c.progress;
    body = `${c.progress}/${c.need} — reward ${c.reward.toLocaleString('en-US')} cr`;
  }
  return { id: `contract-${c.id}-${count}`, title: c.title, body, contract: true };
}

/** Pick which job the HUD follows. */
export function track(player, id) {
  player.tracked = player.contracts.some((c) => c.id === id) ? id : null;
}

export function stationName(id) {
  for (const s of Object.values(SECTORS)) if (s.station.id === id) return s.station.name;
  return id.toUpperCase();
}
