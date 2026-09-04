// Sectors. Each one is a place with its own rock, its own trouble, and one
// station; jump gates link them. The renderer, AI and economy are all
// sector-agnostic, so a sector is very nearly just data.
//
// `danger` is the one that matters most: a region has a fixed character and
// keeps it. The belt does not get harder because you got better at it — you
// find harder places by flying to them. Difficulty used to key off a player
// `threat` score, which meant four separate things stepped up on the same kill
// and buying the ship you had saved for made the sector you were standing in
// measurably worse.

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
    danger: 0.35,                     // licensed space: pulse cannons and bad ideas
    damage: 0.6,                      // and the Authority's medical cover is decent
    evasive: 0.3,                     // a third of them can actually fly
    // A region has to look like one place, and like the same place every time
    // you come back. The seed fixes the starfield; everything else here is what
    // makes the belt read as a different sky from the reach.
    sky: {
      seed: 0x5741,
      stars: 420,
      tint: [0.72, 0.86, 1.00],       // cold and clear
      sun: { dir: [0.42, 0.28, 0.86], colour: [1, 0.95, 0.8], rays: 8, len: 260 },
      planet: { pos: [-9000, -1800, 11000], r: 3100, colour: [0.35, 0.45, 0.85] },
    },
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
      priceBias: { ore: 1.0, goods: 1.24, salvage: 0.78 },
    },
    gates: [{ to: 'cinder', pos: [3300, 240, 2500] }],
  },

  cinder: {
    id: 'cinder',
    name: 'CINDER REACH',
    blurb: 'A graveyard. Hulls that never came home, scavengers who did, and nobody wearing a badge.',
    asteroids: 110,
    oreBias: { iron: 1.6, silicon: 1.4, ice: 0.5, gold: 0.7, platinum: 1.1, xenite: 1.8 },
    pirates: 1.6,
    traders: 0.35,
    miners: 1,
    derelicts: 7,                     // adrift hulls, there for the boarding
    lawful: false,
    danger: 1.8,                      // turrets, thrusters, and nobody coming to help
    damage: 1.0,
    evasive: 0.75,
    // Deeper out and off the plane of the system: fewer, dimmer stars, a small
    // red sun a long way off, and a gas giant close enough overhead to be a
    // presence rather than scenery.
    sky: {
      seed: 0xC14D,
      stars: 260,
      tint: [0.86, 0.72, 0.66],       // dust in the light
      sun: { dir: [-0.30, -0.12, -0.94], colour: [1, 0.55, 0.32], rays: 6, len: 150 },
      planet: { pos: [6200, 2600, -8200], r: 4200, colour: [0.62, 0.30, 0.24] },
    },
    station: {
      id: 'tallow',
      name: 'TALLOW YARD',
      pos: [-1100, 60, 900],
      model: 'yard',                  // a hulk with a dock cut into it, not a ring
      scale: 2.4,
      radius: 26,
      shipyard: false,
      blurb: 'A scavenger yard bolted to a dead freighter. No hulls for sale, no questions asked.',
      // no belt of its own, so it pays over the odds for ore and dumps salvage cheap
      priceBias: { ore: 1.38, goods: 0.72, salvage: 1.55 },
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
