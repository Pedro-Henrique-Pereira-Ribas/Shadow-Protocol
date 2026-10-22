// Bootstrap e fluxo principal do jogo.
import { api } from './api.js';
import { $, $$, show, toast, escapeHtml, fmtTime, formatMoney, clamp } from './util.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { StoryGame } from './story.js';
import { OnlineGame } from './online.js';
import { getMap } from '/shared/mapdefs.js';
import { cellToWorld } from '/shared/maps.js';
import { STORY_MISSIONS, getMission, nextMission, totalStars } from '/shared/story.js';
import { MODES, WEAPONS } from '/shared/constants.js';
import { applyTheme, getStoredTheme, toggleTheme, updateThemeButtons } from './theme.js';

const audio = new AudioEngine();
let renderer = null, input = null, hud = null, touch = null;
let currentGame = null;
let paused = false;
let lastTs = 0;
let user = null;
let storyProgress = {};
let onlineMode = 'tdm';
let pendingMission = null;
let briefAction = 'mission';
let lastResult = null;
let heroRaf = null;

// ---------------- Boot ----------------
async function boot() {
  const bar = $('#bootbar'), txt = $('#boottxt');
  const steps = [
    [18, 'CARREGANDO MOTOR...'],
    [42, 'GERANDO MAPAS...'],
    [66, 'CARREGANDO ARMAS...'],
    [88, 'CONECTANDO...'],
    [100, 'PRONTO'],
  ];
  for (const [p, t] of steps) {
    bar.style.width = `${p}%`;
    txt.textContent = t;
    await new Promise((r) => setTimeout(r, 130));
  }

  // tema (aplicado antes de criar o renderizador)
  const theme = getStoredTheme();
  applyTheme(theme);

  renderer = new Renderer($('#game'), theme);
  input = new Input($('#game'));
  hud = new Hud();
  // controles de toque (celular/tablet)
  touch = new TouchControls(input, document.body, () => {
    if (currentGame) togglePause(!paused);
  });
  touch.show(input.isTouch);
  document.getElementById('hud')?.classList.toggle('touch', input.isTouch);
  wireUI();

  try {
    const me = await api.me();
    user = me.user;
  } catch { user = null; }

  renderUserBox();
  await loadStory();
  await loadLeaderboard();
  startHeroArt();

  show($('#boot'), false);
  show($('#menu'), true);
}

function renderUserBox() {
  const box = $('#userBox');
  if (user) {
    box.innerHTML = `<div class="user-badge">
        <b>${escapeHtml(user.username)}</b>
        <small>${escapeHtml(user.email)}</small>
      </div>
      <button class="btn btn-ghost" id="btnLogout">SAIR</button>`;
    $('#btnLogout').onclick = async () => {
      try { await api.logout(); } catch { /* ignore */ }
      user = null;
      renderUserBox();
      updateOnlineLock();
      toast('Voce saiu da conta.');
    };
  } else {
    box.innerHTML = `<div class="user-badge"><b>CONVIDADO</b><small>modo online requer conta</small></div>
      <button class="btn btn-primary" data-go="conta">ENTRAR</button>`;
    $$('[data-go]', box).forEach((b) => (b.onclick = () => goTab('conta')));
  }
  updateOnlineLock();
}

function updateOnlineLock() {
  const locked = !user;
  show($('#onlineLocked'), locked);
  show($('#onlineContent'), !locked);
}

// ---------------- Navegacao ----------------
function goTab(name) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  $('#menu').scrollTop = 0;
}

function wireUI() {
  $$('.nav-btn').forEach((b) => (b.onclick = () => {
    goTab(b.dataset.tab);
    if (b.dataset.tab === 'ranking') loadLeaderboard();
  }));
  $$('[data-go]').forEach((b) => (b.onclick = () => goTab(b.dataset.go)));

  // --- tema claro/escuro ---
  for (const id of ['btnTheme', 'btnTheme2']) {
    const b = document.getElementById(id);
    if (b) b.onclick = () => toggleTheme((t) => { renderer.setTheme(t); hud.theme = t; });
  }
  updateThemeButtons(document.documentElement.getAttribute('data-theme') || 'dark');

  // --- conta ---
  $('#btnRegister').onclick = doRegister;
  $('#btnLogin').onclick = doLogin;
  $('#regPass').oninput = updateStrength;

  // --- online ---
  $$('#modeSwitch .ms-btn').forEach((b) => (b.onclick = () => {
    onlineMode = b.dataset.mode;
    $$('#modeSwitch .ms-btn').forEach((x) => x.classList.toggle('active', x === b));
    const m = MODES[onlineMode];
    $('#modeDesc').textContent = m.desc + ` Vencedor: ${m.scoreLimit} ${m.teams ? 'rounds' : 'abates'}.`;
  }));
  $('#btnCreateRoom').onclick = doCreateRoom;
  $('#btnJoinRoom').onclick = doJoinRoom;
  $('#roomList').onclick = (e) => {
    const item = e.target.closest('.room-item');
    if (item) enterRoom(item.dataset.code);
  };

  // --- missao / pausa / resultado ---
  $('#btnBriefBack').onclick = () => {
    show($('#briefing'), false);
    if (briefAction === 'results') { showResults(lastResult); return; }
    show($('#menu'), true);
  };
  $('#btnBriefStart').onclick = () => {
    if (briefAction === 'results') {
      show($('#briefing'), false);
      showResults(lastResult);
    } else {
      startMission();
    }
  };
  $('#btnResume').onclick = () => togglePause(false);
  $('#btnQuit').onclick = quitToMenu;
  $('#btnResMenu').onclick = quitToMenu;
  $('#btnResNext').onclick = () => {
    show($('#result'), false);
    const nx = nextMission(pendingMission);
    if (nx) showBriefing(nx);
    else quitToMenu();
  };

  // --- controles globais ---
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (currentGame) togglePause(!paused);
    }
  });

  $('#game').addEventListener('mousedown', () => {
    if (currentGame && !paused) input.requestLock();
  });
  input.onLockChange = (locked) => {
    if (!locked && currentGame && !paused) togglePause(true);
  };

  // --- salas (atualizacao periodica) ---
  setInterval(refreshRooms, 4000);
  refreshRooms();
}

// ---------------- Conta ----------------
function updateStrength() {
  const v = $('#regPass').value;
  const score = scorePassword(v);
  const bar = $('#strBar');
  const colors = ['#e0503c', '#e0503c', '#e8b13d', '#4fd98a', '#4fd98a'];
  bar.style.width = `${(score / 4) * 100}%`;
  bar.style.background = colors[score];
  const labels = [
    'Use 6+ digitos, maiuscula, minuscula e numero',
    'Muito fraca', 'Fraca', 'Boa', 'Forte', 'Muito forte',
  ];
  $('#strTxt').textContent = labels[score];
}

function scorePassword(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return clamp(s, 0, 4);
}

async function doRegister() {
  const email = $('#regEmail').value.trim();
  const pass = $('#regPass').value;
  const name = $('#regName').value.trim();
  const msg = $('#regMsg');
  msg.className = 'form-msg';
  msg.textContent = 'Validando...';
  try {
    const r = await api.register(email, pass, name);
    user = r.user;
    renderUserBox();
    msg.className = 'form-msg ok';
    msg.textContent = `Conta criada! Bem-vindo, ${r.user.username}.`;
    toast('Conta criada com sucesso.');
    await loadStory();
  } catch (e) {
    msg.className = 'form-msg err';
    msg.textContent = e.message;
  }
}

async function doLogin() {
  const email = $('#loginEmail').value.trim();
  const pass = $('#loginPass').value;
  const msg = $('#loginMsg');
  msg.className = 'form-msg';
  msg.textContent = 'Entrando...';
  try {
    const r = await api.login(email, pass);
    user = r.user;
    renderUserBox();
    msg.className = 'form-msg ok';
    msg.textContent = `Bem-vindo de volta, ${r.user.username}.`;
    toast('Login realizado.');
    await loadStory();
  } catch (e) {
    msg.className = 'form-msg err';
    msg.textContent = e.message;
  }
}

async function loadLeaderboard() {
  try {
    const r = await api.leaderboard('global');
    renderLeaderboard(r.leaderboard || []);
  } catch {
    renderLeaderboard([]);
  }
}

function renderLeaderboard(list) {
  const table = $('#rankTable');
  if (!table) return;
  const rows = list.length
    ? list.map((r, i) => `
      <tr>
        <td class="num${i === 0 ? ' gold' : ''}">${i + 1}</td>
        <td>${escapeHtml(r.username)}</td>
        <td class="num">${r.kills || 0}</td>
        <td class="num">${r.deaths || 0}</td>
        <td class="num">${r.wins || 0}</td>
        <td class="num">${r.score || 0}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="muted" style="padding:22px;text-align:center">Nenhum jogador no ranking ainda.</td></tr>';
  table.innerHTML = `
    <thead><tr><th>#</th><th>JOGADOR</th><th>ABATES</th><th>MORTES</th><th>VITORIAS</th><th>PONTOS</th></tr></thead>
    <tbody>${rows}</tbody>`;
}

// ---------------- Historia ----------------
async function loadStory() {
  try {
    const r = await api.story();
    storyProgress = {};
    for (const p of r.progress || []) storyProgress[p.mission_id] = p;
  } catch {
    storyProgress = JSON.parse(localStorage.getItem('fps2d_story') || '{}');
  }
  renderMissions();
}

function renderMissions() {
  const list = $('#missionList');
  const total = Object.values(storyProgress).reduce((a, p) => a + (p.stars || 0), 0);
  $('#starsTotal').textContent = `${total} / ${totalStars()}`;

  list.innerHTML = STORY_MISSIONS.map((m, i) => {
    const prev = i === 0 ? null : STORY_MISSIONS[i - 1];
    const unlocked = i === 0 || (storyProgress[prev.id] && storyProgress[prev.id].completed);
    const pr = storyProgress[m.id];
    const stars = pr ? '★'.repeat(pr.stars || 0) + '☆'.repeat(3 - (pr.stars || 0)) : '☆☆☆';
    const status = pr && pr.completed
      ? `CONCLUIDA${pr.best_time ? ` - ${fmtTime(pr.best_time)}` : ''}`
      : unlocked ? 'DISPONIVEL' : 'BLOQUEADA';
    return `<div class="mission ${unlocked ? '' : 'locked'}" data-mission="${m.id}">
      <div class="num">${String(i + 1).padStart(2, '0')}</div>
      <div>
        <div class="act">${escapeHtml(m.act)}</div>
        <div class="nm">${escapeHtml(m.name)}</div>
        <div class="ob">${escapeHtml(m.objective)}</div>
        <div class="diff">${[1, 2, 3, 4, 5].map((d) => `<i class="${d <= m.difficulty ? 'on' : ''}"></i>`).join('')}</div>
      </div>
      <div class="right">
        <div class="stars">${stars}</div>
        <div class="status">${status}</div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.mission').forEach((n) => {
    n.onclick = () => {
      const m = getMission(n.dataset.mission);
      const i = STORY_MISSIONS.indexOf(m);
      const prev = i > 0 ? STORY_MISSIONS[i - 1] : null;
      const unlocked = i === 0 || (storyProgress[prev.id] && storyProgress[prev.id].completed);
      if (!unlocked) { toast('Complete a missao anterior primeiro.', true); return; }
      showBriefing(m);
    };
  });
}

function showBriefing(mission) {
  pendingMission = mission;
  briefAction = 'mission';
  $('#briefAct').textContent = mission.act;
  $('#briefName').textContent = mission.name.toUpperCase();
  $('#briefMeta').innerHTML = `
    <span>MAPA: ${escapeHtml((getMap(mission.mapId) || {}).name || mission.mapId)}</span>
    <span>HOSTIS: ${mission.enemies.reduce((a, e) => a + e.count, 0)}</span>
    <span>DIFICULDADE: ${'★'.repeat(mission.difficulty)}</span>`;
  $('#briefText').textContent = mission.brief;
  $('#briefObj').textContent = mission.objective;
  $('#cine').innerHTML = '';
  show($('#menu'), false);
  show($('#briefing'), true);
  playDialogue(mission.intro, $('#cine'), null);
  $('#btnBriefStart').textContent = 'INICIAR MISSAO';
  $('#btnBriefStart').disabled = false;
  $('#btnBriefBack').textContent = 'VOLTAR';
}

function playDialogue(lines, container, done) {
  container.innerHTML = '';
  let i = 0;
  const step = () => {
    if (i >= lines.length) { done?.(); return; }
    const l = lines[i++];
    const div = document.createElement('div');
    div.className = 'cine-line';
    div.innerHTML = `<div class="cine-who">${escapeHtml(l.who)}</div><div class="cine-txt">${escapeHtml(l.text)}</div>`;
    container.appendChild(div);
    audio.ui();
  };
  step();
  // avanca ao clicar na area da cinemática
  container.onclick = step;
}

function startMission() {
  const mission = pendingMission;
  if (!mission) return;
  const map = getMap(mission.mapId);
  if (!map) { toast('Mapa indisponivel.', true); return; }
  show($('#briefing'), false);
  startStoryGame(map, mission);
}

function startStoryGame(map, mission) {
  audio.resume();
  const game = new StoryGame(map, mission.id, {
    onMissionEnd: (res) => finishStory(mission, res),
    onToast: (t) => toast(t),
  });
  game.startTime = performance.now();
  game.onReloadStart = () => audio.reload();
  game.onReloadEnd = () => audio.pickup();
  game.onDryFire = () => audio.empty();
  game.onStep = () => audio.step();
  game.onPickup = (it) => { audio.pickup(); game.onToast(it.type === 'health' ? '+35 VIDA' : 'MUNICAO'); };
  game.onEnemySpawn = () => {};
  game.onEnemyKilled = (e) => { audio.kill(); hud.message('HOSTIL ELIMINADO', e.name, 1200); };
  game.onHitEnemy = () => audio.hit();
  game.onPlayerDamage = () => audio.hurt();
  game.onPlayerDeath = () => { audio.death(); setTimeout(() => { game.respawn?.(); }, 2500); };
  game.onDeath = () => {
    hud.message('VOCE FOI ABATIDO', 'Pressione ESC para voltar', 4000);
  };

  // setup do jogador
  const spawn = map.spawns.T[0];
  const sw = cellToWorld(spawn.x, spawn.y);
  game.player.x = sw.x;
  game.player.y = sw.y;
  game.player.armor = 0;

  enterGame(game, 'story');
}

// (respawn da campanha e feito pelo proprio StoryGame)

async function finishStory(mission, res) {
  lastResult = res;
  briefAction = 'results';
  pendingMission = mission;

  // cinemática de encerramento
  show($('#hud'), false);
  show($('#result'), false);
  show($('#briefing'), true);
  $('#briefAct').textContent = 'MISSAO CONCLUIDA';
  $('#briefName').textContent = mission.name.toUpperCase();
  $('#briefMeta').innerHTML = `
    <span>ABATES: ${res.kills}/${res.total}</span>
    <span>TEMPO: ${fmtTime(res.time)}</span>
    <span>PRECISAO: ${res.accuracy}%</span>`;
  $('#briefText').textContent = '';
  $('#briefObj').textContent = `AVALIACAO: ${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)}`;
  $('#cine').innerHTML = '';
  playDialogue(mission.outro || [], $('#cine'), null);
  $('#btnBriefStart').textContent = 'VER RESULTADOS';
  $('#btnBriefStart').disabled = false;
  $('#btnBriefBack').textContent = 'MENU';

  // salvar progresso
  storyProgress[mission.id] = { completed: 1, stars: res.stars, best_time: res.time };
  localStorage.setItem('fps2d_story', JSON.stringify(storyProgress));
  if (user) {
    try {
      await api.saveStory(mission.id, res.time, res.stars);
      await loadStory();
    } catch { /* offline */ }
  }
}

function showResults(res) {
  const stars = '★'.repeat(res.stars) + '☆'.repeat(3 - res.stars);
  $('#resTitle').textContent = 'MISSAO CONCLUIDA';
  $('#resStars').textContent = stars;
  $('#resStats').innerHTML = `
    <div class="res-stat"><b>${res.kills}/${res.total}</b><span>HOSTIS</span></div>
    <div class="res-stat"><b>${fmtTime(res.time)}</b><span>TEMPO</span></div>
    <div class="res-stat"><b>${res.accuracy}%</b><span>PRECISAO</span></div>
    <div class="res-stat"><b>${res.damageTaken}</b><span>DANO SOFRIDO</span></div>`;
  const nx = nextMission(pendingMission?.id);
  $('#btnResNext').textContent = nx ? 'PROXIMA MISSAO' : 'MENU PRINCIPAL';
  show($('#result'), true);
}

// ---------------- Online ----------------
async function refreshRooms() {
  try {
    const r = await api.rooms();
    const list = $('#roomList');
    if (!r.rooms.length) { list.innerHTML = '<p class="muted">Nenhuma sala aberta.</p>'; return; }
    list.innerHTML = r.rooms.map((rm) => `
      <div class="room-item" data-code="${rm.code}">
        <div>
          <div><b>${escapeHtml(rm.name)}</b></div>
          <div class="meta">${escapeHtml(MODES[rm.mode]?.name || rm.mode)} &middot; ${escapeHtml(rm.mapId)} &middot; ${rm.phase}</div>
        </div>
        <div style="text-align:right">
          <div class="code">${rm.code}</div>
          <div class="meta">${rm.players}/${rm.max}</div>
        </div>
      </div>`).join('');
  } catch { /* ignore */ }
}

async function doCreateRoom() {
  if (!user) { goTab('conta'); toast('Crie uma conta para criar salas.', true); return; }
  try {
    const name = $('#roomName').value.trim() || `Sala de ${user.username}`;
    const r = await api.createRoom(name, onlineMode, $('#roomMap').value);
    await refreshRooms();
    enterRoom(r.room.code);
  } catch (e) { toast(e.message, true); }
}

async function doJoinRoom() {
  if (!user) { goTab('conta'); toast('Crie uma conta para entrar em salas.', true); return; }
  const code = $('#roomCode').value.trim().toUpperCase();
  if (!code) { toast('Digite o codigo da sala.', true); return; }
  try {
    await api.joinRoom(code);
    enterRoom(code);
  } catch (e) { toast(e.message, true); }
}

async function enterRoom(code) {
  if (!user) { goTab('conta'); toast('É obrigatorio ter conta para jogar online.', true); return; }
  try {
    const r = await api.joinRoom(code);
    const room = r.room;
    const map = getMap(room.mapId);
    if (!map) throw new Error('Mapa invalido.');
    show($('#menu'), false);
    show($('#hud'), true);
    hud.show(true);
    hud.message('CONECTANDO...', room.code, 1500);

    const game = new OnlineGame(map, {
      room, name: user.username,
      onEvent: handleOnlineEvent,
      onKillfeed: (e) => { hud.renderKillfeed(game.killfeed); },
      onChat: () => {},
    });
    game.onReloadStart = () => audio.reload();
    game.onDryFire = () => audio.empty();
    game.onStep = () => audio.step();
    game.onHitConfirm = () => audio.hit();
    game.onDeath = () => { audio.death(); hud.message('VOCE FOI ABATIDO', '', 2000); };
    game.onOwnShot = (m) => audio.shot(m.w);

    await game.connect(room.code, user.username);
    currentGame = game;
    paused = false;
    input.requestLock();
    audio.resume();
  } catch (e) {
    toast(e.message, true);
    show($('#menu'), true);
  }
}

function handleOnlineEvent(ev) {
  if (ev.kind === 'err') { toast(ev.msg, true); return; }
  if (ev.kind === 'bought') { audio.pickup(); toast(`Comprado: ${ev.item}`); return; }
  if (ev.kind === 'roundend') { audio.round(); hud.message(`ROUND - ${ev.winner}`, '', 2500); return; }
  if (ev.kind === 'planted') { audio.plant(); hud.message('BOMBA PLANTADA', 'Defuse com E', 3000); return; }
  if (ev.kind === 'defused') { audio.round(); hud.message('BOMBA DESARMADA', '', 2500); return; }
  if (ev.kind === 'exploded') { audio.bomb(); hud.message('BOMBA EXPLODIU', '', 2500); return; }
  if (ev.kind === 'noaccount') { toast('É obrigatorio ter conta para jogar online.', true); return; }
  if (ev.kind === 'disconnected') { toast('Conexao perdida com o servidor.', true); quitToMenu(); return; }
  if (ev.kind === 'matchend') {
    hud.message('FIM DE PARTIDA', '', 4000);
  }
}

// ---------------- Loop / gerencia de tela ----------------
function enterGame(game, mode) {
  currentGame = game;
  paused = false;
  show($('#hud'), true);
  hud.show(true);
  hud.renderKillfeed([]);
  touch?.show(!!input?.isTouch);
  lastTs = performance.now();
  audio.resume();
  setTimeout(() => input.requestLock(), 60);
}

function togglePause(on) {
  if (!currentGame) return;
  paused = on;
  show($('#pause'), on);
  if (on) input.exitLock();
  else input.requestLock();
}

function quitToMenu() {
  if (currentGame && currentGame.close) currentGame.close();
  currentGame = null;
  paused = false;
  briefAction = 'mission';
  show($('#pause'), false);
  show($('#result'), false);
  show($('#briefing'), false);
  show($('#hud'), false);
  show($('#menu'), true);
  hud.show(false);
  touch?.show(false);
  input.exitLock();
  loadStory();
  refreshRooms();
}

// ---------------- Loop principal ----------------
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;

  // ainda inicializando (tela de loading)
  if (!input) return;

  if (currentGame && !paused) {
    try {
      currentGame.update(dt, input);
      renderer.render(currentGame, dt);
      hud.update(currentGame);
      hud.drawRadar(currentGame);
      hud.renderBuy(currentGame);
    } catch (err) {
      console.error(err);
    }
  }
  input.endFrame();
}

// ---------------- Arte animada do menu ----------------
function startHeroArt() {
  const box = $('#heroArt');
  if (!box) return;
  const cv = document.createElement('canvas');
  box.appendChild(cv);
  const ctx = cv.getContext('2d');
  let t = 0;
  const blips = Array.from({ length: 7 }, () => ({
    x: Math.random(), y: Math.random(), s: 0.2 + Math.random() * 0.6, ph: Math.random() * 6,
  }));

  const draw = () => {
    heroRaf = requestAnimationFrame(draw);
    t += 0.016;
    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth || 600, h = box.clientHeight || 340;
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = 'rgba(79,217,138,.13)';
    ctx.lineWidth = 1;
    const step = 34;
    const ox = (t * 12) % step, oy = (t * 7) % step;
    for (let x = -step + ox; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = -step + oy; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // aneis
    ctx.strokeStyle = 'rgba(79,217,138,.18)';
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath(); ctx.arc(w / 2, h / 2, i * 40, 0, Math.PI * 2); ctx.stroke();
    }
    // varredura
    const a = (t * 1.1) % (Math.PI * 2);
    const g = ctx.createLinearGradient(w / 2, h / 2, w / 2 + Math.cos(a) * 200, h / 2 + Math.sin(a) * 200);
    g.addColorStop(0, 'rgba(79,217,138,.35)');
    g.addColorStop(1, 'rgba(79,217,138,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + Math.cos(a) * 200, h / 2 + Math.sin(a) * 200); ctx.stroke();
    // blips
    for (const b of blips) {
      const pulse = (Math.sin(t * 2 + b.ph) + 1) / 2;
      const bx = b.x * w, by = b.y * h;
      ctx.fillStyle = `rgba(79,217,138,${0.25 + pulse * 0.6})`;
      ctx.beginPath(); ctx.arc(bx, by, 2 + pulse * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(79,217,138,${pulse * 0.4})`;
      ctx.beginPath(); ctx.arc(bx, by, 8 + pulse * 14, 0, Math.PI * 2); ctx.stroke();
    }
  };
  draw();
}

// ---------------- Inicio ----------------
window.addEventListener('DOMContentLoaded', boot);
window.addEventListener('beforeunload', () => { if (currentGame?.close) currentGame.close(); });
requestAnimationFrame(loop);
