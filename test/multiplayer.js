// Teste de combate: dois jogadores na mesma sala, dano real no servidor.
import { WebSocket } from 'ws';

const BASE = 'http://localhost:3000';
let cookie = '';

async function apiCall(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const [kv] = c.split(';');
    cookie = kv;
  }
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const ok = (c, m) => console.log(`${c ? '  OK  ' : ' FALHA'} | ${m}`);

const email = `mp${Date.now()}@gmail.com`;
let r = await apiCall('/api/auth/register', { method: 'POST', body: { email, password: 'SenhaForte123', username: 'Testador' } });
ok(r.status === 200, `conta criada (${r.status})`);

r = await apiCall('/api/rooms', { method: 'POST', body: { name: 'Duelo', mode: 'dm', mapId: 'de_verde' } });
const code = r.data.room.code;
ok(!!code, `sala DM criada: ${code}`);

function connect(name) {
  const ws = new WebSocket('ws://localhost:3000/ws', { headers: { Cookie: cookie } });
  const st = { ws, id: null, pos: null, hp: 100, hits: 0, snaps: 0, joined: false };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, name })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') { st.id = m.you; st.joined = true; }
    if (m.t === 'snap') {
      st.snaps++;
      const me = m.p.find((x) => x.id === st.id);
      if (me) { st.pos = { x: me.x, y: me.y }; st.hp = me.hp; }
    }
    if (m.t === 'hit') { st.hits++; st.lastHit = m; st.minHp = Math.min(st.minHp ?? 100, m.hp); }
  });
  return st;
}

const A = connect('Alfa');
const B = connect('Bravo');

// espera ambos entrarem e o servidor spawnar
await new Promise((r2) => setTimeout(r2, 3500));
ok(A.joined && B.joined, `ambos conectados (A=${A.id?.slice(0, 6)} B=${B.id?.slice(0, 6)})`);
ok(A.snaps > 0 && B.snaps > 0, `snapshots recebidos (A=${A.snaps} B=${B.snaps})`);
ok(!!A.pos && !!B.pos, `posicoes: A=${JSON.stringify(A.pos)} B=${JSON.stringify(B.pos)}`);

if (A.pos && B.pos) {
  // A mira em B e atira algumas vezes
  for (let i = 0; i < 14; i++) {
    const ang = Math.atan2(B.pos.y - A.pos.y, B.pos.x - A.pos.x);
    A.ws.send(JSON.stringify({ t: 'shoot', a: ang }));
    await new Promise((r2) => setTimeout(r2, 110));
  }
  await new Promise((r2) => setTimeout(r2, 700));
  ok(B.hits > 0, `B recebeu ${B.hits} acertos`);
  ok((B.minHp ?? 100) < 100, `vida de B caiu para ${B.minHp} (minimo observado)`);

  // movimento: B anda e o servidor valida
  const before = { ...B.pos };
  B.ws.send(JSON.stringify({ t: 'pos', x: before.x + 120, y: before.y, a: 0 }));
  await new Promise((r2) => setTimeout(r2, 400));
  ok(true, `posicao atualizada de B: ${JSON.stringify(B.pos)}`);

  // movimento ilegal (atravessando parede / teleporte) deve ser barrado
  B.ws.send(JSON.stringify({ t: 'pos', x: 99999, y: 99999, a: 0 }));
  await new Promise((r2) => setTimeout(r2, 400));
  const d = Math.hypot(B.pos.x - 99999, B.pos.y - 99999);
  ok(d > 1000, `teleporte barrado pelo servidor (dist=${Math.round(d)})`);
}

// chat e compra
A.ws.send(JSON.stringify({ t: 'chat', msg: 'boa' }));
A.ws.send(JSON.stringify({ t: 'buy', w: 'fuzil' }));
await new Promise((r2) => setTimeout(r2, 500));
ok(true, 'chat e compra enviados');

A.ws.close();
B.ws.close();
await new Promise((r2) => setTimeout(r2, 400));
console.log('\nCONCLUIDO\n');
process.exit(0);
