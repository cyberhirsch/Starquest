// Sectors. Each one is a place with its own rock, its own trouble, and one
// station; jump gates link them. The renderer, AI and economy are all
// sector-agnostic, so a sector is very nearly just data.

export const SECTORS = {
  halcyon: {
    id: 'halcyon',
    name: 'HALCYON BELT',
    blurb: 'A working belt under Authority licence. Good rock, patrolled lanes, and haulers running ore out by the ton.',
    asteroids: 190,
    oreBias: null,                    // the default spread
    pirates: 1.0,
    traders: 1.0,
    miners: 2,
    derelicts: 0,
    lawful: true,
    station: {
      id: 'depot',
      name: 'HALCYON DEPOT',
      pos: [0, 0, -1400],
      model: 'station',
      scale: 3.2,
      radius: 26,
      shipyard: true,
      blurb: 'Authority-licensed depot. Hulls, modules, repairs, and a contracts board.',
      // an ore-rich system pays fairly for rock and dearly for anything shipped in
      priceBias: { ore: 1.0, goods: 1.24 },
    },
    gates: [{ to: 'cinder', pos: [3300, 240, 2500] }],
  },

  cinder: {
    id: 'cinder',
    name: 'CINDER REACH',
    blurb: 'A graveyard. Hulls that never came home, scavengers who did, and nobody wearing a badge.',
    asteroids: 110,
    oreBias: { iron: 1.6, silicon: 1.4, ice: 0.5, gold: 0.7, platinum: 1.1, xenite: 1.8 },
    pirates: 2.4,
    traders: 0.35,
    miners: 1,
    derelicts: 7,                     // adrift hulls, there for the boarding
    lawful: false,
    station: {
      id: 'tallow',
      name: 'TALLOW YARD',
      pos: [-1100, 60, 900],
      model: 'station',
      scale: 2.4,
      radius: 26,
      shipyard: false,
      blurb: 'A scavenger yard bolted to a dead freighter. No hulls for sale, no questions asked.',
      // no belt of its own, so it pays over the odds for ore and dumps salvage cheap
      priceBias: { ore: 1.38, goods: 0.72 },
    },
    gates: [{ to: 'halcyon', pos: [-2900, -180, -2600] }],
  },
};

export const START_SECTOR = 'halcyon';

export const sectorOf = (id) => SECTORS[id] || SECTORS[START_SECTOR];

/** Where you arrive when you come through a gate from `fromId`. */
export function arrivalGate(sector, fromId) {
  return sector.gates.find((g) => g.to === fromId) || sector.gates[0];
}
