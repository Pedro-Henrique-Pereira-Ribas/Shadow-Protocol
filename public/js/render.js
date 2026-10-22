// Renderizador raycasting 2D (estilo Wolfenstein/Doom) em Canvas 2D.
import { CELL, C, EYE_STAND, EYE_CROUCH, WALL_FULL } from '/shared/constants.js';
import { TILE, TILE_HEIGHT, tileAt } from '/shared/maps.js';

const TEX_SIZE = 128;
const FOV_PLANE = 0.72;      // meio-angulo da projecao
const SHADES = 7;

// ---------------- Texturas procedurais ----------------
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWallTexture(seed, base, accent) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const g = cv.getContext('2d');
  const r = mulberry(seed);

  g.fillStyle = base;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // borda superior clara: da um topo definido a silhueta da parede
  g.fillStyle = 'rgba(255,255,255,.16)';
  g.fillRect(0, 0, TEX_SIZE, 4);
  // base escura: ancora a parede no chao
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(0, TEX_SIZE - 5, TEX_SIZE, 5);

  // ruido
  const img = g.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 26;
    d[i] += n; d[i + 1] += n * 1.1; d[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);

  // painel: faixas horizontais e verticais (proporcional ao tamanho)
  g.strokeStyle = accent;
  g.globalAlpha = 0.55;
  g.lineWidth = 2;
  for (let y = 0; y < TEX_SIZE; y += TEX_SIZE / 4) {
    g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(TEX_SIZE, y + 0.5); g.stroke();
  }
  for (let x = 0; x < TEX_SIZE; x += TEX_SIZE / 2) {
    g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, TEX_SIZE); g.stroke();
  }
  g.globalAlpha = 1;

  // manchas
  g.globalAlpha = 0.14;
  g.fillStyle = '#000';
  for (let i = 0; i < TEX_SIZE / 6; i++) {
    const w = 4 + r() * 18, h = 3 + r() * 12;
    g.fillRect(r() * TEX_SIZE, r() * TEX_SIZE, w, h);
  }
  g.globalAlpha = 1;
  return cv;
}

function makeCrateTexture(seed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const g = cv.getContext('2d');
  const r = mulberry(seed);

  g.fillStyle = '#2b2015';
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  // tabuas
  for (let y = 0; y < TEX_SIZE; y += TEX_SIZE / 8) {
    g.fillStyle = y % (TEX_SIZE / 4) === 0 ? '#3a2c1d' : '#2f2417';
    g.fillRect(0, y, TEX_SIZE, TEX_SIZE / 8 - 1);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(0, y + TEX_SIZE / 8 - 1, TEX_SIZE, 1);
  }
  // ferragens
  g.strokeStyle = '#5d6b5f';
  g.lineWidth = 5;
  g.strokeRect(3, 3, TEX_SIZE - 6, TEX_SIZE - 6);
  g.beginPath(); g.moveTo(4, 4); g.lineTo(TEX_SIZE - 4, TEX_SIZE - 4); g.stroke();
  g.beginPath(); g.moveTo(TEX_SIZE - 4, 4); g.lineTo(4, TEX_SIZE - 4); g.stroke();
  // granulado
  g.globalAlpha = 0.2;
  for (let i = 0; i < TEX_SIZE * 1.5; i++) {
    g.fillStyle = r() > 0.5 ? '#000' : '#7a6a52';
    g.fillRect(r() * TEX_SIZE, r() * TEX_SIZE, 2, 2);
  }
  g.globalAlpha = 1;
  return cv;
}

function shadeCanvas(src, level, light = false) {
  const cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  const g = cv.getContext('2d');
  g.drawImage(src, 0, 0);
  const k = level / (SHADES - 1);
  if (!light) {
    // ESCURO: escurece conforme a distancia
    g.globalCompositeOperation = 'multiply';
    const val = Math.round(255 * (0.18 + 0.82 * k));
    g.fillStyle = `rgb(${val},${val},${val})`;
    g.fillRect(0, 0, cv.width, cv.height);
  } else {
    // CLARO: clareia e lava com verde-claro
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(236, 245, 238, ${0.20 + (1 - k) * 0.62})`;
    g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'source-over';
    const val = Math.round(255 * (0.70 + 0.30 * k));
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${val},${Math.round(val * 1.02)},${Math.round(val * 0.97)})`;
    g.fillRect(0, 0, cv.width, cv.height);
  }
  g.globalCompositeOperation = 'source-over';
  return cv;
}

// Paletas do cenario por tema
const SCENES = {
  dark: {
    ceil: ['#030604', '#0a140d'],
    floor: ['#101d15', '#050a07'],
    crosshair: 'rgba(79,217,138,.92)',
    dot: 'rgba(255,255,255,.9)',
    vignette: ['rgba(0,0,0,0)', 'rgba(0,0,0,.62)'],
    contact: 'rgba(0,0,0,.55)',
    floorLine: 'rgba(120,200,150,ALPHA)',
    floorBand: 'rgba(140,220,170,ALPHA)',
    fog: 0,
    light: false,
  },
  light: {
    ceil: ['#eef3ef', '#d3ddd6'],
    floor: ['#d9e1da', '#b9c5bc'],
    crosshair: 'rgba(16,70,42,.92)',
    dot: 'rgba(16,40,26,.9)',
    vignette: ['rgba(20,40,28,0)', 'rgba(20,40,28,.26)'],
    contact: 'rgba(20,40,28,.45)',
    floorLine: 'rgba(40,90,55,ALPHA)',
    floorBand: 'rgba(255,255,255,ALPHA)',
    fog: 1,
    light: true,
  },
};

export class Renderer {
  constructor(canvas, theme = 'dark') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.theme = SCENES[theme] ? theme : 'dark';
    this.w = 0; this.h = 0;
    this.scale = 1;
    this.textures = {};
    this.buildTextures();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildTextures() {
    const wall = makeWallTexture(11, '#2b5238', '#0a1a10');
    const crate = makeCrateTexture(29);
    const metal = makeWallTexture(47, '#33403a', '#0c1210');
    const light = SCENES[this.theme]?.light;
    this.textures = {
      [TILE.WALL]: Array.from({ length: SHADES }, (_, i) => shadeCanvas(wall, i, light)),
      [TILE.LOW]: Array.from({ length: SHADES }, (_, i) => shadeCanvas(crate, i, light)),
      [TILE.FLOOR]: Array.from({ length: SHADES }, (_, i) => shadeCanvas(metal, i, light)),
    };
  }

  // Alterna entre os temas claro e escuro
  setTheme(theme) {
    if (!SCENES[theme] || this.theme === theme) return;
    this.theme = theme;
    this.buildTextures();
  }

  resize() {
    // em telas de toque renderiza em resolucao moderada para manter o FPS
    const isTouch = (navigator.maxTouchPoints || 0) > 0;
    const dpr = Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 1);
    const maxW = isTouch ? 1100 : 1600;
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    this.w = Math.max(320, Math.min(maxW, Math.round(cssW * dpr)));
    this.h = Math.max(240, Math.round(this.w * (cssH / cssW)));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    // colunas por pixel: 1 = nitido; 2 = mais leve (celular)
    this.pixelStep = isTouch ? 2 : 1;
    // distancia focal da camera (projecao pinhole) em pixels
    this.focal = (this.w / 2) / FOV_PLANE;
  }

  // ---------------- Rasterizacao principal ----------------
  render(game, dt = 0.016) {
    const ctx = this.ctx;
    const { w, h } = this;
    const map = game.map;
    const p = game.player;

    const eye = p.crouched ? EYE_CROUCH : EYE_STAND;
    const dirX = Math.cos(p.angle), dirY = Math.sin(p.angle);
    const planeX = -dirY * FOV_PLANE, planeY = dirX * FOV_PLANE;
    // horizonte desloca conforme a inclinacao da mira (olhar para cima desce o horizonte)
    const pitch = p.pitch || 0;
    const horizon = h / 2 + this.focal * Math.tan(pitch);
    const scene = SCENES[this.theme] || SCENES.dark;

    // fundo: teto e chao
    const ceilGrad = ctx.createLinearGradient(0, 0, 0, horizon);
    ceilGrad.addColorStop(0, scene.ceil[0]);
    ceilGrad.addColorStop(1, scene.ceil[1]);
    ctx.fillStyle = ceilGrad;
    ctx.fillRect(0, 0, w, horizon + 1);
    const floorGrad = ctx.createLinearGradient(0, horizon, 0, h);
    floorGrad.addColorStop(0, scene.floor[0]);
    floorGrad.addColorStop(1, scene.floor[1]);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, horizon, w, h - horizon);

    // --------- linhas de profundidade no chao ---------
    // dao referencia de movimento e distancia (sem elas a parede "escorrega")
    const eyeH = eye;
    const bandStep = 2;                       // metros
    for (let d = 70; d >= bandStep; d -= bandStep) {
      const sy = horizon + (this.focal * eyeH) / d;
      if (sy > h) continue;                   // abaixo da tela
      if (sy < 0) break;
      const fade = Math.max(0, 1 - d / 70);
      ctx.fillStyle = scene.floorLine.replace('ALPHA', (0.22 * fade).toFixed(3));
      ctx.fillRect(0, sy, w, 1.2);
      const nd = d - bandStep;
      if (nd > 0) {
        const nearer = horizon + (this.focal * eyeH) / nd;
        if (nearer < h && nearer > sy) {
          ctx.fillStyle = scene.floorBand.replace('ALPHA', (0.055 * fade).toFixed(3));
          ctx.fillRect(0, sy, w, nearer - sy);
        }
      }
    }

    // --------- paredes ---------
    // 1 coluna por pixel da tela: cada pixel amostra o ponto exato do
    // mundo -> sem borrado e sem "textura escorregando" ao andar
    const cols = Math.max(1, Math.floor(w / (this.pixelStep || 1)));
    const colW = w / cols;
    for (let i = 0; i < cols; i++) {
      const camX = 2 * (i + 0.5) / cols - 1;
      let rdx = dirX + planeX * camX;
      let rdy = dirY + planeY * camX;
      const len = Math.hypot(rdx, rdy);
      rdx /= len; rdy /= len;

      // DDA
      let mapX = Math.floor(p.x / CELL), mapY = Math.floor(p.y / CELL);
      const deltaX = rdx === 0 ? 1e30 : Math.abs(CELL / rdx);
      const deltaY = rdy === 0 ? 1e30 : Math.abs(CELL / rdy);
      let stepX, stepY, sideDistX, sideDistY;
      if (rdx < 0) { stepX = -1; sideDistX = (p.x - mapX * CELL) * deltaX; }
      else { stepX = 1; sideDistX = ((mapX + 1) * CELL - p.x) * deltaX; }
      if (rdy < 0) { stepY = -1; sideDistY = (p.y - mapY * CELL) * deltaY; }
      else { stepY = 1; sideDistY = ((mapY + 1) * CELL - p.y) * deltaY; }

      let side = 0, dist = 0, hit = false, tile = TILE.FLOOR;
      let wallX = 0;
      for (let k = 0; k < 256; k++) {
        if (sideDistX < sideDistY) { dist = sideDistX; sideDistX += deltaX; mapX += stepX; side = 0; }
        else { dist = sideDistY; sideDistY += deltaY; mapY += stepY; side = 1; }
        if (dist > 1400) break;
        const t = tileAt(map, mapX, mapY);
        if (t !== TILE.FLOOR) {
          hit = true; tile = t;
          wallX = side === 0 ? p.y + dist * rdy : p.x + dist * rdx;
          wallX -= Math.floor(wallX);
          break;
        }
      }
      if (!hit) continue;

      const wallH = TILE_HEIGHT[tile] || WALL_FULL;
      const ppu = this.focal / dist;             // pixels por metro nesse ponto
      const drawStart = horizon + (eye - wallH) * ppu;
      const drawEnd = horizon + eye * ppu;
      const dh = drawEnd - drawStart;
      if (drawStart > h || drawEnd < 0) continue;

      // nivel de sombra por distancia + lado
      const fog = Math.min(1, dist / (this.focal * 2.4));
      let lvl = Math.floor((1 - fog) * (SHADES - 1));
      if (side === 1) lvl = Math.max(0, lvl - 1);
      const texArr = this.textures[tile] || this.textures[TILE.WALL];
      const tex = texArr[Math.max(0, Math.min(SHADES - 1, lvl))];

      const texU = Math.floor(wallX * TEX_SIZE);
      ctx.drawImage(tex, texU, 0, 1, TEX_SIZE, i * colW, drawStart, colW + 0.6, dh);

      // sombra de contato na base da parede: deixa o limite com o chao nitido
      const baseY = drawEnd;
      if (baseY < h && baseY > 0) {
        ctx.fillStyle = scene.contact;
        ctx.fillRect(i * colW, baseY - 1.5, colW + 0.6, 1.5);
      }
    }

    // --------- sprites ---------
    const sprites = game.collectSprites ? game.collectSprites() : [];
    if (sprites.length) {
      const invDet = 1 / (planeX * dirY - dirX * planeY);
      const ordered = sprites
        .map((s) => {
          const relX = s.x - p.x, relY = s.y - p.y;
          const tX = invDet * (dirY * relX - dirX * relY);
          const tY = invDet * (-planeY * relX + planeX * relY);
          return { s, tX, tY, d: tY };
        })
        .filter((o) => o.tY > 8)
        .sort((a, b) => b.d - a.d);

      for (const o of ordered) {
        const ppu = this.focal / o.tY;
        const sH = (o.s.h || 1.75) * ppu;
        const sW = sH * (o.s.aspect || 0.55);
        const sx = (w / 2) * (1 + o.tX / o.tY);
        const bottomY = horizon + eye * ppu;
        const topY = bottomY - sH;
        if (sx + sW < 0 || sx - sW > w) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx - sW / 2, topY, sW, sH);
        ctx.clip();
        if (o.s.kind === 'soldier') this.drawSoldier(ctx, sx, topY, sW, sH, o.s);
        else if (o.s.kind === 'item') this.drawItem(ctx, sx, topY, sW, sH, o.s);
        else if (o.s.kind === 'bomb') this.drawBomb(ctx, sx, topY, sW, sH, o.s);
        else if (o.s.kind === 'ammo') this.drawAmmo(ctx, sx, topY, sW, sH, o.s);
        else this.drawSoldier(ctx, sx, topY, sW, sH, o.s);
        ctx.restore();

        if (o.s.name) {
          const ty = topY - 10;
          ctx.font = '600 12px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(0,0,0,.65)';
          ctx.fillRect(sx - ctx.measureText(o.s.name).width / 2 - 4, ty - 2, ctx.measureText(o.s.name).width + 8, 15);
          ctx.fillStyle = o.s.team === 'T' ? '#4fd98a' : '#e8f1ea';
          ctx.fillText(o.s.name, sx, ty + 11);
          if (o.s.hp !== undefined && o.s.hp < 100) {
            const bw = sW * 0.8;
            ctx.fillStyle = 'rgba(0,0,0,.7)';
            ctx.fillRect(sx - bw / 2, ty + 14, bw, 3);
            ctx.fillStyle = '#4fd98a';
            ctx.fillRect(sx - bw / 2, ty + 14, bw * (o.s.hp / 100), 3);
          }
        }
      }
    }

    // --------- efeitos ---------
    if (game.damageFlash > 0) {
      ctx.fillStyle = `rgba(224,80,60,${Math.min(0.45, game.damageFlash)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, game.flash)})`;
      ctx.fillRect(0, 0, w, h);
    }
    // vinheta
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
    vg.addColorStop(0, scene.vignette[0]);
    vg.addColorStop(1, scene.vignette[1]);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // --------- arma na mao (viewmodel) ---------
    // desenhada por cima da vinheta para continuar nitida
    this.drawViewmodel(ctx, w, h, game);

    // --------- mira ---------
    this.drawCrosshair(ctx, w, h, game);
    if (game.hitMarker > 0) this.drawHitMarker(ctx, w, h, game.hitMarker);
  }

  // ---------------- Arma na mao ----------------
  // ancora visual do jogador: balanco ao andar, recuo ao atirar
  drawViewmodel(ctx, w, h, game) {
    const p = game.player;
    const wpn = p.weaponDef;
    if (!wpn || !wpn.mag) return;

    const light = (SCENES[this.theme] || SCENES.dark).light;
    const moving = Math.hypot(p.vx, p.vy);
    const speedK = Math.min(1, moving / 5.6);

    // balanco vertical/horizontal conforme anda
    const bobY = Math.sin(p.bob * 2) * 7 * speedK;
    const bobX = Math.cos(p.bob) * 5 * speedK;
    // recuo ao atirar
    const kick = Math.min(1, p.recoil || 0) * 26;
    const kickRot = Math.min(1, p.recoil || 0) * 0.09;

    const scale = w / 1280;
    const long = ['fuzil', 'fuzil4', 'pesado', 'sniper', 'escopeta'].includes(p.weapon);
    const gunLen = (long ? 300 : 170) * scale;
    const gunH = (long ? 46 : 58) * scale;

    const baseX = w * 0.60 + bobX;
    const baseY = h + 26 * scale + bobY - kick;

    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.rotate(kickRot);
    ctx.scale(scale, scale);

    const metal = light ? '#3a4740' : '#161c18';
    const metalLight = light ? '#66756b' : '#2b3730';
    const accent = light ? '#1c5c33' : '#4fd98a';

    // mao / punho
    ctx.fillStyle = light ? '#b08a63' : '#7d6249';
    ctx.fillRect(-38, -34, 52, 96);
    ctx.fillRect(26, -52, 44, 78);

    // corpo da arma
    ctx.fillStyle = metal;
    ctx.fillRect(-30, -96, gunLen / scale * 0.72, gunH);
    ctx.fillStyle = metalLight;
    ctx.fillRect(-30, -96, gunLen / scale * 0.72, 7);
    // cano
    ctx.fillStyle = metal;
    ctx.fillRect(gunLen / scale * 0.42, -88, gunLen / scale * 0.6, 16);
    // carregador
    ctx.fillStyle = metal;
    ctx.fillRect(18, -58, 34, 62);
    // detalhes em verde (tema)
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(-22, -84, 54, 5);
    ctx.fillRect(24, -50, 22, 5);
    ctx.globalAlpha = 1;
    // mira
    ctx.fillStyle = metalLight;
    ctx.fillRect(gunLen / scale * 0.5, -104, 42, 9);

    ctx.restore();
  }

  // ---------------- Sprites ----------------
  drawSoldier(ctx, sx, topY, w, h, s) {
    const crouch = s.crouched;
    const teamT = s.team === 'T';
    const light = (SCENES[this.theme] || SCENES.dark).light;
    const body = teamT ? (light ? '#1f6b3a' : '#2f7a4a') : (light ? '#8ea3b5' : '#dfe9e2');
    const bodyDark = teamT ? (light ? '#0f3d20' : '#14472a') : (light ? '#5d6f7d' : '#8ea396');
    const vest = teamT ? (light ? '#08240f' : '#0d2e1b') : (light ? '#3c4a54' : '#2c3a32');
    const skin = light ? '#b08a63' : '#c9a583';
    const outline = light ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.35)';

    // sombra
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(sx, topY + h * 0.98, w * 0.42, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const legH = crouch ? h * 0.16 : h * 0.26;
    const torsoY = topY + (crouch ? h * 0.44 : h * 0.30);
    const torsoH = crouch ? h * 0.34 : h * 0.40;
    const headR = w * 0.20;

    // pernas
    ctx.fillStyle = bodyDark;
    ctx.fillRect(sx - w * 0.20, torsoY + torsoH - 2, w * 0.16, legH);
    ctx.fillRect(sx + w * 0.04, torsoY + torsoH - 2, w * 0.16, legH);
    // torso
    ctx.fillStyle = body;
    ctx.fillRect(sx - w * 0.26, torsoY, w * 0.52, torsoH);
    // colete
    ctx.fillStyle = vest;
    ctx.fillRect(sx - w * 0.22, torsoY + torsoH * 0.18, w * 0.44, torsoH * 0.46);
    // ombros
    ctx.fillStyle = bodyDark;
    ctx.fillRect(sx - w * 0.30, torsoY, w * 0.60, torsoH * 0.14);
    // cabeca
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(sx, torsoY - headR * 0.95, headR, 0, Math.PI * 2);
    ctx.fill();
    // capacete
    ctx.fillStyle = teamT ? '#0f3a20' : '#2b3a31';
    ctx.beginPath();
    ctx.arc(sx, torsoY - headR * 1.05, headR * 1.04, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(sx - headR * 1.05, torsoY - headR * 1.05, headR * 2.1, headR * 0.36);
    // arma
    ctx.fillStyle = '#0b0f0c';
    ctx.fillRect(sx + w * 0.02, torsoY + torsoH * 0.18, w * 0.52, h * 0.045);
    ctx.fillRect(sx + w * 0.10, torsoY + torsoH * 0.30, w * 0.12, h * 0.10);
    // faixa de vida no peito (hostis)
    if (s.team === 'T' && s.hp !== undefined) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(sx - w * 0.22, torsoY + torsoH * 0.70, w * 0.44, h * 0.035);
      ctx.fillStyle = '#e0503c';
      ctx.fillRect(sx - w * 0.22, torsoY + torsoH * 0.70, w * 0.44 * (s.hp / 100), h * 0.035);
    }

    // contorno para destacar no tema claro
    if (light) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = Math.max(1, w * 0.035);
      ctx.strokeRect(sx - w * 0.26, torsoY, w * 0.52, torsoH);
      ctx.beginPath();
      ctx.arc(sx, torsoY - headR * 0.95, headR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawItem(ctx, sx, topY, w, h, s) {
    const green = s.type === 'health';
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.ellipse(sx, topY + h * 0.95, w * 0.4, h * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = green ? '#123322' : '#1a2a22';
    ctx.fillRect(sx - w * 0.28, topY + h * 0.35, w * 0.56, h * 0.5);
    ctx.strokeStyle = green ? '#4fd98a' : '#e8b13d';
    ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.strokeRect(sx - w * 0.28, topY + h * 0.35, w * 0.56, h * 0.5);
    ctx.fillStyle = green ? '#4fd98a' : '#e8b13d';
    if (green) {
      ctx.fillRect(sx - w * 0.06, topY + h * 0.45, w * 0.12, h * 0.30);
      ctx.fillRect(sx - w * 0.16, topY + h * 0.55, w * 0.32, h * 0.10);
    } else {
      ctx.fillRect(sx - w * 0.20, topY + h * 0.52, w * 0.40, h * 0.12);
    }
  }

  drawAmmo(ctx, sx, topY, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.ellipse(sx, topY + h * 0.95, w * 0.35, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#26332a';
    ctx.fillRect(sx - w * 0.30, topY + h * 0.45, w * 0.60, h * 0.36);
    ctx.strokeStyle = '#e8b13d';
    ctx.lineWidth = Math.max(1, w * 0.04);
    ctx.strokeRect(sx - w * 0.30, topY + h * 0.45, w * 0.60, h * 0.36);
    ctx.fillStyle = '#e8b13d';
    for (let i = 0; i < 3; i++) ctx.fillRect(sx - w * 0.18 + i * w * 0.16, topY + h * 0.53, w * 0.08, h * 0.20);
  }

  drawBomb(ctx, sx, topY, w, h, s) {
    ctx.fillStyle = '#151a17';
    ctx.fillRect(sx - w * 0.22, topY + h * 0.45, w * 0.44, h * 0.4);
    ctx.fillStyle = s.team === 'T' ? '#e0503c' : '#4fd98a';
    ctx.fillRect(sx - w * 0.16, topY + h * 0.52, w * 0.32, h * 0.16);
    ctx.fillStyle = '#2a332d';
    ctx.fillRect(sx - w * 0.04, topY + h * 0.36, w * 0.08, h * 0.12);
  }

  // ---------------- Mira ----------------
  drawCrosshair(ctx, w, h, game) {
    if (game.hideCrosshair) return;
    const scene = SCENES[this.theme] || SCENES.dark;
    const cx = w / 2, cy = h / 2;
    const spread = 6 + (game.crosshairSpread || 0) * 26;
    const len = 7 + (game.crosshairSpread || 0) * 10;
    ctx.save();
    ctx.strokeStyle = scene.crosshair;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - spread - len, cy); ctx.lineTo(cx - spread, cy);
    ctx.moveTo(cx + spread, cy); ctx.lineTo(cx + spread + len, cy);
    ctx.moveTo(cx, cy - spread - len); ctx.lineTo(cx, cy - spread);
    ctx.moveTo(cx, cy + spread); ctx.lineTo(cx, cy + spread + len);
    ctx.stroke();
    ctx.fillStyle = scene.dot;
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    ctx.restore();
  }

  drawHitMarker(ctx, w, h, t) {
    const cx = w / 2, cy = h / 2;
    const s = 10 + (1 - t) * 6;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, t)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx - s * 0.4, cy - s * 0.4);
    ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx + s * 0.4, cy - s * 0.4);
    ctx.moveTo(cx - s, cy + s); ctx.lineTo(cx - s * 0.4, cy + s * 0.4);
    ctx.moveTo(cx + s, cy + s); ctx.lineTo(cx + s * 0.4, cy + s * 0.4);
    ctx.stroke();
    ctx.restore();
  }
}
