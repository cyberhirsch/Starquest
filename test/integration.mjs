// Headless play-through of the systems the renderer sits on top of.
// Run: node test/integration.mjs

import { World } from '../src/game/world.js';
import { Player } from '../src/game/player.js';
import { Market, sellAllOre, buyShip, buyModule, repair } from '../src/game/station.js';
import { Boarding, boardBlocker } from '../src/game/boarding.js';
import { createShip, flyShip, fireMount, updateTurrets, damageShip, cargoUsed, addCargo, recalc } from '../src/game/ship.js';
import { MODULES } from '../src/game/data.js';
import { v3, vsub, vnorm, vdist, qlook } from '../src/core/math.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

const player = new Player();
const world = new World(player);
player.buildShip(world);
world.generate();
const step = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) world.update(dt); };

/* ---------------------------------------------------------------- flight */
section('FLIGHT');
{
  const s = player.ship;
  s.pos = v3(0, 0, 0); s.vel = v3(0, 0, 0);
  for (let i = 0; i < 180; i++) flyShip(s, { pitch: 0, yaw: 0, roll: 0, throttle: 1 }, 1 / 60);
  const speed = Math.hypot(...s.vel);
  ok('throttle builds speed', speed > 80, `${speed.toFixed(0)} m/s`);
  for (let i = 0; i < 180; i++) flyShip(s, { pitch: 0, yaw: 0, roll: 0, throttle: -1 }, 1 / 60);
  ok('reverse thrust decelerates', Math.hypot(...s.vel) < speed);
  const before = [...s.quat];
  for (let i = 0; i < 60; i++) flyShip(s, { pitch: 0, yaw: 1, roll: 0, throttle: 0 }, 1 / 60);
  ok('yaw input rotates the hull', Math.abs(s.quat[1] - before[1]) > 0.1);
}

/* ---------------------------------------------------------------- mining */
section('MINING');
{
  const s = player.ship;
  // the shuttle now leaves the yard with a cannon and a cutter already fitted
  const beamIdx = s.hardpoints.findIndex((h) => MODULES[h.moduleId]?.beam);
  ok('mining laser fitted from the start', beamIdx >= 0,
    s.hardpoints.map((h) => h.moduleId).join(' + '));
  const beam = s.hardpoints[beamIdx >= 0 ? beamIdx : 0];
  const rock = world.asteroids[0];
  rock.pos = v3(0, 0, -200); rock.vel = v3(0, 0, 0);
  s.pos = v3(0, 0, 0); s.vel = v3(0, 0, 0);
  qlook(s.quat, [0, 0, -1]);
  s.energy = 999;
  const hp0 = rock.hp;
  for (let i = 0; i < 240; i++) {
    s.energy = s.stats.energyMax;
    fireMount(s, beam, [0, 0, -1], world);
    world.update(1 / 60);
  }
  ok('beam damages the rock', rock.hp < hp0 || !world.asteroids.includes(rock),
    `hp ${hp0.toFixed(0)} -> ${rock.hp.toFixed(0)}`);
  ok('ore reaches the hold', cargoUsed(s) > 0, `${cargoUsed(s)} units: ${JSON.stringify(s.cargo)}`);
}

/* ---------------------------------------------------------------- combat */
section('COMBAT');
{
  const s = player.ship;
  const gunIdx = s.hardpoints.findIndex((h) => MODULES[h.moduleId] && !MODULES[h.moduleId].beam);
  const gun = s.hardpoints[gunIdx];
  ok('a cannon is fitted from the start', !!gun);
  const pirate = world.spawnPirate();
  pirate.pos = v3(0, 0, -300); pirate.vel = v3(0, 0, 0);
  s.pos = v3(0, 0, 0); s.vel = v3(0, 0, 0);
  qlook(s.quat, [0, 0, -1]);
  const hull0 = pirate.hull + pirate.shield;
  for (let i = 0; i < 400 && !pirate.dead; i++) {
    s.energy = s.stats.energyMax;
    gun.cd = 0;
    fireMount(s, gun, vnorm(v3(), vsub(v3(), pirate.pos, s.pos)), world, pirate);
    world.update(1 / 60);
    pirate.vel = v3(0, 0, 0);
    pirate.pos = v3(0, 0, -300);
  }
  ok('pulse cannon hurts a pirate', pirate.hull + pirate.shield < hull0 || pirate.dead || pirate.disabled,
    pirate.dead ? 'destroyed' : pirate.disabled ? 'disabled' : `${(pirate.hull + pirate.shield).toFixed(0)} left`);
}

/* ----------------------------------------------------------- auto-turrets */
section('AUTO-TURRETS');
{
  player.credits = 500000;
  const market = new Market();
  const r = buyShip(player, market, 'bastion', world);
  ok('bought a bastion', r.ok && player.ship.cls.id === 'bastion', `${player.ship.hardpoints.length} mounts`);
  ok('bastion has six mounts', player.ship.hardpoints.length === 6);

  for (let i = 0; i < 3; i++) buyModule(player, market, 'auto2');
  player.install('auto2', 'hardpoint', 1);
  player.install('auto2', 'hardpoint', 2);
  player.install('auto2', 'hardpoint', 3);
  ok('three auto-turrets fitted',
    player.ship.hardpoints.filter((h) => h.moduleId === 'auto2').length === 3);

  const s = player.ship;
  s.pos = v3(0, 0, 0); s.vel = v3(0, 0, 0);
  s.energy = s.stats.energyMax;
  const target = world.spawnPirate();
  target.pos = v3(0, 90, -400); target.vel = v3(0, 0, 0); target.ai = null;
  const shots0 = world.projectiles.length;
  let fired = 0;
  for (let i = 0; i < 240; i++) {
    s.energy = s.stats.energyMax;
    const before = world.projectiles.length;
    updateTurrets(s, world, 1 / 60);
    fired += Math.max(0, world.projectiles.length - before);
    target.pos = v3(0, 90, -400);
  }
  ok('turrets engage without the pilot firing', fired > 0, `${fired} rounds away`);
  const hpWithTarget = s.hardpoints.filter((h) => h.target).length;
  ok('turrets acquired the hostile', hpWithTarget > 0, `${hpWithTarget} tracking`);
}

/* --------------------------------------------------------------- trading */
section('STATION');
{
  const market = new Market();
  addCargo(player.ship, 'gold', 30);
  const credits0 = player.credits;
  const r = sellAllOre(player, market);
  ok('ore sells for credits', r.ok && player.credits > credits0, `+${player.credits - credits0} cr`);
  player.ship.hull *= 0.5;
  const rr = repair(player);
  ok('repairs restore the hull', rr.ok && player.ship.hull === player.ship.stats.hullMax);
}

/* -------------------------------------------------------------- boarding */
section('BOARDING');
{
  player.addModule('breach');
  player.install('breach', 'utility', 0);
  ok('breaching rig gives a boarding rating', player.ship.stats.boarding > 0);

  player.ship.pos = v3(0, 0, 0);
  player.ship.vel = v3(0, 0, 0);

  // striking the colours is a dice roll (95% for a civilian), so take the first
  // hull that yields rather than betting the suite on one throw
  let victim = null, tries = 0;
  while (!victim && tries++ < 20) {
    const v = createShip('hauler', 'trader', { pos: v3(0, 0, -60), credits: 9000, name: 'FAT MARGIN' });
    addCargo(v, 'luxuries', 40);
    v.vel = v3(0, 0, 0);
    world.ships.push(v);
    if (tries === 1) ok('cannot board a powered hull', boardBlocker(player, v) === 'TARGET STILL UNDER POWER');
    damageShip(v, v.stats.shieldMax + v.stats.hullMax * 0.85, world, {});
    if (v.disabled) victim = v;
  }
  ok('a wounded civilian strikes its colours', !!victim, `after ${tries} hull(s)`);

  if (victim.disabled) {
    ok('boarding is clear to start', boardBlocker(player, victim) === null, String(boardBlocker(player, victim)));
    const b = new Boarding(world, player, victim);
    for (let i = 0; i < b.rounds; i++) { b.marker = (b.zone0 + b.zone1) / 2; b.strike(); }
    ok('three clean cuts breach the hull', b.stage === 'loot');
    const held = cargoUsed(player.ship);
    b.takeAll();
    ok('loot moves into your hold', cargoUsed(player.ship) > held);
    ok('hull claim is offered on a clean board', !!b.claimHull());
    const res = b.finish();
    ok('boarding resolves', res.ok, res.msg);
    ok('piracy raises your bounty', player.wanted > 0, `${player.wanted} cr`);
  }
}

/* ----------------------------------------------------------------- chase */
section('CHASE');
{
  // a wounded pirate running flat out must be catchable by a starter shuttle
  player.active = 0;                       // back to the Vex Shuttle
  player.buildShip(world);
  const me = player.ship;
  me.pos = v3(0, 0, 0);
  me.vel = v3(0, 0, 0);

  const runner = world.spawnPirate();
  runner.pos = v3(0, 0, -400);
  runner.vel = v3(0, 0, 0);
  runner.hull = runner.stats.hullMax * 0.1;
  runner.target = me;
  runner.ai.state = 'flee';

  const gap0 = vdist(me.pos, runner.pos);
  let gap = gap0;
  for (let i = 0; i < 60 * 60 && gap > 120; i++) {
    // fly straight at it, full throttle — what a competent pilot would do
    qlook(me.quat, vnorm(v3(), vsub(v3(), runner.pos, me.pos)));
    flyShip(me, { pitch: 0, yaw: 0, roll: 0, throttle: 1 }, 1 / 60);
    world.update(1 / 60);
    if (runner.dead) break;
    gap = vdist(me.pos, runner.pos);
  }
  ok('a fleeing pirate can be run down', gap < 120 || runner.dead,
    `gap ${Math.round(gap0)}m -> ${Math.round(gap)}m`);
  ok('player hulls keep their full rating',
    me.stats.maxSpeed > runner.stats.maxSpeed,
    `${Math.round(me.stats.maxSpeed)} vs ${Math.round(runner.stats.maxSpeed)} m/s`);
}

/* ------------------------------------------------------------ simulation */
section('SOAK');
{
  let maxShips = 0, err = null;
  try {
    for (let i = 0; i < 60 * 120; i++) {
      world.update(1 / 60);
      maxShips = Math.max(maxShips, world.ships.length);
    }
  } catch (e) { err = e; }
  ok('two minutes of simulation runs clean', !err, err ? err.stack.split('\n')[0] : `peak ${maxShips} ships`);
  ok('entity counts stay bounded',
    world.projectiles.length < 800 && world.particles.length < 3000 && world.asteroids.length < 400,
    `proj ${world.projectiles.length} / parts ${world.particles.length} / rocks ${world.asteroids.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
