// Ship-to-ship comms. Every option here resolves through a system that already
// exists — bounty, cargo, AI state, the books — so talking is a real alternative
// to shooting rather than a menu that prints flavour.

import { ITEMS, ORES, TRADE, SALVAGE } from './data.js';
import { addCargo, removeCargo, cargoUsed, cargoFree } from './ship.js';
import { vdist, vlen, clamp, rand, randi, pick, v3, vsub, vnorm } from '../core/math.js';

export const HAIL_RANGE = 2600;

/* ------------------------------------------------------------- chatter -- */

const CHATTER = {
  pirateEngage: [
    'HOLD STILL. THIS GOES QUICKER THAT WAY.',
    'NICE HULL. IT WILL LOOK BETTER IN PIECES.',
    'NOTHING PERSONAL. WELL — SOME OF IT IS.',
    'THE BELT FEEDS US ONE WAY OR ANOTHER.',
  ],
  pirateFlee: [
    'NOT WORTH IT. NOT WORTH IT.',
    'BREAKING OFF — YOU CAN KEEP THE ORE.',
    'I HAVE PEOPLE WAITING ON ME. LATER.',
  ],
  traderHail: [
    'RUNNING LATE AND LIGHT. WHAT DO YOU WANT?',
    'HOLD IS FULL, PATIENCE IS NOT.',
    'IF YOU ARE SELLING, MAKE IT QUICK.',
  ],
  traderFlee: [
    'MAYDAY, MAYDAY — WE ARE NOT ARMED FOR THIS.',
    'TAKE THE CARGO, LEAVE THE CREW.',
    'AUTHORITY, ANYONE, ANYTHING —',
  ],
  minerHail: [
    'ROCK IS THIN THIS SIDE. TRY THE DEEP SIDE.',
    'THIRTY YEARS ON THIS SEAM AND IT STILL SURPRISES ME.',
    'MIND THE DRIFT, IT WILL HAVE YOUR PAINT.',
  ],
  securityHail: [
    'HALCYON AUTHORITY. STATE YOUR BUSINESS.',
    'KEEP YOUR LANES AND WE WILL KEEP OUR DISTANCE.',
  ],
  derelictHail: [
    'IS ANYONE — PLEASE — WE HAVE BEEN DARK FOR DAYS.',
    'POWER IS GONE. AIR IS NOT, YET.',
    'WE SAW THEM COMING. WE DID NOT SEE THEM LEAVE.',
  ],
  saved: [
    'YOU HAVE MY THANKS AND MY MANIFEST.',
    'I OWE YOU A HULL. TAKE THE CREDITS INSTEAD.',
  ],
};

/** Broadcast a line from a ship, throttled so a brawl does not spam the log. */
export function chatter(world, ship, kind, force = false) {
  if (!ship || ship.dead) return;
  const pool = CHATTER[kind];
  if (!pool) return;
  world._chat = world._chat || new Map();
  const last = world._chat.get(ship.id) ?? -99;
  if (!force && world.time - last < 12) return;
  if (!force && Math.random() > 0.4) return;
  if (vdist(ship.pos, world.player.ship.pos) > 3200) return;
  world._chat.set(ship.id, world.time);
  world.log(`${ship.name}: ${pick(pool)}`, 'info');
}

/* --------------------------------------------------------------- hailing -- */

const cr = (n) => Math.round(n).toLocaleString('en-US');

/** Who is stronger, roughly, for deciding whether a demand lands. */
function leverage(player, target) {
  const me = player.ship;
  const mine = me.stats.hullMax + me.stats.shieldMax + me.cls.price / 40;
  const theirs = target.stats.hullMax + target.stats.shieldMax + target.cls.price / 40;
  const hurt = 1 - target.hull / target.stats.hullMax;
  return (mine / Math.max(1, theirs)) * (1 + hurt);
}

export function canHail(player, world, target) {
  if (!target || target.kind !== 'ship') return 'NO SHIP SELECTED';
  if (target === player.ship) return 'THAT IS YOU';
  if (target.dead) return 'NO ANSWER';
  if (vdist(target.pos, player.ship.pos) > HAIL_RANGE) return 'OUT OF COMMS RANGE';
  return null;
}

/** Open a channel: returns the panel state, or null if it cannot be opened. */
export function open(player, world, target) {
  const blocked = canHail(player, world, target);
  if (blocked) return { error: blocked };
  const greet = target.disabled ? pick(CHATTER.derelictHail)
    : target.faction === 'pirate' ? pick(CHATTER.pirateEngage)
    : target.faction === 'security' ? pick(CHATTER.securityHail)
    : target.wing ? `${target.name} STANDING BY.`
    : target.ai?.role === 'miner' ? pick(CHATTER.minerHail)
    : pick(CHATTER.traderHail);
  return { target, line: greet, options: options(player, world, target) };
}

export function options(player, world, target) {
  const out = [];
  const lev = leverage(player, target);
  const theirCargo = cargoUsed(target);

  if (target.wing) {
    out.push({ id: 'wingEngage', label: 'ATTACK MY TARGET' });
    out.push({ id: 'wingForm', label: 'FORM UP ON ME' });
    out.push({ id: 'wingHold', label: 'HOLD POSITION' });
  } else if (target.disabled) {
    if (!target.rescued) {
      if (!target.ransomed) out.push({ id: 'ransom', label: 'DEMAND A PAYOFF', hint: 'PIRACY' });
      out.push({ id: 'aid', label: 'CALL IN A RESCUE', hint: 'CLEARS BOUNTY' });
    }
  } else if (target.faction === 'pirate') {
    out.push({ id: 'tribute', label: `PAY THEM OFF (${cr(tributeCost(player))} CR)` });
    out.push({ id: 'threaten', label: 'TELL THEM TO STAND DOWN', hint: lev > 1.25 ? 'THEY MIGHT' : 'THEY WILL LAUGH' });
    out.push({ id: 'taunt', label: 'TAUNT THEM' });
  } else if (target.faction === 'security') {
    if (!target.scanned) out.push({ id: 'scan', label: 'SUBMIT TO A SCAN' });
    if (player.wanted > 0) out.push({ id: 'fine', label: `SETTLE ON THE SPOT (${cr(player.wanted * 1.6)} CR)` });
  } else {
    out.push({ id: 'greet', label: 'EXCHANGE PLEASANTRIES' });
    if (theirCargo > 0) out.push({ id: 'buy', label: 'ASK WHAT THEY ARE CARRYING' });
    if (theirCargo > 0) out.push({ id: 'demand', label: 'DEMAND THEIR CARGO', hint: 'PIRACY' });
  }
  out.push({ id: 'close', label: 'CLOSE CHANNEL' });
  return out;
}

export const tributeCost = (player) =>
  Math.max(400, Math.round(player.credits * 0.09 / 50) * 50);

/* ------------------------------------------------------------ responses -- */

export function choose(player, world, target, id) {
  const say = (line, close = false) => ({ line, close, options: options(player, world, target) });
  const lev = leverage(player, target);

  switch (id) {
    case 'close':
      return { close: true };

    /* ------------------------------------------------------------ wing -- */
    case 'wingEngage': {
      const t = player.target && player.target !== target ? player.target : null;
      forEachWing(world, (w) => { w.ai.order = 'engage'; w.ai.orderTarget = t; });
      return say(t ? `BREAKING ON ${t.name || 'YOUR TARGET'}.` : 'NOTHING LOCKED — SAY THE WORD.', true);
    }
    case 'wingForm':
      forEachWing(world, (w) => { w.ai.order = 'form'; w.ai.orderTarget = null; });
      return say('FORMING UP.', true);
    case 'wingHold':
      forEachWing(world, (w) => { w.ai.order = 'hold'; w.ai.orderTarget = null; });
      return say('HOLDING.', true);

    /* --------------------------------------------------------- pirates -- */
    case 'tribute': {
      const cost = tributeCost(player);
      if (player.credits < cost) return say('THEY LAUGH AT AN EMPTY ACCOUNT.');
      player.credits -= cost;
      target.angryAt = null;
      target.target = null;
      target.paidOff = world.time;
      if (target.ai) { target.ai.state = 'flee'; target.ai.t = 0; }
      world.log(`PAID OFF ${target.name} — ${cr(cost)} CR`, 'warn');
      return say('SENSIBLE. WE WERE NEVER HERE.', true);
    }
    case 'threaten': {
      if (lev > 1.25 || target.hull / target.stats.hullMax < 0.4) {
        target.angryAt = null;
        target.target = null;
        target.paidOff = world.time;     // a bluff that lands buys the same truce
        if (target.ai) { target.ai.state = 'flee'; target.ai.t = 0; }
        return say('...NOT TODAY, THEN. WE ARE LEAVING.', true);
      }
      return say('THAT IS A LOT OF MOUTH FOR A HULL THAT SIZE.');
    }
    case 'taunt':
      target.angryAt = player.ship;
      target.paidOff = null;             // you just spent the truce
      if (target.ai) { target.ai.state = 'hunt'; target.ai.t = 0; }
      return say(pick(['YOU WILL REGRET THAT.', 'NOTED. FILED. COMING FOR YOU.']));

    /* -------------------------------------------------------- security -- */
    case 'scan': {
      // Once per patrol. Unlimited, it was a free bounty wash: tap SUBMIT TO A
      // SCAN often enough with a clean hold and any price on your head vanished.
      if (target.scanned) return say('WE ALREADY LOOKED. MOVE ALONG.');
      target.scanned = true;
      const illegal = Object.keys(player.ship.cargo).filter((k) => ITEMS[k]?.illegal);
      if (illegal.length) {
        const fine = 1800 + randi(1200);
        for (const k of illegal) removeCargo(player.ship, k, player.ship.cargo[k]);
        player.credits = Math.max(0, player.credits - fine);
        world.log(`CONTRABAND SEIZED — FINED ${cr(fine)} CR`, 'danger');
        return say('WE WILL BE KEEPING THAT. CONSIDER YOURSELF LUCKY.', true);
      }
      player.wanted = Math.max(0, player.wanted - 300);
      return say('CLEAN. ON YOUR WAY, AND KEEP IT THAT WAY.', true);
    }
    case 'fine': {
      const cost = Math.round(player.wanted * 1.6);
      if (player.credits < cost) return say('THEN YOU CAN SETTLE IT AT THE DEPOT.');
      player.credits -= cost;
      player.wanted = 0;
      world.log('RECORD CLEARED IN THE FIELD', 'good');
      return say('PAID AND LOGGED. TRY TO STAY BORING.', true);
    }

    /* --------------------------------------------------------- traders -- */
    case 'greet': {
      const tip = rumour(world);
      return say(tip);
    }
    case 'buy': {
      const lines = Object.entries(target.cargo).filter(([, q]) => q > 0);
      if (!lines.length) return say('EMPTY. TRY SOMEONE PROSPEROUS.');
      const [id, qty] = pick(lines);
      const unit = Math.round((ITEMS[id]?.price ?? 10) * 1.15);
      const n = Math.min(qty, cargoFree(player.ship), Math.floor(player.credits / Math.max(1, unit)));
      if (n <= 0) return say(`${qty} OF ${ITEMS[id].name}, BUT YOU CANNOT TAKE IT.`);
      const cost = unit * n;
      player.credits -= cost;
      addCargo(player.ship, id, n);
      removeCargo(target, id, n);
      world.log(`BOUGHT ${n} ${ITEMS[id].name} FOR ${cr(cost)} CR`, 'good');
      return say(`${n} OF ${ITEMS[id].name}, THEN. PLEASURE DOING BUSINESS.`, true);
    }
    case 'demand': {
      if (lev < 1.15) {
        target.angryAt = player.ship;
        if (target.ai) { target.ai.state = 'flee'; target.ai.t = 0; }
        player.wanted += 150;
        return say('IN THAT? ABSOLUTELY NOT.', true);
      }
      let dropped = 0;
      for (const [id, qty] of Object.entries(target.cargo)) {
        const give = Math.ceil(qty * 0.6);
        if (give <= 0) continue;
        removeCargo(target, id, give);
        world.spawnPod(target.pos, target.vel, id, give);
        dropped += give;
      }
      target.angryAt = player.ship;
      if (target.ai) { target.ai.state = 'flee'; target.ai.t = 0; }
      player.wanted += 900;
      world.log(`${target.name} JETTISONS ${dropped} UNITS — PIRACY LOGGED`, 'danger');
      return say('TAKE IT. TAKE IT AND GO.', true);
    }

    /* -------------------------------------------------------- derelicts -- */
    case 'ransom': {
      // Taking their purse is not the same as emptying their hold: `looted` is
      // what boarding sets, and stamping it here locked you out of a hull whose
      // cargo you had never touched (and dropped it from the derelict count).
      const purse = Math.round(target.credits * 0.7);
      player.credits += purse;
      target.credits -= purse;
      target.ransomed = true;
      player.wanted += 500;
      world.log(`PAYOFF TAKEN — ${cr(purse)} CR`, 'warn');
      return say('THAT IS EVERYTHING. NOW LEAVE US THE AIR.', true);
    }
    case 'aid': {
      player.wanted = Math.max(0, player.wanted - 600);
      player.stats.rescued = (player.stats.rescued || 0) + 1;
      target.looted = true;      // the crew leaves with the hold
      target.rescued = true;
      world.log(`RESCUE CALLED IN FOR ${target.name}`, 'good');
      return say(pick(CHATTER.saved), true);
    }
    default:
      return say('...');
  }
}

function forEachWing(world, fn) {
  for (const s of world.ships) if (s.wing && !s.dead && s.ai) fn(s);
}

function rumour(world) {
  const rocks = world.asteroids.filter((a) => a.type.tier >= 2);
  if (rocks.length && Math.random() < 0.6) {
    const a = pick(rocks);
    const d = Math.round(vdist(a.pos, world.player.ship.pos));
    return `THERE IS ${ITEMS[a.type.ore].name} ABOUT ${cr(d)} METRES OFF. HELP YOURSELF.`;
  }
  const hulk = world.ships.find((s) => s.disabled && !s.dead && !s.looted);
  if (hulk) {
    return `SOMETHING IS ADRIFT OUT THERE, ${cr(Math.round(vdist(hulk.pos, world.player.ship.pos)))} METRES. NOT MY BUSINESS.`;
  }
  return pick([
    'QUIET RUN TODAY. LONG MAY IT LAST.',
    'THE YARD PAYS BETTER FOR ORE THAN THE DEPOT DOES. DO NOT TELL THEM I SAID SO.',
    'IF YOU SEE A MARAUDER, YOU ARE ALREADY TOO CLOSE.',
  ]);
}

/* -------------------------------------------------------------- distress -- */

/** A civilian under attack near you calls for help, and pays if you deliver. */
export function checkDistress(world, player, dt) {
  world._distressTimer = (world._distressTimer ?? 20) - dt;
  if (world._distressTimer > 0) return null;
  world._distressTimer = rand(45, 25);
  if (player.distress) return null;

  const victim = world.ships.find((s) => !s.dead && !s.disabled
    && (s.faction === 'trader' || s.faction === 'civilian')
    && s.angryAt && !s.angryAt.dead && s.angryAt !== player.ship
    && vdist(s.pos, player.ship.pos) < 3000);
  if (!victim) return null;

  const reward = Math.round(rand(9000, 3500) / 50) * 50;
  player.distress = {
    ship: victim, attacker: victim.angryAt, reward, at: world.time,
  };
  world.log(`${victim.name}: MAYDAY — UNDER ATTACK. ${cr(reward)} CR IF YOU DRIVE THEM OFF.`, 'warn');
  return player.distress;
}

/** Resolve an outstanding mayday: paid if the attacker is gone and they live. */
export function updateDistress(world, player) {
  const d = player.distress;
  if (!d) return;
  if (world.time - d.at > 180 || d.ship.dead) {
    if (d.ship.dead) world.log(`${d.ship.name} DID NOT MAKE IT`, 'danger');
    player.distress = null;
    return;
  }
  const gone = d.attacker.dead || d.attacker.disabled
    || vdist(d.attacker.pos, d.ship.pos) > 2600;
  if (gone) {
    player.credits += d.reward;
    player.stats.earned += d.reward;
    player.stats.rescued = (player.stats.rescued || 0) + 1;
    world.log(`${d.ship.name}: THEY ARE RUNNING. ${cr(d.reward)} CR SENT, WITH THANKS.`, 'good');
    chatter(world, d.ship, 'saved', true);
    player.distress = null;
  }
}
