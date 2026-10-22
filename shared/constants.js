// Constantes compartilhadas entre servidor e cliente.

// ---------- Tema: verde escuro / preto / branco ----------
export const C = {
  black: '#000000',
  ink: '#070c09',
  greenDeep: '#0a1a10',
  greenDark: '#12301d',
  green: '#1c5c33',
  greenMid: '#2f8f4e',
  greenLite: '#5fd38a',
  white: '#ffffff',
  bone: '#e8f1ea',
  gray: '#93a89a',
  grayDark: '#3c4a41',
  red: '#e0503c',
  redDark: '#7a2318',
  amber: '#e8b13d',
};

export const TEAM = {
  T: { id: 'T', name: 'Terroristas', color: '#3f9c5c', color2: '#14472a' },
  CT: { id: 'CT', name: 'Contraterroristas', color: '#e8f1ea', color2: '#6d7f74' },
};

// ---------- Física / mundo ----------
// ESCALA: 1 unidade = 1 metro. O grid tem celulas de 2 metros.
export const CELL = 2;              // tamanho de uma celula do grid (metros)
export const PLAYER_RADIUS = 0.35;   // raio de colisao do jogador (metros)
export const PLAYER_HEIGHT_STAND = 1.75;
export const PLAYER_HEIGHT_CROUCH = 1.0;
export const EYE_STAND = 1.6;        // altura do olho em pe
export const EYE_CROUCH = 0.95;      // altura do olho agachado
export const WALK_SPEED = 2.8;       // Shift (m/s)
export const RUN_SPEED = 5.6;        // corrida (m/s)
export const CROUCH_SPEED = 1.9;
export const ACCEL = 12;             // interpolacao de velocidade
export const FRICTION = 0.86;

export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
export const MAX_MONEY = 16000;
export const HEADSHOT_MULT = 4;

// ---------- Tipos de parede (altura em metros) ----------
export const WALL_FULL = 3.0;
export const WALL_LOW = 1.15;         // cobertura na cintura: protege agachado

// ---------- Armas ----------
// dmg: dano por bala | rpm: tiros por minuto | price: preco de compra
export const WEAPONS = {
  faca: {
    id: 'faca', name: 'Faca', slot: 'melee', price: 0, dmg: 55, rpm: 90, mag: 0, reserve: 0,
    spread: 0.0, moveMul: 1.1, recoil: 0, range: 1.5, auto: false, reload: 0,
  },
  pistola: {
    id: 'pistola', name: 'Pistola', slot: 'primary', price: 0, dmg: 34, rpm: 352, mag: 12, reserve: 24,
    spread: 0.012, moveMul: 1.0, recoil: 0.9, range: 45, auto: false, reload: 2200, headMul: 4,
    sound: 'pistol', armorPen: 0.52,
  },
  smg: {
    id: 'smg', name: 'Submetralhadora', slot: 'primary', price: 1200, dmg: 23, rpm: 857, mag: 30, reserve: 120,
    spread: 0.030, moveMul: 1.05, recoil: 0.7, range: 40, auto: true, reload: 2350, headMul: 4,
    sound: 'smg', armorPen: 0.55,
  },
  escopeta: {
    id: 'escopeta', name: 'Escopeta', slot: 'primary', price: 1050, dmg: 26, pellets: 8, rpm: 68, mag: 8, reserve: 32,
    spread: 0.085, moveMul: 0.95, recoil: 2.4, range: 20, auto: false, reload: 3000, headMul: 3,
    sound: 'shotgun', armorPen: 0.45,
  },
  fuzil: {
    id: 'fuzil', name: 'Fuzil A', slot: 'primary', price: 2700, dmg: 36, rpm: 600, mag: 30, reserve: 90,
    spread: 0.026, moveMul: 0.92, recoil: 1.5, range: 75, auto: true, reload: 2500, headMul: 4,
    sound: 'rifle', armorPen: 0.77,
  },
  fuzil4: {
    id: 'fuzil4', name: 'Fuzil B', slot: 'primary', price: 3100, dmg: 33, rpm: 666, mag: 30, reserve: 90,
    spread: 0.022, moveMul: 0.95, recoil: 1.2, range: 75, auto: true, reload: 2500, headMul: 4,
    sound: 'rifle', armorPen: 0.72,
  },
  sniper: {
    id: 'sniper', name: 'Sniper', slot: 'primary', price: 4750, dmg: 115, rpm: 41, mag: 10, reserve: 30,
    spread: 0.001, moveMul: 0.75, recoil: 3.2, range: 180, auto: false, reload: 3700, headMul: 4,
    sound: 'sniper', armorPen: 0.97, scoped: true,
  },
  pesado: {
    id: 'pesado', name: 'Metralhadora', slot: 'primary', price: 1700, dmg: 35, rpm: 800, mag: 150, reserve: 200,
    spread: 0.055, moveMul: 0.85, recoil: 2.0, range: 60, auto: true, reload: 4200, headMul: 4,
    sound: 'heavy', armorPen: 0.60,
  },
};

export const WEAPON_ORDER = ['pistola', 'smg', 'escopeta', 'fuzil', 'fuzil4', 'pesado', 'sniper'];

// Precos de utilitarios
export const EQUIP = {
  colete: { id: 'colete', name: 'Colete', price: 650, armor: 100 },
  kit: { id: 'kit', name: 'Kit de desarme', price: 400 },
  granada: { id: 'granada', name: 'Granada', price: 300, max: 1 },
};

export const GRENADE = {
  price: 300,
  max: 1,
  dmg: 98,
  radius: 8,
  fuse: 1800,
  throwSpeed: 12,
};

// ---------- Modos online ----------
export const MODES = {
  dm: {
    id: 'dm', name: 'Free-for-All', min: 2, max: 12, rounds: 1, target: 30,
    friendlyFire: false, respawn: true, scoreLimit: 30, teams: false,
    desc: 'Cada jogador e seu proprio inimigo. Primeiro a 30 abates vence.',
  },
  tdm: {
    id: 'tdm', name: 'Acove de Equipe', min: 2, max: 12, rounds: 1, target: 25,
    friendlyFire: false, respawn: true, scoreLimit: 25, teams: true,
    desc: 'Terroristas vs Contraterroristas. 25 abates para vencer.',
  },
  bomb: {
    id: 'bomb', name: 'Competitivo (Bomba)', min: 2, max: 12, rounds: 1, target: 16,
    friendlyFire: true, respawn: false, scoreLimit: 16, teams: true,
    desc: 'Ataque e defesa de bomba. 16 rounds wins.',
  },
};

// ---------- Constantes de rede ----------
export const TICK_RATE = 30;         // Hz do servidor
export const SNAPSHOT_RATE = 20;     // Hz de envio de estado
export const INTERP_DELAY = 0.1;     // segundos de interpolacao no cliente
export const PROTOCOL = 1;

export const MAX_ROOM_NAME = 24;
export const MAX_ROOM_CODE = 6;
