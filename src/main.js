/**
 * Entry point.
 *
 * Nothing of the studio is shown until someone has signed in: a signed-out
 * visitor gets the landing page and the sign-up dialog, and that is all.
 * Once in, the map boots exactly once (the first time the studio is shown,
 * so the container already has a size) and the artboard is kept in step with
 * the store.
 */

import './styles/base.css';
import './styles/landing.css';
import './styles/studio.css';
import './styles/previews.css';

import { $, debounce } from './core/dom.js';
import { state, set, subscribe, saveProject, getProject, fetchProject, hasWork, setLibraryOwner, syncLibrary } from './core/store.js';
import { loadSession, signOut, legacyLibraryKeys } from './core/auth.js';
import { saveProjectLayers, loadProjectLayers, lastProjectId, rememberProject } from './core/session.js';
import { notify } from './core/toast.js';
import {
  initMap, resizeSoon, flyTo, flyToBounds,
  applyLook, applyTerrain, applyBuildingExtrusion, applyBasemapGroups,
} from './core/map.js';
import { initLayerRendering } from './layers/render.js';
import { findBySource } from './layers/registry.js';
import { combineAreas, redrawBoundaries } from './data/study-areas.js';
import { boundsFromBbox } from './core/geo.js';

import { reapplyMapState, watchBuildings3d } from './templates/apply.js';
import { initArtboard, layoutArtboard, renderElements, hint } from './ui/artboard.js';
import { thumbnailDataUrl } from './export/render.js';
import { initChrome } from './ui/chrome.js';
import { initInspector } from './ui/inspector.js';
import { initLanding } from './ui/landing.js';
import { setTool } from './ui/tool.js';
import { initTheme } from './ui/theme.js';

import { initTemplatesPane, renderTemplatesPane } from './ui/panels/templates.js';
import { initAreaPane, renderAreaPane } from './ui/panels/area.js';
import { initStartPane, renderStartPane } from './ui/panels/start.js';
import { initProjectsPane, renderProjectsPane } from './ui/panels/projects.js';
import { initDataPane, renderDataPane } from './ui/panels/data.js';
import { initElementsPane, renderElementsPane } from './ui/panels/elements.js';
import { initLayersPane, renderLayersPane } from './ui/panels/layers.js';
import { initAiPane, renderAiPane } from './ui/panels/ai.js';

/** Each pane only refreshes itself while it is the visible one, so it also
 *  has to redraw the moment it becomes visible again. */
const PANE_RENDERERS = {
  area: renderAreaPane,
  start: renderStartPane,
  templates: renderTemplatesPane,
  projects: renderProjectsPane,
  data: renderDataPane,
  ai: renderAiPane,
  elements: renderElementsPane,
  layers: renderLayersPane,
};

let studioReady = false;
let leaving = false;
let owner = null;            // the signed-in account, whose last map is remembered
let restoring = false;       // a project is being put back; do not save it half-done

/* ------------------------------------------------------------------ */
/* autosave                                                            */
/* ------------------------------------------------------------------ */
/**
 * Keep the open map saved as it is worked on, so a refresh, a crash or a
 * closed tab costs nothing. The document goes to the project library (and on
 * to the account), the data layers to this browser's IndexedDB, and the
 * project is remembered as the one to reopen.
 */
function autosave() {
  if (leaving || restoring || state.view !== 'studio' || !hasWork()) return;
  const result = saveProject();
  if (!result.ok) return;
  saveProjectLayers(state.projectId, state.layers);
  rememberProject(owner, state.projectId);
}
const autosaveSoon = debounce(autosave, 2000);

/** What counts as an edit worth saving — the persisted document, plus layers. */
const AUTOSAVE_KEYS = [
  'elements', 'layers', 'studyAreas', 'page', 'templateId', 'basemap', 'basemapGroups',
  'mapLook', 'terrain', 'buildings3d', 'projectName', 'mapStarted', 'clipToArea', 'mapView',
];

/* ------------------------------------------------------------------ */
/* studio boot — runs once                                             */
/* ------------------------------------------------------------------ */
function initStudio() {
  if (studioReady) return;
  studioReady = true;

  initMap('map');
  initLayerRendering();
  watchBuildings3d();

  initArtboard();
  initAreaPane();
  initStartPane();
  initTemplatesPane();
  initProjectsPane({ openProject, newMap });
  initDataPane();
  initAiPane();
  initElementsPane();
  initLayersPane();
  initInspector();
  initChrome({ onHome: () => setTool('projects'), onSignOut: leave });

  subscribe(['activeTool'], () => PANE_RENDERERS[state.activeTool]?.());

  // Map-side effects are driven off state rather than off the click that
  // caused it, so undo/redo — which rewrites state directly — puts the
  // basemap back the way it was too.
  subscribe(['mapLook'], () => applyLook(state.mapLook));
  subscribe(['terrain'], () => applyTerrain(state.terrain));
  subscribe(['buildings3d'], () => applyBuildingExtrusion(state.buildings3d));
  subscribe(['basemapGroups'], () => applyBasemapGroups(state.basemapGroups));

  // Anything that changes what the page should say redraws the elements.
  subscribe(['elements', 'layers', 'studyArea', 'analysisRuns', 'page', 'templateId', 'selectedElementId', 'insetContext'], renderElements);

  // The scale bar, north arrow and map-information block all depend on the
  // camera, so they refresh (cheaply) after the map settles.
  const refreshOnCamera = debounce(renderElements, 240);
  subscribe(['mapView'], refreshOnCamera);

  subscribe(AUTOSAVE_KEYS, autosaveSoon);

  // Not while signing out: the map was saved a moment ago, and the session
  // this would be sent under has just ended. The document write is
  // synchronous and always lands; the layer write is a best effort on the
  // way out — autosave has normally stored them a moment earlier anyway.
  window.addEventListener('beforeunload', () => {
    if (leaving || restoring || !hasWork()) return;
    const result = saveProject();
    if (!result.ok) return;
    saveProjectLayers(state.projectId, state.layers);
    rememberProject(owner, state.projectId);
  });
}

/* ------------------------------------------------------------------ */
/* view switching                                                      */
/* ------------------------------------------------------------------ */
function showStudio() {
  $('#landing')?.classList.add('is-hidden');
  $('#studio')?.classList.remove('is-hidden');
  set({ view: 'studio' }, { history: false });
  initStudio();
  layoutArtboard();
  renderElements();
  resizeSoon(60);
}

/** Save the open map with a fresh thumbnail, if there is anything to save. */
async function saveWithThumbnail() {
  // A template you only looked at saves nothing — see hasWork().
  if (!hasWork()) return { ok: true };
  let thumbnail;
  try {
    // Composed from the live map canvas, so it has to happen while the
    // studio is still on screen.
    if (state.elements.length) thumbnail = await thumbnailDataUrl();
  } catch (err) {
    console.warn('[main] could not compose a project thumbnail', err);
  }
  const result = saveProject({ thumbnail });
  if (result.ok) await saveProjectLayers(state.projectId, state.layers);
  return result;
}

/**
 * Sign out. The page is reloaded rather than unpicked: it is the one way to
 * be certain nothing of the last account — its map, its layers, its undo
 * history — is still in memory when the next person signs in.
 */
async function leave() {
  leaving = true;
  const result = await saveWithThumbnail();
  if (!result.ok && !window.confirm(`${result.error}\n\nSign out anyway? Unsaved changes to this map will be lost.`)) return;
  await signOut();
  window.location.reload();
}

/** Clear the live document so a new map does not inherit the last one. */
function resetDocument() {
  set({
    projectId: null,
    projectName: 'Untitled map',
    mapStarted: false,
    layers: [],
    elements: [],
    analysisRuns: [],
    studyAreas: [],
    studyArea: null,
    selectedElementId: null,
    selectedLayerId: null,
  }, { history: false });
  const name = $('#project-name');
  if (name) name.value = state.projectName;
}

/**
 * Begin a new map from the first step. The one that was open is saved first,
 * so "New map" never costs anything.
 */
async function newMap() {
  const result = await saveWithThumbnail();
  if (!result.ok) notify.warn(result.error, { duration: 8000 });
  resetDocument();
  // The new map becomes the one to resume once it is saved; until then a
  // refresh should not bring the previous one back.
  rememberProject(owner, null);
  setTool('area');
  layoutArtboard();
  renderElements();
  resizeSoon(60);
  hint('Start on the left: choose a <b>study area</b>. The other tools open once it is set.', 7000);
}

/** Reopen a saved project by its library id. */
async function openProject(id) {
  // This browser may only have heard of it from the server so far.
  const entry = getProject(id) ?? await fetchProject(id);
  if (!entry?.doc) {
    notify.error('That project could not be read — it may have been cleared by the browser.');
    return;
  }
  await restoreProject(entry.doc, entry.id);
}

/**
 * Put a saved project back on screen: its document, then — from this
 * browser's store — its data layers.
 * @param {{resumed?: boolean}} [opts]  true when reopened after a refresh
 */
async function restoreProject(doc, projectId = null, opts = {}) {
  restoring = true;
  try {
    await putBack(doc, projectId, opts);
  } finally {
    // Whatever happened, autosave must not stay switched off.
    restoring = false;
  }
}

async function putBack(doc, projectId, { resumed = false }) {
  showStudio();
  resetDocument();

  // Projects saved before a map could have several areas carry a single
  // `studyArea`; it becomes a list of one, which is the same map.
  const areas = doc.studyAreas?.length ? doc.studyAreas : (doc.studyArea ? [doc.studyArea] : []);
  const { studyArea, studyAreas, ...rest } = doc;
  // A project saved before the step-by-step flow existed was, by definition,
  // already started.
  set({ ...rest, mapStarted: doc.mapStarted ?? true, projectId, selectedElementId: null, selectedLayerId: null }, { history: false });
  set({ studyAreas: areas, studyArea: combineAreas(areas) }, { history: false });

  // Data layers, with their styling, from this browser's store. A project
  // saved before layers were kept — or opened on another computer — has
  // none; then the study-area outlines are rebuilt from the saved
  // boundaries, so the map at least does not come back empty.
  let layers = null;
  try {
    layers = await loadProjectLayers(projectId);
  } catch { /* storage unavailable: treated as none */ }
  if (layers?.length) set({ layers }, { history: false });
  else if (areas.length && !findBySource('boundary').length) redrawBoundaries();

  const name = $('#project-name');
  if (name) name.value = state.projectName;

  reapplyMapState();
  if (doc.mapView) flyTo(doc.mapView);
  else if (state.studyArea?.bbox) flyToBounds(boundsFromBbox(state.studyArea.bbox));

  layoutArtboard();
  renderElements();
  resizeSoon(80);
  setTool(!state.studyArea ? 'area' : state.mapStarted ? 'data' : 'start');
  rememberProject(owner, projectId);

  const count = layers?.length ?? 0;
  const what = count
    ? `with its ${count} layer${count === 1 ? '' : 's'}`
    : (areas.length ? 'Data layers were not stored in this browser — the boundary is back; add data again.' : '');
  notify.info(resumed
    ? `Picked up where you left off: <b>${state.projectName}</b>${count ? `, ${what}` : `. ${what}`}`
    : `Reopened <b>${state.projectName}</b>${count ? ` ${what}.` : `. ${what}`}`, { duration: 6000 });
}

/**
 * After a refresh or a new visit, reopen the map this account last had open.
 * The local library answers at once; if this browser has never seen that
 * project, the account server may still have it.
 * @returns {Promise<boolean>} whether a map was reopened
 */
async function resumeLastProject() {
  const id = lastProjectId(owner);
  if (!id) return false;
  let entry = getProject(id);
  if (!entry?.doc) {
    try { entry = await fetchProject(id); } catch { entry = null; }
  }
  if (!entry?.doc) { rememberProject(owner, null); return false; }
  await restoreProject(entry.doc, entry.id, { resumed: true });
  return true;
}

/* ------------------------------------------------------------------ */
/* go                                                                  */
/* ------------------------------------------------------------------ */
initTheme();
// Dev-only console handle, bound here rather than inside store.js on purpose.
// Vite serves an edited module under a new URL, so a bare
// `import('/src/core/store.js')` can hand back a *second*, stale copy — and a
// handle assigned at module scope would be whichever copy happened to
// evaluate last. main.js is the entry point and runs once, so this is
// always the state the app is actually running on.
if (import.meta.env?.DEV) window.__state = state;

/** Open the studio for a signed-in account, at the first step. */
async function enterStudio(user) {
  owner = user.id;
  setLibraryOwner(user.id);
  showStudio();
  resetDocument();

  // Back to the map that was open — after a refresh, or on the next visit.
  // Only a first visit, or after "New map", starts at the first step.
  const resumed = await resumeLastProject();
  if (!resumed) {
    setTool('area');
    layoutArtboard();
    renderElements();
    hint('Start on the left: choose a <b>study area</b>. The other tools open once it is set.', 7000);
  }

  // The account's maps live on the server; bring down whatever was saved on
  // another computer, and send up anything only this browser has.
  const result = await syncLibrary({ legacyKeys: legacyLibraryKeys(user.email) });
  if (!result.ok) {
    notify.warn('Your saved maps could not be loaded from the account service. New work is kept in this browser and sent up when it is back.', { duration: 9000 });
  } else if (result.pushed) {
    notify.info(`${result.pushed} map${result.pushed === 1 ? '' : 's'} from this browser added to your account — they will now open on any computer.`, { duration: 7000 });
  }
  if (state.activeTool === 'projects') setTool('projects');
}

initLanding({ onAuthed: enterStudio });

// Already signed in (the session cookie is still good): straight into the studio.
loadSession().then((user) => { if (user) enterStudio(user); });
