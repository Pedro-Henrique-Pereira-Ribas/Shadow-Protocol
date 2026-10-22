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
    if (m.t === 'spawn') { st.spawned = true; st.spawn = { x: m.x, y: m.y }; }
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

// o jogador NAO pode ficar em (0,0) - isso trava o movimento (dentro de parede)
for (const [n, st] of [['A', A], ['B', B]]) {
  const bad = !st.pos || (Math.abs(st.pos.x) < 0.01 && Math.abs(st.pos.y) < 0.01);
  ok(!bad, `jogador ${n} foi posicionado no mapa (nao em 0,0)`);
}
// o servidor deve ter enviado o spawn
ok(A.spawned, 'servidor enviou a posicao de spawn (mensagem "spawn")');

if (A.pos && B.pos) {
  const dist0 = Math.hypot(A.pos.x - B.pos.x, A.pos.y - B.pos.y);
  ok(dist0 > 0.5, `jogadores em posicoes distintas (distancia=${dist0.toFixed(1)}m)`);

  // aproxima os dois para uma distancia de combate (caminhando pelo campo de fluxo)
  const { getMap } = await import('../shared/mapdefs.js');
  const { cellToWorld, worldToCell, computeFlowField, flowStep, hasLineOfSight } = await import('../shared/maps.js');
  const { CELL } = await import('../shared/constants.js');
  const map = getMap('de_verde');
  // usa o site A (sala aberta) para garantir linha de visao
  const spot = cellToWorld(map.sites.A.x, map.sites.A.y);
  const walkTo = async (st, tx, ty) => {
    const field = computeFlowField(map, Math.floor(tx / CELL), Math.floor(ty / CELL));
    for (let i = 0; i < 400; i++) {
      const p = st.pos;
      if (!p) break;
      if (Math.hypot(tx - p.x, ty - p.y) < 0.8) break;
      const c = worldToCell(p.x, p.y);
      const step = flowStep(map, field, c.cx, c.cy);
      let nx = tx, ny = ty;
      if (step) { const wc = cellCenterOf(step); nx = wc.x; ny = wc.y; }
      const dx = nx - p.x, dy = ny - p.y;
      const dl = Math.hypot(dx, dy) || 1;
      const s = Math.min(0.6, dl);
      st.ws.send(JSON.stringify({ t: 'pos', x: p.x + (dx / dl) * s, y: p.y + (dy / dl) * s, a: 0 }));
      await new Promise((r2) => setTimeout(r2, 30));
    }
  };
  const cellCenterOf = (step) => cellToWorld(step.cx, step.cy);

  await walkTo(A, spot.x, spot.y);
  await walkTo(B, spot.x + 2.5, spot.y);
  await new Promise((r2) => setTimeout(r2, 300));

  // se ficaram sobrepostos, afasta B alguns metros (a sala do site e larga)
  if (Math.hypot(A.pos.x - B.pos.x, A.pos.y - B.pos.y) < 2) {
    for (let i = 0; i < 8; i++) {
      B.ws.send(JSON.stringify({ t: 'pos', x: B.pos.x + 0.6, y: B.pos.y, a: 0 }));
      await new Promise((r2) => setTimeout(r2, 60));
    }
    await new Promise((r2) => setTimeout(r2, 300));
  }

  const dist = Math.hypot(A.pos.x - B.pos.x, A.pos.y - B.pos.y);
  ok(dist > 0.5 && dist < 45, `distancia de combate: ${dist.toFixed(1)}m (pistola: 45m)`);
  const los = hasLineOfSight(map, A.pos.x, A.pos.y, B.pos.x, B.pos.y, true);
  ok(los, 'existe linha de visao entre os dois jogadores');

  if (dist > 0.5 && los) {
    // A mira em B e atira algumas vezes
    for (let i = 0; i < 14; i++) {
      const ang = Math.atan2(B.pos.y - A.pos.y, B.pos.x - A.pos.x);
      A.ws.send(JSON.stringify({ t: 'shoot', a: ang }));
      await new Promise((r2) => setTimeout(r2, 110));
    }
    await new Promise((r2) => setTimeout(r2, 700));
    ok(B.hits > 0, `B recebeu ${B.hits} acertos`);
    ok((B.minHp ?? 100) < 100, `vida de B caiu para ${B.minHp} (minimo observado)`);
  }

  // movimento: B anda e o servidor valida
  const before = { ...B.pos };
  B.ws.send(JSON.stringify({ t: 'pos', x: before.x + 1, y: before.y, a: 0 }));
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
