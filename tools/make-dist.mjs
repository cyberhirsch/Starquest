// Collects the game's runtime files into dist/, which is what the desktop and
// mobile shells wrap. The web build has no build step and does not use this —
// it serves the repository as it stands. Run: node tools/make-dist.mjs [outDir]
//
// Deliberately zero-dependency, like the rest of tools/: the packaging shells
// pull in Electron and Capacitor, but the game itself must stay installable
// with nothing but a copy of the repository.
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the latter yields "/D:/a/repo",
// and joining that produces "D:\D:\a\repo" — which is what broke the first
// Windows build. The output directory is resolved against the caller's cwd,
// which is the ordinary convention for a path argument.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = resolve(process.cwd(), process.argv[2] || join(ROOT, 'dist'));

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const files = [
  'index.html', 'manifest.webmanifest',
  ...walk(join(ROOT, 'src')).map((p) => relative(ROOT, p)),
  ...walk(join(ROOT, 'icons')).map((p) => relative(ROOT, p)),
].filter((f) => /\.(html|js|css|png|webmanifest)$/.test(f)).sort();

rmSync(OUT, { recursive: true, force: true });
for (const f of files) {
  const dest = join(OUT, f);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(join(ROOT, f)));
}

// The service worker is a web-only concern: a packaged app already has every
// file on disk, and registerServiceWorker() bails out off https anyway. Ship it
// and the first launch would race a cache nobody needs.
let bytes = 0;
for (const f of files) bytes += statSync(join(OUT, f)).size;
if (!existsSync(join(OUT, 'index.html'))) {
  console.error(`no index.html landed in ${OUT} — that payload will not run`);
  process.exit(1);
}
console.log(`dist -> ${files.length} files, ${(bytes / 1024).toFixed(0)} kB, at ${OUT}`);
