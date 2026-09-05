// Headless play-through of the systems the renderer sits on top of.
// Run: node test/integration.mjs

import { World } from '../src/game/world.js';
import { Player } from '../src/game/player.js';
import { Market, sellAllOre, buyShip, buyModule, repair } from '../src/game/station.js';
import { Boarding, boardBlocker } from '../src/game/boarding.js';
import { createShip, flyShip, fireMount, updateTurrets, damageShip, destroyShip, disableShip, cargoUsed, addCargo, recalc } from '../src/game/ship.js';
import { MODULES } from '../src/game/data.js';
import * as Contracts from '../src/game/contracts.js';
import * as Crew from '../src/game/crew.js';
import * as Comms from '../src/game/comms.js';
import { SECTORS } from '../src/game/sectors.js';
import { v3, vsub, vnorm, vdist, vlen as vlen3, qlook, leadTarget } from '../src/core/math.js';

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
{
  // The throttle names a speed, not an amount of thrust. Every position above
  // zero used to have the same destination — the hull's maximum — just reached
  // at different rates, which made the bar a rate control wearing a speed
  // control's clothes.
  const s = createShip('shuttle', 'player', { speedHold: true });
  const hold = (frac, secs) => {
    for (let i = 0; i < secs * 60; i++) flyShip(s, { throttle: frac }, 1 / 60);
    return vlen3(s.vel);
  };
  const max = s.stats.maxSpeed;
  const half = hold(0.5, 12);
  ok('half throttle holds half speed', Math.abs(half - max * 0.5) < max * 0.04,
    `${half.toFixed(0)} of ${max.toFixed(0)} m/s`);
  ok('and stays there', Math.abs(hold(0.5, 12) - half) < 1, `${hold(0.5, 2).toFixed(0)} m/s`);
  const quarter = hold(0.25, 12);
  ok('a quarter holds a quarter', Math.abs(quarter - max * 0.25) < max * 0.04,
    `${quarter.toFixed(0)} m/s`);
  ok('full throttle still reaches the rating', hold(1, 12) > max * 0.97);
  ok('and zero is a full stop, not a drift', hold(0, 12) < 0.5);
  const rev = hold(-1, 12);
  ok('below centre flies backwards', rev > 10 && rev <= max * s.stats.reverse + 2,
    `${rev.toFixed(0)} m/s astern`);

  // With the assist off the same bar is a thrust lever again, so FULL NEWTONIAN
  // means what it says: half thrust still winds you past half speed.
  const n = createShip('shuttle', 'player', { speedHold: true });
  n.assist = false;
  for (let i = 0; i < 60 * 20; i++) flyShip(n, { throttle: 0.5 }, 1 / 60);
  ok('assist off makes it a thrust lever again', vlen3(n.vel) > max * 0.7,
    `${vlen3(n.vel).toFixed(0)} m/s on half thrust`);
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
    if (runner.dead) break;                 // caught, or it made the sector edge
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
  // The invariant the trade route rests on is that Cinder always pays more for
  // ore — not that any single roll clears a fixed margin. Drift of +/-14% on
  // both ends means one sample beats 1.2x only about 88% of the time, which is
  // a flaky assertion, not a broken route.
  const away = world.station.market;
  let holds = 0, best = 0;
  for (let i = 0; i < 200; i++) {
    away.roll(); homeMarket.roll();
    const r = away.sellPrice('gold') / homeMarket.sellPrice('gold');
    if (r > 1) holds++;
    best = Math.max(best, r);
  }
  ok('the ore route never runs backwards', holds === 200, `${holds}/200 rolls pay more at the yard`);
  ok('and is worth the trip', best > 1.4, `up to ${best.toFixed(2)}x`);
  away.roll();
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

/* --------------------------------------------------------------- repairs */
// One assertion per bug the code sweep turned up, so none of them come back.
section('REGRESSIONS');
{
  // A tribute used to buy about 16 ms of peace: findPrey re-picked the player on
  // the next tick and the flee-exit flipped a healthy hull straight back to hunt.
  const pirate = world.spawnPirate();
  pirate.pos = v3(...player.ship.pos); pirate.pos[2] += 500;
  pirate.hull = pirate.stats.hullMax;
  pirate.ai = { role: 'pirate', state: 'hunt', t: 0, orbit: 380, sign: 1 };
  pirate.target = player.ship; pirate.angryAt = player.ship;
  player.credits = 90000;
  Comms.choose(player, world, pirate, 'tribute');
  step(240);
  ok('a tribute actually holds', pirate.target !== player.ship && pirate.angryAt !== player.ship,
    `target ${pirate.target?.name || 'none'} after 4 s`);
  // They may well go and hunt someone else — the deal was only that they leave
  // you alone. What used to happen is that they re-acquired the player within a
  // frame, so that is what this watches for.
  let reacquired = 0;
  for (let i = 0; i < 60 * 30; i++) {
    world.update(1 / 60);
    if (pirate.target === player.ship || pirate.angryAt === player.ship) reacquired++;
  }
  ok('and they never come back for you inside the truce', reacquired === 0,
    `${reacquired} frames locked on across 30 s`);

  // A turret round straying through them does not undo what you paid for,
  // however much of it lands — you did not aim it.
  pirate.truceHits = 0;
  damageShip(pirate, pirate.stats.hullMax * 0.5, world, { from: player.ship });
  ok('your turrets cannot void the truce for you', pirate.paidOff !== null);
  // Your own gun does, and it takes a burst rather than a graze.
  damageShip(pirate, 4, world, { from: player.ship, manual: true });
  ok('nor does one round of your own', pirate.paidOff !== null,
    `${Math.round(pirate.truceHits)} of ${Math.round(pirate.stats.hullMax * 0.08)} allowed`);
  damageShip(pirate, pirate.stats.hullMax * 0.2, world, { from: player.ship, manual: true });
  ok('shooting them in earnest does', pirate.paidOff === null);
  pirate.dead = true;
}
{
  // Ransom used to stamp `looted`, locking you out of a hold you never touched.
  const hulk = world.spawnDerelict();
  hulk.credits = 4000;
  Comms.choose(player, world, hulk, 'ransom');
  ok('a ransom leaves the hold alone', !hulk.looted && hulk.ransomed);
  ok('and the hull is still boardable', boardBlocker(player, hulk) !== 'HOLD ALREADY STRIPPED',
    boardBlocker(player, hulk) || 'boardable');
  ok('but they will not pay twice',
    !Comms.options(player, world, hulk).some((o) => o.id === 'ransom'));

  // A wreck has nobody at the radio and is not a licensed hull.
  const wanted0 = player.wanted;
  world.provoke(hulk);
  ok('a derelict broadcasts no distress call', player.wanted === wanted0);
  hulk.hull = 1;
  damageShip(hulk, 500, world, { from: player.ship });
  ok('and finishing one is not an unlawful kill', player.wanted === wanted0,
    `wanted ${player.wanted}`);
}
{
  // Scanning was a free bounty wash: 300 off per tap, no cooldown.
  const sec = world.spawnSecurity();
  player.wanted = 5000;
  Comms.choose(player, world, sec, 'scan');
  const after = player.wanted;
  Comms.choose(player, world, sec, 'scan');
  ok('a patrol only scans you once', player.wanted === after, `${after} wanted, unchanged`);
  ok('and stops offering', !Comms.options(player, world, sec).some((o) => o.id === 'scan'));
  sec.dead = true;
  player.wanted = 0;
}
{
  // The HUD card froze at accept time because its id never changed.
  player.contracts = [];
  const supply = { id: 'c999', type: 'supply', need: 20, progress: 0, item: 'iron',
    title: 'SUPPLY — 20 IRON', reward: 5000, station: 'halcyon-depot' };
  Contracts.accept(player, supply, world);
  const before = Contracts.tracked(player, world);
  addCargo(player.ship, 'iron', 3);
  const after = Contracts.tracked(player, world);
  ok('the tracked card repaints as the hold fills', before.id !== after.id,
    `${before.id} -> ${after.id}`);
  player.contracts = [];
  addCargo(player.ship, 'iron', -3);

  // Ids restart at c1 on reload while saved jobs keep theirs.
  const fresh = new Player();
  fresh.contracts = [{ id: 'c7' }, { id: 'c12' }];
  Contracts.reseed(fresh);
  const board = Contracts.rollBoard(world, fresh);
  ok('a reissued board cannot collide with a saved job',
    board.every((c) => !fresh.contracts.some((a) => a.id === c.id)),
    board.map((c) => c.id).join(','));
}
{
  // Wing hulls are AI-flown, so they take the AI cap; their kills used to pay
  // nothing at all.
  player.credits = 60000;
  Crew.hire(player, 'wingCorsair', world);
  Crew.syncCrew(player, world);
  const wingman = world.ships.find((s) => s.wing);
  ok('a wing hull takes the computer speed cap', !!wingman && wingman.stats.maxSpeed <= 150,
    `${wingman?.stats.maxSpeed.toFixed(0)} m/s`);
  const cr0 = player.credits, kills0 = player.stats.kills;
  let victim = null;
  // A wounded pirate has a 35% chance of surrendering rather than exploding, so
  // shoot until one actually dies — surrender is a different code path.
  for (let i = 0; i < 30 && !(victim && victim.dead); i++) {
    victim = world.spawnPirate();
    victim.hull = 1; victim.shield = 0;
    damageShip(victim, 999, world, { from: wingman });
    if (!victim.dead) victim.disabled = true;
  }
  ok('a wing kill pays a share', victim.dead && player.credits > cr0,
    `+${player.credits - cr0} cr`);
  ok('and counts as a kill', player.stats.kills === kills0 + 1,
    `${player.stats.kills - kills0} logged`);
}
{
  // Cinder has seven permanent hulks against a civilian quota of two, so the
  // old count (everything not pirate or security) never let another trader in.
  world.jumpTo('cinder');
  world.traderTimer = 0;
  const civ0 = world.ships.filter((s) => s.ai && (s.ai.role === 'trader' || s.ai.role === 'miner')).length;
  world.director(0.1);
  const civ1 = world.ships.filter((s) => s.ai && (s.ai.role === 'trader' || s.ai.role === 'miner')).length;
  ok('a graveyard sector still restocks its traders', civ1 >= civ0,
    `${civ0} -> ${civ1} with ${world.ships.filter((s) => s.disabled).length} hulks adrift`);
  world.jumpTo('halcyon');
}
{
  // Beams billed per frame, so a 120 Hz phone mined twice as fast for free.
  const rig = (hz) => {
    const s = createShip('prospector', 'civilian', { loadout: { hardpoints: ['mining1'], utility: [] } });
    const w = new World(new Player());
    w.player.ship = s; w.ships.push(s);
    s.pos = v3(0, 0, 0); s.energy = 1e6;
    const rock = w.spawnAsteroid({ pos: v3(0, 0, -300), size: 40 });
    w.grid.rebuild(w.asteroids);      // fireBeam probes the grid, update() fills it
    const hp0 = rock.hp;
    for (let i = 0; i < hz; i++) {
      s.hardpoints[0].cd = 0;
      fireMount(s, s.hardpoints[0], v3(0, 0, -1), w, null, 1 / hz);
    }
    return hp0 - rock.hp;
  };
  const at60 = rig(60), at120 = rig(120);
  ok('one second of mining is one second of mining at any frame rate',
    Math.abs(at120 - at60) / at60 < 0.02, `${at60.toFixed(1)} at 60 Hz vs ${at120.toFixed(1)} at 120 Hz`);
}
{
  // The tutorial jumped from a ~4,800 cr first sale to a 6,500 cr turret.
  const t = new (await import('../src/game/tutorial.js')).Tutorial(new Player());
  const ids = [];
  while (t.active) { ids.push(t.step.id); t.state.step++; }
  ok('the tutorial funds the turret before asking for it',
    ids.indexOf('earn') > ids.indexOf('sell') && ids.indexOf('earn') < ids.indexOf('turret'),
    ids.join(' -> '));
}

/* ---------------------------------------------------------- readability */
section('LEGIBILITY');
{
  // Nothing on screen used to say which streaks could hurt you: a pirate's
  // pulse round was pixel-identical to your own.
  const foe = world.spawnPirate();
  foe.pos = v3(...player.ship.pos); foe.pos[2] -= 300;
  const gun = foe.hardpoints.find((h) => MODULES[h.moduleId] && !MODULES[h.moduleId].beam);
  gun.cd = 0; foe.energy = 999;
  world.projectiles.length = 0;
  fireMount(foe, gun, v3(0, 0, 1), world, player.ship);
  ok('hostile fire is drawn red', world.projectiles[0]?.color === 'enemyLaser',
    world.projectiles[0]?.color);
  world.projectiles.length = 0;
  const mine = player.ship.hardpoints.find((h) => MODULES[h.moduleId] && !MODULES[h.moduleId].beam);
  mine.cd = 0; player.ship.energy = 999;
  fireMount(player.ship, mine, v3(0, 0, -1), world, foe);
  ok('and your own is not', world.projectiles[0]?.color !== 'enemyLaser',
    world.projectiles[0]?.color);
  foe.dead = true;
}
{
  // The death screen used to say only 'YOUR SHIP CAME APART'.
  world.clearDamageLog();
  const killer = world.spawnPirate();
  killer.name = 'THE LAST WORD';
  killer.pos = v3(...player.ship.pos); killer.pos[2] -= 240;
  player.ship.hull = player.ship.stats.hullMax;
  damageShip(player.ship, 90, world, { from: killer, manual: true });
  damageShip(player.ship, 30, world, { cause: 'collision' });
  const r = world.deathReport();
  ok('the death report names who killed you', r.killer === 'THE LAST WORD', String(r.killer));
  ok('and what took the hull apart, as shares', r.sources.length === 2
    && r.sources[0].label === 'THE LAST WORD'
    && r.sources[0].share === 75 && r.sources[1].share === 25,
    r.sources.map((x) => `${x.label} ${x.share}%`).join(' / '));
  ok('and offers a way to survive it next time', /HAIL/.test(r.tip));
  killer.dead = true;
  world.clearDamageLog();
}
{
  // A pirate could gut a hauler two kilometres off in total silence: only the
  // player's own fire ever registered, so no NPC ever reacted to an NPC.
  const hauler = createShip('hauler', 'trader', { pos: v3(2000, 0, 2000), name: 'SLOW PATIENCE' });
  hauler.ai = { role: 'trader', state: 'travel', t: 0, dest: v3(0, 0, 0) };
  world.ships.push(hauler);
  const raider = world.spawnPirate();
  raider.pos = v3(2100, 0, 2100);
  damageShip(hauler, 20, world, { from: raider });
  ok('a trader shot by a pirate knows who did it', hauler.angryAt === raider,
    hauler.angryAt?.name || 'nobody');
  ok('and runs', hauler.ai.state === 'flee');
  hauler.dead = true; raider.dead = true;
}
{
  // Beaten fighters used to sprint away at full rating and then bounce off the
  // sector wall for ever, so a fight you had won never actually ended.
  const runner = createShip('corsair', 'pirate', { pos: v3(0, 0, 0) });
  runner.ai = { role: 'pirate', state: 'flee', t: 0 };
  const full = runner.stats.maxSpeed;
  for (let i = 0; i < 600; i++) flyShip(runner, { throttle: 1 }, 1 / 60);
  const healthy = vlen3(runner.vel);
  runner.hull = runner.stats.hullMax * 0.1;
  runner.vel = v3(0, 0, 0);
  for (let i = 0; i < 600; i++) flyShip(runner, { throttle: 1 }, 1 / 60);
  const hurt = vlen3(runner.vel);
  ok('a shot-up runner cannot sprint', hurt < healthy * 0.75,
    `${healthy.toFixed(0)} m/s healthy vs ${hurt.toFixed(0)} at 10% hull (cap ${full.toFixed(0)})`);

  // Fly it out under its own power rather than teleporting it past the line: an
  // earlier version of this rule used a distance margin no ship could ever
  // reach, because the boundary's pull balances a hull's drives about 100 m out
  // — and a test that placed the ship by hand passed anyway.
  const w2 = new World(new Player());
  w2.player.buildShip(w2);
  w2.generate();
  const bolter = w2.spawnPirate();
  bolter.pos = v3(0, 0, -w2.radius * 0.97);   // the sector's own edge, not the default
  bolter.vel = v3(0, 0, -60);
  bolter.hull = bolter.stats.hullMax * 0.1;
  bolter.target = w2.player.ship;
  bolter.ai = { role: 'pirate', state: 'flee', t: 0, orbit: 380, sign: 1 };
  w2.player.ship.pos = v3(0, 0, 0);
  let out = 0;
  for (let i = 0; i < 60 * 40 && !bolter.dead; i++) { w2.update(1 / 60); out = i / 60; }
  ok('and one that makes the edge is gone', bolter.dead && bolter.escaped,
    bolter.dead ? `gone after ${out.toFixed(0)} s at ${vlen3(bolter.pos).toFixed(0)} m`
      : `still at ${vlen3(bolter.pos).toFixed(0)} m after 40 s`);
}

/* ------------------------------------------------------------- the depot */
section('THE DEPOT');
{
  // The depot used to be scenery. Rounds went straight through it, hulls flew
  // through the middle of it, and shooting it cost nothing and said nothing.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate();
  w.grace = 9999;
  const said = [];
  w.log = (m, k) => said.push(`${k}:${m}`);
  const me = w.player.ship, st = w.station;
  const R = st.radius * st.scale;

  // a round fired into it stops there
  me.pos = v3(st.pos[0], st.pos[1], st.pos[2] + 400); me.vel = v3(0, 0, 0);
  const dir = vnorm(v3(), vsub(v3(), st.pos, me.pos));
  qlook(me.quat, dir);
  const gun = me.hardpoints.find((h) => MODULES[h.moduleId] && !MODULES[h.moduleId].beam);
  me.energy = me.stats.energyMax; gun.cd = 0;
  fireMount(me, gun, dir, w, null, 1 / 60);
  for (let i = 0; i < 60 * 3; i++) w.update(1 / 60);
  ok('rounds do not pass through the depot',
    !w.projectiles.some((p) => vdist(p.pos, st.pos) < R), `${w.projectiles.length} still in flight`);

  // and a hull cannot fly through the middle of it
  me.pos = v3(st.pos[0], st.pos[1], st.pos[2] + R + 30);
  me.vel = v3(0, 0, -120);
  for (let i = 0; i < 60 * 3; i++) w.update(1 / 60);
  ok('and hulls bounce off it instead of through it', vdist(me.pos, st.pos) >= R - 1,
    `${vdist(me.pos, st.pos).toFixed(0)} m from centre, hull surface at ${R.toFixed(0)} m`);

  // shooting it is noticed and costs you
  const wanted0 = w.player.wanted;
  me.pos = v3(st.pos[0], st.pos[1], st.pos[2] + 400); me.vel = v3(0, 0, 0);
  qlook(me.quat, dir);
  for (let i = 0; i < 60 * 12; i++) {
    me.energy = me.stats.energyMax;
    fireMount(me, gun, dir, w, null, 1 / 60);
    w.update(1 / 60);
  }
  ok('shooting the depot costs you', w.player.wanted > wanted0,
    `bounty +${w.player.wanted - wanted0}`);
  ok('and they say so', said.some((l) => /CHECK YOUR FIRE/.test(l)));
  ok('and eventually shut the bay', st.market.banUntil > w.time,
    st.market.banUntil ? `${(st.market.banUntil - w.time).toFixed(0)}s to go` : 'never banned');

  // The ban has to outlive the station object, or you dodge it by jumping out
  // and straight back — generate() builds a fresh station every time.
  const left = st.market.banUntil;
  w.jumpTo('cinder');
  w.jumpTo('halcyon');
  ok('and the ban survives a round trip through the gate',
    w.station.market.banUntil === left, `${(w.station.market.banUntil - w.time).toFixed(0)}s still to go`);

  // A turret round straying into it is not a crime — you did not aim it.
  const st2 = new World(new Player());
  st2.player.buildShip(st2); st2.generate(); st2.log = () => {};
  const before = st2.player.wanted;
  st2.hitStructure(st2.station, v3(...st2.station.pos),
    { owner: st2.player.ship, manual: false });
  ok('a turret stray is not a crime', st2.player.wanted === before);
}
{
  // Making the station solid must not wall the player out of the two things
  // that need you to get close to something.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate();
  const me = w.player.ship, st = w.station;
  me.pos = v3(st.pos[0], st.pos[1], st.pos[2] + st.radius * st.scale + 40);
  me.vel = v3(0, 0, 0);
  for (let i = 0; i < 60; i++) w.update(1 / 60);
  ok('you can still get close enough to dock',
    vdist(me.pos, st.pos) <= st.dockRadius + st.radius * st.scale,
    `${vdist(me.pos, st.pos).toFixed(0)} m, limit ${(st.dockRadius + st.radius * st.scale).toFixed(0)} m`);

  // Gates are rings you fly through, so they are deliberately not solid: the
  // jump triggers within 62 m and a solid gate stops a Bastion at 59 m.
  const g = w.gates[0];
  me.pos = v3(...g.pos); me.vel = v3(0, 0, 0);
  for (let i = 0; i < 60; i++) w.update(1 / 60);
  ok('and gates never push you out of your own jump trigger',
    vdist(me.pos, g.pos) < 62, `${vdist(me.pos, g.pos).toFixed(0)} m from the gate`);
}

/* -------------------------------------------------------------- evasion */
section('EVASION');
{
  // Being shot used to change a pirate's flight not at all: it read its own
  // hull only to pick between orbiting and running, and running was a dead
  // straight line — the easiest shot in the game against a lead solution.
  const shootAt = (evade) => {
    let shots = 0, dealt = 0;
    for (let r = 0; r < 6; r++) {
      const w = new World(new Player());
      w.player.buildShip(w);
      w.generate();
      w.grace = 9999;
      w.log = () => {};
      for (const x of [...w.ships]) if (x.faction === 'pirate') w.ships.splice(w.ships.indexOf(x), 1);
      const me = w.player.ship;
      me.pos = v3(0, 0, 0); me.vel = v3(0, 0, 0);
      const p = w.spawnPirate();
      p.pos = v3(0, 0, -900); p.vel = v3(0, 0, 0);
      p.ai = { role: 'pirate', state: 'hunt', t: 0, orbit: 900, sign: 1, evade };
      p.target = me; p.angryAt = me;
      // immortal, so the measurement is hit rate rather than time to kill
      p.stats.hullMax = 1e9; p.hull = 1e9; p.shield = 0; p.stats.shieldMax = 0;
      const gun = me.hardpoints.find((h) => MODULES[h.moduleId] && !MODULES[h.moduleId].beam);
      const m = MODULES[gun.moduleId];
      for (let i = 0; i < 60 * 12; i++) {
        me.energy = me.stats.energyMax;
        const before = p.hull;
        if (gun.cd <= 0 && vdist(me.pos, p.pos) < m.range) {
          // a perfect lead — exactly what an auto-turret computes
          const lead = leadTarget(v3(), me.pos, p.pos, p.vel, m.speed);
          const dir = vnorm(v3(), vsub(v3(), lead, me.pos));
          qlook(me.quat, dir);
          if (fireMount(me, gun, dir, w, p, 1 / 60)) shots++;
        }
        w.update(1 / 60);
        dealt += Math.max(0, before - p.hull);
      }
    }
    return shots ? (dealt / shots) / MODULES.pulse.dmg * 100 : 0;
  };
  const straight = shootAt(false), jinking = shootAt(true);
  ok('jinking beats a perfect lead', jinking < straight * 0.8,
    `${straight.toFixed(0)}% of shots connect against a straight flyer, ${jinking.toFixed(0)}% against a jinker`);

  // Who can fly is decided per pilot from the region's own figure, so a belt
  // has a mix rather than a switch that flips for everyone at once.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate();
  w.log = () => {};
  const rate = (sector, n = 400) => {
    w.sector = SECTORS[sector];
    let evasive = 0;
    for (let i = 0; i < n; i++) if (w.spawnPirate().ai.evade) evasive++;
    w.ships.length = 0;
    return evasive / n;
  };
  const quiet = rate('halcyon'), rough = rate('cinder');
  ok('a quiet belt has some pilots who can fly and some who cannot',
    quiet > 0.15 && quiet < 0.5, `${(quiet * 100).toFixed(0)}% evasive in Halcyon`);
  ok('and a rough one has mostly the former', rough > quiet + 0.25,
    `${(rough * 100).toFixed(0)}% in Cinder`);
}

/* --------------------------------------------------------------- the void */
section('OPEN SPACE');
{
  // The belt had a wall: a wireframe grid, a "NAV BUOY LIMIT" nag, and an
  // inward pull that stalled any hull about 300 m past 5.2 km. Nothing in the
  // fiction asked for it — it is open space, not an arena.
  //
  // Nobody shoots at this one. The question is whether the sector lets you
  // leave, and a pilot who flies in a straight line for three minutes without
  // ever firing back is one the belt kills often enough to drown the answer —
  // which is correct behaviour, and a different fact.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate();
  w.grace = 1e9;
  w.log = () => {};
  for (const s of [...w.ships]) if (s.faction === 'pirate') w.ships.splice(w.ships.indexOf(s), 1);
  const me = w.player.ship;
  me.pos = v3(600, 0, 400); me.vel = v3(0, 0, 0);
  for (let i = 0; i < 60 * 180; i++) {
    qlook(me.quat, v3(1, 0, 0));
    flyShip(me, { pitch: 0, yaw: 0, roll: 0, throttle: 1 }, 1 / 60);
    w.update(1 / 60);
  }
  const out = vlen3(me.pos);
  ok('you can fly out as far as you like', out > w.radius * 3,
    `${(out / 1000).toFixed(0)} km out, sector radius ${(w.radius / 1000).toFixed(1)} km`);
  ok('under power the whole way, not adrift', vlen3(me.vel) > me.stats.maxSpeed * 0.95 && !me.dead,
    `${vlen3(me.vel).toFixed(0)} of ${me.stats.maxSpeed.toFixed(0)} m/s`);

  // The sector's own traffic still stays in the sector, or there would be
  // nothing left to trade with by the time you came back.
  const stray = w.ships.find((s) => s.ai && s.faction !== 'player');
  ok('but the locals stay home', !stray || vlen3(stray.pos) < w.radius * 1.3,
    stray ? `nearest local ${(vlen3(stray.pos) / 1000).toFixed(1)} km from centre` : 'none left');

  // ...and you can always find your way back.
  ok('and home is still on the instruments', !!w.station && vlen3(w.station.pos) < w.radius);
}
{
  // Out in the dark the director has to stay quiet. Left alone it places
  // pirates a few km off the player wherever the player happens to be, which
  // would have meant flying out to look at the stars and being ambushed by a
  // belt that is nowhere near you.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate();
  w.grace = 0;
  w.log = () => {};
  const me = w.player.ship;
  me.pos = v3(w.radius * 3, 0, 0); me.vel = v3(0, 0, 0);
  qlook(me.quat, v3(1, 0, 0));
  let nearby = 0;
  for (let i = 0; i < 60 * 300; i++) {
    flyShip(me, { pitch: 0, yaw: 0, roll: 0, throttle: 1 }, 1 / 60);
    w.update(1 / 60);
    nearby = Math.max(nearby, w.ships.filter((s) => s.faction === 'pirate'
      && !s.dead && vdist(s.pos, me.pos) < 4000).length);
  }
  ok('and there is nothing out there', nearby === 0,
    `${nearby} pirates found you ${(vlen3(me.pos) / 1000).toFixed(0)} km out, over five minutes`);
}

{
  // Killing one used to buy nothing at all. The belt topped itself back up to
  // quota every 25-45 s whether you had just won a fight or not, so the count
  // only reached zero if you killed the last two faster than the refill — and
  // in the reach, quota five, effectively never. The break the belt owes you
  // for clearing it was unreachable rather than absent.
  const gapAfterAKill = (kills) => {
    const w = new World(new Player());
    w.player.buildShip(w);
    w.generate();
    w.log = () => {};
    w.grace = 0;
    w.player.ship.pos = v3(0, 0, -900);
    for (let i = 0; i < 60 * 90; i++) w.update(1 / 60);   // let the belt fill
    const live = w.ships.filter((s) => s.faction === 'pirate' && !s.dead);
    for (const p of live.slice(0, kills)) destroyShip(p, w, w.player.ship);
    const before = w.ships.filter((s) => s.faction === 'pirate' && !s.dead).length;
    let gap = 0;
    for (let i = 0; i < 60 * 200; i++) {
      w.update(1 / 60);
      gap = i / 60;
      if (w.ships.filter((s) => s.faction === 'pirate' && !s.dead).length > before) break;
    }
    return { gap, before };
  };
  const one = gapAfterAKill(1);
  ok('killing one buys a pause even with the belt still hot',
    one.before > 0 && one.gap > 25,
    `${one.gap.toFixed(0)} s before the next arrival, ${one.before} still on the scope`);
  const all = gapAfterAKill(9);
  ok('and clearing it buys the long one', all.before === 0 && all.gap > 110,
    `${all.gap.toFixed(0)} s with the belt empty`);
}
{
  // The cooldown starts when the last enemy in the sector is dealt with — and a
  // hull with its drives ioned out has been dealt with. It counted as a live
  // pirate, so leaving one adrift meant the belt never announced itself clear
  // and, sitting at quota, never sent anything else either: the sector went
  // permanently and silently dead, which is not a quiet you earned.
  const leaveThemAdrift = (finish) => {
    const w = new World(new Player());
    w.player.buildShip(w);
    w.generate();
    let cleared = false;
    w.log = (t) => { if (/BELT IS CLEAR/.test(t)) cleared = true; };
    w.grace = 0;
    w.player.ship.pos = v3(0, 0, -900);
    for (let i = 0; i < 60 * 90; i++) w.update(1 / 60);
    const live = w.ships.filter((x) => x.faction === 'pirate' && !x.dead);
    for (const p of live) finish(p, w);
    for (let i = 0; i < 60 * 200; i++) w.update(1 / 60);
    const back = w.ships.some((x) => x.faction === 'pirate' && !x.dead && !x.disabled);
    return { cleared, back, n: live.length };
  };
  const shot = leaveThemAdrift((p, w) => destroyShip(p, w, w.player.ship));
  const ioned = leaveThemAdrift((p, w) => disableShip(p, w, w.player.ship));
  ok('destroying the last of them starts the cooldown', shot.cleared && shot.n > 0,
    `${shot.n} destroyed`);
  ok('and so does ioning it, because a hulk is cargo, not an enemy', ioned.cleared,
    `${ioned.n} left adrift`);
  ok('and the belt comes back afterwards either way', shot.back && ioned.back);
}

/* --------------------------------------------------------------- sites */
section('SITES');
{
  // Jumping the second gate ends the demo, and a sector that is one belt with
  // one station has nowhere to send you: every job the board could write said
  // "anywhere in the belt", which describes work but never a destination.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate();
  w.log = () => {};
  const beltR = 5200;               // the main cluster, deliberately unchanged
  ok('the sector reaches further than the belt does', w.radius > beltR * 1.5,
    `${(w.radius / 1000).toFixed(0)} km sector around a ${(beltR / 1000).toFixed(1)} km belt`);
  ok('and there are places out there to be sent to', w.sites.length === 2,
    w.sites.map((x) => x.name).join(', '));
  const out = w.sites.every((x) => vlen3(x.pos) > beltR && vlen3(x.pos) + x.r < w.radius);
  ok('each one clear of the belt but inside the sector', out,
    w.sites.map((x) => `${x.name} ${(vlen3(x.pos) / 1000).toFixed(1)} km`).join(', '));

  // A claim is only worth naming if the ore is actually there.
  const shoal = w.siteById('shoal');
  const rocks = w.asteroids.filter((a) => w.siteAt(a.pos) === shoal);
  const ice = rocks.filter((a) => a.type.ore === 'ice').length;
  ok('a claim is made of the rock it is named for', rocks.length > 40 && ice / rocks.length > 0.45,
    `${ice} of ${rocks.length} rocks at ${shoal.name} are ice`);

  // The one that actually needed fixing. A multiplier on the sector's mix
  // cannot make a rare ore dominant — 2.4x on platinum, base weight 8 against
  // iron's 34, measured 20% — so the claim named for platinum was an iron field
  // with a platinum name, and the job that sent you there was fiction.
  const anvil = w.siteById('anvil');
  const hard = w.asteroids.filter((a) => w.siteAt(a.pos) === anvil);
  const plat = hard.filter((a) => a.type.ore === 'platinum').length;
  ok('including a claim named for a rare one', plat / hard.length > 0.4,
    `${plat} of ${hard.length} rocks at ${anvil.name} are platinum, against a 6% belt average`);
  const belt = w.asteroids.filter((a) => !w.siteAt(a.pos));
  const beltIce = belt.filter((a) => a.type.ore === 'ice').length / belt.length;
  ok('and the belt is still the belt', belt.length > 180 && beltIce < 0.35,
    `${belt.length} rocks in the main cluster, ${(beltIce * 100).toFixed(0)}% ice`);

  // You have to be able to find it.
  let t = null; const seen = new Set();
  for (let i = 0; i < 60; i++) { t = w.cycleTarget(t); if (!t) break; seen.add(t.name || t.kind); }
  ok('TGT will step through the places, not only the ships',
    w.sites.every((x) => seen.has(x.name)) && seen.has(w.station.name),
    `${w.sites.length} claims, the depot and the gate are all on the cycle`);
}
{
  // A wreck field has wrecks in it, or the job that sends you there is fiction.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate('cinder');
  w.log = () => {};
  const march = w.siteById('march');
  const hulks = w.ships.filter((x) => x.hulk && w.siteAt(x.pos) === march).length;
  ok('the wreck field is made of wrecks', hulks >= 4, `${hulks} adrift hulls at ${march.name}`);
}
{
  // The point of a job that names a place: it only counts in that place.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate();
  w.log = () => {};
  w.onContractMine = (item, qty, pos) => Contracts.onMine(w.player, w, item, qty, pos);
  let job = null;
  for (let i = 0; i < 80 && !job; i++) {
    job = Contracts.rollBoard(w, w.player, 4).find((c) => c.type === 'prospect');
  }
  ok('the board offers work with an address on it', !!job, job?.title);
  Contracts.accept(w.player, job, w);
  const live = () => w.player.contracts[0];
  const site = w.siteById(job.site);
  w.onContractMine(job.item, 5, v3(0, 0, -900));
  const inBelt = live().progress;
  w.onContractMine(job.item, 5, site.pos);
  const atSite = live().progress;
  ok('rock cut in the belt does not count against a claim job', inBelt === 0);
  ok('rock cut at the claim does', atSite === 5, `${atSite}/${job.need}`);

  // ...and carrying it to the next sector does not settle it either.
  w.jumpTo('cinder');
  w.onContractMine(job.item, 5, v3(...site.pos));
  ok('and the claim does not follow you through the gate',
    w.player.contracts[0].progress === atSite, `${w.player.contracts[0].progress}/${job.need}`);
}
{
  // A runner is gone when it has broken off from you, not when it crosses a
  // shell: the shell test worked while every sector was 5.2 km across and left
  // a beaten pirate on the scope for a minute and a half once one was 11 km.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate('cinder');
  w.log = () => {};
  w.player.ship.pos = v3(0, 0, 0);
  const runner = w.spawnPirate();
  runner.pos = v3(0, 0, -1800);
  runner.hull = runner.stats.hullMax * 0.1;
  runner.target = w.player.ship;
  runner.ai = { role: 'pirate', state: 'flee', t: 0, orbit: 380, sign: 1 };
  let secs = 0, gapWhenGone = 0, fromCentre = 0;
  for (let i = 0; i < 60 * 300 && !runner.dead; i++) {
    w.update(1 / 60);
    secs = i / 60;
    gapWhenGone = vdist(runner.pos, w.player.ship.pos);
    fromCentre = vlen3(runner.pos);
  }
  ok('a beaten runner still gets away', runner.dead && runner.escaped, `after ${secs.toFixed(0)} s`);

  // The property that matters, and the one the shell test could not have: it is
  // gone while still well inside an 11 km sector, because what ended the fight
  // was breaking off from you rather than reaching an edge. Timings vary — a
  // hull with a repair module patches itself up and turns round, restarting the
  // clock — so this asserts where it happened, which does not.
  ok('reaped for breaking off, not for reaching the edge', fromCentre < w.radius,
    `${(fromCentre / 1000).toFixed(1)} km from centre in an ${(w.radius / 1000).toFixed(0)} km sector`);
  ok('and it is out of sight before it goes', gapWhenGone > 4200,
    `${(gapWhenGone / 1000).toFixed(1)} km away, past the 4.2 km draw distance`);
}

/* ------------------------------------------------------------- regions */
section('REGIONS');
{
  // A place has to look like itself. The sky used to be one module constant
  // built with Math.random, so both sectors shared it AND it was different on
  // every launch — a belt you flew back to was not the belt you left.
  const { skyFor } = await import('../src/render/scene.js');
  const a1 = skyFor(SECTORS.halcyon), a2 = skyFor(SECTORS.halcyon);
  const b1 = skyFor(SECTORS.cinder);
  ok('a sector\'s sky is the same sky every time', a1.starList[7].d[0] === a2.starList[7].d[0]);
  ok('and is not the sky next door',
    a1.starList.length !== b1.starList.length
    && a1.starList[7].d[0] !== b1.starList[7].d[0]
    && a1.sun.dir[0] !== b1.sun.dir[0],
    `${a1.starList.length} stars vs ${b1.starList.length}, different sun and tint`);
  ok('and the two stations are not the same building',
    SECTORS.halcyon.station.model !== SECTORS.cinder.station.model,
    `${SECTORS.halcyon.station.model} vs ${SECTORS.cinder.station.model}`);
}
{
  // A region has a fixed character. Difficulty used to key off a player threat
  // score, so four things stepped up on the same kill and buying the ship you
  // had saved for made the sector you were standing in measurably worse.
  const look = (kills, ship) => {
    const p = new Player();
    p.stats.kills = kills;
    p.wanted = kills * 200;
    if (ship) {
      p.hangar.push({ classId: ship, loadout: { hardpoints: [], utility: [] } });
      p.active = p.hangar.length - 1;
    }
    const w = new World(p);
    p.buildShip(w);
    w.generate('halcyon');
    w.log = () => {};
    let guns = 0;
    for (let i = 0; i < 200; i++) {
      guns += w.spawnPirate().hardpoints.filter((h) => MODULES[h.moduleId]).length;
      w.ships.length = 0;
    }
    return { quota: Math.round((2 + Math.floor(w.sector.danger)) * w.sector.pirates),
      guns: guns / 200, dmg: w.playerDamageScale() };
  };
  const fresh = look(0, null), veteran = look(50, 'bastion');
  ok('the home belt does not get harder because you did',
    fresh.quota === veteran.quota && fresh.dmg === veteran.dmg
      && Math.abs(fresh.guns - veteran.guns) < 0.25,
    `${fresh.quota} pirates / ${fresh.guns.toFixed(2)} guns / ${(fresh.dmg * 100).toFixed(0)}% dmg `
    + `fresh, vs ${veteran.quota} / ${veteran.guns.toFixed(2)} / ${(veteran.dmg * 100).toFixed(0)}% `
    + 'after 50 kills and a Bastion');

  // ...but it is not a fixed spawn table either: about one in four arrives a
  // notch above the local standard, so a belt has bad days.
  ok('though it still has bad days', fresh.guns > 1.05 && fresh.guns < 1.6,
    `${fresh.guns.toFixed(2)} guns per hull against a tier-0 standard of 1`);

  // Progression is going somewhere rougher, not outgrowing where you are.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate('cinder');
  w.log = () => {};
  ok('and the reach is a different place, not a later one',
    w.sector.danger > SECTORS.halcyon.danger && w.playerDamageScale() > 0.9,
    `danger ${w.sector.danger} vs ${SECTORS.halcyon.danger}, damage `
    + `${(w.playerDamageScale() * 100).toFixed(0)}% vs ${(SECTORS.halcyon.damage * 100).toFixed(0)}%`);
}

/* --------------------------------------------------------------- pacing */
section('DIRECTOR');
{
  // Clearing the belt used to buy about twenty seconds: the director only knew
  // how many pirates it wanted, not that you had just earned an empty sector,
  // so there was no state you could reach where the work counted for anything.
  const w = new World(new Player());
  w.player.buildShip(w);
  w.generate();
  w.grace = 0;
  w.log = () => {};
  w.director(0.1);                       // the director sees a live pirate...
  for (const s of w.ships) if (s.faction === 'pirate') s.dead = true;
  w.ships = w.ships.filter((s) => !s.dead);   // ...and now you have killed it

  const alive = () => w.ships.filter((s) => s.faction === 'pirate' && !s.dead).length;
  let back = null;
  for (let i = 1; i <= 60 * 300 && back === null; i++) {
    w.update(1 / 60);
    if (alive() > 0) back = i / 60;
  }
  ok('clearing the belt buys two minutes of quiet', back !== null && back >= 120,
    back === null ? 'nothing came back in 5 min' : `${back.toFixed(0)} s before the next one`);
  ok('but not five', back !== null && back < 240,
    back === null ? 'the belt stayed empty' : `${back.toFixed(0)} s`);

  for (let i = 0; i < 60 * 120; i++) w.update(1 / 60);
  ok('and the belt fills back to quota', alive() >= 2, `${alive()} on the scope two minutes later`);
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
