// IA dos inimigos do Modo Historia.
import {
  CELL, PLAYER_RADIUS, MAX_HEALTH, WEAPONS, EYE_STAND,
} from '/shared/constants.js';
import { moveCircle, raycast, raycast3D, hasLineOfSight, lowBlocksFor, flowStep, cellCenter, worldToCell } from '/shared/maps.js';
import { ENEMY_TYPES } from '/shared/story.js';
import { HEADSHOT_ZONE } from '/shared/constants.js';
import { clamp, rand, angDiff } from './util.js';

const PATROL_RADIUS = 12;    // metros

export class Enemy {
  constructor(map, typeId, x, y, opts = {}) {
    const t = ENEMY_TYPES[typeId] || ENEMY_TYPES.guarda;
    this.type = t;
    this.typeId = typeId;
    this.map = map;
    this.x = x; this.y = y;
    this.hp = t.hp * (opts.hpMul || 1);
    this.maxHp = this.hp;
    this.armor = t.armor || 0;
    this.alive = true;
    this.angle = rand(Math.PI * 2);
    this.vx = 0; this.vy = 0;
    this.state = 'patrol';      // patrol | alert | chase | attack | dead
    this.target = null;
    this.seeTimer = 0;
    this.loseTimer = 0;
    this.reactionTimer = 0;
    this.cooldown = 0;
    this.homeX = x; this.homeY = y;
    this.patrolTarget = null;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.stuckTimer = 0;
    this.wallTimer = 0;
    this.wallDir = 1;
    this.name = t.name;
    this.boss = !!t.boss;
    this.team = 'T';
    this.crouched = false;
    this.score = t.score;
    this.hitFlash = 0;
  }

  get weapon() { return WEAPONS[this.type.weapon] || WEAPONS.pistola; }
  get speed() { return this.type.speed; }

  update(dt, game) {
    if (!this.alive) return;
    const p = game.player;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    // --------- percepcao ---------
    const dx = p.x - this.x, dy = p.y - this.y;
    const distToPlayer = Math.hypot(dx, dy);
    const canSee = p.alive
      && distToPlayer < this.type.sightRange
      && hasLineOfSight(this.map, this.x, this.y, p.x, p.y, lowBlocksFor(this.crouched));

    if (canSee) {
      this.seeTimer += dt;
      this.loseTimer = 0;
      // compartilha a posicao do jogador com o esquadrao
      if (game.contact && (game.time - game.contact.t) > 0.35) {
        game.contact = { x: p.x, y: p.y, t: game.time };
      }
      if (this.state === 'patrol') {
        this.state = 'alert';
        this.reactionTimer = this.type.reaction;
        game.onEnemyAlert?.(this);
      }
    } else {
      this.seeTimer = 0;
      this.loseTimer += dt;
    }

    if (this.state === 'alert') {
      this.reactionTimer -= dt;
      if (this.reactionTimer <= 0) {
        this.state = 'chase';
        this.target = { x: p.x, y: p.y };
      }
    }

    if (this.state === 'chase' && canSee) {
      const ideal = this.type.range * 0.55;
      if (distToPlayer < ideal * 0.6) this.state = 'attack';
    } else if (this.state === 'attack' && !canSee && this.loseTimer > 1.6) {
      this.state = 'chase';
      this.target = { x: p.x, y: p.y };
    }

    // --------- movimento ---------
    let mx = 0, my = 0;
    const aimAngle = Math.atan2(dy, dx);

    // intel compartilhada: se um companheiro viu o jogador, todos vao ate la
    const contact = game.contact;
    const freshContact = contact && (game.time - contact.t) < 8;

    if (this.state === 'patrol') {
      // usa o campo de fluxo para se aproximar do jogador contornando paredes
      const step = flowStep(this.map, game.flow, ...Object.values(worldToCell(this.x, this.y)));
      if (step) {
        const c = cellCenter(step.cx, step.cy);
        const dx = c.x - this.x, dy = c.y - this.y;
        const dl = Math.hypot(dx, dy) || 1;
        mx = dx / dl; my = dy / dl;
        this.angle += angDiff(this.angle, Math.atan2(dy, dx)) * Math.min(1, dt * 5);
      } else if (freshContact) {
        // indo ate o ultimo ponto conhecido
        const tx = contact.x - this.x, ty = contact.y - this.y;
        const l = Math.hypot(tx, ty) || 1;
        mx = tx / l; my = ty / l;
        this.angle += angDiff(this.angle, Math.atan2(ty, tx)) * Math.min(1, dt * 5);
      } else {
        if (!this.patrolTarget || Math.hypot(this.patrolTarget.x - this.x, this.patrolTarget.y - this.y) < 2) {
          const a = rand(Math.PI * 2);
          const r = rand(PATROL_RADIUS);
          this.patrolTarget = {
            x: clamp(this.homeX + Math.cos(a) * r, CELL, this.map.w * CELL - CELL),
            y: clamp(this.homeY + Math.sin(a) * r, CELL, this.map.h * CELL - CELL),
          };
        }
        const tx = this.patrolTarget.x - this.x, ty = this.patrolTarget.y - this.y;
        const l = Math.hypot(tx, ty) || 1;
        mx = tx / l; my = ty / l;
        this.angle += angDiff(this.angle, Math.atan2(ty, tx)) * Math.min(1, dt * 3);
      }
      if (canSee && Math.abs(angDiff(this.angle, aimAngle)) > 2.4) {
        this.angle += angDiff(this.angle, aimAngle) * Math.min(1, dt * 3);
      }
    } else {
      // persegue/avanca
      const tgt = canSee ? { x: p.x, y: p.y } : (this.target || (freshContact ? contact : { x: this.homeX, y: this.homeY }));
      const tx = tgt.x - this.x, ty = tgt.y - this.y;
      const l = Math.hypot(tx, ty) || 1;
      const ideal = this.type.range * 0.5;
      let forward = 1;
      if (l < ideal * 0.55) forward = -0.55;        // recua se colado
      mx = (tx / l) * forward;
      my = (ty / l) * forward;
      // strafe para ser harder de acertar
      mx += (-ty / l) * this.strafeDir * 0.7;
      my += (tx / l) * this.strafeDir * 0.7;
      if (Math.random() < dt * 0.5) this.strafeDir *= -1;

      // sem linha de visao: usa o campo de fluxo para contornar paredes
      if (!canSee) {
        const step = flowStep(this.map, game.flow, ...Object.values(worldToCell(this.x, this.y)));
        if (step) {
          const c = cellCenter(step.cx, step.cy);
          const dx = c.x - this.x, dy = c.y - this.y;
          const dl = Math.hypot(dx, dy) || 1;
          mx = (dx / dl) * 0.9;
          my = (dy / dl) * 0.9;
        }
      }

      // mira suave
      const turn = angDiff(this.angle, aimAngle);
      this.angle += turn * Math.min(1, dt * (this.boss ? 6 : 8));
    }

    // aplica movimento com aceleracao
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const k = 1 - Math.exp(-10 * dt);
    this.vx += (mx * this.speed - this.vx) * k;
    this.vy += (my * this.speed - this.vy) * k;

    const before = { x: this.x, y: this.y };
    const moved = moveCircle(this.map, this.x, this.y, this.vx * dt, this.vy * dt, PLAYER_RADIUS);
    this.x = moved.x; this.y = moved.y;

    // detecta travamento e desvia
    const realMove = Math.hypot(this.x - before.x, this.y - before.y);
    if (ml > 0.1 && realMove < this.speed * dt * 0.3) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.3) {
        // desliza ao longo da parede por um tempo (evita ficar preso em quinas)
        this.wallTimer = 0.9 + Math.random() * 0.9;
        this.wallDir = Math.random() < 0.5 ? 1 : -1;
        this.stuckTimer = 0;
      }
    } else this.stuckTimer = 0;

    if (this.wallTimer > 0) {
      this.wallTimer -= dt;
      const px = -Math.sin(this.angle) * this.wallDir;
      const py = Math.cos(this.angle) * this.wallDir;
      mx = mx * 0.2 + px;
      my = my * 0.2 + py;
    }

    // --------- tiro ---------
    if ((this.state === 'chase' || this.state === 'attack') && canSee && this.cooldown <= 0) {
      const wpn = this.weapon;
      this.cooldown = 60 / (wpn.rpm * 0.72);
      this.fire(game, distToPlayer);
    }
  }

  fire(game, dist) {
    const p = game.player;
    const wpn = this.weapon;
    const aim = Math.atan2(p.y - this.y, p.x - this.x);
    // erro de mira cresce com a distancia e com o movimento do alvo
    const moveErr = Math.hypot(p.vx, p.vy) / 5.6;
    const err = (1 - this.type.accuracy) * (0.35 + dist / 60) + moveErr * 0.22;
    const shotAngle = aim + rand(err, -err);

    const dirX = Math.cos(shotAngle), dirY = Math.sin(shotAngle);
    // mira vertical: mira no centro do jogador (com erro vertical)
    const targetH = p.crouched ? 1.0 : 1.75;
    const shotH = targetH * 0.5 + rand(err * 0.9, -err * 0.9);
    const pitch = Math.atan2(shotH - 1.6, Math.max(1, dist));
    const wall = raycast3D(this.map, this.x, this.y, dirX, dirY, wpn.range, 1.6, pitch);
    const maxDist = wall.hit ? wall.dist : wpn.range;

    // acerta o jogador?
    const vx = p.x - this.x, vy = p.y - this.y;
    const proj = vx * dirX + vy * dirY;
    const perp = Math.abs(vx * dirY - vy * dirX);
    let hitPlayer = proj > 0 && proj <= maxDist && perp <= PLAYER_RADIUS + 0.35;
    let headshot = false;
    if (hitPlayer) {
      const h = p.crouched ? 1.0 : 1.75;
      const hAt = 1.6 + proj * Math.tan(pitch);
      if (hAt > h || hAt < 0) hitPlayer = false;
      else headshot = hAt > h * HEADSHOT_ZONE;
    }

    game.onEnemyShot?.(this, shotAngle, maxDist, hitPlayer);

    if (hitPlayer) {
      let dmg = this.type.damage * rand(1.25, 0.75) * (headshot ? 2.5 : 1);
      if (p.armor > 0) {
        const absorbed = dmg * 0.5;
        p.armor = Math.max(0, p.armor - absorbed);
        dmg -= absorbed;
      }
      p.hp -= dmg;
      game.onPlayerDamage?.(dmg, this, headshot);
      if (p.hp <= 0) game.onPlayerDeath?.(this);
    }
  }

  damage(amount, headshot) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hitFlash = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.state = 'dead';
      return true;
    }
    // reage a dano
    if (this.state === 'patrol') { this.state = 'alert'; this.reactionTimer = this.type.reaction * 0.6; }
    return false;
  }
}
