// Servidor HTTP + WebSocket do FPS 2D
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

import {
  currentUser, register, login, logout, setSessionCookie, clearSessionCookie,
  sessionToken, parseCookies,
} from './auth.js';
import {
  getStoryProgress, setStoryProgress, leaderboard, addMatchResult, getStat, getSessionUser,
} from './db.js';
import {
  createRoom, getRoom, listRooms, addPlayerToRoom, removePlayerFromRoom,
  handleClientMessage, startServerLoop, scoreboard, roomSend, roomSendTo,
} from './rooms.js';
import { MODES, MAX_ROOM_NAME, WEAPONS, WEAPON_ORDER } from '../shared/constants.js';
import { getMap } from '../shared/mapdefs.js';
import { STORY_MISSIONS, getMission } from '../shared/story.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');
const SHARED = join(ROOT, 'shared');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// ---------------- Utilidades HTTP ----------------
function json(res, code, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Payload grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('JSON invalido')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, base, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (clean.includes('..')) { res.writeHead(403); return res.end('Proibido'); }
  let file = join(base, clean);
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nao encontrado');
  }
  try {
    const data = await readFile(file);
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Nao encontrado');
  }
}

// ---------------- Rate limit simples ----------------
const attempts = new Map();
function rateLimit(key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n++;
  attempts.set(key, rec);
  return rec.n <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now - v.t > 300_000) attempts.delete(k);
}, 120_000).unref?.();

// ---------------- Roteador ----------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  try {
    // ---------- API ----------
    if (path.startsWith('/api/')) {
      // --- Registro ---
      if (path === '/api/auth/register' && method === 'POST') {
        if (!rateLimit(`reg:${req.socket.remoteAddress}`, 30, 10 * 60_000)) {
          return json(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
        }
        const body = await readBody(req);
        const r = await register({
          email: body.email, password: body.password, username: body.username,
        });
        if (!r.ok) return json(res, 400, { error: r.error });
        setSessionCookie(res, r.token);
        return json(res, 200, { user: publicUser(r.user) });
      }

      // --- Login ---
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await readBody(req);
        const mail = String(body.email || '').trim().toLowerCase();
        if (!rateLimit(`log:${req.socket.remoteAddress}`, 20, 5 * 60_000)
          || !rateLimit(`logm:${mail}`, 10, 5 * 60_000)) {
          return json(res, 429, { error: 'Muitas tentativas de login. Aguarde.' });
        }
        const r = login({ email: mail, password: body.password });
        if (!r.ok) return json(res, 401, { error: r.error });
        setSessionCookie(res, r.token);
        return json(res, 200, { user: publicUser(r.user) });
      }

      // --- Logout ---
      if (path === '/api/auth/logout' && method === 'POST') {
        logout(sessionToken(req));
        clearSessionCookie(res);
        return json(res, 200, { ok: true });
      }

      // --- Usuario atual ---
      if (path === '/api/auth/me' && method === 'GET') {
        const { user } = currentUser(req);
        if (!user) return json(res, 401, { error: 'Nao autenticado' });
        return json(res, 200, { user: publicUser(user) });
      }

      // --- Mapas ---
      if (path === '/api/maps' && method === 'GET') {
        const ids = ['de_verde', 'de_fabrica', 'de_caverna', 'de_ceu'];
        const maps = ids.map((id) => {
          const m = getMap(id);
          return { id: m.id, name: m.name, tag: m.tag, w: m.w, h: m.h };
        });
        return json(res, 200, { maps });
      }

      // --- Historia ---
      if (path === '/api/story' && method === 'GET') {
        const { user } = currentUser(req);
        const progress = user ? getStoryProgress(user.id) : [];
        return json(res, 200, {
          missions: STORY_MISSIONS.map((m) => ({
            id: m.id, name: m.name, act: m.act, mapId: m.mapId,
            brief: m.brief, objective: m.objective, difficulty: m.difficulty,
            enemyCount: m.enemies.length, timeLimit: m.timeLimit,
          })),
          progress,
          requiresAccount: false,
        });
      }

      if (path === '/api/story/progress' && method === 'POST') {
        const { user } = currentUser(req);
        if (!user) return json(res, 401, { error: 'Crie uma conta para salvar seu progresso.' });
        const body = await readBody(req);
        const mission = getMission(body.missionId);
        if (!mission) return json(res, 400, { error: 'Missao invalida.' });
        setStoryProgress(user.id, mission.id, {
          completed: 1, bestTime: Number(body.time) || null, stars: Number(body.stars) || 0,
        });
        return json(res, 200, { progress: getStoryProgress(user.id) });
      }

      // --- Salas ---
      if (path === '/api/rooms' && method === 'GET') {
        return json(res, 200, { rooms: listRooms() });
      }

      if (path === '/api/rooms' && method === 'POST') {
        const { user } = currentUser(req);
        if (!user) return json(res, 401, { error: 'É obrigatorio ter conta para jogar online.', needsAccount: true });
        const body = await readBody(req);
        const mode = MODES[body.mode] ? body.mode : 'tdm';
        const mapId = body.mapId && getMap(body.mapId) ? body.mapId : 'de_verde';
        const room = createRoom({
          name: String(body.name || `Sala de ${user.username}`).slice(0, MAX_ROOM_NAME),
          mode, mapId, owner: { id: user.id, name: user.username },
        });
        return json(res, 200, { room: { code: room.code, name: room.name, mode: room.mode, mapId: room.mapId } });
      }

      if (path === '/api/rooms/join' && method === 'POST') {
        const { user } = currentUser(req);
        if (!user) return json(res, 401, { error: 'É obrigatorio ter conta para jogar online.', needsAccount: true });
        const body = await readBody(req);
        const room = getRoom(body.code);
        if (!room) return json(res, 404, { error: 'Sala nao encontrada.' });
        return json(res, 200, { room: { code: room.code, name: room.name, mode: room.mode, mapId: room.mapId } });
      }

      // --- Ranking ---
      if (path === '/api/leaderboard' && method === 'GET') {
        const mode = url.searchParams.get('mode') || 'global';
        return json(res, 200, { leaderboard: leaderboard(mode, 25) });
      }

      // --- Estatisticas do jogador ---
      if (path === '/api/stats' && method === 'GET') {
        const { user } = currentUser(req);
        if (!user) return json(res, 401, { error: 'Nao autenticado' });
        const modes = Object.keys(MODES);
        const stats = {};
        for (const m of modes) stats[m] = getStat(user.id, m);
        return json(res, 200, { stats, story: getStoryProgress(user.id) });
      }

      return json(res, 404, { error: 'Rota nao encontrada' });
    }

    // ---------- Estáticos ----------
    if (path.startsWith('/shared/')) {
      return serveStatic(res, SHARED, path.slice('/shared'.length));
    }
    if (path === '/' || path === '/index.html') {
      return serveStatic(res, PUBLIC, '/index.html');
    }
    return serveStatic(res, PUBLIC, path);
  } catch (err) {
    console.error('[http] erro:', err);
    try { json(res, 500, { error: 'Erro interno' }); } catch { /* ignore */ }
  }
});

function publicUser(u) {
  return { id: u.id, email: u.email, username: u.username, createdAt: u.created_at };
}

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws, req) => {
  // Autenticacao obrigatoria para o modo online
  const cookies = parseCookies(req);
  const token = cookies.fps2d_sid || (req.headers['x-session-token'] || null);
  const user = getSessionUser(token);
  if (!user) {
    try { ws.send(JSON.stringify({ t: 'err', msg: 'É obrigatorio ter conta para jogar online.', code: 'NO_ACCOUNT' })); } catch { /* ignore */ }
    ws.close(4001, 'no-account');
    return;
  }

  const playerId = randomUUID();
  let room = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      const target = getRoom(msg.code);
      if (!target) {
        try { ws.send(JSON.stringify({ t: 'err', msg: 'Sala nao encontrada.' })); } catch { /* ignore */ }
        return;
      }
      const mode = MODES[target.mode];
      if (target.players.size >= mode.max) {
        try { ws.send(JSON.stringify({ t: 'err', msg: 'Sala cheia.' })); } catch { /* ignore */ }
        return;
      }
      room = target;
      const player = {
        id: playerId,
        userId: user.id,
        name: String(msg.name || user.username).slice(0, 16),
        team: null, bot: false,
        x: 0, y: 0, angle: 0,
        hp: 100, armor: 0,
        weapon: 'pistola',
        ammo: {}, reserve: {},
        money: 800, alive: true, kills: 0, deaths: 0, score: 0,
        crouched: false, walking: false, hasBomb: false, hasKit: false, grenades: 0,
        lastShot: 0, lastUpdate: Date.now(), deathAt: 0, ping: 0, connected: true,
      };
      for (const w of WEAPON_ORDER) {
        player.ammo[w] = 0; player.reserve[w] = 0;
      }
      // pistola inicial equipada e carregada
      player.ammo.pistola = WEAPONS.pistola.mag;
      player.reserve.pistola = WEAPONS.pistola.reserve;
      addPlayerToRoom(room, player);
      room.sockets.set(playerId, ws);

      ws.send(JSON.stringify({
        t: 'joined',
        you: playerId,
        room: { code: room.code, name: room.name, mode: room.mode, mapId: room.mapId },
        map: { id: room.map.id, name: room.map.name, w: room.map.w, h: room.map.h },
        players: [...room.players.values()].map((p) => ({
          id: p.id, n: p.name, t: p.team, k: p.kills, d: p.deaths, s: p.score,
        })),
        phase: room.phase,
        scores: room.scores,
        me: { name: player.name, team: player.team, money: player.money, weapon: player.weapon },
      }));
      roomSend(room, { t: 'joinnotice', id: playerId, n: player.name });
      return;
    }

    if (msg.t === 'leave') {
      if (room) removePlayerFromRoom(room, playerId);
      room = null;
      return;
    }

    if (!room) return;
    handleClientMessage(room, playerId, msg);
  });

  ws.on('close', () => {
    if (room) {
      const p = room.players.get(playerId);
      if (p) { p.connected = false; p.alive = false; }
      roomSend(room, { t: 'leave', id: playerId });
      removePlayerFromRoom(room, playerId);
    }
  });

  ws.on('error', () => { /* ignore */ });
});

startServerLoop();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ==============================================');
  console.log('   FPS 2D - Protocolo Sombra');
  console.log('   Historia (estilo COD) + Online (estilo CS2)');
  console.log('  ==============================================');
  console.log(`   Rodando em: http://localhost:${PORT}`);
  console.log('  ==============================================');
  console.log('');
});

export { server };
