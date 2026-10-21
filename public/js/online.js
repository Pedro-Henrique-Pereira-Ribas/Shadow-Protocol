// Cliente do Modo Online: WebSocket, interpolacao, loja e radar.
import { Game } from './game.js';
import {
  WEAPONS, EQUIP, MODES, MAX_HEALTH, MAX_ARMOR, MAX_MONEY, CELL, INTERP_DELAY, PROTOCOL,
} from '/shared/constants.js';
import { TILE, tileAt } from '/shared/maps.js';
import { clamp, lerp, angDiff, fmtTime } from './util.js';

export class OnlineGame extends Game {
  constructor(map, opts = {}) {
    super(map, { loadout: ['pistola'], team: opts.team || 'CT' });
    this.mode = 'online';
    this.ws = null;
    this.myId = null;
    this.room = opts.room || null;
    this.remotes = new Map();      // id -> { cur, prev, next, ts }
    this.serverPlayers = new Map();
    this.phase = 'lobby';
    this.timeLeft = 0;
    this.scores = { T: 0, CT: 0 };
    this.bomb = { state: 'none', x: 0, y: 0 };
    this.killfeed = [];
    this.chat = [];
    this.money = 800;
    this.buyOpen = false;
    this.errorMsg = null;
    this.onEvent = opts.onEvent || null;
    this.onKillfeed = opts.onKillfeed || null;
    this.onChat = opts.onChat || null;
    this.name = opts.name || 'Jogador';
    this.lastSend = 0;
    this.reconciled = { x: 0, y: 0, init: false };
    this.matchResult = null;
    this.connected = false;
  }

  // ---------------- conexao ----------------
  connect(code, name) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      const timeout = setTimeout(() => { reject(new Error('Tempo esgotado ao conectar.')); }, 8000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'join', code, name, p: PROTOCOL }));
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'joined') {
          clearTimeout(timeout);
          this.myId = msg.you;
          this.room = msg.room;
          this.phase = msg.phase;
          this.scores = msg.scores || { T: 0, CT: 0 };
          this.money = msg.me?.money ?? 800;
          this.player.team = msg.me?.team || 'CT';
          this.connected = true;
          for (const p of msg.players || []) {
            if (p.id === this.myId) continue;
            this.remotes.set(p.id, {
              id: p.id, name: p.n, team: p.t,
              cur: { x: 0, y: 0, a: 0 }, prev: { x: 0, y: 0, a: 0 }, next: { x: 0, y: 0, a: 0 },
              ts: performance.now(), hp: 100, armor: 0, weapon: 'pistola',
              alive: true, crouched: false, kills: p.k || 0, deaths: p.d || 0, score: p.s || 0,
            });
          }
          this.onEvent?.({ kind: 'joined', room: msg.room });
          resolve(msg);
          return;
        }
        this.handleMessage(msg);
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('Falha na conexao com o servidor.')); };
      ws.onclose = (ev) => {
        this.connected = false;
        clearTimeout(timeout);
        if (ev.code === 4001) {
          this.onEvent?.({ kind: 'noaccount' });
          reject(new Error('É obrigatorio ter conta para jogar online.'));
        } else if (!this.closedByUs) {
          this.onEvent?.({ kind: 'disconnected' });
        }
      };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closedByUs = true;
    if (this.ws) { try { this.ws.send(JSON.stringify({ t: 'leave' })); } catch { /* ignore */ } }
    if (this.ws) this.ws.close();
  }

  // ---------------- mensagens ----------------
  handleMessage(msg) {
    switch (msg.t) {
      case 'snap': {
        this.phase = msg.ph;
        this.timeLeft = (msg.tl || 0) * 1000;
        this.scores = msg.sc || this.scores;
        if (msg.mb) this.bomb.state = msg.mb;
        if (msg.mb === 'planted' && this.bomb.state !== 'planted') {
          this.bomb.state = 'planted';
          this.bombTimer = (msg.bt || 0) * 1000;
        }
        this.applySnapshot(msg.p || []);
        break;
      }
      case 'shot': {
        this.addEffect({
          kind: 'tracer', x0: msg.x, y0: msg.y,
          x1: msg.x + Math.cos(msg.a) * 420, y1: msg.y + Math.sin(msg.a) * 420,
          life: 0.07, weapon: msg.w, remote: true,
        });
        if (msg.id === this.myId) this.onOwnShot?.(msg);
        break;
      }
      case 'hit': {
        if (msg.fr === this.myId) {
          this.hitMarker = 1;
          this.onHitConfirm?.(msg);
        } else {
          this.damageFlash = Math.min(0.5, this.damageFlash + (msg.d || 0) / 80);
        }
        this.player.hp = msg.hp;
        this.player.armor = msg.ar;
        break;
      }
      case 'kill': {
        const entry = {
          killer: msg.k?.n || 'Mundo',
          killerTeam: msg.k?.t || null,
          victim: msg.v?.n || 'Alguem',
          victimTeam: msg.v?.t || null,
          weapon: msg.w, head: msg.hs,
        };
        this.killfeed.unshift(entry);
        if (this.killfeed.length > 6) this.killfeed.pop();
        this.onKillfeed?.(entry);
        if (msg.v?.id === this.myId) { this.player.alive = false; this.onDeath?.(); }
        break;
      }
      case 'respawn': {
        this.player.alive = true;
        this.player.hp = msg.hp;
        this.player.x = msg.x; this.player.y = msg.y;
        this.reconciled = { x: msg.x, y: msg.y, init: true };
        break;
      }
      case 'buy': {
        this.money = msg.money;
        if (msg.item === 'colete') this.player.armor = EQUIP.colete.armor;
        else if (WEAPONS[msg.item]) {
          this.player.addWeapon(msg.item);
          this.player.selectSlot(this.player.slots.indexOf(msg.item));
        } else if (msg.item === 'kit') this.player.hasKit = true;
        this.onEvent?.({ kind: 'bought', item: msg.item });
        break;
      }
      case 'weapon': { this.player.selectSlot(this.player.slots.indexOf(msg.w)); break; }
      case 'reloaded': {
        if (this.player.weapon === msg.w) {
          this.player.ammo[msg.w] = msg.ammo;
          this.player.reserve[msg.w] = msg.reserve;
        }
        break;
      }
      case 'dryfire': this.onDryFire?.(); break;
      case 'err': this.errorMsg = msg.msg; this.onEvent?.({ kind: 'err', msg: msg.msg }); break;
      case 'chat': this.chat.push(msg); this.onChat?.(msg); break;
      case 'roundstart': this.phase = msg.phase; this.timeLeft = (msg.tl || 0) * 1000; break;
      case 'phase': this.phase = msg.phase; this.timeLeft = (msg.tl || 0) * 1000; break;
      case 'roundend': {
        this.scores = msg.scores || this.scores;
        this.onEvent?.({ kind: 'roundend', winner: msg.winner, scores: this.scores });
        break;
      }
      case 'matchend': {
        this.matchResult = msg;
        this.onEvent?.({ kind: 'matchend', msg });
        break;
      }
      case 'event': {
        if (msg.kind === 'planted') { this.bomb.state = 'planted'; this.bomb.x = msg.x; this.bomb.y = msg.y; }
        if (msg.kind === 'defused' || msg.kind === 'exploded') this.bomb.state = msg.kind;
        this.onEvent?.({ kind: msg.kind, id: msg.id });
        break;
      }
      case 'leave': {
        this.remotes.delete(msg.id);
        break;
      }
      case 'joinnotice': {
        this.onEvent?.({ kind: 'joinnotice', name: msg.n });
        break;
      }
      default: break;
    }
  }

  applySnapshot(list) {
    const now = performance.now();
    for (const p of list) {
      if (p.id === this.myId) {
        // reconciliacao suave com o servidor
        const d = Math.hypot(p.x - this.player.x, p.y - this.player.y);
        if (!this.reconciled.init) { this.reconciled = { x: p.x, y: p.y, init: true }; }
        else if (d > 90) {
          this.player.x = p.x; this.player.y = p.y;
          this.reconciled = { x: p.x, y: p.y, init: true };
        }
        this.player.hp = p.hp; this.player.armor = p.ar;
        this.player.kills = p.k; this.player.deaths = p.d; this.player.score = p.s;
        this.money = Math.max(this.money, 0);
        this.hasBomb = !!p.hb; this.hasKit = !!p.hk;
        continue;
      }
      let r = this.remotes.get(p.id);
      if (!r) {
        r = {
          id: p.id, name: p.n, team: p.t,
          cur: { x: p.x, y: p.y, a: p.a }, prev: { x: p.x, y: p.y, a: p.a }, next: { x: p.x, y: p.y, a: p.a },
          ts: now, hp: 100, armor: 0, weapon: 'pistola', alive: true, crouched: false,
          kills: p.k || 0, deaths: p.d || 0, score: p.s || 0,
        };
        this.remotes.set(p.id, r);
      }
      r.prev = r.next;
      r.next = { x: p.x, y: p.y, a: p.a };
      r.ts = now;
      r.hp = p.hp; r.armor = p.ar; r.weapon = p.w;
      r.alive = !!p.al; r.crouched = !!p.cr;
      r.name = p.n; r.team = p.t;
      r.kills = p.k; r.deaths = p.d; r.score = p.s;
    }
    // remove jogadores que sumiram
    const ids = new Set(list.map((p) => p.id));
    for (const id of [...this.remotes.keys()]) if (!ids.has(id)) this.remotes.delete(id);
  }

  // ---------------- loop ----------------
  update(dt, input) {
    const p = this.player;
    p.crouched = input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC');
    p.walking = input.down('ShiftLeft') || input.down('ShiftRight');
    p.update(dt, input, this);

    if (input.hit('KeyR')) {
      if (p.startReload()) { this.send({ t: 'reload' }); this.onReloadStart?.(); }
    }
    if (input.hit('Digit1')) this.switchWeapon(0);
    if (input.hit('Digit2')) this.switchWeapon(1);
    if (input.hit('Digit3')) this.switchWeapon(2);
    if (input.hit('Digit4')) this.switchWeapon(3);
    if (input.hit('KeyB')) this.toggleBuy();

    // tiro
    const wpn = p.weaponDef;
    if (wpn && wpn.mag) {
      const wantFire = wpn.auto ? input.mouseDown : input.mouseClicked;
      if (wantFire && p.canFire()) {
        p.consumeShot();
        this.send({ t: 'shoot', a: p.angle });
        this.addEffect({
          kind: 'tracer', x0: p.x, y0: p.y,
          x1: p.x + Math.cos(p.angle) * 500, y1: p.y + Math.sin(p.angle) * 500,
          life: 0.06, weapon: p.weapon,
        });
      } else if (wantFire && (p.ammo[p.weapon] || 0) <= 0 && !p.reloading) {
        if (this.time - (this._dryAt || 0) > 0.5) { this._dryAt = this.time; this.onDryFire?.(); }
      }
    }

    // interpolar remotos
    this.interpolateRemotes();

    // envio de posicao
    const t = performance.now();
    if (t - this.lastSend > 33) {
      this.lastSend = t;
      this.send({ t: 'pos', x: p.x, y: p.y, a: p.angle, cr: p.crouched, wk: p.walking, ping: 0 });
    }

    this.updateCommon(dt);
    this.updateEffects(dt);
  }

  interpolateRemotes() {
    const renderTime = performance.now() - INTERP_DELAY * 1000;
    for (const r of this.remotes.values()) {
      const span = Math.max(1, r.ts - (r.prevTs || 0));
      const target = r.ts - INTERP_DELAY * 1000;
      let t = (target - (r.prevTs || r.ts - span)) / span;
      t = clamp(t, 0, 1.6);
      r.cur.x = lerp(r.prev.x, r.next.x, t);
      r.cur.y = lerp(r.prev.y, r.next.y, t);
      let da = angDiff(r.prev.a, r.next.a);
      r.cur.a = r.prev.a + da * clamp(t, 0, 1.6);
      r.prevTs = r.ts;
    }
  }

  switchWeapon(i) {
    const w = this.player.slots[i];
    if (!w) return;
    this.player.selectSlot(i);
    this.send({ t: 'switch', w });
  }

  toggleBuy() {
    const mode = MODES[this.room?.mode || 'tdm'];
    if (mode.respawn) {
      this.onEvent?.({ kind: 'err', msg: 'Loja apenas no modo Competitivo.' });
      return;
    }
    this.buyOpen = !this.buyOpen;
  }

  buy(item) {
    this.send({ t: 'buy', w: item });
    this.buyOpen = false;
  }

  addEffect(fx) {
    this.effects.push(fx);
    if (this.effects.length > 120) this.effects.shift();
  }

  updateEffects(dt) {
    for (const fx of this.effects) fx.life -= dt;
    this.effects = this.effects.filter((f) => f.life > 0);
  }

  collectSprites() {
    const list = [];
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      list.push({
        kind: 'soldier', x: r.cur.x, y: r.cur.y, h: 1.75,
        team: r.team, hp: r.hp, name: r.name, crouched: r.crouched,
      });
    }
    if (this.bomb.state === 'planted') {
      list.push({ kind: 'bomb', x: this.bomb.x, y: this.bomb.y, h: 0.7, team: 'T' });
    }
    return list;
  }

  get objectiveText() {
    const mode = MODES[this.room?.mode || 'tdm'];
    if (this.phase === 'buy') return 'Fase de compra - prepare-se';
    if (this.phase === 'end') return 'Fim da partida';
    if (mode.teams) {
      const mine = this.player.team === 'T' ? this.scores.T : this.scores.CT;
      const foe = this.player.team === 'T' ? this.scores.CT : this.scores.T;
      return `${this.player.team} ${mine} x ${foe} ${this.player.team === 'T' ? 'CT' : 'T'} - ${mode.scoreLimit} para vencer`;
    }
    return `${this.player.kills} / ${mode.scoreLimit} abates`;
  }
}
