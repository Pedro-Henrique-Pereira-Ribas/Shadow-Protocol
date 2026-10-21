// Teste de inicializacao: monta o DOM real do index.html e executa o boot() de verdade.
import { readFile } from 'node:fs/promises';

const ok = (c, m) => console.log(`${c ? '  OK  ' : ' FALHA'} | ${m}`);

// ---------------- Mini-DOM ----------------
const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source', 'area', 'base', 'col']);

function parseAttrs(str) {
  const attrs = {};
  const re = /([a-zA-Z0-9_:@\-\.]+)(\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const name = m[1];
    const value = m[4] ?? m[5] ?? m[6] ?? '';
    attrs[name] = value;
  }
  return attrs;
}

class El {
  constructor(tag, attrs = {}) {
    this.tagName = (tag || 'div').toUpperCase();
    this.attrs = attrs;
    this.children = [];
    this.parentNode = null;
    this.style = new Proxy({}, { get: () => '', set: () => true });
    this.dataset = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    }
    this._innerHTML = '';
    this._textContent = '';
    this.onclick = null;
    this.oninput = null;
    this._listeners = {};
    this._classList = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...c) => c.forEach((x) => this._classList.add(x)),
      remove: (...c) => c.forEach((x) => this._classList.delete(x)),
      toggle: (c, on) => { if (on === undefined) on = !this._classList.has(c); on ? this._classList.add(c) : this._classList.delete(c); },
      contains: (c) => this._classList.has(c),
    };
    if (attrs.id) this.id = attrs.id;
    if (attrs.type && attrs.type === 'checkbox') this.checked = false;
  }
  get className() { return [...this._classList].join(' '); }
  set className(v) { this._classList = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = v; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  hasAttribute(n) { return n in this.attrs; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    // faz o parse do HTML (como o navegador faz) para que querySelector funcione
    this.children = [];
    const frag = parseHTML(this._innerHTML);
    for (const c of frag.children) {
      c.parentNode = this;
      this.children.push(c);
    }
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v); }
  get value() { return this._value ?? ''; }
  set value(v) { this._value = String(v); }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(t, f) { (this._listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); }
  dispatchEvent(e) { for (const f of this._listeners[e.type] || []) f(e); }
  getContext() { return makeCtx(this); }
  getBoundingClientRect() { return { width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 }; }
  get clientWidth() { return 600; }
  get clientHeight() { return 340; }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  get firstChild() { return this.children[0] || null; }
  focus() {}
  click() { this.onclick?.({ target: this, preventDefault() {} }); }
  scrollTo() {}
  scrollTop = 0;
}

function parseHTML(html) {
  const root = new El('#root');
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = parseAttrs(m[3] || '');
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const el = new El(tag, attrs);
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return root;
}

function matches(el, sel) {
  sel = sel.trim();
  if (!sel) return false;
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  if (sel.startsWith('[')) {
    const mm = sel.match(/^\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]$/);
    if (!mm) return false;
    if (mm[2] === undefined) return mm[1] in el.attrs;
    return el.attrs[mm[1]] === mm[2];
  }
  return el.tagName === sel.toUpperCase();
}

function queryAll(root, sel) {
  const parts = sel.split(/\s+/).filter(Boolean);
  let current = [root];
  for (const part of parts) {
    const next = [];
    for (const ctx of current) {
      const found = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (matches(c, part)) found.push(c);
          walk(c);
        }
      };
      walk(ctx);
      next.push(...found);
    }
    current = next;
  }
  return current;
}

function makeCtx(canvas) {
  const W = canvas.width || 300, H = canvas.height || 150;
  return {
    canvas, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '',
    globalAlpha: 1, globalCompositeOperation: 'source-over', textAlign: 'left',
    fillRect() {}, clearRect() {}, drawImage() {}, fillText() {}, strokeText() {}, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, rect() {},
    fill() {}, stroke() {}, clip() {}, save() {}, restore() {}, translate() {}, rotate() {},
    scale() {}, setTransform() {}, measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {},
  };
}

// ---------------- Monta o ambiente ----------------
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const dom = parseHTML(html);
const body = dom.querySelector('body');

globalThis.document = {
  body,
  documentElement: new El('html'),
  createElement: (tag) => new El(tag),
  getElementById: (id) => dom.querySelector('#' + id),
  querySelector: (sel) => dom.querySelector(sel),
  querySelectorAll: (sel) => dom.querySelectorAll(sel),
  addEventListener: (t, f) => { if (t === 'DOMContentLoaded') setTimeout(f, 0); },
};
const winListeners = {};
globalThis.window = {
  addEventListener(t, f) { (winListeners[t] ||= []).push(f); },
  removeEventListener() {},
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
  location: { protocol: 'http:', host: 'localhost:3000' },
};
globalThis.location = { protocol: 'http:', host: 'localhost:3000' };
globalThis.devicePixelRatio = 1;
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
};
let rafFrames = 0;
globalThis.requestAnimationFrame = (f) => {
  if (rafFrames++ > 4000) return 1;
  setTimeout(() => f(Date.now()), 16);
  return 1;
};
globalThis.cancelAnimationFrame = () => {};

// ---------------- Executa o boot real ----------------
console.log('\n=== INICIALIZACAO REAL DO index.html ===');

let bootError = null;
const allErrors = [];
process.on('uncaughtException', (e) => { allErrors.push(e); bootError = e; });
process.on('unhandledRejection', (e) => { allErrors.push(e); bootError = e; });

// trava geral para nao ficar pendurado
const guard = setTimeout(() => {
  console.log('\n[TESTE] TEMPO ESGOTADO');
  if (allErrors.length) console.log('[TESTE] erros:', allErrors.map((e) => e.message).join(' | '));
  process.exit(1);
}, 30000);

await import('../public/js/main.js');
// dispara o DOMContentLoaded como o navegador faria
for (const f of winListeners['DOMContentLoaded'] || []) f({ type: 'DOMContentLoaded' });
await new Promise((r) => setTimeout(r, 2500));

ok(!bootError, bootError ? `erro no boot: ${bootError.message}` : 'boot() executou sem erros');
if (allErrors.length) console.log('        erros capturados:', allErrors.map((e) => e.message).join(' | '));

const boot = dom.querySelector('#boot');
const menu = dom.querySelector('#menu');
ok(boot && boot.classList.contains('hidden'), 'tela de loading foi escondida');
ok(menu && !menu.classList.contains('hidden'), 'menu principal foi exibido');

// o ranking foi preenchido?
const rank = dom.querySelector('#rankTable');
ok(rank && rank.innerHTML.includes('JOGADOR'), 'tabela de ranking foi renderizada');

// as missoes foram listadas?
const missions = dom.querySelectorAll('.mission');
ok(missions.length === 5, `missoes listadas: ${missions.length}/5`);

// a tela de online esta bloqueada sem conta?
ok(dom.querySelector('#onlineLocked') && !dom.querySelector('#onlineLocked').classList.contains('hidden'),
  'modo online aparece bloqueado sem conta');

// clicar numa missao abre o briefing
const firstMission = dom.querySelectorAll('.mission')[0];
ok(!!firstMission, 'primeira missao clicavel');
if (firstMission) {
  firstMission.onclick?.();
  await new Promise((r) => setTimeout(r, 300));
  const briefing = dom.querySelector('#briefing');
  ok(briefing && !briefing.classList.contains('hidden'), 'briefing da missao foi aberto');
  ok(dom.querySelector('#briefName')?.textContent?.length > 3,
    `titulo da missao: "${dom.querySelector('#briefName')?.textContent}"`);
  ok(dom.querySelector('#cine')?.children.length > 0, 'cinematica de abertura renderizada');
}

// o botao de tema existe e responde?
const themeBtn = dom.querySelector('#btnTheme');
ok(!!themeBtn, 'botao de tema presente');
const before = document.documentElement.getAttribute('data-theme');
try { themeBtn.onclick?.(); } catch (e) { console.log('        erro ao alternar tema:', e.message); }
const after = document.documentElement.getAttribute('data-theme');
ok(before !== after, `tema alternou: ${before} -> ${after}`);

// ids referenciados no JS que nao existem no HTML
// (btnLogout e criado dinamicamente pelo renderUserBox)
const dynamic = new Set(['btnLogout']);
const htmlIds = new Set(dom.querySelectorAll('[id]').map((e) => e.id));
const jsFiles = await readFile(new URL('../public/js/main.js', import.meta.url), 'utf8');
const refs = [...jsFiles.matchAll(/\$\('#([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
const missing = [...new Set(refs)].filter((id) => !htmlIds.has(id) && !dynamic.has(id));
ok(missing.length === 0, `todos os ids usados existem no HTML${missing.length ? ': faltam ' + missing.join(', ') : ''}`);

console.log('\nCONCLUIDO\n');
clearTimeout(guard);
process.exit(0);
