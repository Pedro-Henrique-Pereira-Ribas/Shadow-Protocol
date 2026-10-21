// Camada de comunicacao com a API do servidor.
async function req(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req('/api/auth/me'),
  register: (email, password, username) =>
    req('/api/auth/register', { method: 'POST', body: { email, password, username } }),
  login: (email, password) =>
    req('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),

  maps: () => req('/api/maps'),
  story: () => req('/api/story'),
  saveStory: (missionId, time, stars) =>
    req('/api/story/progress', { method: 'POST', body: { missionId, time, stars } }),

  rooms: () => req('/api/rooms'),
  createRoom: (name, mode, mapId) =>
    req('/api/rooms', { method: 'POST', body: { name, mode, mapId } }),
  joinRoom: (code) =>
    req('/api/rooms/join', { method: 'POST', body: { code } }),

  leaderboard: (mode = 'global') => req(`/api/leaderboard?mode=${encodeURIComponent(mode)}`),
  stats: () => req('/api/stats'),
};
