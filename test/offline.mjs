// Does the installed game actually run with no network?
//
//   node server.js &
//   node test/offline.mjs
//
// The service worker pre-caches the whole shell on install, which is easy to
// verify and proves nothing: the cache was complete and the game still would
// not start offline, because caches.match() keys on the entire URL and a launch
// at index.html?gfx=webgl missed a cache holding index.html. Checking the cache
// count is checking the wrong end. This loads the game, pulls the network out,
// and asks whether it comes back — from the deep link, from the scope root a
// home-screen icon opens, and after a cold start with no worker in memory.
//
// Needs Playwright and a Chromium build, like the browser suite. Env: PLAYWRIGHT
// (module path), CHROME (executable), URL (default localhost:8080).
const PW = process.env.PLAYWRIGHT || 'playwright';
const { chromium } = await import(PW);

const BASE = process.env.URL || 'http://localhost:8080';
const SHELL = 38;                       // entries tools/make-sw.mjs writes

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`ok   ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--no-sandbox'],
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 500 } });
const page = await ctx.newPage();

/** Boot the game, or say why it did not. */
const boots = async () => page.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    if (window.STARQUEST) return { ok: true, backend: window.STARQUEST.renderer.backend };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ok: false, why: document.body.innerText.slice(0, 120) || 'blank page' };
});

const visit = async (url) => {
  try { await page.goto(url, { waitUntil: 'load', timeout: 25000 }); return await boots(); }
  catch (e) { return { ok: false, why: e.message.split('\n')[0] }; }
};

// --- install, the way a first visit does ------------------------------------
await page.goto(`${BASE}/index.html?gfx=webgl`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.STARQUEST, null, { timeout: 40000 });

const cached = await page.evaluate(async (want) => {
  await navigator.serviceWorker.ready;
  for (let i = 0; i < 80; i++) {
    for (const k of await caches.keys()) {
      const n = (await (await caches.open(k)).keys()).length;
      if (n >= want) return n;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const keys = await caches.keys();
  return keys.length ? (await (await caches.open(keys[0])).keys()).length : 0;
}, SHELL);
check('installing downloads the whole game', cached >= SHELL, `${cached} files cached`);

// --- and now there is no network --------------------------------------------
await ctx.setOffline(true);

// Every URL below carries ?gfx=webgl. Headless Chromium has no working WebGPU,
// so a launch that lets the game pick a backend fails to boot here whether it
// is online or not — measured, and it would read as an offline failure that is
// nothing of the sort. The query is also the thing under test: the cache has to
// ignore it.
const deep = await visit(`${BASE}/index.html?gfx=webgl`);
check('it starts offline from the link you installed from', deep.ok, deep.why || deep.backend);

const root = await visit(`${BASE}/?gfx=webgl`);
check('and from the scope root, which is what the icon opens', root.ok, root.why || root.backend);

const query = await visit(`${BASE}/index.html?utm=whatever&gfx=webgl#deep`);
check('and with a query string it has never seen', query.ok, query.why || query.backend);

// A cold start: no page in memory, no worker running, only what is on disk.
await page.close();
const cold = await ctx.newPage();
let coldOk = false, coldWhy = '';
try {
  await cold.goto(`${BASE}/index.html?gfx=webgl`, { waitUntil: 'load', timeout: 25000 });
  coldOk = await cold.evaluate(async () => {
    for (let i = 0; i < 80; i++) {
      if (window.STARQUEST) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  });
} catch (e) { coldWhy = e.message.split('\n')[0]; }
check('and from a cold start with the worker not running', coldOk, coldWhy);

const playable = coldOk && await cold.evaluate(() => {
  const g = window.STARQUEST;
  return !!(g.world.ships.length && g.world.asteroids.length && g.world.station);
});
check('with a world in it, not just a page', !!playable);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
