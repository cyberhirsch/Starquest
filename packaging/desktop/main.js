// Electron shell for the desktop builds.
//
// The game is served over a custom `app://` scheme rather than loaded from
// disk with loadFile, for two reasons that both break the game outright:
//
//   1. index.html loads src/main.js as an ES module, and Chromium refuses
//      module scripts over file:// (they are opaque origins, so the CORS check
//      can never pass). The window would come up blank with a console error.
//   2. WebGPU is only exposed in a secure context, which file:// is not — so
//      even with modules working, the primary renderer would be unavailable and
//      every desktop install would silently fall back to WebGL2.
//
// Registering the scheme as standard + secure fixes both, and gives
// localStorage a stable origin so saves survive an app update.
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, 'app');
const SCHEME = 'app';

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

/** Resolve a request path inside the bundle, refusing anything that escapes it. */
function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = path.normalize(path.join(ROOT, clean === '/' ? 'index.html' : clean));
  return target.startsWith(ROOT) ? target : null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#000604',
    title: 'STARQUEST',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The game keeps its own frame pacing; letting Chromium throttle a
      // backgrounded window is fine and saves a laptop battery.
      backgroundThrottling: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`${SCHEME}://starquest/index.html`);

  // Nothing in the game opens an external link today, but if one is ever added
  // it belongs in the user's browser, not in a second game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, async (request) => {
    const file = resolve(new URL(request.url).pathname);
    if (!file) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    // Everything the game needs is in the bundle, so it can be locked to it.
    // 'unsafe-inline' covers style-src only: the HUD writes element.style
    // properties every frame, which counts as an inline style.
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
      + "img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; "
      + "manifest-src 'self'; base-uri 'none'; form-action 'none'");
    return new Response(res.body, { status: res.status, headers });
  });

  // A game does not need an Edit menu. Keep a minimal one so the standard
  // quit/fullscreen accelerators still work, and so macOS gets its app menu.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Game',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
  ]));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
