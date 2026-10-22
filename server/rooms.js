// Gerenciador de salas online: simulacao autoritativa, rounds, compra e bomba.
import { randomBytes } from 'node:crypto';
import {
  CELL, PLAYER_RADIUS, RUN_SPEED, MAX_HEALTH, MAX_ARMOR, MAX_MONEY, HEADSHOT_MULT,
  WEAPONS, EQUIP, MODES, TICK_RATE, SNAPSHOT_RATE, WEAPON_ORDER,
  EYE_STAND, EYE_CROUCH, PITCH_LIMIT, HEADSHOT_ZONE,
} from '../shared/constants.js';
import { getMap } from '../shared/mapdefs.js';
import { collides, moveCircle, raycast, raycast3D, TILE, lowBlocksFor, randomFloorPoints } from '../shared/maps.js';
import { addMatchResult } from './db.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const BUY_TIME = 15000;
const ROUND_TIME = 115000;
const BOMB_TIME = 40000;
const DEFUSE_TIME = 5000;
const RESPAWN_DELAY = 3000;
const PLANT_TIME = 3200;

let roomSeq = 0;

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function makeRoom({ name, mode, mapId, owner }) {
  const id = ++roomSeq;
  const code = randomCode();
  const map = getMap(mapId) || getMap('de_verde');
  const room = {
    id,
    code,
    name: String(name || 'Sala').slice(0, 24),
    mode: MODES[mode] ? mode : 'tdm',
    mapId: map.id,
    map,
    owner,
    players: new Map(),
    sockets: new Map(),
    createdAt: Date.now(),
    phase: 'lobby',        // lobby | buy | live | end
    phaseEnd: Date.now() + 30000,
    scores: { T: 0, CT: 0 },
    bomb: { state: 'none', x: 0, y: 0, timer: 0, planter: null, defuser: null, defuseProgress: 0 },
    scoreboard: {},        // kills por jogador (ordenacao)
    log: [],
    stats: { kills: new Map(), deaths: new Map() },
  };
  return room;
}

// ---------------- Estado do jogador ----------------
function newPlayer({ id, name, userId, isBot = false }) {
  return {
    id,
    userId,
    name: name || 'Jogador',
    team: null,
    bot: isBot,
    x: 0, y: 0, angle: 0,
    hp: MAX_HEALTH, armor: 0,
    weapon: 'pistola',
    ammo: { pistola: 12, smg: 30, escopeta: 8, fuzil: 30, fuzil4: 30, pesado: 150, sniper: 10 },
    reserve: { pistola: 24, smg: 120, escopeta: 32, fuzil: 90, fuzil4: 90, pesado: 200, sniper: 30 },
    money: 800,
    alive: true,
    kills: 0, deaths: 0, damage: 0,
    score: 0,
    crouched: false,
    walking: false,
    hasBomb: false,
    hasKit: false,
    grenades: 0,
    lastShot: 0,
    lastUpdate: Date.now(),
    lastDamageFrom: null,
    ping: 0,
    connected: true,
    slot: 0,
  };
}

function balanceTeams(room) {
  const mode = MODES[room.mode];
  if (!mode.teams) {
    // FFA: times alternados apenas para diferenciacao visual/radar
    let i = 0;
    for (const p of room.players.values()) {
      if (!p.team) p.team = (i % 2 === 0) ? 'T' : 'CT';
      i++;
    }
    return;
  }
  let t = 0, ct = 0;
  for (const p of room.players.values()) { if (p.team === 'T') t++; else ct++; }
  for (const p of room.players.values()) {
    if (!p.team) {
      if (t <= ct) { p.team = 'T'; t++; } else { p.team = 'CT'; ct++; }
    }
  }
}

// ---------------- Sala / jogadores ----------------
export function createRoom(opts) {
  const room = makeRoom(opts);
  ROOMS.set(room.code, room);
  return room;
}

export function listRooms() {
  return [...ROOMS.values()].map((r) => ({
    code: r.code, name: r.name, mode: r.mode, mapId: r.mapId,
    players: r.players.size, max: MODES[r.mode].max,
    phase: r.phase, host: r.owner?.name || null,
  }));
}

export function getRoom(code) {
  return ROOMS.get(String(code || '').toUpperCase()) || null;
}

export function destroyRoom(code) {
  ROOMS.delete(String(code || '').toUpperCase());
}

export function addPlayerToRoom(room, player) {
  room.players.set(player.id, player);
  balanceTeams(room);
  // se a partida ja comecou, coloca o novo jogador no mapa imediatamente
  if (room.phase === 'live' || room.phase === 'buy') {
    spawnPlayer(room, player);
    sendTo(room, player.id, { t: 'spawn', x: player.x, y: player.y, a: player.angle, hp: player.hp });
  }
}

export function removePlayerFromRoom(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  room.players.delete(playerId);
  room.sockets.delete(playerId);
  if (room.owner && room.owner.id === playerId) {
    const next = [...room.players.values()][0];
    room.owner = next || null;
  }
  if (room.players.size === 0) destroyRoom(room.code);
  else if (room.phase === 'lobby') { /* continua no lobby */ }
}

export function resetPlayerLoadout(p, full = true) {
  p.hp = MAX_HEALTH;
  if (full) {
    p.armor = 0;
    p.money = 800;
    p.weapon = 'pistola';
    for (const w of WEAPON_ORDER) {
      p.ammo[w] = WEAPONS[w].mag;
      p.reserve[w] = WEAPONS[w].reserve;
    }
    p.grenades = 0;
    p.hasKit = false;
    p.hasBomb = false;
  }
}

// ---------------- Spawn ----------------
function spawnPlayer(room, p) {
  const mode = MODES[room.mode];
  let wx, wy;
  if (!mode.teams) {
    // FFA: distribuido pelo mapa inteiro (coordenadas de mundo)
    if (!room.spawnPool || !room.spawnPool.length) {
      room.spawnPool = randomFloorPoints(room.map, 26);
    }
    const pool = room.spawnPool.length ? room.spawnPool : room.map.spawns.T;
    const pt = pool[Math.floor(Math.random() * pool.length)];
    wx = pt.x; wy = pt.y;
  } else {
    // por equipe: indices de celula do grid
    const pts = room.map.spawns[p.team || 'T'] || room.map.spawns.T;
    const pt = pts[Math.floor(Math.random() * pts.length)];
    wx = pt.x * CELL + CELL / 2;
    wy = pt.y * CELL + CELL / 2;
  }
  p.x = wx; p.y = wy;
  p.angle = Math.atan2(
    (room.map.h * CELL / 2) - p.y,
    (room.map.w * CELL / 2) - p.x,
  );
  p.hp = MAX_HEALTH;
  p.alive = true;
  p.crouched = false;
  p.lastUpdate = Date.now();
}

// ---------------- Mensagens ----------------
function send(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const [pid, ws] of room.sockets) {
    if (pid === exceptId) continue;
    try { if (ws.readyState === 1) ws.send(data); } catch { /* ignore */ }
  }
}

function sendTo(room, playerId, msg) {
  const ws = room.sockets.get(playerId);
  if (!ws) return;
  try { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
}

export function broadcastAll(room, msg) { send(room, msg); }

// ---------------- Snapshot ----------------
function snapshot(room) {
  const players = [];
  for (const p of room.players.values()) {
    players.push({
      id: p.id,
      n: p.name,
      t: p.team,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      a: Math.round(p.angle * 1000) / 1000,
      hp: p.hp,
      ar: p.armor,
      w: p.weapon,
      cr: p.crouched ? 1 : 0,
      al: p.alive ? 1 : 0,
      k: p.kills,
      d: p.deaths,
      s: p.score,
      hb: p.hasBomb ? 1 : 0,
      hk: p.hasKit ? 1 : 0,
    });
  }
  return {
    t: 'snap',
    p: players,
    ph: room.phase,
    tl: Math.max(0, Math.round((room.phaseEnd - Date.now()) / 1000)),
    sc: room.scores,
    mb: room.bomb.state,
    bt: Math.max(0, Math.round(room.bomb.timer / 1000)),
    bs: room.mode === 'bomb' ? room.bomb.state : null,
  };
}

// ---------------- Dano ----------------
function applyDamage(room, victim, dmg, attacker, weaponId, headshot) {
  if (!victim.alive) return;
  const wpn = WEAPONS[weaponId] || WEAPONS.pistola;
  let finalDmg = dmg;
  if (victim.armor > 0) {
    const pen = wpn.armorPen ?? 0.6;
    const absorbed = finalDmg * pen * 0.5;
    victim.armor = Math.max(0, victim.armor - absorbed);
    finalDmg = finalDmg - absorbed;
  }
  victim.hp -= finalDmg;
  victim.lastDamageFrom = attacker ? attacker.id : null;
  if (attacker && attacker !== victim) {
    attacker.damage += Math.round(finalDmg);
    if (MODES[room.mode].teams && !MODES[room.mode].friendlyFire && attacker.team === victim.team) {
      attacker.damage -= Math.round(finalDmg);
    }
  }
  sendTo(room, victim.id, { t: 'hit', d: Math.round(finalDmg), hp: Math.max(0, Math.round(victim.hp)), ar: Math.round(victim.armor), hs: headshot ? 1 : 0, fr: attacker ? attacker.id : null });

  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.deathAt = Date.now();
    victim.deaths++;
    room.stats.deaths.set(victim.id, (room.stats.deaths.get(victim.id) || 0) + 1);
    if (attacker && attacker !== victim) {
      attacker.kills++;
      attacker.score += 2;
      attacker.money = Math.min(MAX_MONEY, attacker.money + 300);
      room.stats.kills.set(attacker.id, (room.stats.kills.get(attacker.id) || 0) + 1);
    }
    send(room, {
      t: 'kill',
      k: attacker ? { id: attacker.id, n: attacker.name, t: attacker.team } : null,
      v: { id: victim.id, n: victim.name, t: victim.team },
      w: weaponId,
      hs: headshot ? 1 : 0,
    });
    sendTo(room, attacker ? attacker.id : victim.id, { t: 'kfeed', k: attacker ? attacker.kills : 0 });
    // verifica fim de round
    checkRoundEnd(room);
  }
}

// ---------------- Fim de round ----------------
function aliveCounts(room) {
  let t = 0, ct = 0;
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    if (p.team === 'T') t++; else ct++;
  }
  return { t, ct };
}

function checkRoundEnd(room) {
  if (room.mode === 'bomb') {
    const { t, ct } = aliveCounts(room);
    if (room.bomb.state === 'planted') return;
    if (t === 0 && ct > 0) endRound(room, 'CT');
    else if (ct === 0 && t > 0) endRound(room, 'T');
  }
}

function endRound(room, winner) {
  if (room.phase === 'end') return;
  const mode = MODES[room.mode];
  if (mode.teams && (winner === 'T' || winner === 'CT')) {
    room.scores[winner] = (room.scores[winner] || 0) + 1;
  }
  room.phase = 'end';
  room.phaseEnd = Date.now() + 5000;
  room.bomb.state = 'none';
  room.bomb.timer = 0;
  room.bomb.defuseProgress = 0;
  send(room, { t: 'roundend', winner, scores: room.scores, tl: 5 });
}

function startRound(room) {
  const mode = MODES[room.mode];
  room.bomb.state = 'none';
  room.bomb.timer = 0;
  room.bomb.defuseProgress = 0;

  if (mode.teams) {
    // quem plantou / defuses
    for (const p of room.players.values()) {
      p.hasBomb = false;
      p.hasKit = false;
    }
    const ts = [...room.players.values()].filter((p) => p.team === 'T');
    if (ts.length) ts[Math.floor(Math.random() * ts.length)].hasBomb = true;
    const cts = [...room.players.values()].filter((p) => p.team === 'CT');
    if (cts.length) cts[Math.floor(Math.random() * cts.length)].hasKit = true;
  }

  for (const p of room.players.values()) {
    resetPlayerLoadout(p, false);
    p.hp = MAX_HEALTH;
    p.alive = true;
    p.grenades = Math.min(p.grenades, 1);
    spawnPlayer(room, p);
    // informa o jogador onde ele nasceu (sem isso ele ficaria em 0,0)
    sendTo(room, p.id, { t: 'spawn', x: p.x, y: p.y, a: p.angle, hp: p.hp });
  }

  if (mode.respawn) {
    room.phase = 'live';
    room.phaseEnd = Date.now() + ROUND_TIME;
  } else {
    room.phase = 'buy';
    room.phaseEnd = Date.now() + BUY_TIME;
  }
  send(room, { t: 'roundstart', phase: room.phase, tl: Math.round((room.phaseEnd - Date.now()) / 1000), scores: room.scores });
}

// ---------------- Compra ----------------
function handleBuy(room, p, msg) {
  const mode = MODES[room.mode];
  if (mode.respawn) return sendTo(room, p.id, { t: 'err', msg: 'Sem loja neste modo.' });
  if (room.phase !== 'buy' && room.phase !== 'live') return sendTo(room, p.id, { t: 'err', msg: 'Loja indisponivel.' });
  const w = String(msg.w || '');
  if (w === 'armor') {
    if (p.armor >= MAX_ARMOR) return sendTo(room, p.id, { t: 'err', msg: 'Colete ja equipado.' });
    if (p.money < EQUIP.colete.price) return sendTo(room, p.id, { t: 'err', msg: 'Dinheiro insuficiente.' });
    p.money -= EQUIP.colete.price;
    p.armor = EQUIP.colete.armor;
    return sendTo(room, p.id, { t: 'buy', ok: 1, item: 'colete', money: p.money });
  }
  if (w === 'kit') {
    if (p.hasKit) return sendTo(room, p.id, { t: 'err', msg: 'Voce ja tem o kit.' });
    if (p.money < EQUIP.kit.price) return sendTo(room, p.id, { t: 'err', msg: 'Dinheiro insuficiente.' });
    p.money -= EQUIP.kit.price;
    p.hasKit = true;
    return sendTo(room, p.id, { t: 'buy', ok: 1, item: 'kit', money: p.money });
  }
  const wpn = WEAPONS[w];
  if (!wpn || wpn.price === 0) return sendTo(room, p.id, { t: 'err', msg: 'Item invalido.' });
  if (p.money < wpn.price) return sendTo(room, p.id, { t: 'err', msg: 'Dinheiro insuficiente.' });
  p.money -= wpn.price;
  p.weapon = w;
  p.ammo[w] = wpn.mag;
  p.reserve[w] = wpn.reserve;
  sendTo(room, p.id, { t: 'buy', ok: 1, item: w, money: p.money });
}

// ---------------- Tiro ----------------
function handleShoot(room, p, msg) {
  if (!p.alive) return;
  const wpn = WEAPONS[p.weapon];
  if (!wpn) return;
  const now = Date.now();
  const minInterval = 60000 / wpn.rpm;
  if (now - p.lastShot < minInterval) return;
  if ((p.ammo[p.weapon] || 0) <= 0) {
    sendTo(room, p.id, { t: 'dryfire' });
    return;
  }
  p.lastShot = now;
  p.ammo[p.weapon]--;

  const ang = Number(msg.a) || p.angle;
  const pitch = clamp(Number(msg.p) || 0, -PITCH_LIMIT, PITCH_LIMIT);
  const dirX = Math.cos(ang), dirY = Math.sin(ang);
  const crouched = !!p.crouched;
  const eyeH = crouched ? EYE_CROUCH : EYE_STAND;

  // parede (considera a altura do tiro)
  const wall = raycast3D(room.map, p.x, p.y, dirX, dirY, wpn.range, eyeH, pitch);
  let maxDist = wall.hit ? wall.dist : wpn.range;

  // jogador mais proximo no caminho
  let target = null, targetDist = maxDist, targetHead = false;
  for (const other of room.players.values()) {
    if (other.id === p.id || !other.alive) continue;
    if (other.team === p.team && !MODES[room.mode].friendlyFire && MODES[room.mode].teams) continue;
    const vx = other.x - p.x, vy = other.y - p.y;
    const proj = vx * dirX + vy * dirY;
    if (proj <= 0 || proj > targetDist) continue;
    const perp = Math.abs(vx * dirY - vy * dirX);
    if (perp > PLAYER_RADIUS + 0.35) continue;
    target = other;
    targetDist = proj;
    targetHead = Math.random() < (other.crouched ? 0.22 : 0.08);
  }

  const pellets = wpn.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const spread = (wpn.spread || 0) * (p.walking ? 1.6 : p.crouched ? 0.65 : 1);
    const a2 = ang + (Math.random() - 0.5) * 2 * spread * 3;
    const p2 = pitch + (Math.random() - 0.5) * 2 * spread * 0.45;
    const dx = Math.cos(a2), dy = Math.sin(a2);
    const w = raycast3D(room.map, p.x, p.y, dx, dy, wpn.range, eyeH, p2);
    let dist = w.hit ? w.dist : wpn.range;
    let hitPlayer = null, head = false;
    for (const other of room.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      if (other.team === p.team && MODES[room.mode].teams && !MODES[room.mode].friendlyFire) continue;
      const vx = other.x - p.x, vy = other.y - p.y;
      const proj = vx * dx + vy * dy;
      if (proj <= 0 || proj > dist) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      if (perp > PLAYER_RADIUS + 0.3) continue;
      // altura: o tiro precisa passar dentro da altura do alvo
      const oH = other.crouched ? 1.0 : 1.75;
      const hAt = eyeH + proj * Math.tan(p2);
      if (hAt > oH || hAt < 0) continue;
      hitPlayer = other; dist = proj;
      head = hAt > oH * HEADSHOT_ZONE;
    }
    if (hitPlayer) {
      let dmg = wpn.dmg * (head ? HEADSHOT_MULT : 1);
      if (MODES[room.mode].teams && hitPlayer.team === p.team && !MODES[room.mode].friendlyFire) dmg = 0;
      applyDamage(room, hitPlayer, dmg, p, p.weapon, head);
    }
  }

  send(room, {
    t: 'shot',
    id: p.id,
    x: Math.round(p.x), y: Math.round(p.y),
    a: Math.round(ang * 1000) / 1000,
    w: p.weapon,
    hx: target ? Math.round(target.x) : null,
    hy: target ? Math.round(target.y) : null,
    hs: targetHead ? 1 : 0,
  });
}

// ---------------- Posicao (anti-cheat leve) ----------------
function handlePos(room, p, msg) {
  const now = Date.now();
  const dt = Math.min(0.25, (now - p.lastUpdate) / 1000);
  p.lastUpdate = now;
  const nx = Number(msg.x), ny = Number(msg.y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
  const dx = nx - p.x, dy = ny - p.y;
  const d = Math.hypot(dx, dy);
  const maxStep = RUN_SPEED * dt * 2.2 + 1.2;
  let tx = p.x, ty = p.y;
  if (d <= maxStep) {
    tx = nx; ty = ny;
  } else if (d <= maxStep * 3) {
    // excesso pequeno: limita o passo
    const k = maxStep / (d || 1);
    tx = p.x + dx * k; ty = p.y + dy * k;
  } else {
    // salto grande (teleporte ou posicao invalida): ignora
    return;
  }

  // resolve colisao no servidor
  const moved = moveCircle(room.map, p.x, p.y, tx - p.x, ty - p.y, PLAYER_RADIUS);
  p.x = moved.x; p.y = moved.y;
  p.angle = Number(msg.a) || p.angle;
  p.pitch = clamp(Number(msg.p) || 0, -PITCH_LIMIT, PITCH_LIMIT);
  p.crouched = !!msg.cr;
  p.walking = !!msg.wk;
  if (Number.isFinite(msg.ping)) p.ping = msg.ping;
}

// ---------------- Bomba ----------------
function handlePlant(room, p) {
  if (room.mode !== 'bomb') return;
  if (!p.alive || !p.hasBomb || p.team !== 'T') return;
  const inSite = ['A', 'B'].some((s) => {
    const site = room.map.sites[s];
    return Math.hypot(p.x - site.x * CELL, p.y - site.y * CELL) <= site.r * CELL;
  });
  if (!inSite) return sendTo(room, p.id, { t: 'err', msg: 'Voce precisa estar em um dos sites.' });
  room.bomb.state = 'planting';
  room.bomb.planter = p.id;
  room.bomb.plantTimer = Date.now() + PLANT_TIME;
  send(room, { t: 'event', kind: 'planting', id: p.id });
}

function handleDefuse(room, p) {
  if (room.mode !== 'bomb' || room.bomb.state !== 'planted') return;
  if (!p.alive || p.team !== 'CT') return;
  const bx = room.bomb.x, by = room.bomb.y;
  if (Math.hypot(p.x - bx, p.y - by) > 2.5) return;
  if (!p.hasKit) {
    room.bomb.defuser = p.id;
    room.bomb.defuseProgress += 1 / (DEFUSE_TIME / 1000);
  } else {
    room.bomb.defuser = p.id;
    room.bomb.defuseProgress += 1 / 1.2;
  }
  if (room.bomb.defuseProgress >= 1) {
    room.bomb.state = 'defused';
    send(room, { t: 'event', kind: 'defused', id: p.id });
    endRound(room, 'CT');
  }
}

// ---------------- Fim de fase ----------------
function matchWon(room) {
  const mode = MODES[room.mode];
  if (mode.teams) return room.scores.T >= mode.scoreLimit || room.scores.CT >= mode.scoreLimit;
  return [...room.players.values()].some((p) => p.kills >= mode.scoreLimit);
}

function endMatch(room) {
  if (room.matchEnded) return;
  room.matchEnded = true;
  room.phase = 'over';
  room.phaseEnd = Date.now() + 15 * 60 * 1000;
  const mode = MODES[room.mode];
  const winner = mode.teams ? (room.scores.T > room.scores.CT ? 'T' : 'CT') : null;
  send(room, { t: 'matchend', scores: room.scores, winner, players: scoreboard(room) });
  // registra estatisticas
  try {
    for (const p of room.players.values()) {
      if (!p.userId) continue;
      const win = mode.teams ? p.team === winner : p.kills >= mode.scoreLimit;
      addMatchResult(p.userId, room.mode, {
        kills: p.kills, deaths: p.deaths, win, score: p.score,
      });
    }
  } catch (e) { console.error('[stats]', e.message); }
}

function updatePhase(room) {
  const now = Date.now();
  const mode = MODES[room.mode];

  if (room.phase === 'lobby') {
    if (room.players.size >= mode.min) {
      room.phase = 'buy';
      room.phaseEnd = now + BUY_TIME;
      startRound(room);
    }
    return;
  }
  if (room.phase === 'buy' && now >= room.phaseEnd) {
    room.phase = 'live';
    room.phaseEnd = now + ROUND_TIME;
    send(room, { t: 'phase', phase: 'live', tl: Math.round(ROUND_TIME / 1000) });
  }
  if (room.phase === 'live') {
    if (mode.respawn) {
      if (matchWon(room)) { endRound(room, null); return; }
    } else {
      if (room.bomb.state === 'planted') {
        room.bomb.timer -= 1000 / TICK_RATE;
        if (room.bomb.timer <= 0) {
          room.bomb.state = 'exploded';
          send(room, { t: 'event', kind: 'exploded' });
          endRound(room, 'T');
          return;
        }
      } else if (now >= room.phaseEnd) {
        // tempo esgotado
        const { t, ct } = aliveCounts(room);
        endRound(room, t > ct ? 'T' : 'CT');
        return;
      }
    }
  }
  if (room.phase === 'end' && now >= room.phaseEnd) {
    if (matchWon(room)) { endMatch(room); return; }
    startRound(room);
  }
}

// ---------------- Scoreboard ----------------
export function scoreboard(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, n: p.name, t: p.team, k: p.kills, d: p.deaths, s: p.score, hp: p.hp }))
    .sort((a, b) => b.s - a.s || b.k - a.k);
}

// ---------------- Loop principal ----------------
const ROOMS = new Map();
let lastTick = Date.now();

export function startServerLoop() {
  const timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.2, (now - lastTick) / 1000);
    lastTick = now;

    for (const room of ROOMS.values()) {
      updatePhase(room);

      // respawn em modos com respawn
      const mode = MODES[room.mode];
      if (mode.respawn) {
        for (const p of room.players.values()) {
          if (!p.alive && now - (p.deathAt || 0) > RESPAWN_DELAY) {
            spawnPlayer(room, p);
            p.deaths = p.deaths; // mantem
            sendTo(room, p.id, { t: 'respawn', x: p.x, y: p.y, hp: p.hp });
          }
        }
      }

      // bomba plantando
      if (room.bomb.state === 'planting' && now >= room.bomb.plantTimer) {
        const planter = room.players.get(room.bomb.planter);
        room.bomb.state = 'planted';
        room.bomb.timer = BOMB_TIME;
        room.bomb.x = planter ? planter.x : 0;
        room.bomb.y = planter ? planter.y : 0;
        room.bomb.defuseProgress = 0;
        send(room, { t: 'event', kind: 'planted', x: room.bomb.x, y: room.bomb.y });
      }

      if (now - (room.lastSnap || 0) >= 1000 / SNAPSHOT_RATE) {
        room.lastSnap = now;
        send(room, snapshot(room));
      }
    }
  }, 1000 / TICK_RATE);
  timer.unref?.();
}

// ---------------- Mensagens do cliente ----------------
export function handleClientMessage(room, playerId, msg) {
  const p = room.players.get(playerId);
  if (!p) return;
  switch (msg.t) {
    case 'pos': handlePos(room, p, msg); break;
    case 'shoot': handleShoot(room, p, msg); break;
    case 'reload': {
      const wpn = WEAPONS[p.weapon];
      if (!wpn || !wpn.mag) break;
      if ((p.ammo[p.weapon] || 0) >= wpn.mag) break;
      const need = wpn.mag - (p.ammo[p.weapon] || 0);
      const have = p.reserve[p.weapon] || 0;
      const take = Math.min(need, have);
      if (take <= 0) break;
      p.ammo[p.weapon] += take;
      p.reserve[p.weapon] -= take;
      sendTo(room, p.id, { t: 'reloaded', w: p.weapon, ammo: p.ammo[p.weapon], reserve: p.reserve[p.weapon] });
      break;
    }
    case 'switch': {
      const w = String(msg.w || '');
      if (!WEAPONS[w]) break;
      p.weapon = w;
      sendTo(room, p.id, { t: 'weapon', w });
      break;
    }
    case 'buy': handleBuy(room, p, msg); break;
    case 'plant': handlePlant(room, p); break;
    case 'defuse': handleDefuse(room, p); break;
    case 'chat': {
      const txt = String(msg.msg || '').slice(0, 120).replace(/[<>]/g, '');
      if (!txt.trim()) break;
      send(room, { t: 'chat', id: p.id, n: p.name, m: txt });
      break;
    }
    case 'ping': p.ping = Number(msg.p) || 0; break;
    default: break;
  }
}

export function markDeath(room, p) {
  p.deathAt = Date.now();
  p.alive = false;
}

export { ROOMS, spawnPlayer, send as roomSend, sendTo as roomSendTo, applyDamage };
