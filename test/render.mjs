// Runs the real draw path headless and fails if any segment is non-finite.
// A NaN reaching the HDR target is what paints black rectangles on real GPUs.

import { World } from '../src/game/world.js';
import { Player } from '../src/game/player.js';
import { LineBatch } from '../src/render/lines.js';
import { drawScene } from '../src/render/scene.js';
import { drawHUD } from '../src/ui/hud.js';
import { damageShip, createShip, addCargo } from '../src/game/ship.js';
import {
  v3, m4, m4perspective, m4view, m4mul, qforward, qright, qup, qid,
} from '../src/core/math.js';

const W = 1600, H = 900;
const proj = m4(), view = m4(), viewProj = m4();
const player = new Player();
const world = new World(player);
player.buildShip(world);
world.generate();

const batch = new LineBatch(80000);
let rejected = 0, maxLines = 0, frames = 0;

function frame(dt, touch) {
  world.update(dt);
  const ship = player.ship;
  const camPos = v3(ship.pos[0], ship.pos[1], ship.pos[2]);
  const camQuat = ship.quat;
  m4perspective(proj, 1.3, W / H, 0.5, 60000);
  m4view(view, camPos, camQuat);
  m4mul(viewProj, proj, view);
  const cam = {
    pos: camPos, quat: camQuat, viewProj,
    right: qright(v3(), camQuat), up: qup(v3(), camQuat), fwd: qforward(v3(), camQuat),
  };
  batch.reset();
  drawScene(batch, world, cam, { hideShip: ship });
  drawHUD(batch, { world, player, cam, W, H, time: world.time, touch });
  rejected += batch.rejected;
  maxLines = Math.max(maxLines, batch.count);
  frames++;

  // also check the buffer itself: nothing non-finite may reach the GPU
  const used = batch.count * 16;
  for (let i = 0; i < used; i++) {
    if (!Number.isFinite(batch.data[i])) {
      throw new Error(`non-finite float in instance buffer at ${i} (frame ${frames})`);
    }
  }
}

const scenarios = [
  ['drifting', () => {}],
  ['under way', () => { player.ship.throttle = 1; }],
  ['target locked', () => { player.target = world.asteroids[3]; }],
  ['ship targeted', () => { player.target = world.ships.find((s) => s !== player.ship) || null; }],
  ['taking fire', () => {
    const foe = world.spawnPirate();
    foe.pos = [player.ship.pos[0] + 200, player.ship.pos[1], player.ship.pos[2]];
    damageShip(player.ship, 25, world, { from: foe, point: player.ship.pos });
  }],
  ['hull nearly gone', () => { player.ship.hull = 1; player.ship.shield = 0; }],
  ['hull exactly zero', () => { player.ship.hull = 0; player.ship.shield = 0; }],
  ['gunner seat', () => { player.mode = 'gunner'; player.ship.hull = 200; }],
  ['at the sector edge', () => { player.ship.pos = [5300, 0, 0]; }],
  ['adrift target', () => {
    const v = createShip('hauler', 'trader', { pos: [player.ship.pos[0], 0, player.ship.pos[2] - 80] });
    addCargo(v, 'gold', 10);
    v.disabled = true;
    world.ships.push(v);
    player.target = v;
  }],
  ['stationary at the station', () => {
    player.ship.pos = [...world.station.pos];
    player.ship.vel = [0, 0, 0];
  }],
  ['zero velocity, zero throttle', () => {
    player.ship.vel = [0, 0, 0];
    player.ship.throttle = 0;
    player.ship.rate = [0, 0, 0];
  }],
];

let failed = null;
for (const [name, setup] of scenarios) {
  setup();
  const before = rejected;
  try {
    for (let i = 0; i < 240; i++) frame(1 / 60, i % 2 === 0);
  } catch (e) {
    failed = `${name}: ${e.message}`;
    break;
  }
  const bad = rejected - before;
  console.log(`  ${bad ? 'FAIL' : 'ok  '} ${name}${bad ? ` — ${bad} non-finite segments` : ''}`);
}

console.log(`\n${frames} frames drawn, peak ${maxLines} segments, ${rejected} rejected`);
if (failed) { console.log(`FAILED: ${failed}`); process.exit(1); }
process.exit(rejected ? 1 : 0);
