// Headless play-through of the systems the renderer sits on top of.
// Run: node test/integration.mjs

import { World } from '../src/game/world.js';
import { Player } from '../src/game/player.js';
import { Market, sellAllOre, buyShip, buyModule, repair } from '../src/game/station.js';
import { Boarding, boardBlocker } from '../src/game/boarding.js';
import { createShip, flyShip, fireMount, updateTurrets, damageShip, cargoUsed, addCargo, recalc } from '../src/game/ship.js';
import { MODULES } from '../src/game/data.js';
import * as Contracts from '../src/game/contracts.js';
import * as Crew from '../src/game/crew.js';
import * as Comms from '../src/game/comms.js';
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
  // earlier sections left a bounty on us; a running fight is a different test
  player.wanted = 0;
  world.grace = 300;
  for (const s of [...world.ships]) {
    if (s.faction === 'pirate') world.ships.splice(world.ships.indexOf(s), 1);
  }

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

/* --------------------------------------------------------------- sectors */
section('SECTORS AND TRADE');
{
  const here = world.sector.id;
  const homeMarket = world.station.market;
  const goldHome = homeMarket.sellPrice('gold');
  world.jumpTo('cinder');
  ok('jumping rebuilds the sector', world.sector.id === 'cinder', world.sector.name);
  ok('the player is carried through', world.ships.includes(player.ship));
  const derelicts = world.ships.filter((s) => s.disabled && !s.dead).length;
  ok('the reach is full of adrift hulls', derelicts >= 5, `${derelicts} adrift`);
  const goldAway = world.station.market.sellPrice('gold');
  ok('the two stations pay differently for ore', goldAway > goldHome * 1.2,
    `${goldHome} vs ${goldAway} cr`);
  ok('no shipyard at the scavenger yard', world.station.market.shipyard === false);
  world.jumpTo(here);
  ok('and back again', world.sector.id === here);
}

/* ------------------------------------------------------------- contracts */
section('CONTRACTS');
{
  player.ship.cargo = {};                  // earlier sections left the hold full
  const board = Contracts.rollBoard(world, player, 4);
  ok('the board offers work', board.length === 4, `${board.length} jobs`);
  ok('no two jobs read the same', new Set(board.map((c) => c.title)).size === board.length);
  // the board is random, so ask for a supply job specifically
  let supply = board.find((c) => c.type === 'supply');
  for (let i = 0; i < 30 && !supply; i++) {
    supply = Contracts.rollBoard(world, player, 4).find((c) => c.type === 'supply');
  }
  const r = Contracts.accept(player, supply, world);
  ok('a contract can be accepted', r.ok, r.msg);
  addCargo(player.ship, supply.item, supply.need);
  const before = player.credits;
  Contracts.onDock(player, world);
  ok('delivering settles it on docking', player.credits > before,
    `+${player.credits - before} cr`);
  ok('and it leaves the active list', !player.contracts.some((c) => c.id === supply.id));
}

/* ------------------------------------------------------------------ crew */
section('WINGMEN');
{
  player.credits = 200000;
  const h = Crew.hire(player, 'wingShuttle', world);
  ok('a pilot can be hired', h.ok, h.msg);
  const wing = world.ships.find((s) => s.wing);
  ok('the wingman is in the world', !!wing, wing?.name);
  ok('and flies on your side', wing?.faction === 'player');
  ok('your turrets will not shoot them', !world.isHostile(player.ship, wing));
  ok('pirates will', world.isHostile(world.spawnPirate(), wing));

  // with nothing to fight it should fly to the wing rather than wander off
  for (const s of [...world.ships]) {
    if (s.faction === 'pirate') world.ships.splice(world.ships.indexOf(s), 1);
  }
  world.grace = 120;
  player.ship.pos = v3(0, 0, 0);
  player.ship.vel = v3(0, 0, 0);
  wing.pos = v3(900, 0, 900);
  for (let i = 0; i < 60 * 25; i++) world.update(1 / 60);
  const gap = vdist(wing.pos, player.ship.pos);
  ok('it forms up on the player', gap < 400, `${Math.round(gap)}m off the wing`);

  Crew.onWingLost(player, world, wing);
  ok('a loss comes off the books', !player.crew.some((c) => c.name === wing.name));
}

/* --------------------------------------------------------------- salvage */
section('SALVAGE');
{
  world.jumpTo('cinder');
  player.buildShip(world);
  player.ship.cargo = {};
  const hulk = world.ships.find((s) => s.disabled && !s.dead);
  ok('the reach has hulls to cut', !!hulk, hulk?.name);
  ok('a hulk arrives with something worth taking', hulk.salvage.max > 0,
    `${hulk.salvage.modules.length} fittings, ${hulk.salvage.scrap} scrap`);

  const live = world.spawnPirate();
  live.pos = [...player.ship.pos];
  world.stripHulk(live, MODULES.cutter1, player.ship, 1 / 60, live.pos);
  ok('a cutter does nothing to a hull under power', !live.salvage);

  const storeBefore = Object.values(player.storage).reduce((a, b) => a + b, 0);
  let t = 0;
  while (!hulk.dead && t < 90) {
    world.stripHulk(hulk, MODULES.cutter1, player.ship, 1 / 60, hulk.pos);
    t += 1 / 60;
  }
  ok('a hulk can be cut to nothing', hulk.dead, `${t.toFixed(1)}s with a cutter`);
  ok('scrap ends up in the hold', (player.ship.cargo.scrap || 0) > 0,
    `${player.ship.cargo.scrap} scrap`);
  // one hulk may carry nothing, so judge recovery across the whole graveyard
  for (const h of world.ships.filter((x) => x.disabled && !x.dead)) {
    let u = 0;
    while (!h.dead && u < 90) { world.stripHulk(h, MODULES.cutter1, player.ship, 1 / 60, h.pos); u += 1 / 60; }
  }
  const storeAfter = Object.values(player.storage).reduce((a, b) => a + b, 0);
  ok('fittings come out whole', storeAfter > storeBefore,
    `${storeAfter - storeBefore} modules off the graveyard`);
  ok('the yard pays a premium for scrap',
    world.station.market.sellPrice('scrap') > 34,
    `${world.station.market.sellPrice('scrap')} cr vs 34 base`);
}

/* ----------------------------------------------------------------- comms */
section('COMMS');
{
  world.jumpTo('halcyon');
  player.wanted = 0;
  const me = player.ship;
  me.pos = v3(0, 0, 0);

  const far = createShip('corsair', 'pirate', { pos: v3(9000, 0, 0), name: 'TOO FAR' });
  world.ships.push(far);
  ok('range is enforced', Comms.canHail(player, world, far) === 'OUT OF COMMS RANGE');

  // paying off a pirate
  const pirate = createShip('corsair', 'pirate', { pos: v3(0, 0, -400), name: 'RED VESPER' });
  pirate.ai = { role: 'pirate', state: 'hunt', t: 0 };
  pirate.angryAt = me;
  world.ships.push(pirate);
  const panel = Comms.open(player, world, pirate);
  ok('a pirate offers a way out', panel.options.some((o) => o.id === 'tribute'),
    panel.options.map((o) => o.id).join(','));
  player.credits = 20000;
  const cost = Comms.tributeCost(player);
  Comms.choose(player, world, pirate, 'tribute');
  ok('tribute costs credits', player.credits === 20000 - cost, `${cost} cr`);
  ok('and they break off', pirate.angryAt === null && pirate.ai.state === 'flee');

  // robbing a trader you outgun
  player.active = player.hangar.findIndex((h) => h.classId === 'bastion');
  if (player.active < 0) player.active = 0;
  player.buildShip(world);
  const victim = createShip('shuttle', 'trader', { pos: v3(0, 0, -300), name: 'FAT MARGIN' });
  addCargo(victim, 'luxuries', 20);
  victim.ai = { role: 'trader', state: 'travel', t: 0 };
  world.ships.push(victim);
  const pods = world.pods.length;
  const wanted = player.wanted;
  const r = Comms.choose(player, world, victim, 'demand');
  ok('a weaker trader gives up the cargo', world.pods.length > pods,
    `${world.pods.length - pods} pods jettisoned`);
  ok('and it is logged as piracy', player.wanted > wanted, `bounty +${player.wanted - wanted}`);

  // a scan with contraband aboard
  const sec = createShip('sentinel', 'security', { pos: v3(0, 0, -250), name: 'HALCYON PATROL' });
  world.ships.push(sec);
  player.ship.cargo = {};
  addCargo(player.ship, 'contraband', 6);
  player.credits = 30000;
  Comms.choose(player, world, sec, 'scan');
  ok('a scan finds contraband', !player.ship.cargo.contraband, 'seized');
  ok('and fines you', player.credits < 30000);

  // an adrift hull
  const hulk = createShip('hauler', 'trader', { pos: v3(0, 0, -200), name: 'COLD COMFORT', credits: 8000 });
  hulk.disabled = true;
  world.ships.push(hulk);
  const before = player.credits;
  Comms.choose(player, world, hulk, 'ransom');
  ok('an adrift crew will buy you off', player.credits > before, `+${player.credits - before} cr`);

  // orders to the wing
  Crew.hire(player, 'wingShuttle', world);
  const wing = world.ships.find((s) => s.wing && !s.dead);
  player.target = pirate;
  Comms.choose(player, world, wing, 'wingEngage');
  ok('the wing takes an order', wing.ai.order === 'engage' && wing.ai.orderTarget === pirate);
  Comms.choose(player, world, wing, 'wingHold');
  ok('and can be told to sit still', wing.ai.order === 'hold');
}

/* -------------------------------------------------------------- distress */
section('DISTRESS');
{
  player.distress = null;
  const raider = createShip('marauder', 'pirate', { pos: v3(400, 0, 0), name: 'NINE TEETH' });
  const prey = createShip('hauler', 'trader', { pos: v3(300, 0, 0), name: 'LONG PATIENCE' });
  prey.ai = { role: 'trader', state: 'travel', t: 0 };
  prey.angryAt = raider;
  world.ships.push(raider, prey);
  player.ship.pos = v3(0, 0, 0);

  world._distressTimer = 0;
  const call = Comms.checkDistress(world, player, 1 / 60);
  ok('a mayday goes out', !!call, call ? `${call.reward} cr offered` : 'none');

  const purse = player.credits;
  raider.dead = true;                        // you saw them off
  Comms.updateDistress(world, player);
  ok('driving them off pays', player.credits > purse, `+${player.credits - purse} cr`);
  ok('and the call clears', player.distress === null);
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
