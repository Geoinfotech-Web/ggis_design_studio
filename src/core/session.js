/**
 * Picking up where you left off.
 *
 * Two things the project library alone does not do:
 *
 *  1. Remember which map was open, so a refresh (or coming back tomorrow)
 *     reopens it instead of an empty first step. That is one id per account
 *     in localStorage.
 *
 *  2. Keep the data layers. A project's document lives in localStorage and on
 *     the account server, and both are small — a few megabytes at most — while
 *     one district's buildings can be tens of megabytes of GeoJSON. So layers
 *     go to IndexedDB, keyed by project, where size is not the problem. They
 *     are this browser's copy: on another computer the map reopens with its
 *     boundary and page, and its data layers need adding there once.
 *
 * Like the geodata cache, everything here fails quietly. Storage can be
 * refused for reasons that have nothing to do with the app, and the worst
 * outcome of a failed write is the old behaviour, never an error dialog.
 */

const DB_NAME = 'gds-projects';
const DB_VERSION = 1;
const STORE = 'layers';
const LAST_KEY = (owner) => `gds.lastProject.${owner ?? 'local'}`;

const supported = typeof indexedDB !== 'undefined';
let dbPromise = null;

function open() {
  if (!supported) return Promise.resolve(null);
  dbPromise = dbPromise ?? new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve) => {
    if (!db) return resolve(null);
    let out = null;
    let t;
    try { t = db.transaction(STORE, mode); } catch { return resolve(null); }
    t.oncomplete = () => resolve(out);
    t.onerror = () => resolve(null);
    t.onabort = () => resolve(null);
    try { fn(t.objectStore(STORE), (v) => { out = v; }); } catch { resolve(null); }
  }));
}

/** Layers as plain data: anything a structured clone cannot carry is dropped. */
function storable(layers) {
  try {
    return structuredClone(layers);
  } catch {
    // A function or DOM node slipped into a layer somewhere; JSON drops those.
    try { return JSON.parse(JSON.stringify(layers)); } catch { return []; }
  }
}

/** Store a project's data layers. Resolves true when written. */
export async function saveProjectLayers(projectId, layers) {
  if (!projectId) return false;
  const record = { id: projectId, savedAt: Date.now(), layers: storable(layers ?? []) };
  const ok = await run('readwrite', (store, done) => { store.put(record).onsuccess = () => done(true); });
  return Boolean(ok);
}

/** A project's stored data layers, or null when this browser has none. */
export async function loadProjectLayers(projectId) {
  if (!projectId) return null;
  const record = await run('readonly', (store, done) => {
    const req = store.get(projectId);
    req.onsuccess = () => done(req.result ?? null);
  });
  return Array.isArray(record?.layers) ? record.layers : null;
}

/** Forget a project's layers — when the project itself is deleted. */
export function deleteProjectLayers(projectId) {
  if (!projectId) return Promise.resolve(false);
  return run('readwrite', (store, done) => { store.delete(projectId).onsuccess = () => done(true); });
}

/** Which map this account had open last, or null. */
export function lastProjectId(owner) {
  try { return localStorage.getItem(LAST_KEY(owner)) || null; } catch { return null; }
}

/** Remember (or with null, forget) the map this account has open. */
export function rememberProject(owner, projectId) {
  try {
    if (projectId) localStorage.setItem(LAST_KEY(owner), projectId);
    else localStorage.removeItem(LAST_KEY(owner));
  } catch { /* storage blocked: the next visit simply starts fresh */ }
}
