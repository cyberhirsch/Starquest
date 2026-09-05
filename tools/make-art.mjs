// Key art, rendered by the game itself.
//
//   node server.js &
//   node tools/make-art.mjs [outDir]
//
// Every pixel here comes out of the shipped renderer: the same models, the same
// palette, the same additive vector pass. Nothing is drawn by hand and nothing
// is composited afterwards — a picture that is not the game is a picture that
// stops being true the first time the game changes.
//
// Two things make it a photograph rather than a screenshot. The player's own
// hull is never drawn (the camera lives inside it), so posing `player.ship` and
// leaving it empty turns it into a free camera; and `drawHUD` is skipped while
// docked, so setting that flag clears the canopy without touching the renderer.
//
// Needs Playwright and a Chromium build, like test/browser.mjs. Env: PLAYWRIGHT
// (module path), CHROME (executable), URL, W/H (viewport), SCALE (device pixel
// ratio), ONLY (comma-separated scene ids).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PW = process.env.PLAYWRIGHT || 'playwright';
const { chromium } = await import(PW);

const OUT = process.argv[2] || 'docs/art';
const URL_BASE = process.env.URL || 'http://localhost:8080/index.html';
const W = +(process.env.W || 1920), H = +(process.env.H || 1080);
const SCALE = +(process.env.SCALE || 2);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

mkdirSync(OUT, { recursive: true });

/*
 * A scene is data: where the camera stands, what it looks at, and what to build
 * in front of it. `setup` runs inside the page with the game's own modules in
 * scope, so it composes with createShip and the world's own spawners rather than
 * with anything invented here.
 */
const SCENES = [
  {
    id: 'depot',
    title: 'HALCYON DEPOT',
    sector: 'halcyon',
    setup: `
      const st = world.station;
      // Stand off the ring along the line to the far blue world, so the planet
      // is behind it rather than in a corner.
      const toPlanet = norm(sub(world.sector.sky.planet.pos, st.pos));
      frame(st.pos, st.radius * st.scale, 0.44, mul(toPlanet, -1), { high: -0.14, side: 0.30, roll: -0.04 });
      // A Bastion holding station: close enough to be the first thing you read,
      // and far enough off the ring that the two shapes do not tangle.
      face(ship('bastion', 'player', at(44, -0.46, -0.24)),
        add(mul(cam.right, 0.86), mul(cam.fwd, 0.46), [0, 0.10, 0]));
      face(ship('corsair', 'player', at(120, 0.34, 0.19)), add(mul(cam.fwd, 0.9), mul(cam.right, 0.3), [0, 0, 0]));
      rocks(4, 500, 1100, 34, 56, 0.62);
      rocks(5, 180, 380, 8, 16, 0.55);
    `,
  },
  {
    id: 'yard',
    title: 'TALLOW YARD',
    sector: 'cinder',
    setup: `
      const st = world.station;
      const toPlanet = norm(sub(world.sector.sky.planet.pos, st.pos));
      frame(st.pos, st.radius * st.scale, 0.50, mul(toPlanet, -1), { high: -0.10, side: -0.34, roll: 0.05 });
      // The yard is a dead freighter with a dock cut into it, and it keeps
      // company: a hulk turning over in the near field, another further out.
      const a = ship('hauler', 'civilian', at(52, 0.34, -0.22));
      face(a, add(mul(cam.right, -0.7), mul(cam.fwd, 0.2), [0, 0.68, 0]));
      a.disabled = true; a.hulk = true; a.hull = a.stats.hullMax * 0.18;
      const c = ship('prospector', 'civilian', at(110, -0.33, 0.20));
      face(c, add(mul(cam.right, 0.4), mul(cam.fwd, -0.5), [0, -0.76, 0]));
      c.disabled = true; c.hulk = true;
      rocks(4, 420, 900, 30, 50, 0.60);
    `,
  },
  {
    id: 'dogfight',
    title: 'RUNNING FIGHT',
    sector: 'halcyon',
    settle: 0.42,               // long enough for the rounds to clear the muzzles
    setup: `
      look([1400, 120, -700], norm([-0.93, -0.05, 0.36]), 0.06);
      // A hull breaking hard across the frame with two raiders working on it.
      // Everything is inside a hundred metres: at belt distances a fight is
      // three specks and a lot of rock.
      const prey = ship('corsair', 'player', at(34, -0.20, -0.06));
      face(prey, add(mul(cam.fwd, 0.30), mul(cam.right, -0.94), [0, 0.14, 0]));
      const foe1 = ship('marauder', 'pirate', at(62, 0.28, 0.15));
      const foe2 = ship('corsair', 'pirate', at(105, -0.30, 0.24));
      for (const f of [foe1, foe2]) { faceAt(f, prey.pos); shoot(f, prey); }
      shieldHit(prey);
      burn(at(78, 0.06, -0.24));
      rocks(4, 320, 800, 26, 46, 0.62);
      rocks(4, 140, 260, 7, 13, 0.5);
    `,
  },
  {
    id: 'shoal',
    title: 'THE COLD SHOAL',
    sector: 'halcyon',
    setup: `
      const site = world.siteById('shoal');
      // Inside the claim looking back down the line toward the belt, so the
      // beacon stands near and the ice falls away behind it.
      const inward = norm(mul(site.pos, -1));
      frame(site.pos, site.radius * site.scale, 0.34, mul(inward, -1), { high: -0.14, side: 0.24, roll: -0.03 });
      const miner = ship('prospector', 'civilian', at(30, -0.30, -0.16));
      face(miner, add(mul(cam.fwd, 0.66), mul(cam.right, 0.72), [0, -0.08, 0]));
      cut(miner);
    `,
  },
  {
    id: 'gate',
    title: 'THE SECOND GATE',
    sector: 'halcyon',
    setup: `
      const ring = world.gates[0];
      // Square on to the throat, with a hull already inside it and small enough
      // to say how big the ring is.
      frame(ring.pos, ring.radius * ring.scale, 0.66, norm(ring.pos), { high: -0.08, side: 0.14, roll: 0.03 });
      // inside the throat and well toward the camera, so it reads as a ship
      // going through rather than a speck at the centre
      face(ship('corsair', 'player', add(ring.pos, mul(cam.fwd, -46), mul(cam.up, -6))),
        add(mul(cam.fwd, -0.92), mul(cam.right, 0.24), [0, 0.1, 0]));
      // one hull near the camera, half out of frame, for the sense of a queue
      face(ship('hauler', 'trader', at(40, -0.44, -0.24)), add(mul(cam.fwd, 0.94), mul(cam.right, 0.2), [0, 0.06, 0]));
      rocks(4, 500, 1000, 30, 52, 0.66);
    `,
  },
  {
    id: 'belt',
    title: 'THE BELT',
    sector: 'halcyon',
    setup: `
      // No subject but the place: a working belt with a hauler crossing it, the
      // depot small in the distance and the blue world behind. A title card.
      const st = world.station;
      const toPlanet = norm(sub(world.sector.sky.planet.pos, st.pos));
      frame(st.pos, st.radius * st.scale, 0.16, mul(toPlanet, -1), { high: -0.22, side: 0.30, roll: -0.02 });
      face(ship('hauler', 'trader', at(58, -0.30, -0.18)),
        add(mul(cam.right, 0.92), mul(cam.fwd, 0.34), [0, 0.04, 0]));
      face(ship('prospector', 'civilian', at(190, 0.30, 0.10)), add(mul(cam.right, 0.8), mul(cam.fwd, -0.5), [0, 0, 0]));
      rocks(6, 260, 700, 14, 30, 0.6);
      rocks(4, 800, 1600, 40, 62, 0.66);
    `,
  },
  {
    id: 'title',
    title: 'STARQUEST',
    sector: 'halcyon',
    // The wordmark is the game's own typeface and its own green, laid over a
    // frame the game drew. Nothing else on it.
    caption: { text: 'STARQUEST', sub: 'A FIRST-PERSON RETRO LASER VECTOR SPACE GAME' },
    setup: `
      const st = world.station;
      const toPlanet = norm(sub(world.sector.sky.planet.pos, st.pos));
      frame(st.pos, st.radius * st.scale, 0.20, mul(toPlanet, -1), { high: -0.34, side: 0.30, roll: -0.02 });
      face(ship('bastion', 'player', at(52, -0.34, -0.26)),
        add(mul(cam.right, 0.9), mul(cam.fwd, 0.36), [0, 0.06, 0]));
      face(ship('corsair', 'player', at(150, -0.16, -0.30)), add(mul(cam.right, 0.9), mul(cam.fwd, 0.3), [0, 0, 0]));
      rocks(7, 300, 900, 16, 34, 0.62);
      rocks(4, 1000, 1900, 42, 62, 0.66);
    `,
  },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--no-sandbox'],
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});

// WebGL2, not WebGPU: headless Chromium does not composite a WebGPU canvas into
// page.screenshot(), so every shot would come back a blank white page.
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
await page.goto(`${URL_BASE}?gfx=webgl`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.STARQUEST, null, { timeout: 60000 });
await page.waitForTimeout(2500);

// The composition helpers, installed once. They are deliberately thin: they
// place things and point them, and everything they place is built by the game.
await page.evaluate(async () => {
  const ship = await import('/src/game/ship.js');
  const g = window.STARQUEST;
  window.ART = {
    createShip: ship.createShip,
    fireMount: ship.fireMount,
    MODULES: (await import('/src/game/data.js')).MODULES,
  };
  document.getElementById('ui').style.display = 'none';
  g.player.docked = true;              // drawHUD is skipped while docked
  g.ui.close?.();
});

const shots = [];
for (const scene of SCENES) {
  if (ONLY && !ONLY.includes(scene.id)) continue;
  await page.evaluate(async ({ scene }) => {
    const g = window.STARQUEST;
    const { world, player } = g;
    const { createShip, fireMount, MODULES } = window.ART;

    if (world.sector.id !== scene.sector) world.jumpTo(scene.sector);
    world.clear();
    world.generate(scene.sector);
    world.grace = 1e9;
    // Nothing flies itself in a still: the AI would have everything pointing
    // somewhere else by the time the shutter opened.
    for (const s of world.ships) { s.ai = null; s.vel = [0, 0, 0]; }
    world.projectiles.length = 0; world.particles.length = 0;
    world.beams.length = 0; world.rings.length = 0;

    /* ---- the vocabulary a scene is written in ---- */
    const add = (...vs) => vs.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]);
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const mul = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
    const len = (v) => Math.hypot(v[0], v[1], v[2]);
    const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

    const FOV = 74 * Math.PI / 180;      // what render() uses in landscape
    const cam = { pos: [0, 0, 0], fwd: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] };

    /** Stand the camera somewhere, pointed somewhere, with an optional roll. */
    const look = (pos, dir, roll = 0) => {
      const f = norm(dir);
      let r = norm(cross(f, [0, 1, 0]));
      if (!Number.isFinite(r[0]) || len(r) < 1e-6) r = [1, 0, 0];
      let u = cross(r, f);
      if (roll) {
        const c = Math.cos(roll), s2 = Math.sin(roll);
        const r2 = add(mul(r, c), mul(u, s2));
        u = add(mul(u, c), mul(r, -s2));
        r = r2;
      }
      cam.pos = [...pos]; cam.fwd = f; cam.right = r; cam.up = u;
      player.ship.pos = [...pos];
      player.ship.vel = [0, 0, 0];
      g.qlookAt(player.ship.quat, f, u);
    };

    /**
     * Put the camera where `target` fills `frac` of the frame's height. Ships in
     * this game are 5 to 11 metres across and a station is 83, so composing by
     * eye in metres puts everything either in your lap or three pixels wide;
     * composing by the angle it subtends is the only way the framing survives
     * being pointed at a different object.
     *
     * `from` is the direction the camera stands in, and high/side nudge it off
     * that axis in frame-relative units — 0.5 is the edge of frame.
     */
    const frame = (target, radius, frac, from, opts = {}) => {
      const dist = radius / Math.tan(Math.max(0.02, frac) * FOV * 0.5);
      const dir = norm(mul(from, -1));                  // camera looks this way
      look(add(target, mul(from, dist)), dir, opts.roll || 0);
      // now slide the camera sideways/up and re-aim, so the subject lands off
      // centre rather than dead middle
      const off = add(mul(cam.right, -(opts.side || 0) * dist * Math.tan(FOV * 0.5) * 1.78),
        mul(cam.up, -(opts.high || 0) * dist * Math.tan(FOV * 0.5)));
      look(add(cam.pos, off), norm(sub(target, add(cam.pos, off))), opts.roll || 0);
    };

    /** A point in front of the camera: `d` metres out, `x`/`y` in frame units. */
    const at = (d, x = 0, y = 0) => {
      const h = d * Math.tan(FOV * 0.5);
      return add(cam.pos, mul(cam.fwd, d), mul(cam.right, x * h * 1.78), mul(cam.up, y * h));
    };

    const ship = (cls, faction, pos) => {
      const s = createShip(cls, faction, { pos: [...pos] });
      s.ai = null; s.vel = [0, 0, 0];
      world.ships.push(s);
      return s;
    };
    const face = (s, dir) => { g.qlookAt(s.quat, norm(dir)); return s; };
    const faceAt = (s, p) => face(s, sub(p, s.pos));

    /**
     * Rock in a shell in front of the camera. Kept out of the middle on purpose:
     * a rock is 12 to 60 metres and a hull is 5 to 11, so anything in the centre
     * of frame outweighs the subject and the shot becomes a picture of gravel.
     */
    const rocks = (n, near, far, small, big, spread = 0.6) => {
      for (let i = 0; i < n; i++) {
        const d = near + Math.random() * (far - near);
        const edge = (v) => (v < 0 ? -1 : 1) * (0.34 + Math.abs(v) * (spread - 0.34));
        const x = edge(Math.random() * 2 - 1) * 1.0, y = edge(Math.random() * 2 - 1) * 0.86;
        world.spawnAsteroid({ pos: at(d, x, y), size: small + Math.random() * (big - small) });
      }
    };

    const shoot = (from, target) => {
      for (const hp of from.hardpoints) {
        const m = MODULES[hp.moduleId];
        if (!m || m.beam) continue;
        hp.cd = 0;
        from.energy = from.stats.energyMax;
        fireMount(from, hp, norm(sub(target.pos, from.pos)), world, target);
      }
    };

    /** A mining beam onto the nearest rock, which is what a prospector is for. */
    const cut = (from) => {
      const hp = from.hardpoints.find((h) => MODULES[h.moduleId]?.beam);
      if (!hp) return;
      let best = null;
      for (const a of world.asteroids) {
        const d = len(sub(a.pos, from.pos));
        if (d > 40 && (!best || d < best.d)) best = { a, d };
      }
      if (!best) return;
      from.energy = from.stats.energyMax;
      hp.cd = 0;
      fireMount(from, hp, norm(sub(best.a.pos, from.pos)), world, best.a);
    };

    const shieldHit = (s) => world.shieldFlash(s, add(s.pos, mul(cam.right, 6), [0, 3, 0]));
    const burn = (p) => { world.explode(p, [0, 0, 0], 18, 1.2); world.sparks(p, 16, 5); };

    const names = ['world', 'player', 'g', 'cam', 'look', 'frame', 'at', 'ship', 'face', 'faceAt',
      'rocks', 'shoot', 'cut', 'shieldHit', 'burn', 'add', 'sub', 'mul', 'norm', 'len', 'cross'];
    const args = [world, player, g, cam, look, frame, at, ship, face, faceAt,
      rocks, shoot, cut, shieldHit, burn, add, sub, mul, norm, len, cross];
    // eslint-disable-next-line no-new-func
    new Function(...names, scene.setup)(...args);
  }, { scene });

  await page.evaluate((caption) => {
    document.getElementById('artCaption')?.remove();
    if (!caption) return;
    const el = document.createElement('div');
    el.id = 'artCaption';
    // the game's own font stack and green, read off the running page
    const css = getComputedStyle(document.body);
    el.style.cssText = `position:fixed;left:0;right:0;bottom:11%;text-align:center;z-index:99;
      font-family:${css.fontFamily};color:${css.getPropertyValue('color')};pointer-events:none`;
    el.innerHTML = `<div style="font-size:78px;letter-spacing:0.42em;text-indent:0.42em;
        text-shadow:0 0 32px rgba(108,255,159,0.55)">${caption.text}</div>
      <div style="font-size:15px;letter-spacing:0.34em;text-indent:0.34em;margin-top:22px;
        color:#2e7d55">${caption.sub}</div>`;
    document.body.appendChild(el);
  }, scene.caption || null);

  await page.waitForTimeout(Math.round((scene.settle ?? 0.15) * 1000));
  const file = join(OUT, `art-${scene.id}.png`);
  await page.screenshot({ path: file });
  shots.push(`${scene.id.padEnd(9)} ${scene.title.padEnd(18)} ${file}`);
  console.log(`  ${shots[shots.length - 1]}`);
}

await browser.close();
console.log(`\n${shots.length} frames at ${W * SCALE}x${H * SCALE}`);
