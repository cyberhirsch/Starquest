// STARQUEST — bootstrap and the frame loop.

import { createBestRenderer } from './render/backend.js';
import { LineBatch } from './render/lines.js';
import { drawScene, setQuality } from './render/scene.js';
import { drawHUD } from './ui/hud.js';
import { createInput } from './ui/input.js';
import { UI } from './ui/screens.js';
import { Audio } from './ui/audio.js';
import { setupMobile, registerServiceWorker } from './ui/mobile.js';
import { World, SECTOR_R } from './game/world.js';
import { Player } from './game/player.js';
import { Tutorial } from './game/tutorial.js';
import { Market } from './game/station.js';
import { Boarding, boardBlocker, BOARD_RANGE, BOARD_SPEED } from './game/boarding.js';
import { MODULES } from './game/data.js';
import {
  v3, m4, m4perspective, m4view, m4mul, qid, qaxis, qmul, qnorm, qcopy, qforward, qright, qup,
  qrot, vcopy, vset, vadd, vsub, vscale, vaddScaled, vlen, vdist, vnorm, clamp, lerp, rand,
} from './core/math.js';
import { flyShip, fireMount, mountWorldPos, recalc, cargoUsed, addCargo } from './game/ship.js';

const canvas = document.getElementById('gl');
const boot = document.getElementById('boot');
const bootMsg = document.getElementById('bootMsg');

const proj = m4(), view = m4(), viewProj = m4();
const _f = v3(), _r = v3(), _u = v3(), _tmp = v3(), _q = qid(), _q2 = qid();

async function start() {
  let renderer;
  try {
    renderer = await createBestRenderer(canvas, { resScale: 1 });
  } catch (err) {
    bootMsg.innerHTML = `<b>${err.message}</b><br><br>
      STARQUEST draws through WebGPU, falling back to WebGL2. Update to Chrome/Edge 113+,
      Safari 15+, or a recent Android browser, and make sure hardware acceleration is on.`;
    console.error(err);
    return;
  }

  const audio = new Audio();
  const batch = new LineBatch(70000);
  const restored = Player.load();
  const player = restored || new Player();
  const market = new Market();
  const world = new World(player);

  const game = {
    player, world, market, renderer, audio,
    boarding: null,
    paused: false,
    promptText: '',
    time: 0,
    shake: 0,
    toggleCRT() { renderer.crt = renderer.crt > 0.5 ? 0 : 1; },
    onOverlayChange(open) { game.paused = open; if (!open) canvas.focus(); },
    undock() { undock(); },
    endBoarding() { endBoarding(); },
    respawn() { respawn(); },
    newGame() { newGame(); },
  };

  const tutorial = new Tutorial(player);
  game.tutorial = tutorial;
  const ui = new UI(document.body, game);
  const input = createInput(canvas, document.body);
  const mobile = setupMobile(game, renderer, canvas, input);
  game.ui = ui;
  game.mobile = mobile;

  world.onLog = (text, kind) => {
    ui.log(text, kind);
    if (kind === 'danger') audio.alarm();
  };

  world.onPlayerDamage = (hit) => {
    const frac = hit.amount / Math.max(1, player.ship.stats.hullMax);
    ui.flashDamage(0.2 + frac * 2.4);
    mobile.buzz(Math.min(70, 15 + hit.amount));
  };

  function fresh() {
    world.ships.length = 0;
    world.asteroids.length = 0;
    world.projectiles.length = 0;
    world.pods.length = 0;
    world.particles.length = 0;
    world.rings.length = 0;
    world.generate();
    player.buildShip(world);
    if (player._cargo) { player.ship.cargo = player._cargo; player._cargo = null; }
    vset(player.ship.pos, 0, 0, -1050);
    qcopy(player.ship.quat, qid());
    vset(player.ship.vel, 0, 0, 0);
  }
  fresh();

  ui.log(`HALCYON BELT — VECTOR FLIGHT SYSTEM ONLINE (${renderer.backend.toUpperCase()})`, 'good');
  if (restored) ui.log('FLIGHT LOG RESTORED', 'good');
  ui.log(mobile.isTouch ? 'TAP THE MANUAL BUTTON FOR CONTROLS' : 'PRESS M FOR THE FLIGHT MANUAL', 'info');

  /* ------------------------------------------------------------ actions */

  function toggleMode() {
    player.mode = player.mode === 'pilot' ? 'gunner' : 'pilot';
    if (player.mode === 'gunner') { player.gunnerYaw = 0; player.gunnerPitch = 0; }
    audio.beep(player.mode === 'gunner');
    ui.log(player.mode === 'gunner'
      ? `GUNNER SEAT — MOUNT ${player.ship.manualIndex + 1}. THE HULL IS FLYING ITSELF.`
      : 'PILOT SEAT — YOU HAVE THE HELM', 'warn');
  }

  function dockCheck() {
    const st = world.station;
    if (!st) return null;
    const d = vdist(player.ship.pos, st.pos);
    const limit = st.dockRadius + st.radius * st.scale;
    if (d > limit) return null;
    if (vlen(player.ship.vel) > 90) return 'SLOW DOWN TO DOCK';
    return 'DOCK';
  }

  function doAction() {
    const dock = dockCheck();
    if (dock === 'DOCK') return dockAtStation();
    if (dock) { ui.log(dock, 'warn'); return; }
    const t = player.target;
    if (t && t.kind === 'ship' && t.disabled) {
      const blocker = boardBlocker(player, t);
      if (blocker) { ui.log(blocker, 'warn'); return; }
      game.boarding = new Boarding(world, player, t);
      audio.dock();
      ui.open('boarding');
      return;
    }
    ui.log('NOTHING TO DO HERE', 'info');
  }

  function dockAtStation() {
    const st = world.station;
    player.docked = true;
    vset(player.ship.vel, 0, 0, 0);
    player.ship.throttle = 0;
    input.throttle = 0;
    player.stats.docked++;
    player.save();
    audio.dock();
    market.roll();
    ui.open('station');
    ui.log('DOCKING CLAMPS ENGAGED', 'good');
  }

  function undock() {
    player.docked = false;
    const st = world.station;
    qforward(_f, st.quat);
    vaddScaled(player.ship.pos, st.pos, _f, -(st.radius * st.scale + 120));
    vscale(player.ship.vel, _f, -30);
    ui.close();
    ui.log('CLEAR OF THE CLAMPS', 'good');
  }

  function endBoarding() {
    const b = game.boarding;
    if (b) {
      const r = b.finish();
      if (r) ui.log(r.msg, r.ok ? 'good' : 'warn');
    }
    game.boarding = null;
    ui.close();
  }

  function respawn() {
    player.credits = Math.max(0, Math.round(player.credits * 0.85));
    player.ship.cargo = {};
    player.buildShip(world);
    recalc(player.ship, true);
    const st = world.station;
    vcopy(player.ship.pos, st.pos);
    player.ship.pos[2] += 220;
    vset(player.ship.vel, 0, 0, 0);
    player.ship.dead = false;
    player.ship.disabled = false;
    player.target = null;
    if (!world.ships.includes(player.ship)) world.ships.push(player.ship);
    ui.close();
    ui.log('NEW HULL ISSUED — INSURANCE TOOK ITS CUT', 'warn');
  }

  function newGame() {
    Player.clear();
    location.reload();
  }

  function handleEvents() {
    for (const ev of input.drain()) {
      audio.init(); audio.resume();
      if (ev === 'escape') {
        if (ui.isOpen) {
          if (game.boarding) endBoarding();
          else if (player.docked) undock();
          else ui.close();
        } else ui.open('menu');
        continue;
      }
      if (ui.isOpen) {
        // while an overlay is up, only a few keys pass through
        if (ev === 'skiptut') { tutorial.skip(); ui.setObjective(null); continue; }
        if (ev === 'inventory' || ev === 'map') { if (game.boarding) continue; ui.close(); }
        else if (ev === 'action' && game.boarding?.stage === 'breach') { game.boarding.strike(); ui.render(); }
        continue;
      }
      switch (ev) {
        case 'skiptut':
          tutorial.skip();
          ui.setObjective(null);
          player.save();
          ui.log('TUTORIAL SKIPPED — SEE THE MANUAL ANY TIME', 'info');
          break;
        case 'inventory': ui.open('inventory'); break;
        case 'map': ui.open('menu'); break;
        case 'mode': toggleMode(); break;
        case 'action': doAction(); break;
        case 'assist':
          player.assist = !player.assist; player.ship.assist = player.assist;
          ui.log(`FLIGHT ASSIST ${player.assist ? 'ENGAGED' : 'OFF — FULL NEWTONIAN'}`, 'info');
          break;
        case 'target': {
          qforward(_f, camQuat);
          const picked = world.pickTarget(player.ship.pos, _f, 0.22) || world.cycleTarget(player.target);
          player.target = picked === player.ship ? world.cycleTarget(player.target) : picked;
          audio.beep(!!player.target);
          break;
        }
        default:
          if (ev.startsWith('mount')) {
            const i = +ev.slice(5) - 1;
            if (i < player.ship.hardpoints.length) {
              player.ship.manualIndex = i;
              ui.log(`MANNING MOUNT ${i + 1}`, 'info');
            }
          }
      }
    }
  }

  /* --------------------------------------------------------- simulation */

  const camPos = v3();
  let camQuat = qid();

  function updateGunnerAim(dt) {
    const rate = 1.9;
    if (input.pointerLocked && !input.touch) {
      player.gunnerYaw -= input.look.dx * input.sens;
      player.gunnerPitch -= input.look.dy * input.sens;
    } else {
      player.gunnerYaw -= input.axes.x * rate * dt;
      player.gunnerPitch -= input.axes.y * rate * dt;
    }
    player.gunnerYaw = clamp(player.gunnerYaw, -2.6, 2.6);
    player.gunnerPitch = clamp(player.gunnerPitch, -1.35, 1.35);
    qaxis(_q, [0, 1, 0], player.gunnerYaw);
    qaxis(_q2, [1, 0, 0], player.gunnerPitch);
    qmul(_q, _q, _q2);
    qmul(player.gunner, player.ship.quat, _q);
    qnorm(player.gunner);
  }

  function fireControl(dt) {
    const ship = player.ship;
    const hp = ship.hardpoints[ship.manualIndex];
    if (!hp) return;
    const m = MODULES[hp.moduleId];
    if (!m || m.mount === 'auto') return;
    if (!input.fire || ship.disabled || ship.dead) return;
    qforward(_f, camQuat);
    const before = ship.energy;
    if (fireMount(ship, hp, _f, world, player.target)) {
      if (m.beam) { if (Math.random() < 0.12) audio.turret(); }
      else if (m.dmg > 40) audio.rail();
      else audio.laser();
    } else if (before < m.energy && Math.random() < 0.04) audio.beep(false);
  }

  function updateCamera() {
    const ship = player.ship;
    if (player.mode === 'gunner') {
      const hp = ship.hardpoints[ship.manualIndex];
      mountWorldPos(camPos, ship, hp);
      vaddScaled(camPos, camPos, qup(_u, ship.quat), ship.radius * 0.25);
      camQuat = player.gunner;
    } else {
      qforward(_f, ship.quat); qup(_u, ship.quat);
      vaddScaled(camPos, ship.pos, _f, ship.radius * ship.scale * 0.15);
      vaddScaled(camPos, camPos, _u, ship.radius * ship.scale * 0.30);
      camQuat = ship.quat;
    }
    if (game.shake > 0.001) {
      qaxis(_q, [rand(1, -1), rand(1, -1), rand(1, -1)], game.shake * 0.03);
      qnorm(_q);
      qmul(_q2, camQuat, _q);
      camQuat = qcopy(qid(), _q2);
    }
  }

  let prevHull = player.ship.hull;
  let prevShipId = player.ship.id;

  function update(dt) {
    game.time += dt;
    input.sample(dt);
    handleEvents();

    const ship = player.ship;
    if (ui.isOpen) {
      if (game.boarding && game.boarding.stage === 'breach') {
        game.boarding.tick(dt);
        const mark = document.querySelector('.breachMark');
        if (mark) mark.style.left = `${game.boarding.marker * 100}%`;
      }
      audio.setThrust(0);
      updateCamera();
      return;
    }

    if (ship.dead) {
      if (!ui.isOpen) { ui.open('dead'); audio.explode(); }
      return;
    }

    // controls -> ship
    const control = { pitch: 0, yaw: 0, roll: 0, throttle: input.throttle };
    if (player.mode === 'pilot') {
      control.yaw = -input.axes.x;
      control.pitch = -input.axes.y;
      control.roll = input.roll;
      if (input.pointerLocked && !input.touch) {
        control.yaw = -clamp(input.mouse.x * 1.6, -1, 1);
        control.pitch = -clamp(input.mouse.y * 1.6, -1, 1);
      }
      player.gunnerYaw = lerp(player.gunnerYaw, 0, 1 - Math.exp(-6 * dt));
      player.gunnerPitch = lerp(player.gunnerPitch, 0, 1 - Math.exp(-6 * dt));
      qcopy(player.gunner, ship.quat);
    } else {
      control.roll = input.roll * 0.35;
      updateGunnerAim(dt);
    }
    ship.assist = player.assist;
    flyShip(ship, control, dt);

    updateCamera();
    fireControl(dt);
    world.update(dt);

    // damage feedback
    if (ship.id !== prevShipId) { prevShipId = ship.id; prevHull = ship.hull; }
    if (ship.hull < prevHull) {
      game.shake = Math.min(1.4, game.shake + (prevHull - ship.hull) * 0.02);
      audio.hit();
      mobile.buzz(Math.min(60, 12 + (prevHull - ship.hull)));
    }
    prevHull = ship.hull;
    game.shake *= Math.exp(-3.2 * dt);
    audio.setThrust(ship.throttle * (vlen(ship.vel) / ship.stats.maxSpeed));

    // keep the target honest
    if (player.target && (player.target.dead ||
      (player.target.kind === 'asteroid' && !world.asteroids.includes(player.target)))) {
      player.target = null;
    }

    // contextual prompt
    const dock = dockCheck();
    if (dock === 'DOCK') game.promptText = 'DOCKING RANGE — [ACT] TO DOCK';
    else if (dock) game.promptText = dock;
    else {
      const t = player.target;
      if (t && t.kind === 'ship' && t.disabled && !t.looted) {
        const blocker = boardBlocker(player, t);
        game.promptText = blocker ? `BOARD: ${blocker}` : `ADRIFT — [ACT] TO BOARD ${t.name}`;
      } else game.promptText = '';
    }

    const card = tutorial.update(game, dt);
    ui.setObjective(card);
    if (card?.complete) setTimeout(() => ui.setObjective(null), 6000);

    autosave(dt);
    ui.update(game);
  }

  /* --------------------------------------------------------------- saving */

  let saveTimer = 30;
  function autosave(dt) {
    saveTimer -= dt;
    if (saveTimer > 0) return;
    saveTimer = 30;
    player.save();
  }

  // mobile browsers routinely never fire beforeunload, so lean on these two.
  // visibilitychange fires at the document, so it must be bound there.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') player.save();
  });
  addEventListener('pagehide', () => player.save());

  /* ------------------------------------------------------------- render */

  function render() {
    const W = renderer.width, H = renderer.height;
    const fov = (H > W ? 88 : 74) * Math.PI / 180;
    m4perspective(proj, fov, W / H, 0.5, 60000);
    m4view(view, camPos, camQuat);
    m4mul(viewProj, proj, view);

    const cam = {
      pos: camPos, quat: camQuat, viewProj,
      right: qright(_r, camQuat), up: qup(_u, camQuat), fwd: qforward(_f, camQuat),
    };
    // stash copies: qright/qup/qforward reuse scratch vectors
    cam.right = [_r[0], _r[1], _r[2]];
    cam.up = qup(v3(), camQuat);
    cam.fwd = qforward(v3(), camQuat);

    batch.reset();
    // the camera sits inside the hull in both seats, so never draw your own ship —
    // the canopy frame is what you see of it
    drawScene(batch, world, cam, { hideShip: player.ship });
    if (!player.docked) drawHUD(batch, { world, player, cam, W, H, time: game.time, touch: mobile.isTouch });
    renderer.render(batch, viewProj, game.time);
  }

  /* --------------------------------------------------------------- loop */

  const resize = () => mobile.resize();
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 300));
  resize();
  setQuality(renderer.resScale);

  let last = performance.now();
  let lastScale = renderer.resScale;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.visibilityState !== 'hidden') {
      update(dt);
      render();
      mobile.tick(dt);
      if (renderer.resScale !== lastScale) { lastScale = renderer.resScale; setQuality(lastScale); }
    }
    input.clearFrame();
    requestAnimationFrame(frame);
  }

  boot.classList.add('hidden');
  document.getElementById('ui').classList.add('flickering');
  requestAnimationFrame(frame);

  addEventListener('pointerdown', () => { audio.init(); audio.resume(); }, { once: true });
  registerServiceWorker();
  addEventListener('beforeunload', () => player.save());

  game.classes = { Boarding };          // handy from the console
  window.STARQUEST = game;
}

start();
