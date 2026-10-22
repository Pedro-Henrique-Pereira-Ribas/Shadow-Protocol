// Definicao da campanha do Modo Historia (estilo COD).
// Cada missao tem briefing, dialogos, inimigos, objetivos e carga inicial.

export const ENEMY_TYPES = {
  guarda: {
    id: 'guarda', name: 'Guarda', hp: 60, speed: 2.4, weapon: 'pistola',
    accuracy: 0.42, reaction: 0.55, range: 22, damage: 12, sightRange: 20, score: 100,
  },
  soldador: {
    id: 'soldador', name: 'Soldado', hp: 100, speed: 3.0, weapon: 'smg',
    accuracy: 0.55, reaction: 0.4, range: 26, damage: 16, sightRange: 26, score: 150,
  },
  assaltante: {
    id: 'assaltante', name: 'Assaltante', hp: 85, speed: 4.8, weapon: 'smg',
    accuracy: 0.62, reaction: 0.22, range: 22, damage: 14, sightRange: 28, score: 200,
  },
  atirador: {
    id: 'atirador', name: 'Atirador', hp: 75, speed: 2.2, weapon: 'sniper',
    accuracy: 0.8, reaction: 0.85, range: 60, damage: 55, sightRange: 55, score: 250,
  },
  colosso: {
    id: 'colosso', name: 'Blindado', hp: 230, speed: 2.0, weapon: 'pesado',
    accuracy: 0.5, reaction: 0.5, range: 28, damage: 22, sightRange: 30, score: 400, armor: 100,
  },
  comandante: {
    id: 'comandante', name: 'Comandante Varga', hp: 520, speed: 3.2, weapon: 'pesado',
    accuracy: 0.68, reaction: 0.3, range: 40, damage: 26, sightRange: 40, score: 1500,
    boss: true, armor: 100,
  },
};

export const STORY_MISSIONS = [
  {
    id: 'm1',
    act: 'ATO I - O DESPERTAR',
    name: 'Operacao Poeira',
    mapId: 'st_aldeia',
    difficulty: 1,
    timeLimit: 0,
    objective: 'Elimine todos os hostis na aldeia',
    brief:
      'O grupo que protegia os civis foi emboscado esta manha. Suspeitos do Grupo Sombra ocuparam ' +
      'a aldeia e preparam um ataque maior. Voce e o unico operador da unidade fantasma: infiltre, ' +
      'elimine os hostis e garanta a evacuacao dos sobreviventes.',
    intro: [
      { who: 'Comandante', text: 'Operador, a situacao nao esta bem. O Grupo Sombra pegou a aldeia inteira.' },
      { who: 'Operador', text: 'Entendido. Ja estou no perimetro. Vou entrar limpo.' },
      { who: 'Comandante', text: 'Use o terreno. As missoes sao pequenas, mas precisam ser limpas.' },
    ],
    outro: [
      { who: 'Operador', text: 'Aldeia limpa. Quantos sobreviventes tiramos?' },
      { who: 'Comandante', text: 'Todos os civis estao vivos. E o que importa agora.' },
      { who: 'Comandante', text: 'Mas isso e so o comeco. Eles tem mais gente no interior.' },
    ],
    loadout: ['pistola', 'smg'],
    enemies: [
      { type: 'guarda', count: 4, delay: 0 },
      { type: 'soldador', count: 3, delay: 0 },
      { type: 'assaltante', count: 2, delay: 12 },
    ],
    rewards: { unlocked: 'm2' },
  },
  {
    id: 'm2',
    act: 'ATO I - O DESPERTAR',
    name: 'Fazenda Sangrenta',
    mapId: 'st_fazenda',
    difficulty: 2,
    timeLimit: 0,
    objective: 'Limpe a fazenda e neutralize o deposito de armas',
    brief:
      'A fazenda e usada como deposito clandestino do Sombra. Ha mais armas sendo preparadas e ' +
      'a carga segue para a capital. Limpe a area e destrua o deposito antes que ela saia daqui.',
    intro: [
      { who: 'Operador', text: 'Tenho visao da fazenda. Muita cobertura baixa, vou usar como abrigo.' },
      { who: 'Comandante', text: 'Cuidado com os atiradores. Eles controlam os campos abertos.' },
      { who: 'Comandante', text: 'E tem um deposito no fundo. Nao deixe a carga sair.' },
    ],
    outro: [
      { who: 'Operador', text: 'Deposito neutralizado. Perdi a contagem no patio.' },
      { who: 'Comandante', text: 'Descansa enquanto puder. A proxima parada e pior.' },
    ],
    loadout: ['pistola', 'smg', 'fuzil'],
    enemies: [
      { type: 'guarda', count: 3, delay: 0 },
      { type: 'soldador', count: 4, delay: 0 },
      { type: 'assaltante', count: 3, delay: 10 },
      { type: 'atirador', count: 2, delay: 18 },
    ],
    rewards: { unlocked: 'm3' },
  },
  {
    id: 'm3',
    act: 'ATO II - A ESCALADA',
    name: 'Base Militar Fantasma',
    mapId: 'st_base',
    difficulty: 3,
    timeLimit: 0,
    objective: 'Infiltrar a base e destruir o radar inimigo',
    brief:
      'O Sombra montou uma base militar disfarcada de quartel, e o radar deles controla a regiao. ' +
      'Entre pela retaguarda, elimine a guarda e destrua o radar antes que o reforco chegue.',
    intro: [
      { who: 'Comandante', text: 'Entrada pela retaguarda. Sem reforco, sem margem de erro.' },
      { who: 'Operador', text: 'Copiado. Ja estou dentro do perimetro.' },
      { who: 'Comandante', text: 'Blindados no patio. Use o colete que mandamos.' },
    ],
    outro: [
      { who: 'Operador', text: 'Radar fora do ar. Eles estao cegos agora.' },
      { who: 'Comandante', text: 'Isso abre caminho para o interior. Mas prepara o pior.' },
      { who: 'Comandante', text: 'Varga, o comandante do Sombra, responde por tudo.' },
    ],
    loadout: ['pistola', 'smg', 'fuzil', 'escopeta'],
    enemies: [
      { type: 'guarda', count: 4, delay: 0 },
      { type: 'soldador', count: 5, delay: 0 },
      { type: 'assaltante', count: 4, delay: 12 },
      { type: 'atirador', count: 2, delay: 16 },
      { type: 'colosso', count: 2, delay: 24 },
    ],
    rewards: { unlocked: 'm4' },
  },
  {
    id: 'm4',
    act: 'ATO II - A ESCALADA',
    name: 'Refinaria em Chamas',
    mapId: 'st_refinaria',
    difficulty: 4,
    timeLimit: 0,
    objective: 'Sabotar a refinaria antes que exploda',
    brief:
      'O Sombra encheu a refinaria de material instavel e planeja detonar tudo junto com a vila ' +
      'vizinha. Sabote os tanques antes que anoiteca. Nao ha tempo para desvios: ' +
      'apenas velocidade e precisao.',
    intro: [
      { who: 'Operador', text: 'Refinaria comprometida. Sinto combustivel no ar.' },
      { who: 'Comandante', text: 'Cargas de detonacao espalhadas. Sabote todas.' },
      { who: 'Operador', text: 'Entendido. Movendo pelo nivel inferior.' },
    ],
    outro: [
      { who: 'Operador', text: 'Cargas neutralizadas. A refinaria continua de pe.' },
      { who: 'Comandante', text: 'Bom. Eles perderam o material e a cobertura.' },
    ],
    loadout: ['pistola', 'fuzil', 'escopeta', 'sniper'],
    enemies: [
      { type: 'soldador', count: 5, delay: 0 },
      { type: 'assaltante', count: 5, delay: 10 },
      { type: 'atirador', count: 3, delay: 16 },
      { type: 'colosso', count: 3, delay: 22 },
    ],
    rewards: { unlocked: 'm5' },
  },
  {
    id: 'm5',
    act: 'ATO III - O CHEFE',
    name: 'A Fortaleza de Varga',
    mapId: 'st_fortaleza',
    difficulty: 5,
    timeLimit: 0,
    objective: 'Derrote o Comandante Varga',
    brief:
      'Varga se refugiou na fortaleza do norte. Ele comanda o Grupo Sombra e sabe o que voce fez ' +
      'com a aldeia. Entre, atravesse as defesas e encerre isso. Sem volta.',
    intro: [
      { who: 'Comandante', text: 'Varga sabe que voce vem. Ele preparou uma armadilha.' },
      { who: 'Operador', text: 'Ele subestimou quem ia enfrentar.' },
      { who: 'Comandante', text: 'Vai com tudo. Nao pode haver segunda chance.' },
    ],
    outro: [
      { who: 'Operador', text: 'Varga caiu. O Grupo Sombra esta sem lideranca.' },
      { who: 'Comandante', text: 'Bom trabalho, operador. O pais esta seguro.' },
      { who: 'Operador', text: 'A aldeia esta de pe. Foi o que importava.' },
      { who: 'Comandante', text: 'Protocolo Sombra encerrado. Volte para casa.' },
    ],
    loadout: ['pistola', 'fuzil', 'sniper', 'escopeta'],
    enemies: [
      { type: 'soldador', count: 4, delay: 0 },
      { type: 'assaltante', count: 4, delay: 8 },
      { type: 'atirador', count: 3, delay: 14 },
      { type: 'colosso', count: 4, delay: 20 },
      { type: 'comandante', count: 1, delay: 30 },
    ],
    rewards: { unlocked: null },
  },
];

export function getMission(id) {
  return STORY_MISSIONS.find((m) => m.id === id) || null;
}
export function missionIndex(id) {
  return STORY_MISSIONS.findIndex((m) => m.id === id);
}
export function nextMission(id) {
  const i = missionIndex(id);
  return i >= 0 && i < STORY_MISSIONS.length - 1 ? STORY_MISSIONS[i + 1] : null;
}
export function totalStars() {
  return STORY_MISSIONS.length * 3;
}
