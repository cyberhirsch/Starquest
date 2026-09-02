// Hired pilots. A wingman is just a ship on your side with a brain that keeps
// station on you — the natural next step from bolting on auto-turrets.

import { SHIPS, MODULES } from './data.js';
import { createShip } from './ship.js';
import { v3, vaddScaled, vrandSphere, qright, rand, pick } from '../core/math.js';

export const MAX_CREW = 2;

/** Hulls you can put someone else in, and what the contract costs. */
export const HIRES = {
  wingShuttle: {
    id: 'wingShuttle', classId: 'shuttle', name: 'WING — SHUTTLE', price: 14000,
    loadout: { hardpoints: ['pulse', 'auto1'], utility: ['shield1', null] },
    blurb: 'A jobbing pilot in a patched Vex. Cheap, and better than nothing at your six.',
  },
  wingCorsair: {
    id: 'wingCorsair', classId: 'corsair', name: 'WING — CORSAIR', price: 52000,
    loadout: { hardpoints: ['burst', 'auto2', 'auto2'], utility: ['shield2', 'thruster', null] },
    blurb: 'An ex-Authority interceptor pilot with a grudge and a fast hull.',
  },
};

const CALLSIGNS = ['KESTREL', 'TINDER', 'GRAVEL', 'SIX PENCE', 'OLD MAN RIVER',
  'PACER', 'BRIGHT ANNIE', 'DOG WATCH', 'HALFPENNY'];

export function hireCost(id) { return HIRES[id]?.price ?? 0; }

export function hire(player, id, world) {
  const def = HIRES[id];
  if (!def) return { ok: false, msg: 'NO SUCH CONTRACT' };
  if (player.crew.length >= MAX_CREW) return { ok: false, msg: `YOU CAN KEEP ${MAX_CREW} PILOTS ON BOOKS` };
  if (player.credits < def.price) return { ok: false, msg: 'INSUFFICIENT CREDITS' };
  player.credits -= def.price;
  const callsign = pick(CALLSIGNS.filter((c) => !player.crew.some((w) => w.name === c))) || 'WINGMAN';
  player.crew.push({ hireId: id, classId: def.classId, name: callsign, loadout: def.loadout });
  syncCrew(player, world);
  return { ok: true, msg: `${callsign} SIGNED ON` };
}

export function dismiss(player, name, world) {
  const i = player.crew.findIndex((c) => c.name === name);
  if (i < 0) return { ok: false, msg: 'NOT ON YOUR BOOKS' };
  player.crew.splice(i, 1);
  syncCrew(player, world);
  return { ok: true, msg: `${name} PAID OFF` };
}

/** Make the world's wing ships match the books — after hiring, jumping or a loss. */
export function syncCrew(player, world) {
  if (!world || !player.ship) return;
  const alive = world.ships.filter((s) => s.wing && !s.dead);

  // anyone shot down comes off the books
  for (const s of alive) if (!player.crew.some((c) => c.name === s.name)) removeShip(world, s);
  for (let i = 0; i < player.crew.length; i++) {
    const c = player.crew[i];
    if (alive.some((s) => s.name === c.name)) continue;
    const pos = vaddScaled(v3(), player.ship.pos, qright(v3(), player.ship.quat),
      (i % 2 === 0 ? 1 : -1) * 120);
    vaddScaled(pos, pos, vrandSphere(v3(), 1), rand(30, 5));
    const s = createShip(c.classId, 'player', { pos, loadout: c.loadout, name: c.name, wing: true });
    s.ai = { role: 'wing', state: 'form', t: 0, slot: i, orbit: rand(420, 260), sign: i % 2 ? -1 : 1 };
    world.ships.push(s);
  }
}

function removeShip(world, s) {
  const i = world.ships.indexOf(s);
  if (i >= 0) world.ships.splice(i, 1);
}

/** Called when a wing ship dies, so the books stay honest. */
export function onWingLost(player, world, ship) {
  const i = player.crew.findIndex((c) => c.name === ship.name);
  if (i < 0) return;
  player.crew.splice(i, 1);
  world.log(`${ship.name} IS GONE`, 'danger');
}
