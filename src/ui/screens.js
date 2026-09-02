// DOM overlays: HUD text, inventory / loadout, station, boarding, menus.

import { SHIPS, MODULES, ITEMS, ORES, TRADE, PLAYER_SHIPS } from '../game/data.js';
import { cargoUsed, cargoFree, recalc } from '../game/ship.js';
import {
  sellCargo, sellAllOre, buyCargo, buyModule, sellModule, buyShip, switchShip,
  repair, repairCost, payFines,
} from '../game/station.js';
import { vdist, vlen, clamp } from '../core/math.js';
import * as Contracts from '../game/contracts.js';
import * as Crew from '../game/crew.js';
import * as Comms from '../game/comms.js';
import { boardBlocker, BOARD_RANGE } from '../game/boarding.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cr = (n) => Math.round(n).toLocaleString('en-US');

export class UI {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.overlay = document.getElementById('overlay');
    this.el = {
      credits: document.getElementById('credits'),
      hold: document.getElementById('hold'),
      wanted: document.getElementById('wanted'),
      wantedWrap: document.getElementById('wantedWrap'),
      shipName: document.getElementById('shipName'),
      sectorName: document.getElementById('sectorName'),
      modeTag: document.getElementById('modeTag'),
      target: document.getElementById('targetPanel'),
      tgtName: document.getElementById('tgtName'),
      tgtDist: document.getElementById('tgtDist'),
      tgtHull: document.getElementById('tgtHull'),
      tgtShield: document.getElementById('tgtShield'),
      tgtInfo: document.getElementById('tgtInfo'),
      weapons: document.getElementById('weapons'),
      log: document.getElementById('log'),
      prompt: document.getElementById('prompt'),
      speed: document.getElementById('speedVal'),
      vitals: document.getElementById('vitals'),
      hullBar: document.getElementById('hullBar'),
      hullVal: document.getElementById('hullVal'),
      shieldBar: document.getElementById('shieldBar'),
      shieldVal: document.getElementById('shieldVal'),
      hitFlash: document.getElementById('hitFlash'),
      objective: document.getElementById('objective'),
      objTitle: document.getElementById('objTitle'),
      objBody: document.getElementById('objBody'),
      objStep: document.getElementById('objStep'),
      comms: document.getElementById('comms'),
      commsWho: document.getElementById('commsWho'),
      commsLine: document.getElementById('commsLine'),
      commsOpts: document.getElementById('commsOpts'),
    };
    this.el.comms.addEventListener('click', (e) => {
      const b = e.target.closest('[data-do-comms]');
      if (b) this.comms(b.dataset.doComms);
    });
    this.screen = null;
    this.tab = 'loadout';
    this.selSlot = null;
    this.overlay.addEventListener('click', (e) => this.onClick(e));
  }

  get isOpen() { return !!this.screen; }

  log(text, kind = 'info') {
    const d = document.createElement('div');
    d.className = kind;
    d.textContent = text;
    this.el.log.prepend(d);
    while (this.el.log.children.length > 7) this.el.log.lastChild.remove();
    setTimeout(() => d.remove(), 7200);
  }

  /* ------------------------------------------------------------- HUD -- */

  update(g) {
    const { player, world } = g;
    const ship = player.ship;
    this.el.credits.textContent = cr(player.credits);
    this.el.hold.textContent = `${cargoUsed(ship)}/${ship.stats.cargoMax}`;
    this.el.wanted.textContent = cr(player.wanted);
    this.el.wantedWrap.classList.toggle('hot', player.wanted > 0);
    this.el.shipName.textContent = ship.cls.name;
    if (world.sector) this.el.sectorName.textContent = world.sector.name;
    this.el.modeTag.textContent = player.mode === 'gunner'
      ? `GUNNER · ${g.autopilot || 'HOLD'}` : 'PILOT';
    this.el.speed.textContent = Math.round(vlen(ship.vel));

    // vitals: the number, not just a bar — dying should never be a surprise
    const hullFrac = clamp(ship.hull / ship.stats.hullMax, 0, 1);
    const shieldFrac = clamp(ship.shield / Math.max(1, ship.stats.shieldMax), 0, 1);
    this.el.hullBar.style.width = `${hullFrac * 100}%`;
    this.el.shieldBar.style.width = `${shieldFrac * 100}%`;
    this.el.hullVal.textContent = `${Math.ceil(ship.hull)}/${ship.stats.hullMax}`;
    this.el.shieldVal.textContent = `${Math.ceil(ship.shield)}/${ship.stats.shieldMax}`;
    this.el.vitals.classList.toggle('hurt', hullFrac < 0.5);
    this.el.vitals.classList.toggle('critical', hullFrac < 0.25);

    // weapon strip
    if (this._wepSig !== this.weaponSignature(ship, player)) {
      this._wepSig = this.weaponSignature(ship, player);
      this.el.weapons.innerHTML = ship.hardpoints.map((hp, i) => {
        const m = MODULES[hp.moduleId];
        const manned = i === ship.manualIndex;
        const cls = !m ? 'empty' : manned ? 'manual' : '';
        const tag = !m ? 'EMPTY' : m.name.replace(/AUTO-TURRET /, 'AUTO ').replace(/ MK /, ' ');
        return `<span class="${cls}">${i + 1}<b>${esc(tag)}</b>${manned ? ' ◄' : m && m.mount === 'auto' ? ' ⟳' : ''}</span>`;
      }).join('');
    }

    // target panel
    const t = player.target;
    if (t && !t.dead) {
      this.el.target.classList.remove('hidden');
      const d = vdist(t.pos, ship.pos);
      this.el.tgtDist.textContent = `${cr(d)} M`;
      if (t.kind === 'ship') {
        this.el.tgtName.textContent = t.name;
        this.el.tgtHull.style.width = `${clamp(t.hull / t.stats.hullMax, 0, 1) * 100}%`;
        this.el.tgtShield.style.width = `${clamp(t.shield / Math.max(1, t.stats.shieldMax), 0, 1) * 100}%`;
        const scan = ship.stats.scanner;
        const manifest = scan ? Object.entries(t.cargo).map(([id, q]) => `${q} ${ITEMS[id]?.name || id}`).join(', ') : '';
        if (t.disabled) {
          const salv = t.salvage
            ? ` · HULL ${Math.max(0, Math.round((t.salvage.integrity / t.salvage.max) * 100))}%`
            : '';
          this.el.tgtInfo.textContent =
            `ADRIFT — ${t.looted ? 'HOLD STRIPPED' : 'BOARDABLE'}${salv}`;
        } else {
          this.el.tgtInfo.textContent =
            `${t.cls.name} · ${t.faction.toUpperCase()}${manifest ? ` · ${manifest}` : ''}`;
        }
      } else if (t.kind === 'asteroid') {
        this.el.tgtName.textContent = `${t.type.ore.toUpperCase()} ASTEROID`;
        this.el.tgtHull.style.width = `${clamp(t.hp / t.hpMax, 0, 1) * 100}%`;
        this.el.tgtShield.style.width = '0%';
        this.el.tgtInfo.textContent = ship.stats.scanner
          ? `${Math.round(t.ore)} UNITS · ${ITEMS[t.type.ore].name} · ${cr(t.ore * ITEMS[t.type.ore].price)} CR`
          : `${Math.round(t.size)}M ROCK`;
      } else if (t.kind === 'gate') {
        this.el.tgtName.textContent = t.name;
        this.el.tgtHull.style.width = '100%';
        this.el.tgtShield.style.width = '100%';
        this.el.tgtInfo.textContent = 'JUMP GATE — FLY IN AND USE [ACT]';
      } else {
        this.el.tgtName.textContent = t.name || 'STATION';
        this.el.tgtHull.style.width = '100%';
        this.el.tgtShield.style.width = '100%';
        this.el.tgtInfo.textContent = 'DOCKING AUTHORISED';
      }
    } else this.el.target.classList.add('hidden');

    this.tickComms();

    // contextual prompt
    const p = g.promptText;
    if (p) { this.el.prompt.textContent = p; this.el.prompt.classList.remove('hidden'); }
    else this.el.prompt.classList.add('hidden');
  }

  /* ------------------------------------------------------------ comms -- */

  openComms(target) {
    const g = this.game;
    const state = Comms.open(g.player, g.world, target);
    if (state.error) { this.log(state.error, 'warn'); return; }
    this.commsTarget = target;
    this.el.comms.classList.remove('hidden');
    this.drawComms(state);
  }

  closeComms() {
    this.commsTarget = null;
    this.el.comms.classList.add('hidden');
  }

  /** A pick from the channel, or the close button. */
  comms(id) {
    const g = this.game;
    const t = this.commsTarget;
    if (!t || id === 'close') { this.closeComms(); return; }
    const state = Comms.choose(g.player, g.world, t, id);
    if (state.close && !state.line) { this.closeComms(); return; }
    this.drawComms({ ...state, target: t });
    if (state.close) setTimeout(() => this.closeComms(), 2600);
  }

  drawComms(state) {
    const t = state.target || this.commsTarget;
    this.el.commsWho.textContent =
      `${t.name} · ${t.disabled ? 'ADRIFT' : t.wing ? 'YOUR WING' : t.faction.toUpperCase()}`;
    this.el.commsLine.textContent = state.line || '';
    this.el.commsOpts.innerHTML = (state.options || [])
      .map((o) => `<button class="hbtn" data-do-comms="${o.id}">${esc(o.label)}${
        o.hint ? `<i>${esc(o.hint)}</i>` : ''}</button>`).join('');
  }

  /** Drop the channel when the other ship stops being reachable. */
  tickComms() {
    const t = this.commsTarget;
    if (!t) return;
    if (Comms.canHail(this.game.player, this.game.world, t)) this.closeComms();
  }

  /** Show the current tutorial objective, or clear it when there is none. */
  setObjective(card) {
    const el = this.el.objective;
    if (!el) return;
    if (!card) { el.classList.add('hidden'); this._objId = null; return; }
    el.classList.remove('hidden');
    if (this._objId === card.id && !card.complete) return;
    this._objId = card.id;
    this.el.objTitle.textContent = card.title;
    this.el.objBody.textContent = card.body;
    this.el.objStep.textContent = card.contract ? 'CONTRACT'
      : card.complete ? '' : `${card.index + 1}/${card.total}`;
    el.querySelector('[data-action="skiptut"]').classList.toggle('hidden', !!card.contract);
    el.classList.toggle('contract', !!card.contract);
    el.classList.remove('fresh');
    void el.offsetWidth;                 // restart the entry animation
    el.classList.add('fresh');
  }

  /** Red edge flash, scaled by how hard the hit landed. */
  flashDamage(strength = 0.5) {
    const el = this.el.hitFlash;
    if (!el) return;
    clearTimeout(this._flashTimer);
    el.style.display = 'block';
    el.style.transition = 'none';
    el.style.opacity = String(clamp(strength, 0.15, 0.9));
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.35s ease-out';
      el.style.opacity = '0';
    });
    // take it back out of the compositor once it has faded
    this._flashTimer = setTimeout(() => { el.style.display = 'none'; }, 500);
  }

  weaponSignature(ship, player) {
    return ship.hardpoints.map((h) => h.moduleId).join('|') + '#' + ship.manualIndex + player.mode;
  }

  /* --------------------------------------------------------- overlays -- */

  open(name, opts = {}) {
    this.screen = name;
    this.opts = opts;
    if (name === 'station') this.tab = opts.tab || 'contracts';
    if (name === 'inventory') this.tab = opts.tab || 'loadout';
    this.overlay.classList.remove('hidden');
    this.render();
    this.game.onOverlayChange?.(true);
  }

  close() {
    this.screen = null;
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.game.onOverlayChange?.(false);
  }

  render() {
    if (!this.screen) return;
    const fn = {
      inventory: () => this.renderInventory(),
      station: () => this.renderStation(),
      boarding: () => this.renderBoarding(),
      menu: () => this.renderMenu(),
      dead: () => this.renderDead(),
    }[this.screen];
    this.overlay.innerHTML = fn ? fn() : '';
  }

  onClick(e) {
    const btn = e.target.closest('[data-do]');
    if (!btn) return;
    const { do: action, arg, arg2 } = btn.dataset;
    const g = this.game;
    const player = g.player;
    const say = (r) => { if (r?.msg) this.log(r.msg, r.ok === false ? 'warn' : 'good'); };

    switch (action) {
      case 'close': this.close(); return;
      case 'tab': this.tab = arg; this.render(); return;
      case 'selSlot': this.selSlot = { kind: arg, index: +arg2 }; this.render(); return;
      case 'man': player.ship.manualIndex = +arg; this._wepSig = null; this.render(); return;
      case 'install': {
        this.log(player.install(arg, MODULES[arg].slot, this.pickSlot(arg)), 'good');
        this.render(); return;
      }
      case 'uninstall': this.log(player.uninstall(arg, +arg2), 'good'); this.render(); return;
      case 'jettison': {
        const n = player.ship.cargo[arg] || 0;
        g.world.spawnPod(player.ship.pos, player.ship.vel, arg, n);
        delete player.ship.cargo[arg];
        this.log(`JETTISONED ${n} ${ITEMS[arg]?.name || arg}`, 'warn');
        this.render(); return;
      }
      case 'takeJob': {
        const c = (g.world.station.board || []).find((x) => x.id === arg);
        if (c) say(Contracts.accept(player, c, g.world));
        this.render(); return;
      }
      case 'dropJob': say(Contracts.abandon(player, arg)); this.render(); return;
      case 'hire': say(Crew.hire(player, arg, g.world)); this.render(); return;
      case 'fire': say(Crew.dismiss(player, arg, g.world)); this.render(); return;
      case 'sell': say(sellCargo(player, g.market, arg, +(arg2 || 1))); this.render(); return;
      case 'sellAll': say(sellAllOre(player, g.market)); this.render(); return;
      case 'buy': say(buyCargo(player, g.market, arg, +(arg2 || 1))); this.render(); return;
      case 'buyMod': say(buyModule(player, g.market, arg)); this.render(); return;
      case 'sellMod': say(sellModule(player, g.market, arg)); this.render(); return;
      case 'buyShip': say(buyShip(player, g.market, arg, g.world)); this.render(); return;
      case 'switchShip': say(switchShip(player, +arg, g.world)); this.render(); return;
      case 'repair': say(repair(player)); this.render(); return;
      case 'fines': say(payFines(player)); this.render(); return;
      case 'save': this.log(player.save() ? 'FLIGHT LOG SAVED' : 'SAVE FAILED', 'good');
        this.render(); return;
      case 'reload': location.reload(); return;
      case 'undock': g.undock(); return;
      case 'strike': g.boarding?.strike(); this.render(); return;
      case 'loot': g.boarding?.take(arg); this.render(); return;
      case 'lootAll': g.boarding?.takeAll(); this.render(); return;
      case 'lootCash': g.boarding?.takeCash(); this.render(); return;
      case 'claim': { const m = g.boarding?.claimHull(); if (m) this.log(m, 'good'); this.render(); return; }
      case 'endBoard': g.endBoarding(); return;
      case 'respawn': g.respawn(); return;
      case 'newgame': g.newGame(); return;
      case 'assist': player.assist = !player.assist; player.ship.assist = player.assist;
        this.log(`FLIGHT ASSIST ${player.assist ? 'ON' : 'OFF'}`, 'info'); this.render(); return;
      case 'crt': g.toggleCRT(); this.render(); return;
      case 'flat': {
        const on = document.body.classList.toggle('flat');
        try { localStorage.setItem('starquest.flat', on ? '1' : '0'); } catch { /* ignore */ }
        this.log(`SIMPLE HUD ${on ? 'ON' : 'OFF'}`, 'info');
        this.render(); return;
      }
      default: return;
    }
  }

  /** Which slot a clicked module should drop into. */
  pickSlot(id) {
    const m = MODULES[id];
    const ship = this.game.player.ship;
    if (this.selSlot && this.selSlot.kind === m.slot) return this.selSlot.index;
    const list = m.slot === 'hardpoint' ? ship.hardpoints.map((h) => h.moduleId) : ship.utility;
    const free = list.indexOf(null);
    return free >= 0 ? free : 0;
  }

  /* ------------------------------------------------------- inventory -- */

  renderInventory() {
    const p = this.game.player, ship = p.ship;
    const tabs = [['loadout', 'LOADOUT'], ['cargo', 'CARGO'], ['ship', 'SHIP']];
    return `<div class="screen">
      <header>
        <h2>SHIP SYSTEMS</h2><div class="spacer"></div>
        <div class="meta">CR <b>${cr(p.credits)}</b> · HOLD <b>${cargoUsed(ship)}/${ship.stats.cargoMax}</b></div>
        <button class="hbtn" data-do="close">CLOSE</button>
      </header>
      <div class="tabs">${tabs.map(([id, t]) =>
        `<button class="tab ${this.tab === id ? 'on' : ''}" data-do="tab" data-arg="${id}">${t}</button>`).join('')}</div>
      <div class="body">${
        this.tab === 'cargo' ? this.cargoView() : this.tab === 'ship' ? this.shipView() : this.loadoutView()
      }</div>
    </div>`;
  }

  loadoutView() {
    const p = this.game.player, ship = p.ship;
    const sel = this.selSlot;
    const slotRow = (kind, i, id) => {
      const m = MODULES[id];
      const on = sel && sel.kind === kind && sel.index === i;
      const manned = kind === 'hardpoint' && ship.manualIndex === i;
      const role = kind === 'hardpoint'
        ? (m ? (m.mount === 'auto' ? 'AUTO-TRACKING' : manned ? 'MANNED BY YOU' : 'UNMANNED — FIT A TURRET') : 'EMPTY MOUNT')
        : (m ? m.blurb : 'EMPTY BAY');
      return `<div class="item ${on ? 'on' : ''} ${m ? '' : 'empty'}" data-do="selSlot" data-arg="${kind}" data-arg2="${i}">
        <span class="grow"><b>${kind === 'hardpoint' ? `MOUNT ${i + 1}` : `BAY ${i + 1}`}</b> ${m ? esc(m.name) : '—'}
          <span class="sub">${esc(role)}</span></span>
        ${kind === 'hardpoint' && m && m.mount === 'manual' && !manned
          ? `<button class="hbtn" data-do="man" data-arg="${i}">MAN</button>` : ''}
        ${m ? `<button class="hbtn" data-do="uninstall" data-arg="${kind}" data-arg2="${i}">STOW</button>` : ''}
      </div>`;
    };

    const storage = Object.entries(p.storage).filter(([, n]) => n > 0);
    const unmanned = ship.hardpoints.filter((h, i) =>
      i !== ship.manualIndex && (!h.moduleId || MODULES[h.moduleId].mount !== 'auto')).length;

    return `<div class="cols">
      <div>
        <div class="section"><h3>WEAPON MOUNTS — ${ship.cls.name}</h3>
          <div class="list">${ship.hardpoints.map((h, i) => slotRow('hardpoint', i, h.moduleId)).join('')}</div>
        </div>
        <div class="section"><h3>UTILITY BAYS</h3>
          <div class="list">${ship.utility.map((id, i) => slotRow('utility', i, id)).join('')}</div>
        </div>
        <p class="note">${unmanned > 0
          ? `You can only man one mount at a time. ${unmanned} mount${unmanned > 1 ? 's are' : ' is'} sitting idle — fit auto-turrets so they fire while you fly.`
          : 'Every mount is either manned or slaved to an auto-turret.'}</p>
      </div>
      <div>
        <div class="section"><h3>STORAGE${sel ? ` — FITTING TO ${sel.kind === 'hardpoint' ? `MOUNT ${sel.index + 1}` : `BAY ${sel.index + 1}`}` : ''}</h3>
          <div class="list">${storage.length ? storage.map(([id, n]) => {
            const m = MODULES[id];
            const fits = !sel || sel.kind === m.slot;
            return `<div class="item ${fits ? '' : 'locked'}" ${fits ? `data-do="install" data-arg="${id}"` : ''}>
              <span class="grow"><b>${esc(m.name)}</b> <span class="qty">×${n}</span>
                <span class="sub">${esc(m.blurb)}</span></span>
              <span class="price">${m.slot === 'hardpoint' ? (m.mount === 'auto' ? 'AUTO' : 'MANUAL') : 'UTILITY'}</span>
            </div>`;
          }).join('') : '<div class="item empty">STORAGE EMPTY — BUY MODULES AT A STATION</div>'}</div>
        </div>
        <div class="section"><h3>PERFORMANCE</h3>${this.statBlock(ship)}</div>
      </div>
    </div>`;
  }

  statBlock(ship) {
    const s = ship.stats;
    const rows = [
      ['HULL', `${Math.round(ship.hull)} / ${s.hullMax}`],
      ['SHIELD', `${Math.round(ship.shield)} / ${s.shieldMax}`],
      ['CARGO', `${cargoUsed(ship)} / ${s.cargoMax}`],
      ['THRUST', s.accel.toFixed(0)],
      ['TOP SPEED', `${s.maxSpeed.toFixed(0)} M/S`],
      ['AGILITY', s.turn.toFixed(2)],
      ['CAPACITOR', `${s.energyMax} (+${s.energyRate}/S)`],
      ['TRACTOR', `${s.tractor} M`],
      ['BOARDING RIG', s.boarding ? (s.boarding > 1 ? 'ASSAULT' : 'BREACH') : 'NONE'],
    ];
    return `<div class="list">${rows.map(([k, v]) =>
      `<div class="item"><span class="grow">${k}</span><span class="price">${v}</span></div>`).join('')}</div>`;
  }

  cargoView() {
    const p = this.game.player, ship = p.ship;
    const rows = Object.entries(ship.cargo);
    return `<div class="section"><h3>HOLD — ${cargoUsed(ship)} / ${ship.stats.cargoMax} UNITS</h3>
      <div class="list">${rows.length ? rows.map(([id, n]) => {
        const it = ITEMS[id] || { name: id, price: 0 };
        return `<div class="item"><span class="grow"><b>${esc(it.name)}</b> <span class="qty">×${n}</span>
          <span class="sub">EST. VALUE ${cr(n * it.price)} CR${it.illegal ? ' · CONTRABAND' : ''}</span></span>
          <button class="hbtn" data-do="jettison" data-arg="${id}">JETTISON</button></div>`;
      }).join('') : '<div class="item empty">HOLD IS EMPTY</div>'}</div>
      <p class="note">Ore is mined with a mining laser, or scooped from cargo pods. Sell it at Halcyon Depot.</p></div>`;
  }

  shipView() {
    const p = this.game.player;
    return `<div class="cols"><div class="section"><h3>${esc(p.ship.cls.name)}</h3>
      <p class="note">${esc(p.ship.cls.blurb)}</p>${this.statBlock(p.ship)}</div>
      <div><div class="section"><h3>HANGAR</h3><div class="list">${p.hangar.map((h, i) => {
        const c = SHIPS[h.classId];
        return `<div class="item ${i === p.active ? 'on' : ''}">
          <span class="grow"><b>${esc(c.name)}</b><span class="sub">${c.hardpoints} MOUNTS · ${c.cargo} HOLD</span></span>
          ${i === p.active ? '<span class="price">ABOARD</span>'
            : p.docked ? `<button class="hbtn" data-do="switchShip" data-arg="${i}">BOARD</button>`
            : '<span class="price">AT DEPOT</span>'}</div>`;
      }).join('')}</div></div>
      <div class="section"><h3>RECORD</h3><div class="list">${[
        ['KILLS', p.stats.kills], ['ROCKS CRACKED', p.stats.rocks], ['ORE SCOOPED', p.stats.mined],
        ['HULLS BOARDED', p.stats.boarded], ['CREDITS EARNED', cr(p.stats.earned)],
        ['BOUNTY ON YOU', cr(p.wanted)],
      ].map(([k, v]) => `<div class="item"><span class="grow">${k}</span><span class="price">${v}</span></div>`).join('')}</div></div>
      <div class="rowbtns">
        <button class="hbtn" data-do="assist">FLIGHT ASSIST: ${p.assist ? 'ON' : 'OFF'}</button>
        <button class="hbtn" data-do="crt">CRT FILTER</button>
        <button class="hbtn" data-do="save">SAVE</button>
      </div></div></div>`;
  }

  /* --------------------------------------------------------- station -- */

  renderStation() {
    const p = this.game.player;
    const tabs = [['contracts', 'CONTRACTS'], ['market', 'MARKET'], ['shipyard', 'SHIPYARD'],
      ['crew', 'CREW'], ['outfit', 'OUTFITTING'], ['loadout', 'LOADOUT'], ['services', 'SERVICES']];
    return `<div class="screen">
      <header><h2>${esc(this.game.world.station?.name || 'DEPOT')}</h2><div class="spacer"></div>
        <div class="meta">CR <b>${cr(p.credits)}</b> · HOLD <b>${cargoUsed(p.ship)}/${p.ship.stats.cargoMax}</b></div>
        <button class="hbtn" data-do="undock">UNDOCK</button>
      </header>
      <div class="tabs">${tabs.map(([id, t]) =>
        `<button class="tab ${this.tab === id ? 'on' : ''}" data-do="tab" data-arg="${id}">${t}</button>`).join('')}</div>
      <div class="body">${{
        contracts: () => this.contractsView(),
        crew: () => this.crewView(),
        market: () => this.marketView(),
        shipyard: () => this.shipyardView(),
        outfit: () => this.outfitView(),
        loadout: () => this.loadoutView(),
        services: () => this.servicesView(),
      }[this.tab]()}</div></div>`;
  }

  contractsView() {
    const g = this.game, p = g.player;
    const board = (g.world.station.board || []).filter(
      (c) => !p.contracts.some((a) => a.id === c.id));
    const active = p.contracts;
    const cr = (n) => Math.round(n).toLocaleString('en-US');

    const progressOf = (c) => {
      if (c.type === 'supply') return `${p.ship.cargo[c.item] || 0}/${c.need} IN THE HOLD`;
      if (c.type === 'courier') return `${p.ship.cargo.crate || 0}/${c.units} CRATES ABOARD`;
      return `${c.progress}/${c.need} DONE`;
    };

    return `<div class="cols">
      <div class="section"><h3>ON OFFER</h3><div class="list">${board.length ? board.map((c) => `
        <div class="item" data-do="takeJob" data-arg="${c.id}">
          <span class="grow"><b>${esc(c.title)}</b><span class="sub">${esc(c.brief)}</span></span>
          <span class="price">${cr(c.reward)} CR</span>
        </div>`).join('') : '<div class="item empty">THE BOARD IS EMPTY — UNDOCK AND COME BACK</div>'}</div>
        <p class="note">You can hold ${Contracts.MAX_ACTIVE} contracts at once. Courier freight is loaded
        the moment you accept, so make room first.</p>
      </div>
      <div class="section"><h3>ACTIVE — ${active.length}/${Contracts.MAX_ACTIVE}</h3><div class="list">${
        active.length ? active.map((c) => `
        <div class="item on"><span class="grow"><b>${esc(c.title)}</b>
          <span class="sub">${progressOf(c)}${c.type === 'courier' || c.type === 'supply'
            ? ` · SETTLES ON DOCKING AT ${esc(c.type === 'courier' ? c.toName : Contracts.stationName(c.station))}` : ''}</span></span>
          <span class="price">${cr(c.reward)}</span>
          <button class="hbtn" data-do="dropJob" data-arg="${c.id}">DROP</button>
        </div>`).join('') : '<div class="item empty">NOTHING ACCEPTED</div>'}</div>
        <p class="note">Dropping a contract costs you standing with the Authority.</p>
      </div></div>`;
  }

  crewView() {
    const g = this.game, p = g.player;
    const cr = (n) => Math.round(n).toLocaleString('en-US');
    return `<div class="cols">
      <div class="section"><h3>PILOTS FOR HIRE</h3><div class="list">${
        Object.values(Crew.HIRES).map((h) => {
          const afford = p.credits >= h.price && p.crew.length < Crew.MAX_CREW;
          return `<div class="item ${afford ? '' : 'locked'}" ${afford ? `data-do="hire" data-arg="${h.id}"` : ''}>
            <span class="grow"><b>${esc(h.name)}</b><span class="sub">${esc(h.blurb)}</span></span>
            <span class="price">${cr(h.price)} CR</span></div>`;
        }).join('')}</div>
        <p class="note">A hired pilot flies their own hull, holds station off your wing, and breaks to
        engage anything that threatens you. They keep up across jumps. If they are shot down, they are
        gone — there is no insurance on other people.</p>
      </div>
      <div class="section"><h3>ON YOUR BOOKS — ${p.crew.length}/${Crew.MAX_CREW}</h3><div class="list">${
        p.crew.length ? p.crew.map((c) => {
          const ship = g.world.ships.find((s) => s.wing && s.name === c.name);
          const hull = ship ? Math.round((ship.hull / ship.stats.hullMax) * 100) : 100;
          return `<div class="item on"><span class="grow"><b>${esc(c.name)}</b>
            <span class="sub">${esc(SHIPS[c.classId].name)} · HULL ${hull}%</span></span>
            <button class="hbtn" data-do="fire" data-arg="${esc(c.name)}">PAY OFF</button></div>`;
        }).join('') : '<div class="item empty">FLYING ALONE</div>'}</div>
      </div></div>`;
  }

  marketView() {
    const g = this.game, p = g.player, m = g.market;
    const hold = Object.entries(p.ship.cargo);
    const goods = Object.keys(TRADE);
    return `<div class="cols">
      <div class="section"><h3>SELL FROM HOLD</h3><div class="list">${hold.length ? hold.map(([id, n]) => {
        const unit = m.sellPrice(id);
        return `<div class="item" data-do="sell" data-arg="${id}" data-arg2="${n}">
          <span class="grow"><b>${esc(ITEMS[id].name)}</b> <span class="qty">×${n}</span>
          <span class="sub">${unit} CR/UNIT${ITEMS[id].illegal ? ' · CUSTOMS RISK' : ''}</span></span>
          <span class="price">+${cr(unit * n)}</span></div>`;
      }).join('') : '<div class="item empty">HOLD IS EMPTY</div>'}</div>
      <div class="rowbtns"><button class="hbtn" data-do="sellAll">SELL ALL ORE</button></div></div>
      <div class="section"><h3>BUY</h3><div class="list">${goods.map((id) => {
        const unit = m.buyPrice(id);
        const stock = m.stock[id] ?? 0;
        return `<div class="item ${stock ? '' : 'locked'}" ${stock ? `data-do="buy" data-arg="${id}" data-arg2="10"` : ''}>
          <span class="grow"><b>${esc(TRADE[id].name)}</b>
          <span class="sub">STOCK ${stock}${TRADE[id].illegal ? ' · ILLEGAL' : ''} · TAP TO BUY 10</span></span>
          <span class="price">${unit} CR</span></div>`;
      }).join('')}</div></div></div>`;
  }

  shipyardView() {
    const g = this.game, p = g.player, m = g.market;
    return `<div class="section"><h3>HULLS FOR SALE</h3><div class="list">${
      PLAYER_SHIPS.filter((id) => SHIPS[id].price > 0).map((id) => {
        const c = SHIPS[id];
        const price = m.shipPrice(id, p);
        const owned = p.hangar.some((h) => h.classId === id);
        const claim = p.vouchers[id] > 0;
        const afford = p.credits >= price;
        return `<div class="item ${afford ? '' : 'locked'}" ${afford ? `data-do="buyShip" data-arg="${id}"` : ''}>
          <span class="grow"><b>${esc(c.name)}</b>${owned ? ' <span class="qty">OWNED</span>' : ''}
            ${claim ? ' <span class="qty">SALVAGE CLAIM — 50% OFF</span>' : ''}
            <span class="sub">${c.hardpoints} MOUNTS · ${c.utility} BAYS · ${c.cargo} HOLD · ${c.hull} HULL — ${esc(c.blurb)}</span></span>
          <span class="price">${cr(price)} CR</span></div>`;
      }).join('')}</div>
      <p class="note">Bigger hulls carry more mounts than one pilot can man. Every mount past the one you sit in
      needs an auto-turret from Outfitting, or it flies empty.</p></div>`;
  }

  outfitView() {
    const g = this.game, p = g.player, m = g.market;
    const groups = [
      ['MANUAL WEAPONS', Object.values(MODULES).filter((x) => x.slot === 'hardpoint' && x.mount === 'manual')],
      ['AUTO-TURRETS', Object.values(MODULES).filter((x) => x.mount === 'auto')],
      ['UTILITY', Object.values(MODULES).filter((x) => x.slot === 'utility')],
    ];
    const owned = Object.entries(p.storage).filter(([, n]) => n > 0);
    return `<div class="cols"><div>${groups.map(([title, list]) => `
      <div class="section"><h3>${title}</h3><div class="list">${list.map((mod) => {
        const price = m.buyPrice(mod.id);
        const afford = p.credits >= price;
        return `<div class="item ${afford ? '' : 'locked'}" ${afford ? `data-do="buyMod" data-arg="${mod.id}"` : ''}>
          <span class="grow"><b>${esc(mod.name)}</b><span class="sub">${esc(mod.blurb)}</span></span>
          <span class="price">${cr(price)} CR</span></div>`;
      }).join('')}</div></div>`).join('')}</div>
      <div class="section"><h3>YOUR STORAGE</h3><div class="list">${owned.length ? owned.map(([id, n]) => `
        <div class="item"><span class="grow"><b>${esc(MODULES[id].name)}</b> <span class="qty">×${n}</span></span>
        <button class="hbtn" data-do="sellMod" data-arg="${id}">SELL ${cr(m.sellPrice(id))}</button></div>`).join('')
        : '<div class="item empty">NOTHING IN STORAGE</div>'}</div>
      <p class="note">Fit modules on the LOADOUT tab.</p></div></div>`;
  }

  servicesView() {
    const g = this.game, p = g.player;
    const rc = repairCost(p.ship);
    return `<div class="cols"><div class="section"><h3>SERVICES</h3><div class="list">
      <div class="item" data-do="repair"><span class="grow"><b>HULL REPAIR</b>
        <span class="sub">${rc > 0 ? `${Math.round(p.ship.stats.hullMax - p.ship.hull)} POINTS OF DAMAGE` : 'HULL INTACT'}</span></span>
        <span class="price">${rc > 0 ? `${cr(rc)} CR` : '—'}</span></div>
      <div class="item" data-do="fines"><span class="grow"><b>SETTLE BOUNTY</b>
        <span class="sub">${p.wanted > 0 ? 'CLEAR YOUR RECORD WITH HALCYON AUTHORITY' : 'RECORD IS CLEAN'}</span></span>
        <span class="price">${p.wanted > 0 ? `${cr(p.wanted * 1.5)} CR` : '—'}</span></div>
      <div class="item" data-do="save"><span class="grow"><b>SAVE FLIGHT LOG</b>
        <span class="sub">STORES CREDITS, HANGAR AND CARGO IN THIS BROWSER</span></span><span class="price">FREE</span></div>
      </div></div>
      <div class="section"><h3>DEPOT NOTICE</h3><p class="note">
      Halcyon Belt is a working field. Prospectors cut ore, haulers run it out, and the Marauder crews
      take whatever drifts. Disabled hulls are salvage under belt law — board them if you carry a rig.
      Shoot a licensed hull and the Authority will price your head accordingly.</p>
      ${this.statBlock(p.ship)}</div></div>`;
  }

  /* -------------------------------------------------------- boarding -- */

  renderBoarding() {
    const b = this.game.boarding;
    if (!b) return '';
    const t = b.target;
    if (b.stage === 'breach') {
      const pips = Array.from({ length: b.rounds }, (_, i) =>
        `<div class="pip ${i < b.round ? 'on' : ''}"></div>`).join('') +
        Array.from({ length: b.fails }, () => '<div class="pip bad"></div>').join('');
      return `<div class="screen"><header><h2>BREACHING ${esc(t.name)}</h2><div class="spacer"></div>
        <div class="meta">RIG <b>${b.rig > 1 ? 'ASSAULT' : 'BREACH'}</b></div>
        <button class="hbtn" data-do="endBoard">ABORT</button></header>
        <div class="body"><p class="note">Stop the cutter inside the seam. ${b.maxFails - b.fails} misfire${b.maxFails - b.fails === 1 ? '' : 's'} left
        before the collar blows.</p>
        <div class="breach"><div class="breachBar">
          <div class="breachZone" style="left:${b.zone0 * 100}%;width:${(b.zone1 - b.zone0) * 100}%"></div>
          <div class="breachMark" style="left:${b.marker * 100}%"></div>
        </div><div class="pips">${pips}</div></div>
        <div class="rowbtns"><button class="hbtn hot" data-do="strike" style="font-size:15px;padding:16px 40px">CUT</button></div>
        <div class="section"><h3>COLLAR LOG</h3><div class="list">${b.log.map((l) =>
          `<div class="item">${esc(l)}</div>`).join('')}</div></div>
        </div></div>`;
    }
    if (b.stage === 'loot') {
      const lines = b.manifest.filter((m) => m.qty > 0);
      return `<div class="screen"><header><h2>${esc(t.name)} — HOLD</h2><div class="spacer"></div>
        <div class="meta">FREE SPACE <b>${cargoFree(this.game.player.ship)}</b></div>
        <button class="hbtn" data-do="endBoard">DISENGAGE</button></header>
        <div class="body"><div class="cols"><div class="section"><h3>MANIFEST</h3><div class="list">
        ${lines.length ? lines.map((l) => `<div class="item" data-do="loot" data-arg="${l.id}">
          <span class="grow"><b>${esc(ITEMS[l.id]?.name || l.id)}</b> <span class="qty">×${l.qty}</span>
          <span class="sub">${cr((ITEMS[l.id]?.price || 0) * l.qty)} CR AT MARKET</span></span>
          <span class="price">TAKE</span></div>`).join('') : '<div class="item empty">HOLD STRIPPED</div>'}
        ${!b.cashTaken && b.cash > 0 ? `<div class="item" data-do="lootCash">
          <span class="grow"><b>SHIP'S SAFE</b><span class="sub">LOOSE CREDITS</span></span>
          <span class="price">${cr(b.cash)} CR</span></div>` : ''}
        </div><div class="rowbtns"><button class="hbtn" data-do="lootAll">TAKE EVERYTHING</button>
        ${b.claimable ? '<button class="hbtn hot" data-do="claim">CLAIM THE HULL</button>' : ''}</div></div>
        <div class="section"><h3>BOARDING LOG</h3><div class="list">${b.log.map((l) =>
          `<div class="item">${esc(l)}</div>`).join('')}</div>
        <p class="note">A clean breach lets your crew rewrite the registry — a hull claim halves the price
        of that class at any shipyard.</p></div></div></div></div>`;
    }
    return `<div class="screen"><header><h2>BOARDING COMPLETE</h2><div class="spacer"></div>
      <button class="hbtn" data-do="endBoard">RETURN TO FLIGHT</button></header>
      <div class="body"><p class="big">${esc(b.result?.msg || '')}</p></div></div>`;
  }

  /* ------------------------------------------------------------ menus -- */

  renderMenu() {
    const touch = document.body.classList.contains('touch');
    return `<div class="screen"><header><h2>FLIGHT MANUAL</h2><div class="spacer"></div>
      <button class="hbtn" data-do="close">RESUME</button></header>
      <div class="body"><div class="cols">
      <div class="section"><h3>CONTROLS — ${touch ? 'TOUCH' : 'KEYBOARD'}</h3><div class="list">${(touch ? [
        ['LEFT BAR', 'Throttle. Up is forward, below centre is reverse. Double-tap to cut to zero.'],
        ['RIGHT SIDE', 'Steering stick — touch anywhere on the right to place it.'],
        ['FIRE', 'Fires the mount you are manning.'],
        ['MODE', 'Switch between piloting and the gunner seat.'],
        ['TGT', 'Cycle contacts. ACT docks, boards, or scoops.'],
        ['INV', 'Inventory, loadout and ship record.'],
      ] : [
        ['W / S', 'Throttle up and down · X cuts to zero · wheel trims'],
        ['MOUSE', 'Steer (click to capture the pointer) · A/D and arrows also steer'],
        ['Q / E', 'Roll'],
        ['SPACE / CLICK', 'Fire the manned mount'],
        ['R', 'Toggle pilot / gunner seat'],
        ['T', 'Cycle target · F to dock or board'],
        ['TAB', 'Inventory and loadout · 1-6 change which mount you man'],
        ['G', 'Flight assist · M this manual'],
      ]).map(([k, v]) => `<div class="item"><span class="grow"><b>${k}</b><span class="sub">${v}</span></span></div>`).join('')}</div></div>
      <div class="section"><h3>THE BELT</h3>
      <p class="note">Through the jump gate is <b>Cinder Reach</b>: a graveyard of adrift hulls,
      twice the pirates and no Authority. Board a hull for its hold; fit a <b>salvage cutter</b>
      and you can cut the hull itself apart for scrap and its fittings, which come out whole and
      go straight to your storage. Tallow Yard pays over the odds for both.</p>
      <p class="note">Graphics: <b>${this.game.renderer.backend.toUpperCase()}</b> at
      ${this.game.renderer.width}×${this.game.renderer.height}
      (${Math.round((this.game.renderer.resScale || 1) * 100)}% scale)${this.game.fps ? `, ${Math.round(this.game.fps)} fps` : ''}.
      Seeing black rectangles over the view? Try <b>SIMPLE HUD</b> below, and try loading the game with
      <b>?gfx=webgl</b> on the end of the address — that forces the fallback renderer and tells us
      which of the two is at fault.</p>
      <p class="note">
        You start in a Vex Shuttle with one gun and a mining laser in storage. Fit the laser, cut ore out of
        the rocks, and sell it at Halcyon Depot. Bigger hulls carry more mounts than you have hands —
        buy auto-turrets so the rest of the ship fights while you fly. Ion weapons leave a hull adrift
        instead of scattering it; with a breaching rig you can board what drifts.
      </p>
      ${this.installHint()}
      <p class="note">${this.saveLine()}</p>
      <div class="rowbtns">
        <button class="hbtn" data-do="assist">FLIGHT ASSIST: ${this.game.player.assist ? 'ON' : 'OFF'}</button>
        <button class="hbtn" data-do="crt">CRT FILTER</button>
        <button class="hbtn" data-do="flat">SIMPLE HUD: ${document.body.classList.contains('flat') ? 'ON' : 'OFF'}</button>
        <button class="hbtn" data-do="save">SAVE NOW</button>
        <button class="hbtn" data-do="reload">RELOAD LAST SAVE</button>
        <button class="hbtn" data-do="newgame">NEW GAME</button>
      </div></div></div></div></div>`;
  }

  /** When the flight log was last written, in plain words. */
  saveLine() {
    const t = this.game.player.lastSaved;
    if (!t) return 'Not saved yet. The game also saves itself every 30 seconds, when you dock, and whenever you leave the page.';
    const secs = Math.round((Date.now() - t) / 1000);
    const when = secs < 5 ? 'just now' : secs < 90 ? `${secs} seconds ago`
      : `${Math.round(secs / 60)} minutes ago`;
    return `Flight log saved ${when}. It also saves itself every 30 seconds, when you dock, and whenever you leave the page.`;
  }

  /** Home-screen install nudge — iOS needs the manual Share-sheet route. */
  installHint() {
    const m = this.game.mobile;
    if (!m || m.standalone) return '';
    if (m.isIOS) {
      return `<p class="note">Install it: tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>.
        It runs fullscreen and offline from there.</p>`;
    }
    if (m.installEvent) {
      return '<p class="note">Tap <b>INSTALL</b> on the flight deck to add STARQUEST to your home screen — it runs offline.</p>';
    }
    return '';
  }

  renderDead() {
    const p = this.game.player;
    return `<div class="screen"><header><h2>HULL LOST</h2><div class="spacer"></div></header>
      <div class="body"><p class="big">YOUR SHIP CAME APART</p>
      <p class="note">Halcyon Authority recovered your pod. The insurers replaced the hull and kept the
      cargo — and their fee.</p>
      <div class="list">${[
        ['KILLS', p.stats.kills], ['ROCKS CRACKED', p.stats.rocks],
        ['HULLS BOARDED', p.stats.boarded], ['CREDITS', cr(p.credits)],
      ].map(([k, v]) => `<div class="item"><span class="grow">${k}</span><span class="price">${v}</span></div>`).join('')}</div>
      <div class="rowbtns"><button class="hbtn hot" data-do="respawn">RESPAWN AT DEPOT</button>
      <button class="hbtn" data-do="newgame">NEW GAME</button></div></div></div>`;
  }
}
