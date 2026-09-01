// A short guided opening. Each step states one objective and watches for it.

import { vlen } from '../core/math.js';
import { MODULES, ORES } from './data.js';

const oreInHold = (ship) =>
  Object.entries(ship.cargo).reduce((n, [id, q]) => n + (ORES[id] ? q : 0), 0);

const hasAutoTurret = (ship) =>
  ship.hardpoints.some((h) => MODULES[h.moduleId]?.mount === 'auto');

/** touch and keyboard players get different wording for the same objective */
const STEPS = [
  {
    id: 'throttle',
    title: 'BUILD SPEED',
    touch: 'Drag the bar on the left upward. Above centre is forward, below is reverse.',
    keys: 'Hold W to open the throttle. S slows you, X cuts it to zero.',
    done: (g) => vlen(g.player.ship.vel) > 45,
  },
  {
    id: 'steer',
    title: 'COME ABOUT',
    touch: 'Touch anywhere on the right half and drag to steer.',
    keys: 'Steer with the mouse (click once to capture it) or the arrow keys.',
    done: (g, st) => st.turned > 2.4,
  },
  {
    id: 'target',
    title: 'LOCK A ROCK',
    touch: 'Put an asteroid in the middle of the canopy and tap TGT.',
    keys: 'Put an asteroid in your sights and press T.',
    done: (g) => g.player.target?.kind === 'asteroid',
  },
  {
    id: 'mine',
    title: 'CUT ORE',
    touch: 'Close to within 400m, hold the rock in your sights and hold FIRE. Mount 2 is your mining laser — tap 2 on the weapon strip, or use INV to check.',
    keys: 'Close to within 400m and hold Space. Press 2 to man the mining laser.',
    done: (g) => oreInHold(g.player.ship) > 0,
  },
  {
    id: 'scoop',
    title: 'SCOOP THE PODS',
    touch: 'Break the rock apart and fly through the pods it sheds — the tractor pulls them in.',
    keys: 'Break the rock apart and fly through the pods it sheds.',
    done: (g) => oreInHold(g.player.ship) >= 10,
  },
  {
    id: 'dock',
    title: 'DOCK AT HALCYON DEPOT',
    touch: 'Follow the square station marker. Slow to under 90 m/s and tap ACT.',
    keys: 'Follow the square station marker. Slow to under 90 m/s and press F.',
    done: (g) => g.player.docked,
  },
  {
    id: 'sell',
    title: 'SELL THE ORE',
    touch: 'On the MARKET tab, tap SELL ALL ORE.',
    keys: 'On the MARKET tab, click SELL ALL ORE.',
    done: (g) => oreInHold(g.player.ship) === 0 && g.player.stats.earned > 0,
  },
  {
    id: 'turret',
    title: 'FIT AN AUTO-TURRET',
    touch: 'You can only man one mount at a time. Buy an AUTO-TURRET MK I in OUTFITTING, then fit it on the LOADOUT tab — it fires on hostiles while you fly.',
    keys: 'You can only man one mount at a time. Buy an AUTO-TURRET MK I in OUTFITTING, then fit it on the LOADOUT tab — it fires on hostiles while you fly.',
    done: (g) => hasAutoTurret(g.player.ship),
  },
];

export class Tutorial {
  constructor(player) {
    this.player = player;
    this.state = player.tutorial || (player.tutorial = { step: 0, done: false });
    this.turned = 0;
    this.shown = -1;
  }

  get active() { return !this.state.done && this.state.step < STEPS.length; }
  get step() { return STEPS[this.state.step]; }

  skip() {
    this.state.done = true;
    this.state.step = STEPS.length;
  }

  /** Returns the current objective, or null when there is nothing to show. */
  update(g, dt) {
    if (!this.active) return null;
    const ship = g.player.ship;
    this.turned += (Math.abs(ship.rate[0]) + Math.abs(ship.rate[1])) * dt;

    const step = this.step;
    if (step.done(g, this)) {
      this.state.step++;
      this.player.save();
      if (!this.active) {
        this.state.done = true;
        return { complete: true, title: 'BELT LICENCE ISSUED', body: 'You know enough to be dangerous. Good hunting.' };
      }
      return this.card(g, true);
    }
    return this.card(g, false);
  }

  card(g, fresh) {
    const step = this.step;
    const touch = g.mobile?.isTouch;
    return {
      id: step.id,
      index: this.state.step,
      total: STEPS.length,
      title: step.title,
      body: touch ? step.touch : step.keys,
      fresh,
    };
  }
}
