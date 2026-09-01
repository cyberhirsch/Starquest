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
check('throttle bar drives forward thrust',
  await until(() => window.STARQUEST.player.ship.throttle > 0.5 && Math.hypot(...window.STARQUEST.player.ship.vel) > 5),
  await read(() => `${window.STARQUEST.player.ship.throttle.toFixed(2)} throttle`));

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

check('manifest is served', (await read(async () => (await fetch('manifest.webmanifest')).status)) === 200);
check('service worker API is present', await read(() => 'serviceWorker' in navigator));

console.log(results.join('\n'));
if (errors.length) console.log(`\nconsole errors:\n${errors.slice(0, 8).join('\n')}`);
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
