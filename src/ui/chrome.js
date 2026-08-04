/**
 * Studio chrome — the header, the tool rail, the guided step strip, the
 * floating map controls and the footer.
 *
 * None of this holds state of its own; it reads the store and writes back
 * through it, which is what keeps the rail, the steps and the panels from
 * disagreeing about where the user is.
 */

import { $, $$, el, fill, debounce } from '../core/dom.js';
import { state, set, subscribe, undo, redo, canUndo, canRedo, saveProject } from '../core/store.js';
import { notify } from '../core/toast.js';
import { APP, BASEMAPS, ATTRIBUTION_TEXT } from '../core/constants.js';
import { setBasemap, flyToBounds, getMap, resizeSoon } from '../core/map.js';
import { boundsFromBbox, formatArea } from '../core/geo.js';
import { exportPng, exportPdf } from '../export/render.js';
import { setTool } from './tool.js';
import { renderElements, layoutArtboard, paperDims } from './artboard.js';

/* ------------------------------------------------------------------ */
/* tool rail                                                           */
/* ------------------------------------------------------------------ */
const TOOLS = [
  { id: 'templates', icon: '◫', label: 'Templates' },
  { id: 'area',      icon: '◎', label: 'Area' },
  { id: 'data',      icon: '≣', label: 'Data' },
  { id: 'analysis',  icon: '◐', label: 'Analysis' },
  { id: 'elements',  icon: '✥', label: 'Elements' },
  { id: 'layers',    icon: '❒', label: 'Layers' },
];

function renderRail() {
  const rail = $('#tool-rail');
  if (!rail) return;
  fill(rail, TOOLS.map((tool) => {
    const btn = el('button.rail-btn', { type: 'button', title: tool.label }, [
      el('span.rail-ico', { text: tool.icon }),
      el('span', { text: tool.label }),
    ]);
    btn.classList.toggle('is-active', state.activeTool === tool.id);
    btn.addEventListener('click', () => setTool(tool.id));
    return btn;
  }));
}

function showPane() {
  $$('.panel-pane').forEach((pane) => {
    pane.classList.toggle('is-active', pane.dataset.pane === state.activeTool);
  });
}

/* ------------------------------------------------------------------ */
/* guided steps                                                        */
/* ------------------------------------------------------------------ */
const STEPS = [
  { id: 'templates', label: 'Style',    done: () => Boolean(state.templateId) },
  { id: 'area',      label: 'Area',     done: () => Boolean(state.studyArea) },
  { id: 'data',      label: 'Data',     done: () => state.layers.some((l) => l.source === 'osm' || l.source === 'upload') },
  { id: 'analysis',  label: 'Analysis', done: () => state.analysisRuns.length > 0 },
  { id: 'elements',  label: 'Design',   done: () => state.elements.length > 0 },
];

function renderSteps() {
  const strip = $('#step-strip');
  if (!strip) return;
  const children = [];
  STEPS.forEach((step, i) => {
    const li = el('li');
    const btn = el('button.step', { type: 'button' }, [
      el('span.step-num', { text: String(i + 1) }),
      el('span', { text: step.label }),
    ]);
    btn.classList.toggle('is-active', state.activeTool === step.id);
    btn.classList.toggle('is-done', step.done() && state.activeTool !== step.id);
    btn.addEventListener('click', () => setTool(step.id));
    li.append(btn);
    children.push(li);
    if (i < STEPS.length - 1) children.push(el('li.step-sep', { text: '›' }));
  });
  fill(strip, children);
}

/* ------------------------------------------------------------------ */
/* map controls                                                        */
/* ------------------------------------------------------------------ */
function renderMapControls() {
  const host = $('#map-controls');
  if (!host) return;

  const basemapCard = el('div.control-card', {}, Object.entries(BASEMAPS).map(([key, base]) => {
    const btn = el('button.control-btn', { type: 'button', text: base.label, title: base.hint });
    btn.classList.toggle('is-active', state.basemap === key);
    btn.addEventListener('click', () => setBasemap(key));
    return btn;
  }));

  const viewCard = el('div.control-card', {}, [
    (() => {
      const btn = el('button.control-btn', { type: 'button', text: 'Fit area', title: 'Zoom to the study area' });
      btn.addEventListener('click', () => {
        if (!state.studyArea) { notify.warn('No study area loaded yet.'); setTool('area'); return; }
        flyToBounds(boundsFromBbox(state.studyArea.bbox));
      });
      return btn;
    })(),
    (() => {
      const btn = el('button.control-btn', { type: 'button', text: 'North up', title: 'Reset rotation and tilt' });
      btn.addEventListener('click', () => getMap()?.easeTo({ bearing: 0, pitch: 0, duration: 500 }));
      return btn;
    })(),
  ]);

  fill(host, [basemapCard, viewCard]);
}

/* ------------------------------------------------------------------ */
/* footer                                                              */
/* ------------------------------------------------------------------ */
function renderFooter() {
  const footer = $('#studio-footer');
  if (!footer) return;
  const { wIn, hIn, label } = paperDims();
  const bits = [
    `${APP.name} ${APP.version}`,
    `${label} · ${wIn.toFixed(1)}″ × ${hIn.toFixed(1)}″ · ${state.page.dpi} dpi`,
    state.studyArea ? `${state.studyArea.name} · ${formatArea(state.studyArea.areaKm2)}` : 'No study area',
    `${state.layers.length} layer${state.layers.length === 1 ? '' : 's'}`,
    ATTRIBUTION_TEXT,
  ];
  fill(footer, bits.flatMap((text, i) => [
    i ? el('span.sep', { text: '·' }) : null,
    el('span', { text }),
  ]).filter(Boolean));
}

/* ------------------------------------------------------------------ */
/* header                                                              */
/* ------------------------------------------------------------------ */
function renderHeader() {
  const undoBtn = $('#undo-btn');
  const redoBtn = $('#redo-btn');
  if (undoBtn) undoBtn.disabled = !canUndo();
  if (redoBtn) redoBtn.disabled = !canRedo();

  const subline = $('#project-subline');
  if (subline) {
    const { label, orientation } = paperDims();
    subline.textContent = `${label} ${orientation} · ${state.layers.length} layer${state.layers.length === 1 ? '' : 's'}`;
  }
}

async function runExport(kind) {
  const status = notify.busy(`Preparing your ${kind.toUpperCase()}…`);
  try {
    const fn = kind === 'pdf' ? exportPdf : exportPng;
    const out = await fn({ onProgress: (msg) => status.update(msg) });
    status.update(`<b>${kind.toUpperCase()} saved</b> — ${out.width} × ${out.height} px`, { tone: 'ok', duration: 5000 });
  } catch (err) {
    console.error(err);
    status.update(`Export failed: ${err.message}`, { tone: 'error', duration: 8000 });
  }
}

function initHeader(onHome) {
  const name = $('#project-name');
  if (name) {
    name.value = state.projectName;
    name.addEventListener('input', () => set({ projectName: name.value }, { history: false }));
  }

  $('#back-home')?.addEventListener('click', onHome);
  $('#undo-btn')?.addEventListener('click', () => { if (undo()) { renderElements(); layoutArtboard(); } });
  $('#redo-btn')?.addEventListener('click', () => { if (redo()) { renderElements(); layoutArtboard(); } });
  $('#export-png-btn')?.addEventListener('click', () => runExport('png'));
  $('#export-pdf-btn')?.addEventListener('click', () => runExport('pdf'));

  window.addEventListener('keydown', (event) => {
    if (state.view !== 'studio') return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); if (undo()) { renderElements(); layoutArtboard(); } }
    else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); if (redo()) { renderElements(); layoutArtboard(); } }
    else if (key === 's') { event.preventDefault(); saveProject() && notify.ok('Project saved in this browser.'); }
    else if (key === 'e') { event.preventDefault(); runExport('pdf'); }
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
export function initChrome({ onHome }) {
  initHeader(onHome);
  renderRail();
  showPane();
  renderSteps();
  renderMapControls();
  renderFooter();
  renderHeader();

  subscribe(['activeTool'], () => { renderRail(); showPane(); renderSteps(); resizeSoon(); });
  subscribe(['basemap'], renderMapControls);
  subscribe(['studyArea', 'layers', 'analysisRuns', 'elements', 'templateId', 'page'], () => {
    renderSteps();
    renderFooter();
    renderHeader();
  });
  subscribe(['history'], renderHeader);

  // Autosave — a refresh should never lose a design.
  const save = debounce(() => saveProject(), 900);
  subscribe(['elements', 'page', 'layers', 'studyArea', 'templateId', 'mapLook', 'basemap', 'mapView', 'projectName', 'terrain', 'buildings3d'], save);
}
