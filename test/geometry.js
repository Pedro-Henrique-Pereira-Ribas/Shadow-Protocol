// Teste de geometria da renderizacao: a parede precisa aparecer na posicao
// correta na tela (e nao "escorregar" quando o jogador anda).
import { getMap } from '../shared/mapdefs.js';
import { CELL, EYE_STAND, EYE_CROUCH } from '../shared/constants.js';
import { cellToWorld, tileAt, TILE } from '../shared/maps.js';

// stub de canvas que REGISTRA as chamadas
function makeRecordingCanvas() {
  const calls = { fillRect: [], drawImage: [], path: [], strokes: 0 };
  const cv = {
    width: 1280, height: 720, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '',
    globalAlpha: 1, globalCompositeOperation: 'source-over', textAlign: 'left',
    fillRect(x, y, w, h) { calls.fillRect.push({ x, y, w, h, fill: this.fillStyle }); },
    clearRect() {},
    drawImage(...a) { calls.drawImage.push(a); },
    moveTo(x, y) { calls.path.push({ x, y }); },
    lineTo(x, y) { calls.path.push({ x, y }); },
    stroke() { calls.strokes++; },
    fillText() {}, strokeText() {}, strokeRect() {},
    beginPath() {}, closePath() {}, arc() {}, ellipse() {}, rect() {},
    fill() {}, clip() {}, save() {}, restore() {}, translate() {}, rotate() {},
    scale() {}, setTransform() {}, measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {},
  };
  const ctx = cv.getContext = () => cv;
  return { cv, calls };
}

globalThis.document = {
  createElement: (tag) => {
    if (tag === 'canvas') {
      const { cv, calls } = makeRecordingCanvas();
      cv.__calls = calls;
      return cv;
    }
    return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, getContext: () => ({}) };
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  documentElement: { setAttribute() {}, getAttribute: () => 'dark' },
};
globalThis.window = { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
try {
  Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
} catch { /* ignore */ }

const { Renderer } = await import('../public/js/render.js');
const { Game } = await import('../public/js/game.js');

const ok = (c, m) => console.log(`${c ? '  OK  ' : ' FALHA'} | ${m}`);

console.log('\n=== GEOMETRIA DA RENDERIZACAO ===');

const map = getMap('de_verde');
const game = new Game(map, { loadout: ['pistola'] });
const canvas = document.createElement('canvas');
const r = new Renderer(canvas, 'dark');
const focal = (r.w / 2) / 0.72;
const spot = cellToWorld(map.spawns.T[0].x, map.spawns.T[0].y);

// encontra uma parede em frente a um ponto aberto
function wallInFront(cx, cy, dirX, dirY) {
  let x = cx, y = cy;
  for (let d = 0; d < 30; d += 0.1) {
    x += dirX * 0.1; y += dirY * 0.1;
    const tx = Math.floor(x / CELL), ty = Math.floor(y / CELL);
    if (tileAt(map, tx, ty) === TILE.WALL) {
      return { dist: d, x, y };
    }
  }
  return null;
}

// --- 1. a base da parede aparece na altura correta ---
{
  // procura uma parede virando para o norte
  let found = null;
  for (let ang = 0; ang < Math.PI * 2 && !found; ang += 0.05) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const w = wallInFront(spot.x, spot.y, dx, dy);
    if (w && w.dist > 3 && w.dist < 12) found = { ang, dx, dy, w };
  }
  ok(!!found, `parede encontrada a ${found ? found.w.dist.toFixed(1) : 0}m`);

  if (found) {
    game.player.x = spot.x; game.player.y = spot.y;
    game.player.angle = found.ang;
    game.player.pitch = 0;
    canvas.__calls.fillRect.length = 0;
    canvas.__calls.drawImage.length = 0;
    r.render(game, 0.016);

    // as "sombra de contato" sao os fillRect de 1.5px de altura na base
    const contacts = canvas.__calls.fillRect.filter((c) => c.h <= 2 && c.h > 0.5 && c.w > 0.4 && c.w < 4);
    ok(contacts.length > 0, `linha de base da parede desenhada (${contacts.length} colunas)`);

    // a altura esperada da base: horizon + eye * focal / dist
    const expected = r.h / 2 + (EYE_STAND * focal) / found.w.dist;
    const ys = contacts.map((c) => c.y).sort((a, b) => a - b);
    const median = ys[Math.floor(ys.length / 2)];
    const err = Math.abs(median - expected);
    ok(err < expected * 0.12,
      `altura da base da parede correta: real=${median.toFixed(0)}px esperado=${expected.toFixed(0)}px (erro ${err.toFixed(0)}px)`);
    ok(median > r.h / 2, `base da parede abaixo do horizonte (${median.toFixed(0)} > ${(r.h / 2).toFixed(0)})`);
  }
}

// --- 2. a parede nao escorrega quando o jogador anda ---
{
  // mede a base da parede na coluna central (a mira) a cada passo
  const baseAtCenter = [];
  for (let i = 0; i < 4; i++) {
    game.player.x = spot.x;
    game.player.y = spot.y + i * 0.25;          // andando na direcao da mira (+y = sul)
    game.player.angle = Math.PI / 2;            // olhando para +y
    game.player.pitch = 0;
    canvas.__calls.fillRect.length = 0;
    r.render(game, 0.016);
    const contacts = canvas.__calls.fillRect.filter(
      (c) => c.h <= 2 && c.h > 0.5 && c.w > 0.4 && c.w < 4
        && Math.abs(c.x + c.w / 2 - r.w / 2) < r.w * 0.02,
    );
    if (contacts.length) baseAtCenter.push(contacts[0].y);
  }
  ok(baseAtCenter.length >= 4, `medidas da parede na mira: ${baseAtCenter.length}`);
  // a base deve variar de forma SUAVE (nada de saltos)
  let maxJump = 0;
  for (let i = 1; i < baseAtCenter.length; i++) {
    maxJump = Math.max(maxJump, Math.abs(baseAtCenter[i] - baseAtCenter[i - 1]));
  }
  ok(maxJump < 40, `sem salto vertical ao andar (maior variacao ${maxJump.toFixed(1)}px)`);
  // e deve monotonamente descer (a parede se aproxima -> base mais baixa na tela)
  const monotonic = baseAtCenter.every((v, i) => i === 0 || v >= baseAtCenter[i - 1] - 1);
  ok(monotonic, `base desce de forma consistente ao aproximar (${baseAtCenter.map((v) => Math.round(v)).join(', ')})`);
}

// --- 3. resolucao horizontal: 1 coluna por pixel (sem borrado) ---
{
  canvas.__calls.drawImage.length = 0;
  game.player.x = spot.x; game.player.y = spot.y;
  game.player.angle = 0;
  r.render(game, 0.016);
  const wallSlices = canvas.__calls.drawImage.length;
  ok(wallSlices >= r.w * 0.5,
    `fatias de parede por frame: ${wallSlices} (tela ${r.w}px) -> sem borrado horizontal`);
}
// --- 4. grade de referencia no chao existe e se move lateralmente ---
{
  const gridAt = (px, py) => {
    canvas.__calls.path.length = 0;
    canvas.__calls.strokes = 0;
    game.player.x = px; game.player.y = py;
    game.player.angle = 0;
    r.render(game, 0.016);
    return { segs: canvas.__calls.path.length, strokes: canvas.__calls.strokes };
  };
  const g1 = gridAt(spot.x, spot.y);
  ok(g1.strokes > 10, `grade do chao desenhada (${g1.strokes} trechos, ${g1.segs} pontos)`);

  // ao andar de lado, a grade precisa mudar de posicao (paralaxe lateral)
  canvas.__calls.path.length = 0;
  r.render(game, 0.016);
  const ptsA = canvas.__calls.path.map((p) => Math.round(p.x)).join(',');
  const g2 = gridAt(spot.x + 1, spot.y);
  const ptsB = canvas.__calls.path.map((p) => Math.round(p.x)).join(',');
  ok(ptsA !== ptsB, 'a grade do chao tem paralaxe lateral (referencia de movimento)');

  // e ao virar, tambem
  const g3 = gridAt(spot.x, spot.y);
  game.player.angle = Math.PI / 2;
  canvas.__calls.path.length = 0;
  r.render(game, 0.016);
  const ptsC = canvas.__calls.path.map((p) => Math.round(p.x)).join(',');
  ok(ptsA !== ptsC, 'a grade do chao muda ao virar a camera');
}

// --- 5. quinas das paredes sao destacadas ---
{
  // procura um angulo em que ha uma quina visivel
  let found = false;
  for (let ang = 0; ang < Math.PI * 2 && !found; ang += 0.02) {
    game.player.x = spot.x; game.player.y = spot.y;
    game.player.angle = ang;
    canvas.__calls.fillRect.length = 0;
    r.render(game, 0.016);
    const edges = canvas.__calls.fillRect.filter((c) => c.w <= 2 && c.w >= 1 && c.h > 60);
    if (edges.length >= 1) found = true;
  }
  ok(found, 'quina da parede destacada com linha vertical (da para ver onde vira)');
}

console.log('\nCONCLUIDO\n');
process.exit(0);
