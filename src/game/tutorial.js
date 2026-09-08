// A short guided opening. Each step states one objective and watches for it.

import { vlen } from '../core/math.js';
import { MODULES, ORES } from './data.js';
import { inTruce } from './ai.js';

const oreInHold = (ship) =>
  Object.entries(ship.cargo).reduce((n, [id, q]) => n + (ORES[id] ? q : 0), 0);

const hasAutoTurret = (ship) =>
  ship.hardpoints.some((h) => MODULES[h.moduleId]?.mount === 'auto');

/** touch and keyboard players get different wording for the same objective */
const STEPS = [
  {
    id: 'throttle',
    title: 'BUILD SPEED',
    touch: 'Drag the bar on the left upward. It sets the speed you want and the drives hold it — above centre is forward, below is astern.',
    keys: 'Hold W to ask for more speed; the drives hold whatever you set. S slows you, X stops.',
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
    // The first hostile hull a new pilot sees. The belt is held quiet until
    // here (see `peaceful`), because the old opening sent one on a 75-second
    // timer: you could be jumped while still working out which way was up, by
    // a ship nobody had introduced and with no card telling you that turning
    // for the depot is allowed. Now the fight is taught, and it is the
    // tutorial that starts it.
    id: 'raider',
    title: 'SOMETHING ON THE SCOPE',
    touch: 'A raider is closing on you. Tap TGT to lock it, tap 1 on the weapon strip to man the cannon, and hold FIRE. Or turn for the depot — running is a real answer.',
    keys: 'A raider is closing on you. Press T to lock it, 1 to man the cannon, and hold Space. Or turn for the depot — running is a real answer.',
    // Not while they are still docked. The sale that brings this card up
    // happens at the market, and docking is what counts as running from the
    // fight — so sending the hull a frame after the sale would have started
    // the fight and settled it in the same breath, with the player standing in
    // the shop. It waits until they are back outside.
    enter: (g, st) => {
      if (g.player.docked) return false;
      st.raider = g.world.sendRaider();
      return true;
    },
    done: (g, st) => st.settled(g),
  },
  {
    // A full shuttle hold of iron sells for about 4,800, so the old jump
    // straight from the first sale to a 6,500 cr turret left the card sitting
    // there with no way to satisfy it and no hint that another run was needed.
    id: 'earn',
    title: 'RAISE 6,500 CR',
    touch: 'A turret costs 6,500. Fly another load out to the belt, or take a job from the CONTRACTS tab and track it.',
    keys: 'A turret costs 6,500. Mine another load, or take a job from the CONTRACTS tab and track it.',
    done: (g) => g.player.credits >= 6500 || hasAutoTurret(g.player.ship),
  },
  {
    id: 'turret',
    title: 'FIT AN AUTO-TURRET',
    touch: 'You can only man one mount at a time. Buy an AUTO-TURRET MK I in OUTFITTING, then fit it on the LOADOUT tab — it fires on hostiles while you fly.',
    keys: 'You can only man one mount at a time. Buy an AUTO-TURRET MK I in OUTFITTING, then fit it on the LOADOUT tab — it fires on hostiles while you fly.',
    done: (g) => hasAutoTurret(g.player.ship),
  },
];

/** The step that sends the first raider — everything before it is peacetime. */
const FIGHT = STEPS.findIndex((s) => s.id === 'raider');

/**
 * Is the belt still holding its fire? True while a pilot is being walked
 * through flying, cutting and selling, and through the scripted fight itself
 * so nothing else piles in on top of it. The director asks this before it
 * sends anything, and so does the sector build. Skipping the tutorial ends it,
 * which is the point of skipping it.
 */
export const peaceful = (player) => {
  const t = player?.tutorial;
  return !!t && !t.done && t.step <= FIGHT;
};

export class Tutorial {
  constructor(player) {
    this.player = player;
    this.state = player.tutorial || (player.tutorial = { step: 0, done: false });
    this.turned = 0;
    this.shown = -1;
    this.entered = -1;
    this.raider = null;
  }

  /**
   * Is the first fight over? Won, or the hull gave up, or it never caught you.
   * Docking counts, because the card says running is a real answer and a
   * tutorial that only accepts a kill would be lying about that — and so does
   * buying it off over the radio, which is a whole answer the game offers and
   * would otherwise have left the card stuck on screen for good.
   */
  settled(g) {
    const r = this.raider;
    if (!r) return false;
    return r.dead || r.disabled || !g.world.ships.includes(r)
      || inTruce(r, g.world) || !!g.player.docked;
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
    // A step that has to make something happen does it once, on arrival — and
    // again after a reload, since a fight you never finished is still ahead of
    // you and the hull that was sent is long gone.
    if (step.enter && this.entered !== this.state.step) {
      if (step.enter(g, this) !== false) this.entered = this.state.step;
    }
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
