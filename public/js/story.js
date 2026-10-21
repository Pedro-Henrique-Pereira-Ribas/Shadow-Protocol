// Modo Historia: campanha solo com ondas de inimigos e objetivos.
import { Game } from './game.js';
import { Enemy } from './ai.js';
import { WEAPONS, MAX_HEALTH, MAX_ARMOR, HEADSHOT_MULT, CELL } from '/shared/constants.js';
import { randomFloorPoints, hasLineOfSight, lowBlocksFor, raycast, rng } from '/shared/maps.js';
import { getMission } from '/shared/story.js';
import { rand, randInt, clamp } from './util.js';

export class StoryGame extends Game {
  constructor(map, missionId, opts = {}) {
    super(map, { loadout: getMission(missionId).loadout, money: 0 });
    this.mode = 'story';
    this.mission = getMission(missionId);
    this.missionId = missionId;
    this.waves = this.mission.enemies.map((w) => ({ ...w, spawned: 0, timer: w.delay || 0, done: false }));
    this.totalEnemies = this.waves.reduce((a, w) => a + w.count, 0);
    this.killed = 0;
    this.startTime = performance.now();
    this.elapsed = 0;
    this.endTime = null;
    this.onMissionEnd = opts.onMissionEnd || null;
    this.onToast = opts.onToast || null;
    this.rng = rng(missionId.charCodeAt(1) * 991 + 7);
    this.spawnPool = randomFloorPoints(map, 60, this.rng);
    this.damageTaken = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.parTime = 45 + this.totalEnemies * 9;
    this.state = 'playing';
    this.pickups = 0;
    this.contact = null;
    this.spawnInitialItems();
  }

  spawnInitialItems() {
    const spots = randomFloorPoints(this.map, 8, this.rng);
    spots.slice(0, 4).forEach((s) => {
      this.items.push({ x: s.x, y: s.y, type: 'health', taken: false });
    });
  }

  // ---------------- loop ----------------
  update(dt, input) {
    if (this.state !== 'playing') return;
    const p = this.player;
    this.elapsed += dt;

    p.crouched = input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC');
    p.walking = input.down('ShiftLeft') || input.down('ShiftRight');
    p.update(dt, input, this);

    // teclas de acao
    if (input.hit('KeyR')) {
      if (p.startReload()) this.onReloadStart?.();
    }
    if (input.hit('Digit1')) p.selectSlot(0);
    if (input.hit('Digit2')) p.selectSlot(1);
    if (input.hit('Digit3')) p.selectSlot(2);
    if (input.hit('Digit4')) p.selectSlot(3);
    if (input.hit('KeyQ')) p.cycleSlot(1);

    // tiro
    this.handleFire(input);

    // ondas
    for (const w of this.waves) {
      if (w.done) continue;
      w.timer -= dt;
      if (w.timer <= 0 && w.spawned < w.count) {
        this.spawnEnemy(w.type);
        w.spawned++;
        if (w.spawned >= w.count) w.done = true;
        w.timer = 0.55;
      }
    }

    // inimigos
    for (const e of this.enemies) e.update(dt, this);

    // limpeza
    this.enemies = this.enemies.filter((e) => e.alive || (this.time - (e.deathTime || 0) < 3));
    for (const e of this.enemies) if (!e.alive && e.deathTime === undefined) e.deathTime = this.time;

    this.updateCommon(dt);

    // fim da missao
    const allSpawned = this.waves.every((w) => w.done);
    const noneLeft = this.enemies.length === 0;
    if (allSpawned && noneLeft && this.killed >= this.totalEnemies) {
      this.complete();
    }
  }

  handleFire(input) {
    const p = this.player;
    const wpn = p.weaponDef;
    if (!wpn || !wpn.mag) return;
    const wantFire = wpn.auto ? input.mouseDown : input.mouseClicked;
    if (!wantFire) return;
    if (!p.canFire()) {
      if ((p.ammo[p.weapon] || 0) <= 0 && !p.reloading && this.time - (this._dryAt || 0) > 0.4) {
        this._dryAt = this.time;
        this.onDryFire?.();
        if (p.reserve[p.weapon] > 0) p.startReload();
      }
      return;
    }
    p.consumeShot();
    this.shotsFired++;
    // o barulho do tiro atrai os hostis
    this.contact = { x: p.x, y: p.y, t: this.time };

    const moving = Math.hypot(p.vx, p.vy);
    const spreadBase = (wpn.spread || 0) * (p.crouched ? 0.7 : 1) * (p.walking ? 1.35 : 1)
      + (moving / 260) * 0.02 + (p.recoil || 0) * 0.012;

    const pellets = wpn.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const a = p.angle + rand(spreadBase, -spreadBase) * 1.6;
      const res = this.traceShot(a);
      this.addEffect({
        kind: 'tracer', x0: p.x, y0: p.y,
        x1: p.x + Math.cos(a) * res.dist, y1: p.y + Math.sin(a) * res.dist,
        life: 0.06, weapon: p.weapon,
      });
      if (res.hit) {
        const dmg = wpn.dmg * (res.head ? HEADSHOT_MULT : 1);
        const killed = res.hit.damage(dmg, res.head);
        this.shotsHit++;
        this.hitMarker = 1;
        this.onHitEnemy?.(res.hit, dmg, res.head, killed);
        if (killed) this.onEnemyKilled?.(res.hit);
      }
    }
  }

  spawnEnemy(typeId) {
    const p = this.player;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 30; i++) {
      const s = this.spawnPool[randInt(0, this.spawnPool.length - 1)];
      if (!s) break;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < 230) continue;
      // prefere pontos a 300-900 unidades: combate sem ser instantaneo
      const score = (d < 900 ? 900 - Math.abs(d - 550) : 200 - (d - 900) * 0.1) + Math.random() * 120;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (!best) best = this.spawnPool[0] || { x: CELL * 2, y: CELL * 2 };
    const e = new Enemy(this.map, typeId, best.x, best.y);
    // alguns hostis entram agachados
    e.crouched = Math.random() < 0.22;
    this.enemies.push(e);
    this.onEnemySpawn?.(e);
  }

  addEffect(fx) {
    this.effects.push(fx);
    if (this.effects.length > 120) this.effects.shift();
  }

  // ---------------- eventos ----------------
  onEnemyKilled(e) {
    this.killed++;
    this.player.kills++;
    this.player.score += e.score || 100;
    // drop
    if (Math.random() < 0.45) {
      const isHealth = this.player.hp < 60 && Math.random() < 0.6;
      this.items.push({
        x: e.x + rand(20, -20), y: e.y + rand(20, -20),
        type: isHealth ? 'health' : 'ammo', taken: false,
      });
    }
    if (this.killed === this.totalEnemies) this.complete();
  }

  onPickup(item) {
    const p = this.player;
    if (item.type === 'health') {
      p.hp = Math.min(MAX_HEALTH, p.hp + 35);
      this.onToast?.('+35 VIDA');
    } else {
      const w = p.weapon;
      p.giveAmmo(w, Math.round(WEAPONS[w].mag * 0.8));
      this.onToast?.('MUNICAO');
    }
  }

  onPlayerDamage(dmg) {
    this.damageTaken += dmg;
    this.damageFlash = Math.min(0.5, this.damageFlash + dmg / 90);
    const p = this.player;
    if (p.hp <= 0 && p.alive) {
      p.hp = 0; p.alive = false;
      this.onPlayerDeath?.();
    }
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.onToast?.('VOCE FOI ABATIDO');
    this.onDeath?.();
  }

  // Reaparecer apos morrer na campanha
  respawn() {
    if (this.state !== 'dead') return;
    this.state = 'playing';
    const p = this.player;
    p.hp = 100; p.alive = true;
    p.vx = 0; p.vy = 0;
    const spawns = this.map.spawns.T;
    const s = spawns[Math.floor(Math.random() * spawns.length)];
    p.x = s.x * 64 + 32; p.y = s.y * 64 + 32;
  }

  complete() {
    if (this.state === 'complete') return;
    this.state = 'complete';
    this.endTime = performance.now();
    const seconds = this.elapsed;
    const timeOK = seconds <= this.parTime;
    const hpOK = this.damageTaken < this.player.maxHp * 0.5;
    let stars = 1;
    if (timeOK && hpOK) stars = 3;
    else if (timeOK || hpOK) stars = 2;
    this.stars = stars;
    this.timeTaken = seconds;
    this.onMissionEnd?.({
      completed: true, time: Math.round(seconds * 1000), stars,
      kills: this.killed, total: this.totalEnemies,
      accuracy: this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0,
      damageTaken: Math.round(this.damageTaken),
    });
  }

  get objectiveText() {
    const remaining = this.totalEnemies - this.killed;
    if (remaining <= 0) return 'Missao concluida';
    return `Hostis restantes: ${remaining}`;
  }

  get parTimeText() {
    const s = Math.round(this.parTime);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
