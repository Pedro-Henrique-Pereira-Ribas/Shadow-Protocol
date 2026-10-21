// Teste de fumaça do cliente: carrega todos os modulos e renderiza frames.
const ok = (c, m) => console.log(`${c ? '  OK  ' : ' FALHA'} | ${m}`);

// ---------- stub de DOM/Canvas 2D ----------
function makeCtx(canvas) {
  const W = canvas.width || 300, H = canvas.height || 150;
  const buf = new Uint8ClampedArray(W * H * 4);
  const ctx = {
    canvas, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '',
    globalAlpha: 1, globalCompositeOperation: 'source-over', textAlign: 'left',
    _fill: [0, 0, 0, 255],
    fillRect(x, y, w, h) {
      const c = parseColor(this.fillStyle);
      this._fill = c;
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
      const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * W + xx) * 4;
          buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
        }
      }
    },
    clearRect() {},
    drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) { void img; void sx; void sy; void sw; void sh; void dx; void dy; void dw; void dh; },
    fillText() {}, strokeText() {},
    strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, rect() {},
    fill() {}, stroke() {}, clip() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const s = ((y + j) * W + (x + i)) * 4;
          const d = (j * w + i) * 4;
          out[d] = buf[s]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s + 2]; out[d + 3] = buf[s + 3];
        }
      }
      return { data: out, width: w, height: h };
    },
    putImageData(img) {
      const d = img.data;
      for (let j = 0; j < img.height; j++) {
        for (let i = 0; i < img.width; i++) {
          const s = (j * img.width + i) * 4;
          const t = ((j) * W + i) * 4;
          buf[t] = d[s]; buf[t + 1] = d[s + 1]; buf[t + 2] = d[s + 2]; buf[t + 3] = d[s + 3];
        }
      }
    },
  };
  return ctx;
}

function parseColor(s) {
  if (typeof s !== 'string') return [0, 0, 0, 255];
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? Math.round(p[3] * 255) : 255];
  }
  return [0, 0, 0, 255];
}

function makeCanvas() {
  const cv = {
    width: 300, height: 150, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
  const ctx = makeCtx(cv);
  cv.getContext = () => ctx;
  return cv;
}

const stubEls = new Map();
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }),
  getElementById: (id) => {
    if (id === 'radar') {
      const cv = makeCanvas(); cv.width = 220; cv.height = 220;
      return cv;
    }
    if (!stubEls.has(id)) {
      stubEls.set(id, { innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [] });
    }
    return stubEls.get(id);
  },
  querySelector: (sel) => {
    if (sel === '#radar') {
      const cv = makeCanvas(); cv.width = 220; cv.height = 220;
      return cv;
    }
    return null;
  },
  querySelectorAll: () => [],
  addEventListener() {},
  documentElement: { setAttribute() {}, getAttribute: () => 'dark' },
};
globalThis.window = {
  addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  matchMedia: () => ({ matches: false }),
};
globalThis.location = { protocol: 'http:', host: 'localhost:3000' };
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
};
globalThis.requestAnimationFrame = () => 0;

console.log('\n=== CARREGANDO MODULOS DO CLIENTE ===');
const mods = [
  '../public/js/util.js', '../public/js/api.js', '../public/js/audio.js',
  '../public/js/input.js', '../public/js/theme.js', '../public/js/render.js',
  '../public/js/hud.js', '../public/js/game.js', '../public/js/ai.js',
  '../public/js/story.js', '../public/js/online.js',
];
for (const m of mods) {
  try {
    await import(m);
    ok(true, m);
  } catch (e) {
    ok(false, `${m} -> ${e.message}`);
  }
}

console.log('\n=== RENDERIZACAO ===');
const { Renderer } = await import('../public/js/render.js');
const { StoryGame } = await import('../public/js/story.js');
const { getMap } = await import('../shared/mapdefs.js');

const canvas = makeCanvas();
const r = new Renderer(canvas, 'dark');
ok(r.w > 0 && r.h > 0, `canvas ${r.w}x${r.h}`);

const map = getMap('st_aldeia');
const game = new StoryGame(map, 'm1', {});
game.player.x = map.spawns.T[0].x * 64 + 32;
game.player.y = map.spawns.T[0].y * 64 + 32;
game.enemies = [];

try {
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    game.player.angle += 0.01;
    r.render(game, 0.016);
  }
  const dt = Date.now() - t0;
  ok(true, `60 frames renderizados em ${dt}ms (${(dt / 60).toFixed(1)}ms/frame)`);
  ok(dt / 60 < 60, 'desempenho aceitavel (<60ms por frame)');
} catch (e) {
  ok(false, `renderizar frame -> ${e.message}`);
}

// tema claro
try {
  r.setTheme('light');
  for (let i = 0; i < 10; i++) r.render(game, 0.016);
  ok(true, 'tema claro renderiza sem erros');
} catch (e) {
  ok(false, `tema claro -> ${e.message}`);
}

// sprites
try {
  const { Enemy } = await import('../public/js/ai.js');
  game.enemies = [new Enemy(map, 'soldador', game.player.x + 300, game.player.y)];
  r.setTheme('dark');
  r.render(game, 0.016);
  ok(true, 'renderiza com sprites (inimigos)');
} catch (e) {
  ok(false, `sprites -> ${e.message}`);
}

console.log('\n=== HUD ===');
try {
  const { Hud } = await import('../public/js/hud.js');
  const hud = new Hud('dark');
  hud.drawRadar(game);
  ok(true, 'radar desenhado sem erros');
} catch (e) {
  ok(false, `hud -> ${e.message}`);
}

console.log('\nCONCLUIDO\n');
process.exit(0);
