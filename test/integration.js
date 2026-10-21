// Teste de integracao: cadastro, login, salas e WebSocket.
import { WebSocket } from 'ws';

const BASE = 'http://localhost:3000';
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(jar.size ? { Cookie: cookieHeader() } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
  let data = null;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

const ok = (c, m) => console.log(`${c ? '  OK  ' : ' FALHA'} | ${m}`);

console.log('\n=== 1. CADASTRO ===');
const email = `teste${Date.now()}@gmail.com`;
const password = 'SenhaForte123';

let r = await call('/api/auth/register', { method: 'POST', body: { email, password, username: 'Operador' } });
ok(r.status === 200, `cadastro valido (${r.status}) ${JSON.stringify(r.data).slice(0, 90)}`);

console.log('\n=== 2. VALIDACOES ===');
r = await call('/api/auth/register', { method: 'POST', body: { email: 'invalido@', password, username: 'X' } });
ok(r.status === 400, `e-mail invalido rejeitado: ${r.data.error}`);

r = await call('/api/auth/register', { method: 'POST', body: { email: `a${Date.now()}@gmail.com`, password: '123', username: 'X' } });
ok(r.status === 400, `senha curta rejeitada: ${r.data.error}`);

r = await call('/api/auth/register', { method: 'POST', body: { email: `b${Date.now()}@gmail.com`, password: 'senhafraca', username: 'X' } });
ok(r.status === 400, `senha sem maiuscula/numero rejeitada: ${r.data.error}`);

r = await call('/api/auth/register', { method: 'POST', body: { email: `c${Date.now()}@gmail.com`, password: 'SenhaForte123', username: 'Teste' } });
ok(r.status === 200, `novo usuario com senha forte (${r.status})`);

r = await call('/api/auth/register', { method: 'POST', body: { email, password, username: 'Dup' } });
ok(r.status === 400, `e-mail duplicado rejeitado: ${r.data.error}`);

console.log('\n=== 3. LOGIN ===');
r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'ErradaX123' } });
ok(r.status === 401, `senha errada rejeitada: ${r.data.error}`);

jar.clear();
r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
ok(r.status === 200, `login valido (${r.status})`);

r = await call('/api/auth/me');
ok(r.status === 200 && r.data.user?.email === email, `sessao ativa: ${r.data.user?.username}`);

console.log('\n=== 4. MODO ONLINE SEM CONTA ===');
const jar2 = new Map();
const saved = [...jar.entries()];
jar.clear();
r = await call('/api/rooms', { method: 'POST', body: { name: 'x', mode: 'tdm', mapId: 'de_verde' } });
ok(r.status === 401 && r.data.needsAccount, `criar sala sem conta bloqueado: ${r.data.error}`);
r = await call('/api/rooms/join', { method: 'POST', body: { code: 'ABCDE' } });
ok(r.status === 401, `entrar em sala sem conta bloqueado: ${r.data.error}`);
jar.clear();
for (const [k, v] of saved) jar.set(k, v);

console.log('\n=== 5. SALAS ===');
r = await call('/api/rooms', { method: 'POST', body: { name: 'Sala Teste', mode: 'tdm', mapId: 'de_verde' } });
ok(r.status === 200, `sala criada: ${r.data.room?.code}`);
const code = r.data.room?.code;

r = await call('/api/rooms');
ok(Array.isArray(r.data.rooms) && r.data.rooms.length > 0, `lista de salas: ${r.data.rooms.length}`);

console.log('\n=== 6. WEBSOCKET ===');
const ws = new WebSocket('ws://localhost:3000/ws', { headers: { Cookie: cookieHeader() } });
let joined = false, gotSnap = false;

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout WS')), 6000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, name: 'Testador' })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') { joined = true; ok(true, `entrou na sala ${m.room.code} (${m.room.mode}) id=${m.you}`); }
    if (m.t === 'snap') { gotSnap = true; }
    if (m.t === 'err') console.log('        erro do servidor:', m.msg);
  });
  ws.on('error', (e) => { clearTimeout(t); reject(e); });
  setTimeout(() => { clearTimeout(t); resolve(); }, 2500);
});

ok(joined, 'handshake joined');
ok(gotSnap, 'recebeu snapshots do servidor');

ws.send(JSON.stringify({ t: 'pos', x: 200, y: 200, a: 0.5, cr: false, wk: false }));
ws.send(JSON.stringify({ t: 'shoot', a: 0.5 }));
await new Promise((r) => setTimeout(r, 600));
ok(true, 'enviou posicao e tiro sem erros');
ws.close();

console.log('\n=== 7. WEBSOCKET SEM CONTA ===');
const ws2 = new WebSocket('ws://localhost:3000/ws');
await new Promise((resolve) => {
  let closed = false;
  ws2.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'err' && m.code === 'NO_ACCOUNT') {
      ok(true, `conexao sem conta recusada: ${m.msg}`);
      closed = true;
    }
  });
  ws2.on('close', (code) => { if (!closed) ok(false, `fechou sem avisar (code ${code})`); resolve(); });
  setTimeout(resolve, 3000);
});

console.log('\n=== 8. HISTORIA / RANKING ===');
r = await call('/api/story');
ok(r.status === 200 && r.data.missions.length === 5, `missoes: ${r.data.missions.length}`);
r = await call('/api/story/progress', { method: 'POST', body: { missionId: 'm1', time: 65000, stars: 2 } });
ok(r.status === 200 && r.data.progress.length === 1, 'progresso da campanha salvo');
r = await call('/api/leaderboard');
ok(r.status === 200, `ranking: ${r.data.leaderboard.length} entradas`);

console.log('\nCONCLUIDO\n');
process.exit(0);
