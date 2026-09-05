// Keyboard + mouse + touch. Produces one control snapshot per frame.

import { clamp } from '../core/math.js';

const KEYMAP = {
  KeyW: 'thrUp', KeyS: 'thrDown', ArrowUp: 'pitchUp', ArrowDown: 'pitchDown',
  ArrowLeft: 'yawLeft', ArrowRight: 'yawRight', KeyA: 'yawLeft', KeyD: 'yawRight',
  KeyQ: 'rollLeft', KeyE: 'rollRight', Space: 'fire', KeyX: 'thrZero',
};

const ONESHOT = {
  Tab: 'inventory', KeyR: 'mode', KeyF: 'action', KeyT: 'target', KeyG: 'assist',
  KeyM: 'map', KeyH: 'hail', Escape: 'escape', Enter: 'action', Digit1: 'mount1', Digit2: 'mount2',
  Digit3: 'mount3', Digit4: 'mount4', Digit5: 'mount5', Digit6: 'mount6',
  // Everything on screen while you are flying answers to a key. These two were
  // the last buttons that only a mouse could reach.
  KeyK: 'skiptut', KeyI: 'install',
};

export function createInput(canvas, root) {
  const input = {
    throttle: 0,
    stick: { x: 0, y: 0 },        // -1..1, pilot steering / gunner slew
    look: { dx: 0, dy: 0 },       // raw mouse deltas this frame
    roll: 0,
    fire: false,
    events: [],
    touch: false,
    pointerLocked: false,
    keys: new Set(),
    sens: 0.0022,
    enabled: true,
  };

  const emit = (name) => input.events.push(name);
  input.drain = () => { const e = input.events; input.events = []; return e; };

  /* ---------------------------------------------------------- keyboard -- */
  addEventListener('keydown', (e) => {
    if (e.repeat) { if (e.code === 'Tab') e.preventDefault(); return; }
    if (ONESHOT[e.code]) { emit(ONESHOT[e.code]); e.preventDefault(); }
    const a = KEYMAP[e.code];
    if (a) { input.keys.add(a); e.preventDefault(); }
  });
  addEventListener('keyup', (e) => {
    const a = KEYMAP[e.code];
    if (a) input.keys.delete(a);
  });
  addEventListener('blur', () => { input.keys.clear(); input.fire = false; });

  /* ------------------------------------------------------------- mouse -- */
  const mouse = { x: 0, y: 0, down: false };
  input.mouse = mouse;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.button === 0) mouse.down = true;
    if (!input.pointerLocked && input.enabled) canvas.requestPointerLock?.();
  });
  addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch' && e.button === 0) mouse.down = false; });
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (input.pointerLocked) {
      input.look.dx += e.movementX;
      input.look.dy += e.movementY;
      mouse.x = clamp(mouse.x + e.movementX * 0.0045, -1, 1);
      mouse.y = clamp(mouse.y + e.movementY * 0.0045, -1, 1);
    } else {
      const r = canvas.getBoundingClientRect();
      mouse.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      mouse.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    }
  });
  document.addEventListener('pointerlockchange', () => {
    input.pointerLocked = document.pointerLockElement === canvas;
    if (!input.pointerLocked) { mouse.x = 0; mouse.y = 0; }
  });
  addEventListener('wheel', (e) => {
    if (!input.enabled) return;
    input.throttle = clamp(input.throttle - Math.sign(e.deltaY) * 0.1, -1, 1);
  }, { passive: true });

  /* ------------------------------------------------------------- touch -- */
  const bar = root.querySelector('#throttleBar');
  const barFill = root.querySelector('#throttleFill');
  const barKnob = root.querySelector('#throttleKnob');
  const stickZone = root.querySelector('#stickZone');
  const stickBase = root.querySelector('#stickBase');
  const stickKnob = root.querySelector('#stickKnob');
  const fireBtn = root.querySelector('#fireBtn');

  const markTouch = () => {
    if (input.touch) return;
    input.touch = true;
    document.body.classList.add('touch');
  };
  addEventListener('touchstart', markTouch, { passive: true, once: true });

  // throttle bar: absolute position, +1 at the top
  let barId = null;
  const setThrottleFromY = (clientY) => {
    const r = bar.getBoundingClientRect();
    let v = 1 - ((clientY - r.top) / r.height) * 2;
    if (Math.abs(v) < 0.09) v = 0;
    input.throttle = clamp(v, -1, 1);
  };
  bar.addEventListener('pointerdown', (e) => {
    markTouch(); barId = e.pointerId; bar.setPointerCapture(e.pointerId);
    setThrottleFromY(e.clientY); e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => {
    if (barId !== e.pointerId) return;
    setThrottleFromY(e.clientY); e.preventDefault();
  });
  const endBar = (e) => { if (barId === e.pointerId) barId = null; };
  bar.addEventListener('pointerup', endBar);
  bar.addEventListener('pointercancel', endBar);
  bar.addEventListener('dblclick', () => { input.throttle = 0; });

  // right-hand floating stick
  let stickId = null, sx0 = 0, sy0 = 0;
  const stickR = () => Math.min(90, Math.max(56, Math.min(innerWidth, innerHeight) * 0.14));
  stickZone.addEventListener('pointerdown', (e) => {
    markTouch();
    if (stickId !== null) return;
    stickId = e.pointerId;
    stickZone.setPointerCapture(e.pointerId);
    sx0 = e.clientX; sy0 = e.clientY;
    stickBase.style.display = 'block';
    stickBase.style.left = `${sx0}px`;
    stickBase.style.top = `${sy0}px`;
    stickKnob.style.transform = 'translate(-50%,-50%)';
    e.preventDefault();
  });
  stickZone.addEventListener('pointermove', (e) => {
    if (stickId !== e.pointerId) return;
    const R = stickR();
    let dx = e.clientX - sx0, dy = e.clientY - sy0;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    input.stick.x = dx / R;
    input.stick.y = dy / R;
    stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    e.preventDefault();
  });
  const endStick = (e) => {
    if (stickId !== e.pointerId) return;
    stickId = null;
    input.stick.x = 0; input.stick.y = 0;
    stickBase.style.display = 'none';
  };
  stickZone.addEventListener('pointerup', endStick);
  stickZone.addEventListener('pointercancel', endStick);

  // fire button
  const holdFire = (v) => (e) => { markTouch(); input.fireBtn = v; e.preventDefault(); };
  fireBtn.addEventListener('pointerdown', holdFire(true));
  fireBtn.addEventListener('pointerup', holdFire(false));
  fireBtn.addEventListener('pointercancel', holdFire(false));
  fireBtn.addEventListener('pointerleave', holdFire(false));

  // labelled HUD buttons
  root.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', (e) => { emit(el.dataset.action); e.preventDefault(); });
    el.addEventListener('pointerdown', markTouch, { passive: true });
  });

  /* ------------------------------------------------------------ update -- */
  input.sample = (dt) => {
    const k = input.keys;
    if (k.has('thrUp')) input.throttle = clamp(input.throttle + dt * 0.9, -1, 1);
    if (k.has('thrDown')) input.throttle = clamp(input.throttle - dt * 0.9, -1, 1);
    if (k.has('thrZero')) input.throttle = 0;

    let sx = input.stick.x, sy = input.stick.y;
    if (!input.touch || Math.abs(sx) + Math.abs(sy) < 0.01) {
      // keyboard steering folds into the same virtual stick
      let kx = 0, ky = 0;
      if (k.has('yawLeft')) kx -= 1;
      if (k.has('yawRight')) kx += 1;
      if (k.has('pitchUp')) ky -= 1;
      if (k.has('pitchDown')) ky += 1;
      if (kx || ky) { sx = kx; sy = ky; }
      else if (input.pointerLocked) { sx = mouse.x; sy = mouse.y; }
    }
    input.roll = (k.has('rollRight') ? 1 : 0) - (k.has('rollLeft') ? 1 : 0);
    input.fire = !!input.fireBtn || mouse.down || k.has('fire');

    // spring the virtual mouse stick back toward centre
    if (input.pointerLocked && !input.touch) {
      const decay = Math.exp(-2.2 * dt);
      mouse.x *= decay; mouse.y *= decay;
    }

    input.axes = { x: sx, y: sy };
    // reflect throttle on the touch widget
    if (barFill) {
      const pct = (1 - input.throttle) * 50;
      barKnob.style.top = `${pct}%`;
      barFill.style.top = `${Math.min(50, pct)}%`;
      barFill.style.height = `${Math.abs(50 - pct)}%`;
      barFill.classList.toggle('reverse', input.throttle < 0);
    }
  };

  input.clearFrame = () => { input.look.dx = 0; input.look.dy = 0; };
  return input;
}
