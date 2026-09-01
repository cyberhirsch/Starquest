// Ships, modules and commodities. Prices are in credits (cr).

export const SHIPS = {
  shuttle: {
    id: 'shuttle', name: 'VEX SHUTTLE', model: 'shuttle', scale: 1.0, radius: 4,
    mass: 12, thrust: 34, reverse: 0.55, turn: 2.1, hull: 200, shield: 90, shieldRate: 9,
    cargo: 30, hardpoints: 2, utility: 2, energy: 110, energyRate: 26, price: 0,
    blurb: 'Civilian runabout. Two mounts, a cupboard for cargo, and enough thrust to run away.',
  },
  prospector: {
    id: 'prospector', name: 'PROSPECTOR', model: 'prospector', scale: 1.1, radius: 5.5,
    mass: 26, thrust: 40, reverse: 0.6, turn: 1.5, hull: 240, shield: 110, shieldRate: 8,
    cargo: 110, hardpoints: 2, utility: 3, energy: 140, energyRate: 30, price: 21000,
    miningBonus: 1.4, blurb: 'Belt workhorse. Reinforced rig arms give +40% mining yield.',
  },
  corsair: {
    id: 'corsair', name: 'CORSAIR', model: 'corsair', scale: 1.0, radius: 5,
    mass: 20, thrust: 62, reverse: 0.75, turn: 2.4, hull: 280, shield: 180, shieldRate: 11,
    cargo: 45, hardpoints: 3, utility: 3, energy: 180, energyRate: 38, price: 46000,
    blurb: 'Fast attack hull. Three mounts — you can only man one of them.',
  },
  hauler: {
    id: 'hauler', name: 'ORB HAULER', model: 'hauler', scale: 1.0, radius: 8,
    mass: 68, thrust: 44, reverse: 0.5, turn: 0.95, hull: 520, shield: 260, shieldRate: 12,
    cargo: 320, hardpoints: 4, utility: 4, energy: 220, energyRate: 42, price: 78000,
    blurb: 'Freight hull. Enormous hold, four mounts, and the turn rate of a moon.',
  },
  bastion: {
    id: 'bastion', name: 'BASTION', model: 'bastion', scale: 1.0, radius: 11,
    mass: 120, thrust: 58, reverse: 0.5, turn: 0.8, hull: 950, shield: 520, shieldRate: 18,
    cargo: 200, hardpoints: 6, utility: 5, energy: 320, energyRate: 60, price: 168000,
    blurb: 'Line cruiser. Six mounts. Fly it without auto-turrets and five of them are ballast.',
  },
  marauder: {
    id: 'marauder', name: 'MARAUDER', model: 'marauder', scale: 1.0, radius: 5.6,
    mass: 24, thrust: 56, reverse: 0.7, turn: 2.2, hull: 260, shield: 140, shieldRate: 9,
    cargo: 60, hardpoints: 3, utility: 2, energy: 160, energyRate: 34, price: 52000,
    blurb: 'Pirate raider. Ugly, quick, and legally awkward to be caught flying.',
  },
  sentinel: {
    id: 'sentinel', name: 'SENTINEL', model: 'sentinel', scale: 1.0, radius: 4.6,
    mass: 22, thrust: 66, reverse: 0.8, turn: 2.6, hull: 340, shield: 240, shieldRate: 14,
    cargo: 30, hardpoints: 3, utility: 3, energy: 200, energyRate: 44, price: 0,
    blurb: 'System security interceptor. Not for sale.',
  },
};

export const PLAYER_SHIPS = ['shuttle', 'prospector', 'corsair', 'hauler', 'bastion'];

/* ------------------------------------------------------------------ ores */

export const ORES = {
  ice:      { id: 'ice', name: 'ICE', kind: 'ore', price: 6, tier: 0 },
  iron:     { id: 'iron', name: 'IRON ORE', kind: 'ore', price: 11, tier: 0 },
  silicon:  { id: 'silicon', name: 'SILICATES', kind: 'ore', price: 19, tier: 1 },
  gold:     { id: 'gold', name: 'GOLD ORE', kind: 'ore', price: 58, tier: 2 },
  platinum: { id: 'platinum', name: 'PLATINUM', kind: 'ore', price: 96, tier: 3 },
  xenite:   { id: 'xenite', name: 'XENITE', kind: 'ore', price: 165, tier: 4 },
};

export const TRADE = {
  alloy:    { id: 'alloy', name: 'HULL ALLOY', kind: 'goods', price: 42 },
  cells:    { id: 'cells', name: 'POWER CELLS', kind: 'goods', price: 70 },
  meds:     { id: 'meds', name: 'MEDICALS', kind: 'goods', price: 130 },
  luxuries: { id: 'luxuries', name: 'LUXURIES', kind: 'goods', price: 210 },
  contraband: { id: 'contraband', name: 'CONTRABAND', kind: 'goods', price: 340, illegal: true },
};

/* --------------------------------------------------------------- modules */

const W = (o) => ({ slot: 'hardpoint', kind: 'weapon', mount: 'manual', ...o });
const T = (o) => ({ slot: 'hardpoint', kind: 'turret', mount: 'auto', ...o });
const U = (o) => ({ slot: 'utility', kind: 'utility', ...o });

export const MODULES = {
  /* manual weapons — usable in the seat you are flying or gunning */
  pulse: W({
    id: 'pulse', name: 'PULSE CANNON', price: 2400, dmg: 9, rate: 0.14, speed: 900,
    range: 1400, energy: 2.4, spread: 0.004, color: 'laser',
    blurb: 'Rapid light cannon. Cheap to run, unimpressive against armour.',
  }),
  burst: W({
    id: 'burst', name: 'BURST REPEATER', price: 8600, dmg: 7, rate: 0.06, speed: 1050,
    range: 1300, energy: 1.9, spread: 0.012, color: 'laser',
    blurb: 'Shreds shields at knife range. Drinks the capacitor.',
  }),
  rail: W({
    id: 'rail', name: 'RAIL LANCE', price: 19000, dmg: 62, rate: 0.95, speed: 2200,
    range: 2600, energy: 26, spread: 0.0006, color: 'laserHot',
    blurb: 'Slow, exact, and it goes through shields like they are a rumour.',
  }),
  disruptor: W({
    id: 'disruptor', name: 'ION DISRUPTOR', price: 24000, dmg: 14, rate: 0.35, speed: 1200,
    range: 1500, energy: 9, spread: 0.003, color: 'security', ion: 3.2,
    blurb: 'Collapses drives instead of hulls. The boarder\'s tool of choice.',
  }),
  mining1: W({
    id: 'mining1', name: 'MINING LASER I', price: 3200, beam: true, dmg: 16, rate: 0.05,
    range: 380, energy: 16, oreMul: 6, color: 'mining',
    blurb: 'Continuous cutting beam. Effective on rock, embarrassing on hulls.',
  }),
  mining2: W({
    id: 'mining2', name: 'MINING LASER II', price: 13500, beam: true, dmg: 30, rate: 0.05,
    range: 600, energy: 24, oreMul: 11, color: 'mining',
    blurb: 'Wide-aperture cutter. Cracks a big rock in one pass.',
  }),

  /* auto-turrets — the answer to a hull with more mounts than hands */
  auto1: T({
    id: 'auto1', name: 'AUTO-TURRET MK I', price: 6500, dmg: 6, rate: 0.32, speed: 800,
    range: 900, energy: 1.6, track: 2.2, arc: 2.6, color: 'laser',
    blurb: 'Slaved point-defence mount. Fires on hostiles while you fly.',
  }),
  auto2: T({
    id: 'auto2', name: 'AUTO-TURRET MK II', price: 17500, dmg: 11, rate: 0.26, speed: 1000,
    range: 1200, energy: 2.6, track: 3.0, arc: 2.9, color: 'laser',
    blurb: 'Better servos, better optics, better lead prediction.',
  }),
  auto3: T({
    id: 'auto3', name: 'FLAK TURRET MK III', price: 39000, dmg: 19, rate: 0.22, speed: 1150,
    range: 1500, energy: 3.8, track: 3.6, arc: 3.14, color: 'warn',
    blurb: 'Full-sphere coverage. Expensive, and worth every credit on a big hull.',
  }),
  autoMine: T({
    id: 'autoMine', name: 'AUTO-MINER TURRET', price: 22000, dmg: 10, rate: 0.3, speed: 700,
    range: 500, energy: 2.4, track: 2.4, arc: 3.14, color: 'mining', oreMul: 4, minesRocks: true,
    blurb: 'Slaved cutting head. Chews the rocks you fly past, hands-free.',
  }),

  /* utility */
  shield1: U({ id: 'shield1', name: 'SHIELD CAPACITOR', price: 5200, shield: 90, shieldRate: 3, blurb: '+90 shield, faster recharge.' }),
  shield2: U({ id: 'shield2', name: 'DEFLECTOR ARRAY', price: 21000, shield: 260, shieldRate: 7, blurb: '+260 shield. Heavy draw.' }),
  hold1: U({ id: 'hold1', name: 'CARGO EXPANDER', price: 4200, cargo: 40, blurb: '+40 cargo units.' }),
  hold2: U({ id: 'hold2', name: 'CARGO EXPANDER II', price: 15000, cargo: 130, blurb: '+130 cargo units.' }),
  thruster: U({ id: 'thruster', name: 'OVERTHRUSTER', price: 9800, thrustMul: 1.35, turnMul: 1.15, blurb: '+35% thrust, +15% agility.' }),
  tractor: U({ id: 'tractor', name: 'TRACTOR BEAM', price: 6800, tractor: 260, blurb: 'Pulls loose cargo in from 260m.' }),
  armour: U({ id: 'armour', name: 'ABLATIVE PLATING', price: 12500, hull: 260, massMul: 1.12, blurb: '+260 hull, slightly heavier.' }),
  breach: U({ id: 'breach', name: 'BREACHING RIG', price: 16000, boarding: 1, blurb: 'Cutting charges and a docking collar. Required to board.' }),
  breach2: U({ id: 'breach2', name: 'ASSAULT RIG', price: 42000, boarding: 2, blurb: 'Marine pods. Boarding is faster and far safer.' }),
  scanner: U({ id: 'scanner', name: 'SURVEY SCANNER', price: 7400, scanner: 1, blurb: 'Reads ore content and cargo manifests at range.' }),
  repair: U({ id: 'repair', name: 'REPAIR DRONES', price: 18000, repair: 3.5, blurb: 'Slowly rebuilds hull while out of combat.' }),
};

export const ITEMS = { ...ORES, ...TRADE, ...MODULES };

export const itemName = (id) => ITEMS[id]?.name ?? id.toUpperCase();
export const itemPrice = (id) => ITEMS[id]?.price ?? 0;
export const isModule = (id) => !!MODULES[id];

/** Ore an asteroid class yields, with rarity weights. */
export const ASTEROID_TYPES = [
  { ore: 'iron', weight: 34, color: 'iron', yieldMul: 1.0 },
  { ore: 'ice', weight: 22, color: 'ice', yieldMul: 1.3 },
  { ore: 'silicon', weight: 20, color: 'silicon', yieldMul: 1.0 },
  { ore: 'gold', weight: 12, color: 'gold', yieldMul: 0.7 },
  { ore: 'platinum', weight: 8, color: 'platinum', yieldMul: 0.55 },
  { ore: 'xenite', weight: 4, color: 'xenite', yieldMul: 0.4 },
];

export function rollAsteroidType() {
  const total = ASTEROID_TYPES.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of ASTEROID_TYPES) { r -= t.weight; if (r <= 0) return t; }
  return ASTEROID_TYPES[0];
}
