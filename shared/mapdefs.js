// Definicoes de mapas (fixas e deterministicas) usadas por ambos os lados.
import { generateMap } from './maps.js';

const defs = [
  // ---------------- Mapas Online ----------------
  { id: 'de_verde', name: 'Verde', tag: 'Deserto', w: 44, h: 32, rooms: 10, corridor: 3, cover: 16, seed: 1001 },
  { id: 'de_fabrica', name: 'Fabrica', tag: 'Industrial', w: 40, h: 30, rooms: 8, corridor: 4, cover: 20, seed: 2002 },
  { id: 'de_caverna', name: 'Caverna', tag: 'Fechado', w: 38, h: 30, rooms: 7, corridor: 2, cover: 24, seed: 3003 },
  { id: 'de_ceu', name: 'Ceu', tag: 'Aberto', w: 48, h: 32, rooms: 12, corridor: 3, cover: 14, seed: 4004 },

  // ---------------- Mapas de Historia ----------------
  { id: 'st_aldeia', name: 'Aldeia', tag: 'Historia', w: 34, h: 26, rooms: 6, corridor: 3, cover: 10, seed: 5005 },
  { id: 'st_fazenda', name: 'Fazenda', tag: 'Historia', w: 38, h: 26, rooms: 7, corridor: 3, cover: 12, seed: 6006 },
  { id: 'st_base', name: 'Base Militar', tag: 'Historia', w: 40, h: 28, rooms: 8, corridor: 3, cover: 16, seed: 7007 },
  { id: 'st_refinaria', name: 'Refinaria', tag: 'Historia', w: 38, h: 28, rooms: 8, corridor: 2, cover: 18, seed: 8008 },
  { id: 'st_fortaleza', name: 'Fortaleza', tag: 'Historia', w: 42, h: 30, rooms: 9, corridor: 2, cover: 20, seed: 9009 },
];

const cache = new Map();

export function getMap(id) {
  if (cache.has(id)) return cache.get(id);
  const d = defs.find((x) => x.id === id);
  if (!d) return null;
  const m = generateMap(d);
  cache.set(id, m);
  return m;
}

export function allMapIds() { return defs.map((d) => d.id); }
export function getMapDef(id) { return defs.find((d) => d.id === id) || null; }

export function storyMapIds() {
  return defs.filter((d) => d.id.startsWith('st_')).map((d) => d.id);
}
export function onlineMapIds() {
  return defs.filter((d) => !d.id.startsWith('st_')).map((d) => d.id);
}

export { defs as MAP_DEFS };
