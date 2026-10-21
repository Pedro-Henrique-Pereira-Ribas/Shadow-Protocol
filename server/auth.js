// Autenticacao: validacao de e-mail, forca de senha, hash e sessoes.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { promises as dns } from 'node:dns';
import {
  createSession, createUser, destroySession, getSessionUser, getUserByEmail, touchLogin,
} from './db.js';

const SESSION_COOKIE = 'fps2d_sid';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;

// ---------------- E-mail ----------------
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;

// dominios descartaveis conhecidos (bloqueio basico)
const DISPOSABLE = new Set([
  '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com',
  'guerrillamail.com', 'sharklasers.com', 'getnada.com', 'mailinator.com', 'trashmail.com',
  'dispostable.com', 'fakeinbox.com', 'maildrop.cc', 'tempmailo.com', 'mytemp.email',
  'spamgourmet.com', 'emailondeck.com', 'moakt.com', 'linshiyouxiang.net', 'tempr.email',
]);

export async function validateEmail(rawEmail) {
  const email = String(rawEmail || '').trim();
  if (!email) return { ok: false, error: 'E-mail obrigatorio.' };
  if (email.length > 254) return { ok: false, error: 'E-mail muito longo.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Formato de e-mail invalido.' };

  const [, domain] = email.split('@');
  const d = domain.toLowerCase();
  if (DISPOSABLE.has(d)) {
    return { ok: false, error: 'E-mails temporarios/descartaveis nao sao aceitos.' };
  }
  if (d === 'localhost' || d.endsWith('.local') || d.endsWith('.test') || d.endsWith('.invalid')) {
    return { ok: false, error: 'Dominio de e-mail invalido.' };
  }

  // Verificacao de dominio (MX). Falhas de rede nao bloqueiam o cadastro.
  try {
    const mx = await dns.resolveMx(d);
    if (!mx || mx.length === 0) {
      const a = await dns.resolve4(d).catch(() => []);
      if (!a.length) return { ok: false, error: 'Dominio de e-mail nao existe.' };
    }
  } catch (e) {
    if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) {
      return { ok: false, error: 'Dominio de e-mail nao existe.' };
    }
    // sem rede -> aceita (validacao sintatica ja passou)
  }

  return { ok: true, email };
}

// ---------------- Senha ----------------
const COMMON_PASSWORDS = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', 'password', 'senha', 'senha123',
  'qwerty', 'qwertyui', 'abc123', 'admin', 'admin123', 'root', 'root123', '111111', '000000',
  '123123', '654321', 'football', 'minecraft', 'iloveyou', 'princess', 'login', 'welcome',
  'letmein', 'monkey', 'dragon', 'sunshine', 'master', 'shadow', 'superman', 'batman',
]);

export function validatePassword(pw) {
  const s = String(pw || '');
  if (!s) return { ok: false, error: 'Senha obrigatoria.' };
  if (s.length < 6) return { ok: false, error: 'A senha deve ter no minimo 6 digitos.' };
  if (s.length > 128) return { ok: false, error: 'Senha muito longa (max 128).' };
  if (s.length < 8 && !/[A-Z]/.test(s)) {
    return { ok: false, error: 'Senha fraca: inclua ao menos uma letra maiuscula.' };
  }
  if (!/[a-z]/.test(s)) return { ok: false, error: 'Senha fraca: inclua ao menos uma letra minuscula.' };
  if (!/[0-9]/.test(s)) return { ok: false, error: 'Senha fraca: inclua ao menos um numero.' };
  if (COMMON_PASSWORDS.has(s.toLowerCase())) return { ok: false, error: 'Senha muito comum. Escolha outra.' };
  if (/^(.)\1+$/.test(s)) return { ok: false, error: 'Senha muito fraca (caracteres repetidos).' };
  return { ok: true };
}

export function passwordStrength(pw) {
  const s = String(pw || '');
  let score = 0;
  if (s.length >= 6) score++;
  if (s.length >= 10) score++;
  if (s.length >= 14) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/[0-9]/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  return Math.min(4, score);
}

// ---------------- Hash ----------------
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  try {
    const a = Buffer.from(hash, 'hex');
    const b = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------- Sessoes / cookies ----------------
export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionToken(req) {
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE] || (req.headers['x-session-token'] || null);
}

export function setSessionCookie(res, token, maxAgeSec = SESSION_TTL / 1000) {
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAgeSec)}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// ---------------- Servico ----------------
export async function register({ email, password, username }) {
  const em = await validateEmail(email);
  if (!em.ok) return { ok: false, error: em.error };

  const pw = validatePassword(password);
  if (!pw.ok) return { ok: false, error: pw.error };

  const name = String(username || '').trim().slice(0, 16) || em.email.split('@')[0].slice(0, 16);
  if (!/^[\w \-_.]{2,16}$/.test(name)) {
    return { ok: false, error: 'Nome de usuario invalido (2-16 letras/numeros).' };
  }

  if (getUserByEmail(em.email)) {
    return { ok: false, error: 'Este e-mail ja esta cadastrado.' };
  }

  const { hash, salt } = hashPassword(password);
  const user = createUser(em.email, name, hash, salt);
  const token = randomBytes(32).toString('hex');
  createSession(token, user.id, null, null);
  return { ok: true, user, token };
}

export function login({ email, password }) {
  const mail = String(email || '').trim().toLowerCase();
  if (!mail || !password) return { ok: false, error: 'Informe e-mail e senha.' };
  const user = getUserByEmail(mail);
  if (!user) {
    // gasta tempo para nao revelar se o e-mail existe
    hashPassword(String(password));
    return { ok: false, error: 'E-mail ou senha incorretos.' };
  }
  if (!verifyPassword(String(password), user.pass_hash, user.pass_salt)) {
    return { ok: false, error: 'E-mail ou senha incorretos.' };
  }
  touchLogin(user.id);
  const token = randomBytes(32).toString('hex');
  createSession(token, user.id, null, null);
  return { ok: true, user, token };
}

export function logout(token) {
  destroySession(token);
}

export function currentUser(req) {
  const token = sessionToken(req);
  const user = getSessionUser(token);
  return user ? { user, token } : { user: null, token };
}

export { SESSION_COOKIE };
