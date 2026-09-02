// Smoke test for the Electron shell. Needs the desktop packaging installed:
//
//   cd packaging/desktop && npm install
//   node tools/make-dist.mjs packaging/desktop/app
//   xvfb-run -a node test/desktop.mjs        # Linux; drop xvfb-run elsewhere
//
// What this is actually for: the desktop shell serves the game over a custom
// app:// scheme instead of loading it from disk, and both reasons for that are
// silent failures if the scheme is ever misconfigured.
//
//   - index.html loads src/main.js as an ES module, and Chromium refuses module
//     scripts over file://. The window would come up blank.
//   - WebGPU is only exposed in a secure context. Over file:// the primary
//     renderer would quietly disappear and every install would run on WebGL2.
//
// Neither shows up as a crash, so both are asserted here.
//
// It deliberately does NOT assert that anything is drawn: Electron's
// distribution bundles no software rasteriser (unlike Chromium's), so on a
// machine with no GPU — CI included — the renderer cannot start at all. The
// browser suite covers drawing.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DESKTOP = join(ROOT, 'packaging/desktop');
const ELECTRON = join(DESKTOP, 'node_modules/.bin/electron');

if (!existsSync(ELECTRON)) {
  console.log('SKIP  electron is not installed — run `npm install` in packaging/desktop');
  process.exit(0);
}
if (!existsSync(join(DESKTOP, 'app/index.html'))) {
  console.log('SKIP  no payload — run `node tools/make-dist.mjs packaging/desktop/app`');
  process.exit(0);
}

// Run the real main.js with a probe appended, so the shell under test is the
// one that ships rather than a copy that has drifted from it. It has to live
// beside main.js: the shell resolves its payload relative to __dirname, so a
// copy anywhere else looks for the game in the wrong place and serves 404s.
const probe = join(DESKTOP, `main.probe.${process.pid}.js`);
writeFileSync(probe, `${readFileSync(join(DESKTOP, 'main.js'), 'utf8')}
const errors = [];
setTimeout(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.log('PROBE ' + JSON.stringify({ window: false })); return app.exit(0); }
  win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) errors.push(msg); });
  await win.webContents.reload();
  await new Promise((r) => setTimeout(r, 9000));
  let out = { window: true, errors };
  try {
    out = { ...out, ...await win.webContents.executeJavaScript(\`(() => ({
      url: location.href,
      secure: window.isSecureContext,
      hasGPU: 'gpu' in navigator,
      // Set at the top of src/main.js's module body, so it is only ever true if
      // the whole import graph resolved and ran.
      modulesRan: typeof window.STARQUEST !== 'undefined' || !!document.querySelector('#ui'),
      hasCanvas: !!document.getElementById('gl'),
      storage: (() => { try { localStorage.setItem('t', '1'); return localStorage.getItem('t') === '1'; } catch { return false; } })(),
    }))()\`) };
  } catch (e) { out.evalError = e.message; }
  console.log('PROBE ' + JSON.stringify(out));
  app.exit(0);
}, 2500);
`);

const args = [probe, '--no-sandbox'];
const child = spawn(ELECTRON, args, { cwd: DESKTOP, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
let stdout = '';
child.stdout.on('data', (d) => { stdout += d; });
child.stderr.on('data', (d) => { stdout += d; });

const code = await new Promise((resolve) => {
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 60000);
  child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
});

rmSync(probe, { force: true });
const line = stdout.split('\n').find((l) => l.startsWith('PROBE '));
const r = line ? JSON.parse(line.slice(6)) : null;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};

console.log('DESKTOP SHELL');
ok('the app starts and opens a window', !!r && r.window, code === 'timeout' ? 'timed out' : `exit ${code}`);
if (r && r.window) {
  ok('served over the app:// scheme', /^app:\/\//.test(r.url || ''), r.url);
  ok('which is a secure context', r.secure === true);
  ok('so WebGPU is exposed at all', r.hasGPU === true);
  ok('the page and canvas are there', r.hasCanvas === true);
  ok('ES modules load and run', r.modulesRan === true,
    r.modulesRan ? '' : (r.errors || []).find((e) => /module|CORS|import/i.test(e)) || 'no module error reported');
  ok('saves have somewhere to go', r.storage === true);
  // On a GPU-less runner the game's own "no adapter" message is the correct
  // outcome. What must never appear is a module or protocol failure.
  const bad = (r.errors || []).filter((e) => /CORS|Failed to load module|net::ERR|Not allowed to load/i.test(e));
  ok('no protocol or module errors', bad.length === 0, bad[0] || 'clean');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
