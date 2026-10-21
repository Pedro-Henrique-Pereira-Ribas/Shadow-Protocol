// HUD: vida, colete, municao, dinheiro, killfeed, radar, loja e mensagens.
import { WEAPONS, MODES, EQUIP, CELL, MAX_HEALTH } from '/shared/constants.js';
import { TILE, tileAt, hasLineOfSight } from '/shared/maps.js';
import { $, escapeHtml, fmtTime, formatMoney } from './util.js';

export class Hud {
  constructor(theme = 'dark') {
    this.theme = theme;
    this.el = {
      root: $('#hud'),
      hpFill: $('#hpFill'), hpVal: $('#hpVal'),
      arFill: $('#arFill'), arVal: $('#arVal'),
      ammoMag: $('#ammoMag'), ammoRes: $('#ammoRes'),
      weapon: $('#hudWeapon'), slots: $('#hudSlots'),
      money: $('#hudMoney'), timer: $('#hudTimer'),
      score: $('#hudScore'), score2: $('#hudScore2'),
      objective: $('#hudObjective'), killfeed: $('#hudKillfeed'),
      msg: $('#hudMsg'), buy: $('#buyMenu'), radar: $('#radar'),
    };
    this.rctx = this.el.radar.getContext('2d');
    this.msgTimer = 0;
    this.radarZoom = 5;
  }

  show(on) { this.el.root.classList.toggle('hidden', !on); }

  update(game) {
    const p = game.player;
    const hp = Math.max(0, Math.round(p.hp));
    this.el.hpFill.style.width = `${hp}%`;
    this.el.hpFill.classList.toggle('low', hp <= 30);
    this.el.hpVal.textContent = hp;
    const ar = Math.max(0, Math.round(p.armor));
    this.el.arFill.style.width = `${ar}%`;
    this.el.arVal.textContent = ar;

    const wpn = p.weaponDef;
    this.el.ammoMag.textContent = p.ammo[p.weapon] ?? 0;
    this.el.ammoRes.textContent = p.reserve[p.weapon] ?? 0;
    this.el.weapon.textContent = (wpn?.name || '—').toUpperCase();

    this.el.slots.innerHTML = p.slots.map((s, i) => {
      const d = WEAPONS[s];
      return `<span class="slot ${i === p.slotIndex ? 'active' : ''}">${i + 1} ${d ? d.name : s}</span>`;
    }).join('');

    if (game.mode === 'online') {
      this.el.money.textContent = formatMoney(game.money);
      this.el.money.style.display = '';
    } else {
      this.el.money.style.display = 'none';
    }

    // tempo / placar
    if (game.mode === 'online') {
      const mode = MODES[game.room?.mode || 'tdm'];
      const t = game.timeLeft;
      this.el.timer.textContent = fmtTime(t);
      this.el.timer.style.color = t < 10000 && t > 0 ? '#e0503c' : '#e8f1ea';
      if (mode.teams) {
        this.el.score.textContent = game.scores.T ?? 0;
        this.el.score.className = 'hud-score';
        this.el.score2.textContent = game.scores.CT ?? 0;
        this.el.score2.className = 'hud-score right';
      } else {
        this.el.score.textContent = `${p.kills}`;
        this.el.score.className = 'hud-score';
        this.el.score2.textContent = '/ ' + mode.scoreLimit;
        this.el.score2.className = 'hud-score right';
      }
    } else {
      this.el.timer.textContent = fmtTime(game.timeTaken ? (performance.now() - game.startTime) : (performance.now() - game.startTime));
      this.el.score.textContent = '';
      this.el.score2.textContent = '';
    }

    // objetivo
    const obj = game.objectiveText || '';
    this.el.objective.innerHTML = obj ? `<b>OBJETIVO</b>${escapeHtml(obj)}` : '';
  }

  renderKillfeed(entries) {
    this.el.killfeed.innerHTML = entries.map((e) => {
      const killerCls = e.killerTeam === 'T' ? 't' : 'ct';
      const victimCls = e.victimTeam === 'T' ? 't' : 'ct';
      return `<div class="kf-row">
        <span class="who ${killerCls}">${escapeHtml(e.killer)}</span>
        <span class="what">${e.head ? 'HEADSHOT' : 'eliminou'}</span>
        <span class="who ${victimCls}">${escapeHtml(e.victim)}</span>
      </div>`;
    }).join('');
  }

  message(text, sub = '', duration = 2200) {
    this.el.msg.innerHTML = `${escapeHtml(text)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    this.el.msg.classList.add('show');
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => this.el.msg.classList.remove('show'), duration);
  }

  // ---------------- Radar ----------------
  drawRadar(game) {
    const ctx = this.rctx;
    const size = this.el.radar.width;
    const map = game.map;
    const p = game.player;
    const scale = this.radarZoom;
    const light = this.theme === 'light';

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = light ? 'rgba(255,255,255,.80)' : 'rgba(3,8,5,.88)';
    ctx.fillRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2;
    const rot = -p.angle;

    // celulas do mapa
    const view = Math.ceil(size / 2 / scale) + 2;
    const pcx = Math.floor(p.x / CELL), pcy = Math.floor(p.y / CELL);
    for (let dy = -view; dy <= view; dy++) {
      for (let dx = -view; dx <= view; dx++) {
        const gx = pcx + dx, gy = pcy + dy;
        if (gx < 0 || gy < 0 || gx >= map.w || gy >= map.h) continue;
        const t = tileAt(map, gx, gy);
        if (t === TILE.FLOOR) continue;
        const wx = (gx + 0.5) * CELL - p.x;
        const wy = (gy + 0.5) * CELL - p.y;
        const rx = wx * Math.cos(rot) - wy * Math.sin(rot);
        const ry = wx * Math.sin(rot) + wy * Math.cos(rot);
        const sx = cx + rx * scale, sy = cy + ry * scale;
        ctx.fillStyle = t === TILE.LOW
          ? (light ? '#7fb894' : '#2f8f4e')
          : (light ? '#2f7a4a' : '#1c5c33');
        ctx.fillRect(sx - scale / 2, sy - scale / 2, scale, scale);
      }
    }

    // sites
    if (game.mode === 'online') {
      for (const key of ['A', 'B']) {
        const s = map.sites[key];
        const wx = (s.x + 0.5) * CELL - p.x, wy = (s.y + 0.5) * CELL - p.y;
        const rx = wx * Math.cos(rot) - wy * Math.sin(rot);
        const ry = wx * Math.sin(rot) + wy * Math.cos(rot);
        const sx = cx + rx * scale, sy = cy + ry * scale;
        ctx.strokeStyle = 'rgba(232,177,61,.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(232,177,61,.9)';
        ctx.font = '9px monospace';
        ctx.fillText(key, sx - 3, sy + 3);
      }
    }

    // aliados / inimigos visiveis
    const dots = [];
    if (game.mode === 'online') {
      for (const r of game.remotes.values()) {
        if (!r.alive) continue;
        const visible = r.team === p.team || hasLineOfSight(map, p.x, p.y, r.cur.x, r.cur.y, false);
        dots.push({ x: r.cur.x, y: r.cur.y, color: r.team === p.team ? '#4fd98a' : '#e0503c', visible, enemy: r.team !== p.team });
      }
    } else {
      for (const e of game.enemies) {
        if (!e.alive) continue;
        const visible = hasLineOfSight(map, p.x, p.y, e.x, e.y, false);
        dots.push({ x: e.x, y: e.y, color: '#e0503c', visible, enemy: true });
      }
    }

    for (const d of dots) {
      if (!d.visible) continue;
      const wx = d.x - p.x, wy = d.y - p.y;
      const rx = wx * Math.cos(rot) - wy * Math.sin(rot);
      const ry = wx * Math.sin(rot) + wy * Math.cos(rot);
      const sx = cx + rx * scale, sy = cy + ry * scale;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(sx, sy, d.enemy ? 3.5 : 3, 0, Math.PI * 2); ctx.fill();
      if (d.enemy) {
        ctx.strokeStyle = d.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // bomba
    if (game.mode === 'online' && game.bomb?.state === 'planted') {
      const wx = game.bomb.x - p.x, wy = game.bomb.y - p.y;
      const rx = wx * Math.cos(rot) - wy * Math.sin(rot);
      const ry = wx * Math.sin(rot) + wy * Math.cos(rot);
      const sx = cx + rx * scale, sy = cy + ry * scale;
      ctx.fillStyle = '#e8b13d';
      ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
    }

    // jogador
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.angle);
    ctx.fillStyle = light ? '#0a1a10' : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(-4, -4.5); ctx.lineTo(-2, 0); ctx.lineTo(-4, 4.5);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // moldura
    ctx.strokeStyle = light ? 'rgba(16,70,42,.45)' : 'rgba(79,217,138,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(.5, .5, size - 1, size - 1);
  }

  // ---------------- Loja ----------------
  renderBuy(game) {
    const el = this.el.buy;
    if (!game.buyOpen) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const money = game.money;
    const items = [
      { id: 'pistola', label: 'Pistola', price: 0 },
      { id: 'smg', label: 'Submetralhadora', price: WEAPONS.smg.price },
      { id: 'escopeta', label: 'Escopeta', price: WEAPONS.escopeta.price },
      { id: 'fuzil', label: 'Fuzil A', price: WEAPONS.fuzil.price },
      { id: 'fuzil4', label: 'Fuzil B', price: WEAPONS.fuzil4.price },
      { id: 'pesado', label: 'Metralhadora', price: WEAPONS.pesado.price },
      { id: 'sniper', label: 'Sniper', price: WEAPONS.sniper.price },
      { id: 'armor', label: 'Colete', price: EQUIP.colete.price },
      { id: 'kit', label: 'Kit de desarme', price: EQUIP.kit.price },
    ];
    el.innerHTML = `
      <h3>LOJA &mdash; ${formatMoney(money)} &nbsp;|&nbsp; B para fechar</h3>
      <div class="buy-cols">
        ${items.map((i) => `
          <div class="buy-item ${money < i.price ? 'cant' : ''}" data-buy="${i.id}">
            <span>${i.label}</span><span class="price">${i.price ? formatMoney(i.price) : 'GRATIS'}</span>
          </div>`).join('')}
      </div>
      <div class="buy-close">Clique para comprar &middot; teclas 1/2/3 trocam de arma</div>`;
    el.querySelectorAll('[data-buy]').forEach((n) => {
      n.onclick = () => game.buy(n.dataset.buy);
    });
  }
}
