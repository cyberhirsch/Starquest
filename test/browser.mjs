// Optional end-to-end check: drives the touch controls in a real browser.
// Needs Playwright and a Chromium build; both paths can be overridden.
//
//   node server.js &                       # serve on :8080
//   PLAYWRIGHT=$(npm root -g)/playwright/index.mjs node test/browser.mjs
//
// Env: PLAYWRIGHT (module path), CHROME (executable), URL (default localhost:8080),
//      GFX (webgl | webgpu — forces a backend).

const PW = process.env.PLAYWRIGHT || 'playwright';
const { chromium } = await import(PW);

const URL_BASE = process.env.URL || 'http://localhost:8080/index.html';
const gfx = process.env.GFX ? `?gfx=${process.env.GFX}` : '';
const args = [
  '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader', '--use-gl=angle', '--enable-features=Vulkan', '--no-sandbox',
];

const browser = await chromium.launch({
  headless: true, args,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});
const ctx = await browser.newContext({
  viewport: { width: 892, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Mobile Safari/537.36',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const results = [];
const check = (name, cond, extra = '') =>
  results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
const read = (fn) => page.evaluate(fn);
/** Software rendering can drop to a few frames a second — wait for state, not time. */
const until = async (fn, tries = 15) => {
  for (let i = 0; i < tries; i++) {
    if (await read(fn)) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

await page.goto(URL_BASE + gfx, { waitUntil: 'load' });
await until(() => !!window.STARQUEST);
const backend = await read(() => window.STARQUEST.renderer.backend);
console.log(`backend: ${backend}`);
// Headless Chromium does not composite a WebGPU canvas into page.screenshot():
// every shot below comes out a uniform white page with the HUD missing, which
// looks like a captured frame until you measure it. WebGL2 captures properly,
// so that is the backend to take pictures on.
if (backend !== 'webgl2') console.log('note: screenshots will be blank — rerun with GFX=webgl to capture frames');

check('touch controls appear on a touch device', await page.locator('#throttleBar').isVisible());
check('fire button appears', await page.locator('#fireBtn').isVisible());

const bar = await page.locator('#throttleBar').boundingBox();
const dragBar = async (frac) => {
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height * frac, { steps: 6 });
  await page.mouse.up();
};
await dragBar(0.08);
check('throttle bar sets a cruise speed',
  await until(() => window.STARQUEST.player.ship.throttle > 0.5 && Math.hypot(...window.STARQUEST.player.ship.vel) > 5),
  await read(() => `${window.STARQUEST.player.ship.throttle.toFixed(2)} demanded`));
check('and the HUD names the speed you asked for',
  await until(() => /SET \d+/.test(document.getElementById('speedSet').textContent), 25),
  await page.locator('#speedSet').textContent());

// Half-open should settle at half the rating, not keep winding up to it.
await dragBar(0.5 - 0.5 * 0.5 * 0.82);
const cruise = await read(async () => {
  const g = window.STARQUEST;
  // The player's hull is flown by the frame loop, not by World.update — pumping
  // the world alone leaves it drifting.
  const th = g.player.ship.throttle;
  for (let i = 0; i < 60 * 14; i++) g.flyShip(g.player.ship, { throttle: th }, 1 / 60);
  return { v: Math.hypot(...g.player.ship.vel), max: g.player.ship.stats.maxSpeed, th };
});
await page.screenshot({ path: 'docs/shot-throttle.png' });
check('half the bar settles at half the rating',
  Math.abs(cruise.v - cruise.max * cruise.th) < cruise.max * 0.12,
  `${cruise.v.toFixed(0)} m/s at ${cruise.th.toFixed(2)} of ${cruise.max.toFixed(0)}`);

await dragBar(0.95);
check('below centre is reverse', await until(() => window.STARQUEST.player.ship.throttle < -0.5));

await page.mouse.move(700, 200);
await page.mouse.down();
await page.mouse.move(760, 250, { steps: 5 });
const turned = await until(() => {
  const r = window.STARQUEST.player.ship.rate;
  return Math.abs(r[0]) + Math.abs(r[1]) > 0.02;
});
await page.mouse.up();
check('right-side stick steers the ship', turned);

const fb = await page.locator('#fireBtn').boundingBox();
const before = await read(() => window.STARQUEST.world.projectiles.length);
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
await page.mouse.down();
const shot = await until(() => window.STARQUEST.world.projectiles.length > 0, 10);
await page.mouse.up();
check('FIRE button shoots', shot, `${before} rounds before`);

await page.locator('[data-action="mode"]').click();
check('MODE swaps to the gunner seat', await until(() => window.STARQUEST.player.mode === 'gunner'));

await page.locator('[data-action="inventory"]').click();
await until(() => !!document.querySelector('#overlay .screen'));
check('INV opens the loadout', await page.locator('#overlay .screen').isVisible());
await page.locator('[data-do="close"]').click();
check('overlay closes', await until(() => document.getElementById('overlay').classList.contains('hidden')));

// --- tutorial and persistence ------------------------------------------------
check('hull readout shows real numbers',
  /\d+\/\d+/.test(await page.locator('#hullVal').textContent()),
  await page.locator('#hullVal').textContent());
check('starter ship carries a cannon and a cutter',
  (await page.locator('#weapons').textContent()).includes('MINING LASER'));
// earlier checks left the pilot in the gunner seat (where the autopilot owns
// the throttle) and the bar in reverse — take the stick back, then open it up
// so the first objective ("build speed") can actually complete
await page.locator('[data-action="mode"]').click();
await until(() => window.STARQUEST.player.mode === 'pilot');
await dragBar(0.05);
check('tutorial advanced past the throttle step',
  await until(() => window.STARQUEST.player.tutorial.step >= 1, 40),
  `step ${await read(() => window.STARQUEST.player.tutorial.step)}`);

await read(() => { window.STARQUEST.player.credits = 4242; });
await read(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
});
check('backgrounding the tab writes the save',
  (await read(() => JSON.parse(localStorage.getItem('starquest.save.v1') || '{}').credits)) === 4242);

await page.reload({ waitUntil: 'load' });
await until(() => !!window.STARQUEST);
check('progress survives a reload',
  (await read(() => window.STARQUEST.player.credits)) === 4242);

await page.locator('[data-action="skiptut"]').click();
check('SKIP TUTORIAL dismisses it', await until(() => window.STARQUEST.player.tutorial.done));

// --- comms ------------------------------------------------------------------
// Park a pirate right off the bow so the channel is definitely in range.
await read(() => {
  const g = window.STARQUEST;
  const p = g.player.ship;
  const foe = g.world.spawnPirate();
  foe.name = 'BLACK KESTREL';
  foe.pos[0] = p.pos[0] + 400; foe.pos[1] = p.pos[1]; foe.pos[2] = p.pos[2] + 400;
  g.player.target = foe;
});
await page.locator('[data-action="hail"]').click();
check('HAIL opens a channel', await until(() => !document.getElementById('comms').classList.contains('hidden')));
check('the other ship says something',
  (await page.locator('#commsLine').textContent()).trim().length > 0,
  (await page.locator('#commsLine').textContent()).slice(0, 44));
const opts = await page.locator('#commsOpts .hbtn').allTextContents();
check('the channel offers a way out', opts.length >= 3, opts.map((o) => o.split('\n')[0]).join(', '));
await page.screenshot({ path: 'docs/shot-comms.png' });
await page.locator('#commsOpts [data-do-comms="close"]').click();
check('the channel closes', await until(() => document.getElementById('comms').classList.contains('hidden')));

// --- open space --------------------------------------------------------------
await read(() => {
  const g = window.STARQUEST;
  const s = g.player.ship;
  s.pos = [26000, 900, 14000];          // far outside the belt
  s.vel = [0, 0, 0];
  g.qlookAt(s.quat, [-0.88, -0.03, -0.47]);   // looking back toward the belt
});
await page.waitForTimeout(1400);
const far = await read(() => Math.hypot(...window.STARQUEST.player.ship.pos));
check('you can be far outside the belt', far > 25000, `${(far / 1000).toFixed(0)} km out`);
await page.screenshot({ path: 'docs/shot-deep.png' });
await read(() => { window.STARQUEST.player.ship.pos = [0, 0, -900]; });

// --- a sector should look like a place ---------------------------------------
await read(() => {
  const g = window.STARQUEST;
  g.player.ship.pos[0] = 0; g.player.ship.pos[1] = 0; g.player.ship.pos[2] = -900;
  g.player.ship.vel = [0, 0, 0];
  g.world.station.pos[0] = 0; g.world.station.pos[1] = -40; g.world.station.pos[2] = -1400;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/shot-halcyon.png' });
await read(() => {
  const g = window.STARQUEST;
  g.world.jumpTo('cinder');
  g.player.ship.pos[0] = g.world.station.pos[0];
  g.player.ship.pos[1] = g.world.station.pos[1] + 40;
  g.player.ship.pos[2] = g.world.station.pos[2] + 500;
  g.player.ship.vel = [0, 0, 0];
});
await page.waitForTimeout(1500);
check('the reach is a different sky', await read(() => window.STARQUEST.world.sector.id === 'cinder'));
await page.screenshot({ path: 'docs/shot-cinder.png' });
// face the yard, so its own shape is on screen rather than off to one side
await read(() => {
  const g = window.STARQUEST;
  const st = g.world.station, s = g.player.ship;
  s.pos = [st.pos[0] + 30, st.pos[1] + 60, st.pos[2] + 260];
  s.vel = [0, 0, 0];
  const d = [st.pos[0] - s.pos[0], st.pos[1] - s.pos[1], st.pos[2] - s.pos[2]];
  const l = Math.hypot(...d);
  g.qlookAt(s.quat, [d[0] / l, d[1] / l, d[2] / l]);
});
await page.waitForTimeout(900);
await page.screenshot({ path: 'docs/shot-yard.png' });
await read(() => window.STARQUEST.world.jumpTo('halcyon'));

// --- combat legibility -------------------------------------------------------
await read(() => {
  const g = window.STARQUEST;
  // Spawn the attacker here rather than reusing the one from the comms check:
  // the sector-look block above jumps to Cinder and back, and jumpTo clears
  // every ship that is not yours, so that one no longer exists.
  const foe = g.world.spawnPirate();
  foe.name = 'BLACK KESTREL';
  const p = g.player.ship;
  foe.pos[0] = p.pos[0] + 400; foe.pos[1] = p.pos[1]; foe.pos[2] = p.pos[2] + 400;
  g.player.target = foe;
  g.damageShip(p, 60, g.world, { from: foe, manual: true });
});
check('the threat tag names who is shooting you',
  await until(() => !document.getElementById('threat').classList.contains('hidden')),
  await page.locator('#threatName').textContent());
await page.screenshot({ path: 'docs/shot-threat.png' });

await read(() => {
  const g = window.STARQUEST;
  const foe = g.world.ships.find((s) => s.name === 'BLACK KESTREL');
  g.player.ship.shield = 0;
  g.damageShip(g.player.ship, 99999, g.world, { from: foe, manual: true });
});
check('dying opens the post-mortem',
  await until(() => /HULL LOST/.test(document.getElementById('overlay').textContent), 30));
const dead = await page.locator('#overlay').textContent();
check('which names the ship that killed you', /BLACK KESTREL KILLED YOU/.test(dead));
check('and itemises the damage by share', /WHAT TOOK YOU APART/.test(dead) && /\d+%/.test(dead));
await page.screenshot({ path: 'docs/shot-death.png' });
await page.locator('[data-do="respawn"]').click();
check('respawn puts you back at the depot',
  await until(() => !window.STARQUEST.player.ship.dead));

// --- GPU context loss, which Android does on every backgrounding -----------
if (backend === 'webgl2') {
  await read(() => {
    window.__ext = window.STARQUEST.renderer.gl.getExtension('WEBGL_lose_context');
    window.__ext.loseContext();
  });
  check('a lost context is noticed', await until(() => window.STARQUEST.renderer.lost));
  await read(() => window.__ext.restoreContext());
  check('the context is rebuilt', await until(() => !window.STARQUEST.renderer.lost, 30));
  await page.waitForTimeout(1200);
  check('the world draws again after a restore',
    await until(() => {
      const b = window.STARQUEST.batch;
      let world = 0;
      for (let i = 0; i < b.count; i++) if (b.data[i * 16 + 3] < 0.5) world++;
      return world > 100;
    }),
    `${await read(() => window.STARQUEST.batch.count)} segments`);
}

check('manifest is served', (await read(async () => (await fetch('manifest.webmanifest')).status)) === 200);
check('service worker API is present', await read(() => 'serviceWorker' in navigator));

console.log(results.join('\n'));
if (errors.length) console.log(`\nconsole errors:\n${errors.slice(0, 8).join('\n')}`);
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
