// Gerenciador de tema (claro/escuro) com persistencia.
const KEY = 'fps2d_theme';
export const THEMES = ['dark', 'light'];

export function getStoredTheme() {
  try {
    const t = localStorage.getItem(KEY);
    if (THEMES.includes(t)) return t;
  } catch { /* localStorage indisponivel */ }
  return 'dark';
}

export function applyTheme(theme, onChange) {
  const t = THEMES.includes(theme) ? theme : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  updateThemeButtons(t);
  onChange?.(t);
  return t;
}

export function toggleTheme(onChange) {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  return applyTheme(cur === 'dark' ? 'light' : 'dark', onChange);
}

export function updateThemeButtons(theme) {
  const isDark = theme === 'dark';
  const ico = isDark ? '\u263D' : '\u2600';   // lua / sol
  const txt = isDark ? 'ESCURO' : 'CLARO';
  for (const id of ['themeIco', 'themeIco2']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = ico;
  }
  for (const id of ['themeTxt', 'themeTxt2']) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }
}
