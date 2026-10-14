/**
 * Accounts — the browser's side of server/account-server.mjs.
 *
 * Accounts used to live in each browser, which meant signing in at the office
 * and again at home gave you two strangers with two empty libraries. They now
 * live on the account server, so the same email (or the same Gmail) is the
 * same person, with the same maps, on any computer.
 *
 * The session is an httpOnly cookie the server sets; this module never sees
 * it. All it keeps is who the server says is signed in.
 */

const API = '/api/account';
const UNREACHABLE = 'The studio’s account service is not running, so nobody can sign in right now. Start it with start-studio.bat (or `npm run accounts`) and try again.';

let me = null;
const listeners = new Set();

function emit() { listeners.forEach((fn) => fn(me)); }

/** POST a JSON body, and always come back with { ok, ... } rather than throwing. */
async function post(path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, field: 'password', error: UNREACHABLE };
  }
  let data = {};
  try { data = await res.json(); } catch { /* an empty or HTML error page */ }
  // A proxy with nothing behind it answers 502/504 with a page, not JSON.
  if (res.status >= 502) return { ok: false, field: 'password', error: UNREACHABLE };
  return res.ok ? { ok: true, ...data } : { ok: false, field: data.field ?? 'password', error: data.error ?? 'Something went wrong. Please try again.' };
}

function signedIn(result) {
  if (!result.ok) return result;
  me = result.user;
  emit();
  return { ok: true, user: me, created: result.created };
}

/**
 * Ask the server who is signed in (the cookie travels by itself). Called once
 * at start-up; resolves to the user or null, and to null when the service is
 * unreachable — the landing page then explains at sign-in.
 */
export async function loadSession() {
  try {
    const res = await fetch(`${API}/me`, { credentials: 'same-origin' });
    me = res.ok ? (await res.json()).user ?? null : null;
  } catch {
    me = null;
  }
  return me;
}

/** The signed-in account, or null. */
export const currentUser = () => me;

/** @returns {Promise<{ok: true, user: object} | {ok: false, field: string, error: string}>} */
export async function signUp({ name, email, password }) {
  return signedIn(await post('/signup', { name, email, password }));
}

/** @returns {Promise<{ok: true, user: object} | {ok: false, field: string, error: string}>} */
export async function signIn({ email, password }) {
  return signedIn(await post('/signin', { email, password }));
}

/**
 * Sign in — or up — with the ID token Google's button produced. The server
 * checks its signature against Google's keys before trusting a word of it.
 * @param {string} credential
 */
export async function signInWithGoogle(credential) {
  return signedIn(await post('/google', { credential }));
}

export async function signOut() {
  await post('/signout');
  me = null;
  emit();
}

/** @param {(user: object|null) => void} fn */
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Two letters for the avatar. */
export const initials = (user) =>
  (user?.name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';

/**
 * Libraries left in this browser by the accounts that lived here before the
 * account server existed, for the same email. Their projects are carried up to
 * the server the first time that person signs in, so nothing made before the
 * change is stranded on one machine.
 */
export function legacyLibraryKeys(email) {
  try {
    const old = JSON.parse(localStorage.getItem('gds.accounts.v1') ?? '[]');
    const wanted = String(email ?? '').trim().toLowerCase();
    return old.filter((a) => a.email === wanted).map((a) => `gds.projects.v3.${a.id}`);
  } catch {
    return [];
  }
}
