// Banco de dados SQLite (modulo nativo do Node 24)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FPS2D_DB || join(__dirname, '..', 'data', 'fps2d.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS stats (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode      TEXT NOT NULL,
  kills     INTEGER NOT NULL DEFAULT 0,
  deaths    INTEGER NOT NULL DEFAULT 0,
  wins      INTEGER NOT NULL DEFAULT 0,
  matches   INTEGER NOT NULL DEFAULT 0,
  score     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, mode)
);

CREATE TABLE IF NOT EXISTS story_progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL,
  completed  INTEGER NOT NULL DEFAULT 0,
  best_time  INTEGER,
  stars      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mission_id)
);
`);

// ---------- helpers ----------
export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}
export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
export function createUser(email, username, passHash, passSalt) {
  const now = Date.now();
  const info = db.prepare(
    'INSERT INTO users (email, username, pass_hash, pass_salt, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(email.toLowerCase().trim(), username, passHash, passSalt, now, now);
  return getUserById(Number(info.lastInsertRowid));
}
export function touchLogin(id) {
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), id);
}
export function updateUsername(id, username) {
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
}

export function createSession(token, userId, ip, ua) {
  const now = Date.now();
  const expires = now + 1000 * 60 * 60 * 24 * 30; // 30 dias
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .run(token, userId, now, expires, ip || null, ua || null);
  return expires;
}
export function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = getUserById(row.user_id);
  return user || null;
}
export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
export function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function getStat(userId, mode) {
  let s = db.prepare('SELECT * FROM stats WHERE user_id = ? AND mode = ?').get(userId, mode);
  if (!s) {
    db.prepare('INSERT OR IGNORE INTO stats (user_id, mode) VALUES (?, ?)').run(userId, mode);
    s = db.prepare('SELECT * FROM stats WHERE user_id = ? AND mode = ?').get(userId, mode);
  }
  return s;
}
export function addMatchResult(userId, mode, { kills = 0, deaths = 0, win = false, score = 0 }) {
  const s = getStat(userId, mode);
  db.prepare(
    'UPDATE stats SET kills = kills + ?, deaths = deaths + ?, wins = wins + ?, matches = matches + 1, score = score + ? WHERE user_id = ? AND mode = ?'
  ).run(kills, deaths, win ? 1 : 0, score, userId, mode);
  return s;
}
export function leaderboard(mode = 'global', limit = 20) {
  if (mode === 'global') {
    return db.prepare(`
      SELECT u.username AS username, u.email AS email, SUM(s.kills) AS kills, SUM(s.deaths) AS deaths,
             SUM(s.wins) AS wins, SUM(s.matches) AS matches, SUM(s.score) AS score
      FROM stats s JOIN users u ON u.id = s.user_id
      GROUP BY u.id ORDER BY score DESC, kills DESC LIMIT ?`).all(limit);
  }
  return db.prepare(`
    SELECT u.username AS username, SUM(s.kills) AS kills, SUM(s.deaths) AS deaths,
           SUM(s.wins) AS wins, SUM(s.matches) AS matches, SUM(s.score) AS score
    FROM stats s JOIN users u ON u.id = s.user_id
    WHERE s.mode = ? GROUP BY u.id ORDER BY s.score DESC, s.kills DESC LIMIT ?`).all(mode, limit);
}

export function getStoryProgress(userId) {
  return db.prepare('SELECT mission_id, completed, best_time, stars FROM story_progress WHERE user_id = ?').all(userId);
}
export function setStoryProgress(userId, missionId, { completed = 1, bestTime = null, stars = 0 }) {
  db.prepare(`
    INSERT INTO story_progress (user_id, mission_id, completed, best_time, stars, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, mission_id) DO UPDATE SET
      completed = MAX(completed, excluded.completed),
      best_time = CASE
        WHEN excluded.best_time IS NULL THEN story_progress.best_time
        WHEN story_progress.best_time IS NULL THEN excluded.best_time
        ELSE MIN(story_progress.best_time, excluded.best_time) END,
      stars = MAX(stars, excluded.stars),
      updated_at = excluded.updated_at`).run(userId, missionId, completed, bestTime, stars, Date.now());
}
