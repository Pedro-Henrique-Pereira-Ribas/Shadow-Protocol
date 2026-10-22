// Gerador deterministico de mapas + geometria (raycasting/colisao).
// Servidor e cliente importam este modulo para garantir mapas identicos.

import { CELL, WALL_FULL, WALL_LOW, EYE_STAND, EYE_CROUCH } from './constants.js';
export const TILE = { FLOOR: 0, WALL: 1, LOW: 2 };
export const TILE_HEIGHT = [0, WALL_FULL, WALL_LOW];

// ---------------- RNG deterministico (mulberry32) ----------------
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const irange = (r, a, b) => a + Math.floor(r() * (b - a + 1));

// ---------------- Construcao do grid ----------------
class Grid {
  constructor(w, h, fill = TILE.WALL) {
    this.w = w; this.h = h;
    this.d = new Uint8Array(w * h).fill(fill);
  }
  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = v;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TILE.WALL;
    return this.d[y * this.w + x];
  }
  rect(x, y, w, h, v) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v);
  }
  carveCorridor(x0, y0, x1, y1, width) {
    const half = (width - 1) / 2;
    const clearAt = (x, y) => {
      const t = this.get(x, y);
      if (t === TILE.WALL || t === TILE.LOW) this.set(x, y, TILE.FLOOR);
    };
    const horiz = (y) => {
      const a = Math.min(x0, x1), b = Math.max(x0, x1);
      for (let x = a; x <= b; x++) {
        for (let k = -half; k <= half; k++) clearAt(x, Math.round(y + k));
      }
    };
    const vert = (x) => {
      const a = Math.min(y0, y1), b = Math.max(y0, y1);
      for (let y = a; y <= b; y++) {
        for (let k = -half; k <= half; k++) clearAt(Math.round(x + k), y);
      }
    };
    horiz(y0); vert(x1);
  }
}

// ---------------- Gerador de mapa ----------------
// params: { w,h,rooms,corridor,cover,seed,name,id,longs }
export function generateMap(params) {
  const {
    w = 40, h = 30, rooms: roomCount = 9, corridor = 3, cover = 14,
    seed = 1, name = 'Map', id = 'map', tag = '',
  } = params;

  const r = rng(seed);
  const g = new Grid(w, h, TILE.WALL);

  // salas reservadas (spawns e sites) - impede sobreposicao
  const reserved = [];
  const mkRoom = (x, y, rw, rh, kind) => {
    g.rect(x, y, rw, rh, TILE.FLOOR);
    // paredes internas com aberturas
    g.set(x, y, TILE.WALL); g.set(x + rw - 1, y, TILE.WALL);
    g.set(x, y + rh - 1, TILE.WALL); g.set(x + rw - 1, y + rh - 1, TILE.WALL);
    for (let j = y + 1; j < y + rh - 1; j++) { g.set(x, j, TILE.WALL); g.set(x + rw - 1, j, TILE.WALL); }
    for (let i = x + 1; i < x + rw - 1; i++) { g.set(i, y, TILE.WALL); g.set(i, y + rh - 1, TILE.WALL); }
    const room = { x, y, w: rw, h: rh, kind, cx: x + (rw >> 1), cy: y + (rh >> 1) };
    reserved.push(room);
    return room;
  };

  const usableW = w - 2, usableH = h - 2;
  // Sala T (inferior esquerda), Sala CT (inferior direita)
  const tRoom = mkRoom(2, h - 8, 8, 6, 'T');
  const ctRoom = mkRoom(w - 10, h - 8, 8, 6, 'CT');
  // Sites bomba (superior)
  const aRoom = mkRoom(2, 2, 9, 7, 'A');
  const bRoom = mkRoom(w - 11, 2, 9, 7, 'B');

  // salas aleatorias no espaco restante
  const placed = [...reserved];
  let tries = 0;
  while (placed.length < roomCount + 4 && tries < 600) {
    tries++;
    const rw = irange(r, 5, 10), rh = irange(r, 5, 9);
    const x = irange(r, 2, Math.max(2, w - rw - 2));
    const y = irange(r, 2, Math.max(2, h - rh - 2));
    const box = { x, y, w: rw, h: rh };
    let ok = true;
    for (const p of placed) {
      if (box.x < p.x + p.w + 1 && box.x + box.w + 1 > p.x &&
          box.y < p.y + p.h + 1 && box.y + box.h + 1 > p.y) { ok = false; break; }
    }
    if (!ok) continue;
    mkRoom(x, y, rw, rh, 'room');
    placed.push({ ...box, cx: x + (rw >> 1), cy: y + (rh >> 1) });
  }

  // Conecta todas as salas: MST sobre centros + loops extras
  const nodes = placed.map((p) => ({ cx: p.cx, cy: p.cy }));

  // --- cobertura ANTES dos corredores (corredores sao abertos por ultimo,
  //     garantindo que nada fique selado) ---
  const cov = [];
  for (let i = 0; i < cover; i++) {
    const candidates = placed.filter((p) => p.kind === 'room' || p.kind === 'A' || p.kind === 'B');
    if (!candidates.length) break;
    const room = candidates[irange(r, 0, candidates.length - 1)];
    const cw = irange(r, 1, 3), ch = irange(r, 1, 3);
    const cx = irange(r, room.x + 1, room.x + room.w - cw - 1);
    const cy = irange(r, room.y + 1, room.y + room.h - ch - 1);
    if (cx < 1 || cy < 1 || cx + cw >= w - 1 || cy + ch >= h - 1) continue;
    let free = true;
    for (let j = cy; j < cy + ch && free; j++) for (let i = cx; i < cx + cw; i++) {
      if (g.get(i, j) !== TILE.FLOOR) { free = false; break; }
    }
    if (!free) continue;
    g.rect(cx, cy, cw, ch, TILE.LOW);
    cov.push({ x: cx, y: cy, w: cw, h: ch });
  }

  const connected = [0];
  const inTree = new Set([0]);
  while (inTree.size < nodes.length) {
    let best = null, bestD = Infinity;
    for (const a of inTree) {
      for (let b = 0; b < nodes.length; b++) {
        if (inTree.has(b)) continue;
        const d = Math.hypot(nodes[a].cx - nodes[b].cx, nodes[a].cy - nodes[b].cy);
        if (d < bestD) { bestD = d; best = [a, b]; }
      }
    }
    if (!best) break;
    g.carveCorridor(nodes[best[0]].cx, nodes[best[0]].cy, nodes[best[1]].cx, nodes[best[1]].cy, corridor);
    inTree.add(best[1]);
    connected.push(best[1]);
  }
  // loops extras
  const extra = Math.max(2, Math.floor(placed.length * 0.35));
  for (let i = 0; i < extra; i++) {
    const a = irange(r, 0, nodes.length - 1), b = irange(r, 0, nodes.length - 1);
    if (a === b) continue;
    g.carveCorridor(nodes[a].cx, nodes[a].cy, nodes[b].cx, nodes[b].cy, corridor);
  }
  // garante ligacao direta T<->CT e A/B
  g.carveCorridor(tRoom.cx, tRoom.cy, ctRoom.cx, ctRoom.cy, corridor);
  g.carveCorridor(aRoom.cx, aRoom.cy, bRoom.cx, bRoom.cy, corridor);

  // borda garantida
  g.rect(0, 0, w, 1, TILE.WALL);
  g.rect(0, h - 1, w, 1, TILE.WALL);
  g.rect(0, 0, 1, h, TILE.WALL);
  g.rect(w - 1, 0, 1, h, TILE.WALL);

  // pontos de spawn (em volta dos centros das salas de spawn)
  const spawnPoints = (room, count) => {
    const pts = [];
    let guard = 0;
    while (pts.length < count && guard++ < 400) {
      const x = irange(r, room.x + 1, room.x + room.w - 2);
      const y = irange(r, room.y + 1, room.y + room.h - 2);
      if (g.get(x, y) !== TILE.FLOOR) continue;
      if (pts.some((p) => Math.hypot(p.x - x, p.y - y) < 1.4)) continue;
      pts.push({ x, y });
    }
    if (!pts.length) pts.push({ x: room.cx, y: room.cy });
    return pts;
  };

  const map = {
    id, name, tag, w, h,
    grid: g.d,
    spawns: {
      T: spawnPoints(tRoom, 8),
      CT: spawnPoints(ctRoom, 8),
    },
    sites: {
      A: { x: aRoom.cx, y: aRoom.cy, r: 3.4 },
      B: { x: bRoom.cx, y: bRoom.cy, r: 3.4 },
    },
    cover: cov,
  };

  // valida conectividade
  map.connected = validateConnectivity(map);
  return map;
}

// ---------------- Consultas de grid ----------------
export function tileAt(map, cx, cy) {
  if (cx < 0 || cy < 0 || cx >= map.w || cy >= map.h) return TILE.WALL;
  return map.grid[cy * map.w + cx];
}
export function isSolid(map, cx, cy) {
  const t = tileAt(map, cx, cy);
  return t === TILE.WALL || t === TILE.LOW;
}
export function worldToCell(x, y) {
  return { cx: Math.floor(x / CELL), cy: Math.floor(y / CELL) };
}
export function cellToWorld(cx, cy) {
  return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
}
export function cellCenter(cx, cy) { return cellToWorld(cx, cy); }

// ---------------- Colisao circulo x grid ----------------
// move eixo a eixo para deslizar ao longo das paredes
export function moveCircle(map, x, y, dx, dy, radius) {
  let nx = x, ny = y;
  const tryX = (x + dx);
  if (!collides(map, tryX, ny, radius)) nx = tryX;
  const tryY = (ny + dy);
  if (!collides(map, nx, tryY, radius)) ny = tryY;
  return { x: nx, y: ny };
}

export function collides(map, x, y, radius) {
  const minX = Math.floor((x - radius) / CELL), maxX = Math.floor((x + radius) / CELL);
  const minY = Math.floor((y - radius) / CELL), maxY = Math.floor((y + radius) / CELL);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      if (!isSolid(map, cx, cy)) continue;
      const bx = cx * CELL, by = cy * CELL;
      const closestX = Math.max(bx, Math.min(x, bx + CELL));
      const closestY = Math.max(by, Math.min(y, by + CELL));
      const ddx = x - closestX, ddy = y - closestY;
      if (ddx * ddx + ddy * ddy < radius * radius) return true;
    }
  }
  return false;
}

// ---------------- Raycast (DDA) ----------------
// Retorna { hit, dist, tile, cx, cy, side }
// lowBlocks: quando true, paredes baixas tambem bloqueiam o tiro
export function raycast(map, ox, oy, dirX, dirY, maxDist = 3000, lowBlocks = true) {
  let cx = Math.floor(ox / CELL), cy = Math.floor(oy / CELL);
  const deltaX = dirX === 0 ? 1e30 : Math.abs(CELL / dirX);
  const deltaY = dirY === 0 ? 1e30 : Math.abs(CELL / dirY);
  let stepX, stepY, sideDistX, sideDistY;
  if (dirX < 0) { stepX = -1; sideDistX = (ox - cx * CELL) * deltaX; }
  else { stepX = 1; sideDistX = ((cx + 1) * CELL - ox) * deltaX; }
  if (dirY < 0) { stepY = -1; sideDistY = (oy - cy * CELL) * deltaY; }
  else { stepY = 1; sideDistY = ((cy + 1) * CELL - oy) * deltaY; }

  let side = 0, dist = 0;
  for (let i = 0; i < 512; i++) {
    if (sideDistX < sideDistY) { dist = sideDistX; sideDistX += deltaX; cx += stepX; side = 0; }
    else { dist = sideDistY; sideDistY += deltaY; cy += stepY; side = 1; }
    if (dist > maxDist) return { hit: false, dist: maxDist, tile: TILE.FLOOR, cx, cy, side };
    const t = tileAt(map, cx, cy);
    if (t === TILE.WALL) return { hit: true, dist, tile: t, cx, cy, side };
    if (t === TILE.LOW && lowBlocks) return { hit: true, dist, tile: t, cx, cy, side };
  }
  return { hit: false, dist: maxDist, tile: TILE.FLOOR, cx, cy, side };
}

// Linha de visao entre dois pontos (usada por IA e por checagem de tiro)
export function hasLineOfSight(map, x1, y1, x2, y2, lowBlocks = true) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return true;
  const hit = raycast(map, x1, y1, dx / len, dy / len, len, lowBlocks);
  return !hit.hit || hit.dist >= len - 2;
}

// ---------------- Raycast com altura (mira vertical) ----------------
// O tiro viaja na altura eyeH e inclina com o pitch: em cada celula,
// a altura do tiro na distancia decide se a parede bloqueia.
export function raycast3D(map, ox, oy, dirX, dirY, maxDist = 3000, eyeH = 1.6, pitch = 0) {
  const tanP = Math.tan(pitch);
  let cx = Math.floor(ox / CELL), cy = Math.floor(oy / CELL);
  const deltaX = dirX === 0 ? 1e30 : Math.abs(CELL / dirX);
  const deltaY = dirY === 0 ? 1e30 : Math.abs(CELL / dirY);
  let stepX, stepY, sideDistX, sideDistY;
  if (dirX < 0) { stepX = -1; sideDistX = (ox - cx * CELL) * deltaX; }
  else { stepX = 1; sideDistX = ((cx + 1) * CELL - ox) * deltaX; }
  if (dirY < 0) { stepY = -1; sideDistY = (oy - cy * CELL) * deltaY; }
  else { stepY = 1; sideDistY = ((cy + 1) * CELL - oy) * deltaY; }

  let side = 0, dist = 0;
  for (let i = 0; i < 512; i++) {
    if (sideDistX < sideDistY) { dist = sideDistX; sideDistX += deltaX; cx += stepX; side = 0; }
    else { dist = sideDistY; sideDistY += deltaY; cy += stepY; side = 1; }
    if (dist > maxDist) break;
    const t = tileAt(map, cx, cy);
    if (t === TILE.WALL) {
      return { hit: true, dist, tile: t, cx, cy, side };
    }
    if (t === TILE.LOW) {
      // parede baixa: bloqueia somente se o tiro passa abaixo do topo
      const shotH = eyeH + dist * tanP;
      if (shotH <= WALL_LOW) {
        return { hit: true, dist, tile: t, cx, cy, side };
      }
      // caso contrario o tiro passa por cima e continua
    }
  }
  return { hit: false, dist: maxDist, tile: TILE.FLOOR, cx, cy, side };
}

// Altura do tiro a uma distancia dada (olho + inclinacao)
export function shotHeightAt(eyeH, pitch, dist) {
  return eyeH + dist * Math.tan(pitch);
}

// Altura do olho -> define se parede baixa bloqueia o tiro
export function eyeHeight(crouched) { return crouched ? EYE_CROUCH : EYE_STAND; }

// Se o tiro de um jogador (em pe ou agachado) e bloqueado pela parede baixa
export function lowBlocksFor(crouched) {
  return WALL_LOW >= eyeHeight(crouched);
}

// ---------------- Validação ----------------
export function validateConnectivity(map) {
  const start = map.spawns.T[0];
  const seen = new Set();
  const stack = [[start.x, start.y]];
  seen.add(start.y * map.w + start.x);
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      if (isSolid(map, nx, ny)) continue;
      const k = ny * map.w + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  const reach = (room) => {
    const c = { x: Math.floor(room.x), y: Math.floor(room.y) };
    return seen.has(c.y * map.w + c.x);
  };
  return {
    valid: reach(map.sites.A) && reach(map.sites.B) && reach(map.spawns.CT[0]),
    reachable: seen.size,
  };
}

// Pontos de chao aleatorios (para spawn de itens/IA)
export function randomFloorPoints(map, count, r = rng(7)) {
  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 60) {
    const cx = irange(r, 1, map.w - 2), cy = irange(r, 1, map.h - 2);
    if (isSolid(map, cx, cy)) continue;
    if (pts.some((p) => Math.hypot(p.x - cx, p.y - cy) < 2)) continue;
    const c = cellCenter(cx, cy);
    pts.push({ x: c.x, y: c.y });
  }
  return pts;
}

// ---------------- Campo de fluxo (BFS) ----------------
// Distancia em celulas de cada ponto do mapa ate o alvo.
// Usado pela IA para contornar paredes (estilo RTS).
const FLOW_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function computeFlowField(map, tx, ty) {
  const n = map.w * map.h;
  const dist = new Int16Array(n).fill(-1);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return dist;
  if (isSolid(map, tx, ty)) return dist;
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  const start = ty * map.w + tx;
  dist[start] = 0;
  q[tail++] = start;
  while (head < tail) {
    const cur = q[head++];
    const cx = cur % map.w;
    const cy = (cur / map.w) | 0;
    const d = dist[cur];
    for (const [dx, dy] of FLOW_DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      if (isSolid(map, nx, ny)) continue;
      // nao cortar quinas
      if (dx && dy && (isSolid(map, cx + dx, cy) || isSolid(map, cx, cy + dy))) continue;
      const ni = ny * map.w + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = d + 1;
      q[tail++] = ni;
    }
  }
  return dist;
}

// Proxima celula do caminho (vizinha com menor distancia no campo de fluxo)
export function flowStep(map, field, cx, cy) {
  if (!field) return null;
  let best = null, bestD = Infinity;
  for (const [dx, dy] of FLOW_DIRS) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
    const d = field[ny * map.w + nx];
    if (d >= 0 && d < bestD) { bestD = d; best = { cx: nx, cy: ny, d }; }
  }
  return best;
}
