/**
 * Central application state with a tiny pub/sub layer and an undo stack.
 *
 * Everything the UI renders comes from here. Modules never talk to each
 * other directly — they `set()` state and `subscribe()` to the keys they
 * care about, which is what keeps the panels, the map and the export
 * pipeline from drifting apart the way they did in the v2 prototype.
 */

// The catalogue is a static data module with no imports of its own, so this
// stays a leaf dependency rather than a cycle back into the UI.
import { templateById } from '../templates/catalog.js';

const HISTORY_KEYS = ['elements', 'page', 'templateId', 'mapLook'];
const HISTORY_LIMIT = 60;

export const state = {
  view: 'landing',                     // 'landing' | 'studio'
  projectId: null,                     // entry in the saved project library
  projectName: 'Untitled map',
  activeTool: 'area',                  // which left panel is showing
  // Set once the user has picked a starting point — new, template or
  // contributor layout. Until then only the study area and Start map are
  // open; see core/flow.js.
  mapStarted: false,
  // While on, page elements let the pointer through to the map, so it
  // can be dragged from anywhere. Interface state: not saved, not undone.
  panMode: false,

  templateId: 'quiet-canvas',

  basemap: 'liberty',
  basemapGroups: { roads: true, water: true, buildings: true, boundaries: true, labels: true, landcover: true },
  mapView: { center: [7.4951, 9.0579], zoom: 5.6, pitch: 0, bearing: 0 },
  terrain: false,
  buildings3d: false,
  mapLook: { filter: 'none', texture: 'none', vignette: 0 },

  page: { size: 'a4', orientation: 'portrait', dpi: 150, background: '#ffffff' },

  // The areas this map is about, and the combined view of them that the rest
  // of the app reads. Both are written together by data/study-areas.js —
  // never assign either one directly.
  studyAreas: [],                      // [{ name, level, geojson, bbox, areaKm2 }]
  studyArea: null,                     // the same shape, covering all of them
  clipToArea: true,                    // trim open data to the boundary, not the bbox
  // Bumped when a locator-inset context outline finishes loading. A counter,
  // not the outline: several insets can want different ones, and each looks
  // its own up. See data/inset-context.js.
  insetContext: 0,

  layers: [],                          // see layers/registry.js
  elements: [],                        // see layout/elements.js
  selectedElementId: null,
  selectedLayerId: null,               // right panel shows layer styling instead

  analysisRuns: [],                    // completed analysis jobs
  analysisBusy: false,

  hydrated: false,
};

/* ------------------------------------------------------------------ */
/* pub / sub                                                           */
/* ------------------------------------------------------------------ */
const subscribers = new Set();

/**
 * @param {string[]|'*'} keys  top-level state keys to watch
 * @param {(state:object, changed:string[]) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(keys, fn) {
  const entry = { keys: keys === '*' ? null : new Set([].concat(keys)), fn };
  subscribers.add(entry);
  return () => subscribers.delete(entry);
}

function emit(changed) {
  if (!changed.length) return;
  for (const { keys, fn } of Array.from(subscribers)) {
    if (!keys || changed.some((k) => keys.has(k))) {
      try { fn(state, changed); } catch (err) { console.error('[store] subscriber failed', err); }
    }
  }
}

/**
 * Merge a patch into state and notify subscribers.
 * @param {object} patch
 * @param {{history?: boolean, silent?: boolean}} [opts]
 *        history:true records an undo checkpoint *before* applying.
 */
export function set(patch, opts = {}) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] === value) continue;
    changed.push(key);
  }
  if (!changed.length) return;

  if (opts.history !== false && changed.some((k) => HISTORY_KEYS.includes(k))) checkpoint();

  Object.assign(state, patch);
  if (!opts.silent) emit(changed);
}

/** Force-notify keys whose contents were mutated in place. */
export function touch(...keys) { emit(keys); }

/* ------------------------------------------------------------------ */
/* undo / redo                                                         */
/* ------------------------------------------------------------------ */
const past = [];
const future = [];
let restoring = false;

const snapshot = () => JSON.parse(JSON.stringify(Object.fromEntries(HISTORY_KEYS.map((k) => [k, state[k]]))));

/** Record the current document so the next change can be undone. */
export function checkpoint() {
  if (restoring) return;
  past.push(snapshot());
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  emit(['history']);
}

function restore(snap) {
  restoring = true;
  Object.assign(state, JSON.parse(JSON.stringify(snap)));
  restoring = false;
  emit([...HISTORY_KEYS, 'selectedElementId', 'history']);
}

export function undo() {
  if (!past.length) return false;
  future.push(snapshot());
  restore(past.pop());
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(snapshot());
  restore(future.pop());
  return true;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

/* ------------------------------------------------------------------ */
/* project library — many projects, saved in this browser              */
/* ------------------------------------------------------------------ */
const SHARED_LIBRARY_KEY = 'gds.projects.v3';   // from before there were accounts
let LIBRARY_KEY = SHARED_LIBRARY_KEY;

/**
 * Point the library at one account's projects.
 *
 * Projects saved before sign-in existed sit under the shared key. The first
 * account to sign in on this browser inherits them — they were made here, by
 * whoever is at this machine — and from then on every account has its own.
 * @param {string|null} userId
 */
export function setLibraryOwner(userId) {
  LIBRARY_KEY = userId ? `${SHARED_LIBRARY_KEY}.${userId}` : SHARED_LIBRARY_KEY;
  if (!userId) return;
  try {
    const shared = localStorage.getItem(SHARED_LIBRARY_KEY);
    if (shared && localStorage.getItem(LIBRARY_KEY) === null) {
      localStorage.setItem(LIBRARY_KEY, shared);
      localStorage.removeItem(SHARED_LIBRARY_KEY);
    }
  } catch { /* storage blocked: the library simply starts empty */ }
}
const LEGACY_KEY = 'gds.project.v3';      // the old single-slot format
const PERSIST_KEYS = [
  'projectName', 'templateId', 'basemap', 'basemapGroups', 'mapView', 'terrain',
  'buildings3d', 'mapLook', 'page', 'elements', 'studyAreas', 'clipToArea', 'mapStarted',
];

/** Beyond this the oldest project is dropped — localStorage is finite. */
export const MAX_PROJECTS = 24;

/* ------------------------------------------------------------------ */
/* the account server's copy                                           */
/* ------------------------------------------------------------------ */

/**
 * The library this browser keeps is a working copy; the account server holds
 * the real one, which is what makes the same maps appear on every computer an
 * account signs in from. Reads stay synchronous and local, so nothing in the
 * studio waits on the network to draw a list. Every save is written here first
 * and then sent up; signing in pulls down whatever was saved elsewhere.
 */
const PROJECTS_API = '/api/account/projects';

/** Saves still on their way up, by project — only the newest is worth sending. */
const outbox = new Map();
let pushing = false;

async function flushOutbox() {
  if (pushing) return;
  pushing = true;
  try {
    while (outbox.size) {
      const [id, entry] = outbox.entries().next().value;
      outbox.delete(id);
      try {
        const res = await fetch(`${PROJECTS_API}/${encodeURIComponent(id)}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });
        // 409 means a newer copy is already up there; nothing to retry.
        if (!res.ok && res.status !== 409 && res.status !== 413) throw new Error(String(res.status));
        syncFailed = false;
      } catch {
        // Offline, or the service is down: keep it, and try again shortly.
        if (!outbox.has(id)) outbox.set(id, entry);
        syncFailed = true;
        setTimeout(flushOutbox, 15000);
        break;
      }
    }
  } finally {
    pushing = false;
  }
}

let syncFailed = false;
/** True when the last attempt to reach the server failed — the panel says so. */
export const librarySyncFailing = () => syncFailed || outbox.size > 0;

function pushProject(entry) {
  outbox.set(entry.id, entry);
  flushOutbox();
}

/**
 * Bring this browser's copy and the server's into agreement, newest version
 * of each map winning. Maps only here (made offline, or before accounts were
 * on the server) are sent up; maps only there are brought down.
 *
 * @param {{legacyKeys?: string[]}} [opts]  older per-browser libraries for this
 *        same person, carried up once and then retired.
 * @returns {Promise<{ok: boolean, pulled: number, pushed: number}>}
 */
export async function syncLibrary({ legacyKeys = [] } = {}) {
  let remote;
  try {
    const res = await fetch(`${PROJECTS_API}?full=1`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    remote = (await res.json()).projects ?? [];
  } catch {
    syncFailed = true;
    return { ok: false, pulled: 0, pushed: 0 };
  }

  const legacy = legacyKeys.flatMap((key) => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
  });
  const local = [...readLibrary(), ...legacy];

  const byId = new Map();
  for (const entry of [...remote, ...local]) {
    const have = byId.get(entry.id);
    if (!have || (entry.savedAt ?? 0) > (have.savedAt ?? 0)) byId.set(entry.id, entry);
  }
  const remoteAt = new Map(remote.map((entry) => [entry.id, entry.savedAt ?? 0]));
  const merged = [...byId.values()].sort((a, b) => b.savedAt - a.savedAt);

  let pushed = 0;
  for (const entry of merged) {
    if ((remoteAt.get(entry.id) ?? -1) < (entry.savedAt ?? 0) && entry.doc) { outbox.set(entry.id, entry); pushed += 1; }
  }
  writeLibrary(merged.slice(0, MAX_PROJECTS));
  await flushOutbox();
  if (!outbox.size) {
    legacyKeys.forEach((key) => { try { localStorage.removeItem(key); } catch { /* fine */ } });
    syncFailed = false;
  }
  return { ok: true, pulled: remote.filter((r) => !local.some((l) => l.id === r.id)).length, pushed };
}

/** A project this browser has no copy of — its thumbnail-only stub, say. */
export async function fetchProject(id) {
  try {
    const res = await fetch(`${PROJECTS_API}/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    return res.ok ? (await res.json()).project : null;
  } catch {
    return null;
  }
}

const newId = () => `p_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

function readLibrary() {
  try {
    const list = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Write, shedding thumbnails and then whole projects if the quota bites. */
function writeLibrary(list) {
  const attempts = [
    list,
    list.map((p, i) => (i === 0 ? p : { ...p, thumb: '' })),   // keep newest thumb
    list.map((p) => ({ ...p, thumb: '' })),
    list.slice(0, Math.max(1, Math.floor(list.length / 2))).map((p) => ({ ...p, thumb: '' })),
  ];
  for (const attempt of attempts) {
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(attempt));
      return { ok: true, trimmed: attempt.length < list.length || attempt.some((p, i) => !p.thumb && list[i].thumb) };
    } catch { /* try a smaller payload */ }
  }
  return { ok: false, error: 'This browser is out of storage space for saved projects. Delete a few from My projects.' };
}

let migrated = false;
function migrateLegacy() {
  if (migrated) return;
  migrated = true;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const { savedAt, doc } = JSON.parse(raw);
    if (doc) {
      const list = readLibrary();
      list.unshift({
        id: newId(),
        name: doc.projectName || 'Untitled map',
        templateId: doc.templateId,
        savedAt: savedAt ?? Date.now(),
        thumb: '',
        doc,
      });
      writeLibrary(list);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* nothing worth recovering */ }
}

/** Every saved project, newest first, without the (large) document body. */
export function listProjects() {
  migrateLegacy();
  return readLibrary()
    .map(({ doc, ...meta }) => meta)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function getProject(id) {
  migrateLegacy();
  return readLibrary().find((p) => p.id === id) ?? null;
}

/**
 * Save the live document into the current project, creating one on first
 * save. Pass a thumbnail data URL to refresh the home-page card.
 * @returns {{ok: boolean, id?: string, error?: string}}
 */
/**
 * Is the page still exactly what the template laid out?
 *
 * Compared field by field rather than by a "dirty" flag, so it stays honest
 * no matter which panel made the change — moving a title, typing one, adding
 * or deleting an element all show up here without any of them having to
 * remember to report it.
 */
function elementsAreUntouched() {
  const tpl = templateById(state.templateId);
  if (!tpl) return false;
  if (state.elements.length !== tpl.elements.length) return false;
  return state.elements.every((elm, i) => {
    const spec = tpl.elements[i];
    return elm.type === spec.type
      && elm.x === spec.x && elm.y === spec.y && elm.w === spec.w && elm.h === spec.h
      && (elm.text ?? '') === (spec.text ?? '');
  });
}

/**
 * Has the user actually started something here?
 *
 * Opening a template is browsing, not work — on its own it must never reach
 * the project library, or looking through the gallery fills the home page
 * with identical stubs. Loading an area, adding data, running an analysis or
 * editing the page all count; so does a project that has been saved once
 * already, which from then on keeps itself up to date.
 */
export function hasWork() {
  // Until a starting point is chosen there is no page at all, so an empty
  // page is not an edit — only a study area (or a project already saved)
  // makes this worth keeping.
  if (!state.mapStarted) return Boolean(state.projectId || state.studyArea || state.layers.length);
  return Boolean(
    state.projectId
    || state.studyArea
    || state.layers.length
    || state.analysisRuns.length
    || !elementsAreUntouched(),
  );
}

export function saveProject({ thumbnail, name } = {}) {
  migrateLegacy();
  const doc = Object.fromEntries(PERSIST_KEYS.map((k) => [k, state[k]]));
  const list = readLibrary();
  const id = state.projectId ?? newId();
  const existing = list.find((p) => p.id === id);

  const entry = {
    id,
    name: name ?? state.projectName ?? 'Untitled map',
    templateId: state.templateId,
    savedAt: Date.now(),
    thumb: thumbnail ?? existing?.thumb ?? '',
    doc,
  };

  const next = [entry, ...list.filter((p) => p.id !== id)].slice(0, MAX_PROJECTS);
  const result = writeLibrary(next);
  if (!result.ok) return result;

  if (state.projectId !== id) set({ projectId: id }, { history: false });
  pushProject(entry);
  return { ok: true, id };
}

/** Fork the live document into a brand-new project. */
export function saveProjectAs(name, thumbnail) {
  set({ projectId: null, projectName: name || state.projectName }, { history: false });
  return saveProject({ thumbnail, name });
}

export function deleteProject(id) {
  const result = writeLibrary(readLibrary().filter((p) => p.id !== id));
  outbox.delete(id);
  fetch(`${PROJECTS_API}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {
    // It will reappear from the server on the next sign-in; say so rather than pretend.
    syncFailed = true;
  });
  if (state.projectId === id) set({ projectId: null }, { history: false });
  return result;
}

export function renameProject(id, name) {
  const list = readLibrary();
  const entry = list.find((p) => p.id === id);
  if (!entry) return { ok: false };
  entry.name = name;
  if (entry.doc) entry.doc.projectName = name;
  return writeLibrary(list);
}

/** Serialise the whole project for "download .gdsmap" / re-import. */
export function exportProject() {
  return {
    format: 'gis-design-studio/project',
    version: 3,
    savedAt: new Date().toISOString(),
    doc: Object.fromEntries(PERSIST_KEYS.map((k) => [k, state[k]])),
    layers: state.layers.map(({ id, name, source, kind, style, visible, legend, meta }) => ({
      id, name, source, kind, style, visible, legend, meta,
    })),
  };
}
