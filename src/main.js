/**
 * Entry point.
 *
 * Wires the landing page to the studio, boots the map exactly once (the
 * first time the studio is shown, so the container already has a size),
 * and keeps the artboard in step with the store.
 */

import './styles/base.css';
import './styles/landing.css';
import './styles/studio.css';
import './styles/previews.css';

import { $, debounce } from './core/dom.js';
import { state, set, subscribe, saveProject } from './core/store.js';
import { notify } from './core/toast.js';
import {
  initMap, resizeSoon, flyTo, flyToBounds,
  applyLook, applyTerrain, applyBuildingExtrusion, applyBasemapGroups,
} from './core/map.js';
import { initLayerRendering } from './layers/render.js';
import { addVectorLayer, findBySource } from './layers/registry.js';
import { boundsFromBbox } from './core/geo.js';

import { applyTemplate, reapplyMapState, watchBuildings3d } from './templates/apply.js';
import { initArtboard, layoutArtboard, renderElements, hint } from './ui/artboard.js';
import { initChrome } from './ui/chrome.js';
import { initInspector } from './ui/inspector.js';
import { initLanding, showLanding } from './ui/landing.js';
import { setTool } from './ui/tool.js';

import { initTemplatesPane, renderTemplatesPane } from './ui/panels/templates.js';
import { initAreaPane, renderAreaPane, loadPlace } from './ui/panels/area.js';
import { initDataPane, renderDataPane } from './ui/panels/data.js';
import { initAnalysisPane, renderAnalysisPane } from './ui/panels/analysis.js';
import { initElementsPane, renderElementsPane } from './ui/panels/elements.js';
import { initLayersPane, renderLayersPane } from './ui/panels/layers.js';

/** Each pane only refreshes itself while it is the visible one, so it also
 *  has to redraw the moment it becomes visible again. */
const PANE_RENDERERS = {
  templates: renderTemplatesPane,
  area: renderAreaPane,
  data: renderDataPane,
  analysis: renderAnalysisPane,
  elements: renderElementsPane,
  layers: renderLayersPane,
};

let studioReady = false;

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
  initTemplatesPane();
  initAreaPane();
  initDataPane();
  initAnalysisPane();
  initElementsPane();
  initLayersPane();
  initInspector();
  initChrome({ onHome: goHome });

  subscribe(['activeTool'], () => PANE_RENDERERS[state.activeTool]?.());

  // Map-side effects are driven off state rather than off the click that
  // caused it, so undo/redo — which rewrites state directly — puts the
  // basemap back the way it was too.
  subscribe(['mapLook'], () => applyLook(state.mapLook));
  subscribe(['terrain'], () => applyTerrain(state.terrain));
  subscribe(['buildings3d'], () => applyBuildingExtrusion(state.buildings3d));
  subscribe(['basemapGroups'], () => applyBasemapGroups(state.basemapGroups));

  // Anything that changes what the page should say redraws the elements.
  subscribe(['elements', 'layers', 'studyArea', 'analysisRuns', 'page', 'templateId', 'selectedElementId'], renderElements);

  // The scale bar, north arrow and map-information block all depend on the
  // camera, so they refresh (cheaply) after the map settles.
  const refreshOnCamera = debounce(renderElements, 240);
  subscribe(['mapView'], refreshOnCamera);

  window.addEventListener('beforeunload', () => saveProject());
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

function goHome() {
  saveProject();
  set({ view: 'landing' }, { history: false });
  showLanding();
}

/**
 * Open the studio.
 * @param {{templateId?: string, tool?: string, place?: string}} opts
 */
function openStudio(opts = {}) {
  showStudio();

  if (opts.templateId) {
    applyTemplate(opts.templateId);
    layoutArtboard();
    renderElements();
    resizeSoon(80);
  }
  if (opts.tool) setTool(opts.tool);

  if (opts.place) {
    loadPlace(opts.place).catch(() => { /* the panel reports its own errors */ });
  } else {
    hint('Start on the left: choose a <b>study area</b>, then add <b>data</b>. Drag anything inside the dashed page frame.', 7000);
  }
}

/** Reopen a project saved in this browser. */
function restoreProject(doc) {
  showStudio();
  set({ ...doc, selectedElementId: null, selectedLayerId: null }, { history: false });

  // Layers are not persisted, but the study-area outline can be rebuilt
  // from the saved boundary so the map does not come back empty.
  if (doc.studyArea?.geojson && !findBySource('boundary').length) {
    addVectorLayer({
      name: `${doc.studyArea.name} boundary`,
      source: 'boundary',
      geojson: doc.studyArea.geojson,
      kind: 'polygon',
      color: '#0369a1',
      style: { fillOpacity: 0.07, strokeWidth: 2.2, stroke: '#0369a1' },
      legend: [{ label: `${doc.studyArea.name} boundary`, color: '#0369a1', swatch: 'polygon' }],
      meta: { slug: 'study-area', level: doc.studyArea.level },
    });
  }

  const name = $('#project-name');
  if (name) name.value = state.projectName;

  reapplyMapState();
  if (doc.mapView) flyTo(doc.mapView);
  else if (doc.studyArea?.bbox) flyToBounds(boundsFromBbox(doc.studyArea.bbox));

  layoutArtboard();
  renderElements();
  resizeSoon(80);
  notify.info(`Reopened <b>${state.projectName}</b>. Data layers need adding again — the boundary is back.`, { duration: 6000 });
}

/* ------------------------------------------------------------------ */
/* go                                                                  */
/* ------------------------------------------------------------------ */
initLanding({ openStudio, restoreProject });

// A hash link like #studio/oil-spill opens straight into a template.
const [view, templateId] = window.location.hash.replace(/^#/, '').split('/');
if (view === 'studio') openStudio({ templateId: templateId || 'quiet-canvas', tool: 'area' });
