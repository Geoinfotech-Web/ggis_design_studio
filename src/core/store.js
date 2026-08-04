/**
 * Central application state with a tiny pub/sub layer and an undo stack.
 *
 * Everything the UI renders comes from here. Modules never talk to each
 * other directly — they `set()` state and `subscribe()` to the keys they
 * care about, which is what keeps the panels, the map and the export
 * pipeline from drifting apart the way they did in the v2 prototype.
 */

const HISTORY_KEYS = ['elements', 'page', 'templateId', 'mapLook'];
const HISTORY_LIMIT = 60;

export const state = {
  view: 'landing',                     // 'landing' | 'studio'
  projectName: 'Untitled map',
  activeTool: 'templates',             // which left panel is showing

  templateId: 'quiet-canvas',

  basemap: 'liberty',
  basemapGroups: { roads: true, water: true, buildings: true, boundaries: true, labels: true, landcover: true },
  mapView: { center: [7.4951, 9.0579], zoom: 5.6, pitch: 0, bearing: 0 },
  terrain: false,
  buildings3d: false,
  mapLook: { filter: 'none', texture: 'none', vignette: 0 },

  page: { size: 'a4', orientation: 'portrait', dpi: 150, background: '#ffffff' },

  studyArea: null,                     // { name, level, geojson, bbox, areaKm2 }

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
/* persistence — a project survives a page refresh                     */
/* ------------------------------------------------------------------ */
const STORAGE_KEY = 'gds.project.v3';
const PERSIST_KEYS = [
  'projectName', 'templateId', 'basemap', 'basemapGroups', 'mapView', 'terrain',
  'buildings3d', 'mapLook', 'page', 'elements', 'studyArea',
];

export function saveProject() {
  try {
    const doc = Object.fromEntries(PERSIST_KEYS.map((k) => [k, state[k]]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), doc }));
    return true;
  } catch (err) {
    console.warn('[store] could not save project', err);
    return false;
  }
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { savedAt, doc } = JSON.parse(raw);
    return { savedAt, doc };
  } catch {
    return null;
  }
}

export function clearProject() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
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
