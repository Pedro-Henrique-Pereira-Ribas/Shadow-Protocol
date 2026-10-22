// Nucleo do jogo: jogador local, movimento, armas e colisao.
import {
  CELL, PLAYER_RADIUS, RUN_SPEED, WALK_SPEED, CROUCH_SPEED, MAX_HEALTH, MAX_ARMOR,
  WEAPONS, EYE_STAND, EYE_CROUCH, PITCH_LIMIT, PITCH_SENSITIVITY,
  ENEMY_HEIGHT, ENEMY_HEIGHT_CROUCH, HEADSHOT_ZONE,
} from '/shared/constants.js';
import { moveCircle, raycast, raycast3D, lowBlocksFor, TILE, shotHeightAt } from '/shared/maps.js';
import { clamp, rand, randInt } from './util.js';

export class LocalPlayer {
  constructor(map, opts = {}) {
    this.map = map;
    this.x = 0; this.y = 0;
    this.angle = 0;
    this.pitch = 0;              // inclinacao vertical da mira (radianos)
    this.vx = 0; this.vy = 0;
    this.hp = MAX_HEALTH;
    this.armor = opts.armor || 0;
    this.money = opts.money ?? 800;
    this.crouched = false;
    this.walking = false;
    this.alive = true;
    this.team = opts.team || 'CT';

    this.slots = (opts.loadout && opts.loadout.length ? opts.loadout : ['pistola']).slice(0, 4);
    this.slotIndex = 0;
    this.ammo = {}; this.reserve = {};
    for (const w of this.slots) {
      this.ammo[w] = WEAPONS[w] ? WEAPONS[w].mag : 0;
      this.reserve[w] = WEAPONS[w] ? WEAPONS[w].reserve : 0;
    }
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.lastShot = -9999;
    this.recoil = 0;
    this.bob = 0;
    this.stepDist = 0;
    this.kills = 0; this.deaths = 0; this.damage = 0;
    this.score = 0;
    this.hasBomb = false;
    this.hasKit = false;
    this.grenades = 0;
  }

  get weapon() { return this.slots[this.slotIndex]; }
  get weaponDef() { return WEAPONS[this.weapon]; }
  get eye() { return this.crouched ? EYE_CROUCH : EYE_STAND; }

  addWeapon(id) {
    if (!WEAPONS[id]) return;
    if (!this.slots.includes(id)) {
      if (this.slots.length >= 4) this.slots[this.slotIndex] = id;
      else this.slots.push(id);
    }
    this.ammo[id] = WEAPONS[id].mag;
    this.reserve[id] = WEAPONS[id].reserve;
  }

  giveAmmo(id, rounds) {
    if (!this.reserve[id]) return;
    this.reserve[id] = Math.min(WEAPONS[id].reserve, this.reserve[id] + rounds);
  }

  selectSlot(i) {
    if (i < 0 || i >= this.slots.length) return;
    if (i === this.slotIndex) return;
    this.slotIndex = i;
    this.reloading = false;
  }

  cycleSlot(dir) {
    const n = this.slots.length;
    this.selectSlot((this.slotIndex + dir + n) % n);
  }

  startReload() {
    const w = this.weaponDef;
    if (!w || !w.mag) return false;
    if (this.reloading) return false;
    if ((this.ammo[this.weapon] || 0) >= w.mag) return false;
    if ((this.reserve[this.weapon] || 0) <= 0) return false;
    this.reloading = true;
    this.reloadTimer = w.reload / 1000;
    return true;
  }

  finishReload() {
    const w = this.weaponDef;
    if (!w) return;
    const need = w.mag - (this.ammo[this.weapon] || 0);
    const take = Math.min(need, this.reserve[this.weapon] || 0);
    this.ammo[this.weapon] += take;
    this.reserve[this.weapon] -= take;
    this.reloading = false;
  }

  // ---------------- Atualizacao por frame ----------------
  update(dt, input, game) {
    if (!this.alive) return;

    // cadencia de tiro e recarregamento baseadas no tempo de jogo
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.finishReload();
        game.onReloadEnd?.();
      }
    }

    // mira horizontal e vertical
    const dx = input.consumeMouse();
    if (dx) this.angle += dx * input.sensitivity;
    const dy = input.consumeMouseY();
    if (dy) this.pitch = clamp(this.pitch - dy * PITCH_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);

    // troca de arma
    const w = input.consumeWheel();
    if (w) this.cycleSlot(w > 0 ? 1 : -1);

    // movimento
    const ax = input.axis();
    const wpn = this.weaponDef;
    let speed = this.crouched ? CROUCH_SPEED : (this.walking ? WALK_SPEED : RUN_SPEED);
    if (wpn && wpn.moveMul) speed *= wpn.moveMul;

    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    const sx = -fy, sy = fx;
    // axis.y negativo = frente (W), axis.x positivo = direita (D)
    const mx = (ax.x * sx - ax.y * fx);
    const my = (ax.x * sy - ax.y * fy);

    const k = 1 - Math.exp(-14 * dt);
    this.vx += (mx * speed - this.vx) * k;
    this.vy += (my * speed - this.vy) * k;
    if (!ax.x && !ax.y) {
      const f = Math.exp(-9 * dt);
      this.vx *= f; this.vy *= f;
    }

    const moved = moveCircle(this.map, this.x, this.y, this.vx * dt, this.vy * dt, PLAYER_RADIUS);
    const realDx = moved.x - this.x, realDy = moved.y - this.y;
    this.x = moved.x; this.y = moved.y;

    // passos + bob
    const step = Math.hypot(realDx, realDy);
    this.stepDist += step;
    this.bob += step * 0.06;
    if (this.stepDist > 1.5) { this.stepDist = 0; game.onStep?.(); }

    // recarregamento
    if (this.reloading && this.reloadTimer <= 0) {
      this.finishReload();
      game.onReloadEnd?.();
    }

    // recuo decai
    this.recoil = Math.max(0, this.recoil - dt * 6);
  }

  // ---------------- Tiro ----------------
  canFire() {
    const w = this.weaponDef;
    if (!w || !w.mag) return false;
    if (this.reloading) return false;
    if (this.cooldown > 0) return false;
    if ((this.ammo[this.weapon] || 0) <= 0) return false;
    return true;
  }

  consumeShot() {
    const w = this.weaponDef;
    this.ammo[this.weapon]--;
    this.cooldown = 60 / w.rpm;
    this.lastShot = performance.now();
    this.recoil = Math.min(1.4, this.recoil + (w.recoil || 1) * 0.32);
  }
}

// ---------------- Base do jogo ----------------
export class Game {
  constructor(map, opts = {}) {
    this.map = map;
    this.player = new LocalPlayer(map, opts);
    this.enemies = [];
    this.items = [];
    this.effects = [];
    this.damageFlash = 0;
    this.flash = 0;
    this.hitMarker = 0;
    this.crosshairSpread = 0;
    this.hideCrosshair = false;
    this.time = 0;
    this.dead = false;
    this.mode = 'story';
    this.messages = [];
    this.running = false;
  }

  // ---------- helpers de tiro (historia) ----------
  traceShot(angle, spreadMul = 1, pitchOverride = null) {
    const p = this.player;
    const w = p.weaponDef;
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    const pitch = pitchOverride === null ? (p.pitch || 0) : pitchOverride;
    const eye = p.eye;
    // parede considering a altura do tiro (pode passar por cima da cobertura baixa)
    const wall = raycast3D(this.map, p.x, p.y, dirX, dirY, w.range, eye, pitch);
    let maxDist = wall.hit ? wall.dist : w.range;

    let best = null, bestDist = maxDist, bestHead = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const vx = e.x - p.x, vy = e.y - p.y;
      const proj = vx * dirX + vy * dirY;
      if (proj <= 0 || proj > bestDist) continue;
      const perp = Math.abs(vx * dirY - vy * dirX);
      if (perp > PLAYER_RADIUS + 0.45) continue;
      // o tiro precisa estar dentro da altura do inimigo
      const enemyH = e.boss ? 2.4 : (e.crouched ? ENEMY_HEIGHT_CROUCH : ENEMY_HEIGHT);
      const shotH = shotHeightAt(eye, pitch, proj);
      if (shotH > enemyH || shotH < 0) continue;
      best = e; bestDist = proj;
      bestHead = shotH > enemyH * HEADSHOT_ZONE;
    }
    return { hit: best, dist: bestDist, head: bestHead, wallDist: wall.dist, wallHit: wall.hit };
  }

  collectSprites() {
    const list = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      list.push({
        kind: 'soldier', x: e.x, y: e.y, h: e.boss ? 2.4 : 1.75,
        team: e.team || 'T', hp: e.hp, name: e.name, crouched: e.crouched, boss: e.boss,
      });
    }
    for (const it of this.items) {
      if (it.taken) continue;
      list.push({ kind: 'item', x: it.x, y: it.y, h: 0.55, type: it.type });
    }
    return list;
  }

  updateCommon(dt) {
    this.time += dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 2.2);
    const p = this.player;
    const moving = Math.hypot(p.vx, p.vy);
    const base = 0.12 + (p.recoil || 0) * 0.55;
    this.crosshairSpread = base + (moving / RUN_SPEED) * 0.5 + (p.crouched ? -0.06 : 0);
    for (const it of this.items) {
      if (it.taken) continue;
      if (Math.hypot(it.x - p.x, it.y - p.y) < 1.6) {
        it.taken = true;
        this.onPickup?.(it);
      }
    }
  }
}
