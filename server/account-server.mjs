/**
 * Account server — who you are, and your maps, kept in one place.
 *
 *   node server/account-server.mjs          (or: npm run accounts)
 *
 * Before this, accounts and projects lived in each browser's localStorage, so
 * signing in at the office and again at home meant two strangers with two
 * empty libraries. Here they live in one SQLite file, and any browser that
 * signs in to the same account sees the same maps.
 *
 * What it does:
 *   - email + password accounts, hashed with scrypt;
 *   - Sign in with Google, with the ID token's signature checked against
 *     Google's published keys — the check a browser cannot make;
 *   - a session cookie (httpOnly, so page scripts never see it);
 *   - each account's project library: list, read, save, delete.
 *
 * In development Vite proxies /api/account here (see vite.config.js), so the
 * browser makes same-origin requests and the cookie needs no CORS. Deployed,
 * put both behind one domain the same way, over HTTPS, with COOKIE_SECURE=1.
 *
 * Uses node:sqlite and node:crypto only — nothing to install.
 */

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, createPublicKey, verify } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCb);
const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* configuration                                                       */
/* ------------------------------------------------------------------ */

/** The studio's .env, so the Google client ID is set in one place for both halves. */
function readDotEnv() {
  const file = resolve(HERE, '..', '.env');
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]));
}
const DOTENV = readDotEnv();

const PORT = Number(process.env.PORT ?? 8789);
const DB_PATH = process.env.ACCOUNTS_DB ?? resolve(HERE, 'data', 'accounts.db');
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID ?? DOTENV.VITE_GOOGLE_CLIENT_ID ?? '').trim();
/** Set when served over HTTPS, so the cookie is never sent in the clear. */
const COOKIE_SECURE = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE ?? '');
const SESSION_DAYS = 30;
/** A project carries its study-area outlines, which can be large; a page of them cannot be unlimited. */
const MAX_BODY = Number(process.env.MAX_PROJECT_BYTES ?? 25 * 1024 * 1024);
const MAX_PROJECTS = 200;

/* ------------------------------------------------------------------ */
/* database                                                            */
/* ------------------------------------------------------------------ */
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  password    TEXT,               -- scrypt$salt$hash, or NULL for Google-only accounts
  google_sub  TEXT UNIQUE,
  picture     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,    -- sha256 of the cookie; the cookie itself is never stored
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  template_id TEXT,
  saved_at    INTEGER NOT NULL,
  thumb       TEXT NOT NULL DEFAULT '',
  doc         TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS projects_by_user ON projects(user_id, saved_at DESC);
`);

const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByGoogle: db.prepare('SELECT * FROM users WHERE google_sub = ?'),
  insertUser: db.prepare('INSERT INTO users (id, email, name, password, google_sub, picture, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  linkGoogle: db.prepare('UPDATE users SET google_sub = ?, picture = ? WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  session: db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
  dropSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  dropExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  listProjects: db.prepare('SELECT id, name, template_id, saved_at, thumb FROM projects WHERE user_id = ? ORDER BY saved_at DESC'),
  listProjectsFull: db.prepare('SELECT id, name, template_id, saved_at, thumb, doc FROM projects WHERE user_id = ? ORDER BY saved_at DESC'),
  project: db.prepare('SELECT id, name, template_id, saved_at, thumb, doc FROM projects WHERE user_id = ? AND id = ?'),
  projectSavedAt: db.prepare('SELECT saved_at FROM projects WHERE user_id = ? AND id = ?'),
  countProjects: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?'),
  upsertProject: db.prepare(`INSERT INTO projects (id, user_id, name, template_id, saved_at, thumb, doc)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET name = excluded.name, template_id = excluded.template_id,
      saved_at = excluded.saved_at, thumb = excluded.thumb, doc = excluded.doc`),
  deleteProject: db.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?'),
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, picture: u.picture ?? '', google: Boolean(u.google_sub), password: Boolean(u.password) });

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function passwordMatches(password, stored) {
  const [kind, saltHex, hashHex] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(String(password ?? ''), Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('That is too large to save.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('The request was not valid JSON.'), { status: 400 });
  }
}

const cookies = (req) => Object.fromEntries(String(req.headers.cookie ?? '').split(/;\s*/)
  .filter(Boolean).map((pair) => { const i = pair.indexOf('='); return [pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))]; }));

function sessionCookie(token, maxAgeSeconds) {
  return [
    `gds_session=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`,
    COOKIE_SECURE ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function startSession(res, user) {
  const token = randomBytes(32).toString('hex');
  q.insertSession.run(sha256(token), user.id, Date.now() + SESSION_DAYS * 86400000);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

function sessionUser(req) {
  const token = cookies(req).gds_session;
  if (!token) return null;
  const row = q.session.get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  return q.userById.get(row.user_id) ?? null;
}

/**
 * A few attempts a minute per address and per email. Enough for anyone who
 * mistyped; far too few for anyone guessing.
 */
const attempts = new Map();
function throttled(key, limit = 8, windowMs = 60000) {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > limit;
}
/**
 * The caller's address, for the sign-in rate limits. X-Forwarded-For is only
 * believed behind a reverse proxy we run (TRUST_PROXY=1): exposed directly,
 * anyone could send a fresh fake address with every attempt and never be
 * throttled.
 */
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? '');
const clientIp = (req) => (TRUST_PROXY
  ? String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()
  : String(req.socket.remoteAddress ?? ''));

/* ------------------------------------------------------------------ */
/* Google ID tokens                                                    */
/* ------------------------------------------------------------------ */
let googleKeys = { at: 0, keys: new Map() };

/** Google's current signing keys, refreshed hourly and whenever an unknown key id turns up. */
async function googleKey(kid) {
  const stale = Date.now() - googleKeys.at > 3600000;
  if (stale || !googleKeys.keys.has(kid)) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!res.ok) throw new Error('Could not reach Google to check the sign-in.');
    const { keys } = await res.json();
    googleKeys = { at: Date.now(), keys: new Map(keys.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })])) };
  }
  return googleKeys.keys.get(kid) ?? null;
}

const fromB64url = (part) => Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function verifyGoogleToken(token) {
  if (!GOOGLE_CLIENT_ID) throw Object.assign(new Error('Google sign-in is not configured on the server.'), { status: 501 });
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new Error('That is not a Google sign-in token.');
  const header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
  const claims = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('Unexpected token type.');

  const key = await googleKey(header.kid);
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  if (!key || !verify('RSA-SHA256', signed, key, fromB64url(parts[2]))) throw new Error('This Google sign-in could not be verified.');
  if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error('This Google sign-in was issued for a different application.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('This sign-in did not come from Google.');
  if (Number(claims.exp) * 1000 < Date.now()) throw new Error('This Google sign-in has expired. Please try again.');
  if (claims.email_verified === false || claims.email_verified === 'false') throw new Error('Google has not verified this email address yet.');
  if (!claims.sub || !claims.email) throw new Error('Google did not share an email address for this account.');
  return claims;
}

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */
async function signup(req, res) {
  const { name, email, password } = await readJson(req);
  const cleanName = String(name ?? '').trim().slice(0, 120);
  const cleanEmail = normaliseEmail(email);
  if (!cleanName) return send(res, 400, { field: 'name', error: 'Enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return send(res, 400, { field: 'email', error: 'Enter a valid email address.' });
  if (String(password ?? '').length < 8) return send(res, 400, { field: 'password', error: 'Use at least 8 characters.' });
  if (throttled(`signup:${clientIp(req)}`, 10)) return send(res, 429, { field: 'email', error: 'Too many attempts. Wait a minute and try again.' });

  const existing = q.userByEmail.get(cleanEmail);
  if (existing) {
    return send(res, 409, {
      field: 'email',
      error: existing.password ? 'There is already an account with this email. Sign in instead.' : 'This email signs in with Google. Use the Google button above.',
    });
  }
  const user = { id: newId('u'), email: cleanEmail, name: cleanName, password: await hashPassword(password), google_sub: null, picture: '' };
  q.insertUser.run(user.id, user.email, user.name, user.password, null, '', Date.now());
  return send(res, 201, { user: publicUser(user) }, { 'Set-Cookie': startSession(res, user) });
}

async function signin(req, res) {
  const { email, password } = await readJson(req);
  const cleanEmail = normaliseEmail(email);
  if (throttled(`signin:${clientIp(req)}`) || throttled(`signin:${cleanEmail}`, 6)) {
    return send(res, 429, { field: 'password', error: 'Too many attempts. Wait a minute and try again.' });
  }
  const user = q.userByEmail.get(cleanEmail);
  // One message for an unknown email and a wrong password, so the form does
  // not confirm which addresses have accounts.
  const failed = { field: 'password', error: 'That email and password do not match an account.' };
  if (!user) return send(res, 401, failed);
  if (!user.password) return send(res, 401, { field: 'password', error: 'This account signs in with Google. Use the Google button above.' });
  if (!(await passwordMatches(password, user.password))) return send(res, 401, failed);
  return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': startSession(res, user) });
}

async function google(req, res) {
  const { credential } = await readJson(req);
  if (throttled(`google:${clientIp(req)}`, 20)) return send(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });
  let claims;
  try {
    claims = await verifyGoogleToken(credential);
  } catch (err) {
    return send(res, err.status ?? 401, { error: err.message });
  }
  const email = normaliseEmail(claims.email);
  let user = q.userByGoogle.get(claims.sub) ?? q.userByEmail.get(email);
  let created = false;
  if (user) {
    // Google has proved this person owns the address, so an existing password
    // account with it is the same person: link rather than duplicate.
    q.linkGoogle.run(claims.sub, claims.picture ?? user.picture ?? '', user.id);
    user = q.userById.get(user.id);
  } else {
    user = { id: newId('u'), email, name: claims.name || claims.given_name || email.split('@')[0], password: null, google_sub: claims.sub, picture: claims.picture ?? '' };
    q.insertUser.run(user.id, user.email, user.name, null, user.google_sub, user.picture, Date.now());
    created = true;
  }
  return send(res, 200, { user: publicUser(user), created }, { 'Set-Cookie': startSession(res, user) });
}

function signout(req, res) {
  const token = cookies(req).gds_session;
  if (token) q.dropSession.run(sha256(token));
  return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}

const projectRow = (row, withDoc) => ({
  id: row.id, name: row.name, templateId: row.template_id, savedAt: row.saved_at, thumb: row.thumb,
  ...(withDoc ? { doc: JSON.parse(row.doc) } : {}),
});

async function saveProject(req, res, user, id) {
  const entry = await readJson(req);
  if (!entry || typeof entry.doc !== 'object') return send(res, 400, { error: 'A project needs a document.' });
  const savedAt = Number(entry.savedAt) || Date.now();
  const current = q.projectSavedAt.get(user.id, id);
  // Two computers editing the same map: the later save wins, and an older one
  // arriving late must not roll the newer one back.
  if (current && current.saved_at > savedAt) return send(res, 409, { error: 'A newer version of this map is already saved.', savedAt: current.saved_at });
  if (!current && q.countProjects.get(user.id).n >= MAX_PROJECTS) {
    return send(res, 409, { error: `You have reached ${MAX_PROJECTS} maps. Delete some in My projects first.` });
  }
  q.upsertProject.run(id, user.id, String(entry.name ?? 'Untitled map').slice(0, 200), entry.templateId ?? null,
    savedAt, String(entry.thumb ?? ''), JSON.stringify(entry.doc));
  return send(res, 200, { ok: true, savedAt });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  if (method === 'GET' && path === '/health') return send(res, 200, { ok: true, google: Boolean(GOOGLE_CLIENT_ID) });
  if (method === 'GET' && path === '/config') return send(res, 200, { googleClientId: GOOGLE_CLIENT_ID });
  if (method === 'POST' && path === '/signup') return signup(req, res);
  if (method === 'POST' && path === '/signin') return signin(req, res);
  if (method === 'POST' && path === '/google') return google(req, res);
  if (method === 'POST' && path === '/signout') return signout(req, res);

  const user = sessionUser(req);
  // Signed out is an answer, not an error: 200 with no user keeps every
  // signed-out page load from logging a failed request.
  if (method === 'GET' && path === '/me') return send(res, 200, { user: user ? publicUser(user) : null });
  if (!user) return send(res, 401, { error: 'Sign in first.' });

  if (method === 'GET' && path === '/projects') {
    const full = url.searchParams.get('full') === '1';
    const rows = (full ? q.listProjectsFull : q.listProjects).all(user.id);
    return send(res, 200, { projects: rows.map((row) => projectRow(row, full)) });
  }
  const match = path.match(/^\/projects\/([A-Za-z0-9_-]{1,64})$/);
  if (match) {
    const id = match[1];
    if (method === 'GET') {
      const row = q.project.get(user.id, id);
      return row ? send(res, 200, { project: projectRow(row, true) }) : send(res, 404, { error: 'No such project.' });
    }
    if (method === 'PUT') return saveProject(req, res, user, id);
    if (method === 'DELETE') { q.deleteProject.run(user.id, id); return send(res, 200, { ok: true }); }
  }
  return send(res, 404, { error: 'Not found.' });
}

createServer((req, res) => {
  route(req, res).catch((err) => {
    if (!err.status) console.error('[accounts]', err);
    if (!res.headersSent) send(res, err.status ?? 500, { error: err.status ? err.message : 'Something went wrong on the server.' });
  });
}).listen(PORT, () => {
  q.dropExpired.run(Date.now());
  console.log(`Account server on http://localhost:${PORT}`);
  console.log(`Database ${DB_PATH}`);
  console.log(GOOGLE_CLIENT_ID ? 'Google sign-in: on' : 'Google sign-in: off (no VITE_GOOGLE_CLIENT_ID in .env)');
});
