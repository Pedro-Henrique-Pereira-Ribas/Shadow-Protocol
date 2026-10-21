// Teste headless da logica de jogo (Modo Historia) com entrada simulada.
import { getMap } from '../shared/mapdefs.js';
import { STORY_MISSIONS } from '../shared/story.js';
import { ENEMY_TYPES } from '../shared/story.js';

// ---- stubs minimos de DOM (o jogo nao usa DOM na logica) ----
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    getContext: () => ({
      fillRect() {}, clearRect() {}, drawImage() {}, fillText() {}, strokeRect() {},
      beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, rect() {},
      closePath() {}, fill() {}, stroke() {}, save() {}, restore() {}, translate() {},
      rotate() {}, scale() {}, clip() {}, setTransform() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData() {}, measureText: () => ({ width: 10 }),
      set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set font(v) {},
      set globalAlpha(v) {}, set globalCompositeOperation(v) {}, set textAlign(v) {},
    }),
  }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
globalThis.location = { protocol: 'http:', host: 'localhost:3000' };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const { StoryGame } = await import('../public/js/story.js');

const ok = (c, m) => console.log(`${c ? '  OK  ' : ' FALHA'} | ${m}`);

// ---- entrada falsa ----
class FakeInput {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDown = false;
    this.mouseClicked = false;
    this.mx = 0;
    this.ax = 0; this.ay = 0;
  }
  down(c) { return this.keys.has(c); }
  hit(c) { const v = this.pressed.has(c); this.pressed.delete(c); return v; }
  axis() { return { x: this.ax, y: this.ay }; }
  consumeMouse() { const d = this.mx; this.mx = 0; return d; }
  consumeWheel() { return 0; }
  endFrame() { this.pressed.clear(); this.mouseClicked = false; }
}

console.log('\n=== SIMULACAO DAS MISSOES (headless) ===');

for (const mission of STORY_MISSIONS) {
  const map = getMap(mission.mapId);
  const input = new FakeInput();
  let ended = null;
  const game = new StoryGame(map, mission.id, {
    onMissionEnd: (res) => { ended = res; },
  });
  game.player.x = map.spawns.T[0].x * 64 + 32;
  game.player.y = map.spawns.T[0].y * 64 + 32;

  const dt = 1 / 60;
  let frames = 0;
  let spawned = 0;
  let deaths = 0;
  let stuckFrames = 0;
  let detour = 0;
  let detourDir = 1;
  let lastPos = { x: game.player.x, y: game.player.y };
  const maxFrames = 60 * 240; // 4 minutos simulados

  while (frames < maxFrames && !ended) {
    frames++;
    // respawn se morreu
    if (game.state === 'dead') { game.respawn(); deaths++; }

    const p = game.player;

    // escolhe a arma com mais municao
    let bestSlot = p.slotIndex, bestAmmo = -1;
    p.slots.forEach((w, i) => {
      const tot = (p.ammo[w] || 0) + (p.reserve[w] || 0) * 0.3;
      if (tot > bestAmmo) { bestAmmo = tot; bestSlot = i; }
    });
    if (bestSlot !== p.slotIndex) p.selectSlot(bestSlot);

    // recarrega quando necessario
    if ((p.ammo[p.weapon] || 0) === 0 && !p.reloading && (p.reserve[p.weapon] || 0) > 0) {
      input.pressed.add('KeyR');
    }

    // mira no inimigo mais proximo
    let best = null, bestD = Infinity;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestD) { bestD = d; best = e; }
    }

    // desliza em paredes quando fica travado
    if (frames % 12 === 0) {
      const moved = Math.hypot(p.x - lastPos.x, p.y - lastPos.y);
      if (moved < 6) { stuckFrames++; } else { stuckFrames = 0; }
      lastPos = { x: p.x, y: p.y };
      if (stuckFrames > 2) { detour = 40; detourDir = Math.random() < 0.5 ? 1 : -1; stuckFrames = 0; }
    }
    if (detour > 0) detour--;

    // busca itens quando precisa (vida baixa ou municao escassa)
    let itemTarget = null, itemD = Infinity;
    const needHealth = p.hp < 55;
    const needAmmo = (p.ammo[p.weapon] || 0) + (p.reserve[p.weapon] || 0) < 12;
    if (needHealth || needAmmo) {
      for (const it of game.items) {
        if (it.taken) continue;
        if (needHealth && it.type !== 'health') continue;
        if (needAmmo && it.type !== 'ammo') continue;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d < itemD) { itemD = d; itemTarget = it; }
      }
    }
    if (itemTarget) {
      const want = Math.atan2(itemTarget.y - p.y, itemTarget.x - p.x);
      let diff = want - p.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.angle += diff * 0.3;
      const rel = want - p.angle;
      input.ay = -Math.cos(rel) * 0.9;
      input.ax = Math.sin(rel) * 0.3;
      if (detour > 0) { input.ax = detourDir * 1; input.ay = 0; }
      if (bestD < 900 && best) { input.mouseDown = true; input.mouseClicked = true; }
    } else if (best) {
      const want = Math.atan2(best.y - p.y, best.x - p.x);
      let diff = want - p.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.angle += diff * 0.4;
      // avanca se longe, recua se colado (eixo local: ay negativo = frente)
      const ideal = 420;
      const rel = want - p.angle;
      const fwd = Math.cos(rel), side = Math.sin(rel);
      if (bestD > ideal) {
        input.ay = -fwd * 0.9;
        input.ax = side * 0.4;
      } else if (bestD < 180) {
        input.ay = fwd * 0.7;
        input.ax = -side * 0.4;
      } else { input.ax = 0; input.ay = 0; }
      if (detour > 0) { input.ax = detourDir * 1; input.ay = 0; }
      if (bestD < 900) { input.mouseDown = true; input.mouseClicked = true; }
    } else { input.ax = 0; input.ay = 0; }

    game.update(dt, input);
    input.endFrame();
    spawned = Math.max(spawned, game.enemies.length);
  }

  const total = mission.enemies.reduce((a, e) => a + e.count, 0);
  ok(!!ended, `${mission.id} ${mission.name}: ${ended ? `concluida em ${(ended.time / 1000).toFixed(1)}s (${ended.stars} estrelas, ${ended.accuracy}% precisao)` : 'NAO CONCLUIDA'}`);
  ok(ended && ended.kills === total, `   abates ${ended?.kills}/${total}`);
  ok(spawned > 0, `   inimigos spawnados: ${spawned}`);
  if (!ended) {
    console.log(`   [diag] frames=${frames} matou=${game.killed} tiros=${game.shotsFired} acertos=${game.shotsHit} ` +
      `hp=${Math.round(game.player.hp)} municao=${game.player.ammo[game.player.weapon]}/${game.player.reserve[game.player.weapon]} ` +
      `arma=${game.player.weapon} inimigosVivos=${game.enemies.filter((e) => e.alive).length} ` +
      `states=${JSON.stringify(game.enemies.reduce((a, e) => { a[e.state] = (a[e.state] || 0) + 1; return a; }, {}))}`);
  }
}

console.log('\n=== TIPOS DE INIMIGO ===');
for (const [k, v] of Object.entries(ENEMY_TYPES)) {
  ok(v.hp > 0 && v.speed > 0 && v.weapon, `${k}: hp=${v.hp} vel=${v.speed} arma=${v.weapon}`);
}

console.log('\nCONCLUIDO\n');
process.exit(0);
