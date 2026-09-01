// Phone and tablet plumbing: fullscreen, orientation, wake lock, haptics and
// an adaptive resolution scaler so mid-range hardware keeps a steady frame.

export function setupMobile(game, renderer, canvas, input) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;

  const m = {
    isTouch: coarse || mobileUA,
    isIOS, standalone,
    installEvent: null,
    dprCap: 2,
    minScale: 0.55,
    _acc: 0, _frames: 0, _cooldown: 2,
  };

  if (m.isTouch) {
    document.body.classList.add('touch');
    input.touch = true;
    input.sens = 0;                     // no mouse look on touch
    renderer.resScale = 0.82;           // start conservative, adapt upward
  }

  /* ------------------------------------------------------- screen state -- */
  async function goFullscreen() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch { /* iOS Safari on iPhone has no element fullscreen — the PWA covers it */ }
    try { await screen.orientation?.lock?.('landscape'); } catch { /* not everywhere */ }
  }

  let wakeLock = null;
  async function keepAwake() {
    try { wakeLock = await navigator.wakeLock?.request?.('screen'); } catch { /* optional */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });

  const firstGesture = () => {
    if (m.isTouch) goFullscreen();
    keepAwake();
    removeEventListener('pointerdown', firstGesture);
    removeEventListener('keydown', firstGesture);
  };
  addEventListener('pointerdown', firstGesture, { passive: true });
  addEventListener('keydown', firstGesture);

  // stop iOS rubber-banding and double-tap zoom over the play area
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* -------------------------------------------------------- orientation -- */
  const hint = document.getElementById('rotateHint');
  const checkOrientation = () => {
    if (!hint) return;
    const portrait = innerHeight > innerWidth;
    hint.classList.toggle('hidden', !(portrait && m.isTouch));
  };
  addEventListener('resize', checkOrientation);
  addEventListener('orientationchange', () => setTimeout(checkOrientation, 300));
  checkOrientation();
  hint?.addEventListener('click', () => hint.classList.add('hidden'));

  /* ------------------------------------------------------------ install -- */
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    m.installEvent = e;
    document.getElementById('installBtn')?.classList.remove('hidden');
  });
  document.getElementById('installBtn')?.addEventListener('click', async () => {
    if (!m.installEvent) return;
    m.installEvent.prompt();
    await m.installEvent.userChoice;
    m.installEvent = null;
    document.getElementById('installBtn')?.classList.add('hidden');
  });
  if (standalone) document.getElementById('installBtn')?.classList.add('hidden');

  /* ------------------------------------------------- adaptive resolution -- */
  m.tick = (dt) => {
    m._acc += dt;
    m._frames++;
    m._cooldown -= dt;
    if (m._acc < 1) return;
    const fps = m._frames / m._acc;
    m._acc = 0; m._frames = 0;
    game.fps = fps;
    if (m._cooldown > 0) return;
    const s = renderer.resScale;
    if (fps < 40 && s > m.minScale) {
      renderer.resScale = Math.max(m.minScale, s - 0.12);
      m._cooldown = 2.5;
      resizeNow();
    } else if (fps > 57 && s < 1) {
      renderer.resScale = Math.min(1, s + 0.06);
      m._cooldown = 3.5;
      resizeNow();
    }
  };

  function resizeNow() {
    renderer.resize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, m.dprCap));
  }
  m.resize = resizeNow;

  /* ------------------------------------------------------------ haptics -- */
  let lastBuzz = 0;
  m.buzz = (ms) => {
    if (!m.isTouch || !navigator.vibrate) return;
    const now = performance.now();
    if (now - lastBuzz < 60) return;
    lastBuzz = now;
    navigator.vibrate(ms);
  };

  return m;
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW:', e.message));
  });
}
