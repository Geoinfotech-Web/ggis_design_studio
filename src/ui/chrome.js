/**
 * Studio chrome — the header, the tool rail, the guided step strip, the
 * floating map controls and the footer.
 *
 * None of this holds state of its own; it reads the store and writes back
 * through it, which is what keeps the rail, the steps and the panels from
 * disagreeing about where the user is.
 */

import { $, $$, el, fill, debounce } from '../core/dom.js';
import { state, set, subscribe, undo, redo, canUndo, canRedo, saveProject, hasWork } from '../core/store.js';
import { notify } from '../core/toast.js';
import { APP, BASEMAPS, attributionFor, PAPER_SIZES, paperDimsLabel } from '../core/constants.js';
import { setBasemap, flyToBounds, getMap, resizeSoon } from '../core/map.js';
import { boundsFromBbox, formatArea } from '../core/geo.js';
import { exportPng, exportPdf, thumbnailDataUrl } from '../export/render.js';
import { setTool } from './tool.js';
import { themeToggle } from './theme.js';
import { toolLocked, studioLocked, lockReason } from '../core/flow.js';
import { currentUser, initials } from '../core/auth.js';
import { uiIcon } from './ui-icons.js';
import { renderElements, layoutArtboard, paperDims, setPanMode, hint } from './artboard.js';

/* ------------------------------------------------------------------ */
/* tool rail                                                           */
/* ------------------------------------------------------------------ */
/**
 * The rail, in the order a map is made. `also` lists panels that belong to a
 * rail item without having one of their own: the style, basemap and page
 * settings open from Start map, so the rail keeps Start map lit for them.
 */
const TOOLS = [
  { id: 'area',     label: 'Study area',   done: () => Boolean(state.studyArea),
    d: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10zM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  { id: 'start',    label: 'Start map',    done: () => Boolean(state.mapStarted), also: ['templates'],
    d: 'M12 5v14M5 12h14' },
  { id: 'data',     label: 'Data',
    d: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' },
  { id: 'analysis', label: 'Analysis',
    d: 'M4 20V4M4 20h16M8 16l3.5-5 3 2.5L19 7' },
  { id: 'elements', label: 'Elements',
    d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'layers',   label: 'Layers',
    d: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5' },
  { id: 'projects', label: 'My projects',
    d: 'M3 7h6l2 2h10v10H3z' },
  { id: 'ai',       label: 'AI assistant',
    d: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z' },
];

const railIcon = (d) => el('span.rail-ico', {
  html: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`,
});

const isActiveTool = (tool) => state.activeTool === tool.id || Boolean(tool.also?.includes(state.activeTool));

/* ------------------------------------------------------------------ */
/* narrow-screen sheets                                                */
/* ------------------------------------------------------------------ */

/**
 * Below this width the panels stop being columns and become sheets over the
 * map, so they need opening and closing — something the wide layout never
 * has to think about. The breakpoint is duplicated in studio.css; it is the
 * one number the two have to agree on.
 */
const narrow = () => window.matchMedia('(max-width: 760px)').matches;

const studioEl = () => $('#studio');

function setPanelOpen(open) {
  studioEl()?.classList.toggle('is-panel-open', open);
  resizeSoon();
}

function setInspectorOpen(open) {
  studioEl()?.classList.toggle('is-inspector-open', open);
  resizeSoon();
}

function renderRail() {
  const rail = $('#tool-rail');
  if (!rail) return;
  fill(rail, TOOLS.map((tool) => {
    const locked = toolLocked(tool.id);
    const active = isActiveTool(tool);
    const btn = el('button.rail-btn', {
      type: 'button',
      title: locked ? `${tool.label} — locked. ${lockReason()}` : tool.label,
      'aria-disabled': locked ? 'true' : null,
    }, [
      railIcon(tool.d),
      el('span', { text: tool.label }),
      locked ? el('span.rail-lock', { 'aria-hidden': 'true' }, [uiIcon('lock', 11)]) : null,
    ]);
    btn.classList.toggle('is-active', active);
    btn.classList.toggle('is-locked', locked);
    btn.classList.toggle('is-done', !active && !locked && Boolean(tool.done?.()));
    btn.addEventListener('click', () => {
      // On a phone the rail doubles as the panel's open/close control:
      // tapping the tool you are already in puts the map back.
      if (narrow() && active) {
        setPanelOpen(!studioEl()?.classList.contains('is-panel-open'));
        return;
      }
      // setTool() explains itself and redirects when the tool is locked.
      setTool(tool.id);
      if (narrow()) setPanelOpen(true);
    });
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
/**
 * The chain across the header: where you are in making the map. A filled node
 * is done, the solid one is where you are, and a dashed one is not ready yet —
 * the same reading as a model diagram, where a hollow step has not got its
 * inputs.
 */
let exported = false;
const STEPS = [
  { id: 'area',     label: 'Study area', tools: ['area'],                done: () => Boolean(state.studyArea) },
  { id: 'start',    label: 'Start map',  tools: ['start', 'templates'],  done: () => Boolean(state.mapStarted) },
  { id: 'data',     label: 'Data',       tools: ['data', 'analysis'],    done: () => state.layers.some((l) => l.source === 'osm' || l.source === 'overture' || l.source === 'upload') },
  { id: 'elements', label: 'Compose',    tools: ['elements', 'layers'],  done: () => exported },
  { id: 'export',   label: 'Export',     tools: [],                      done: () => exported },
];

function renderSteps() {
  const strip = $('#step-strip');
  if (!strip) return;
  const children = [];
  STEPS.forEach((step, i) => {
    const locked = step.id === 'export' ? studioLocked() : toolLocked(step.id);
    const active = step.tools.includes(state.activeTool);
    const li = el('li');
    const btn = el('button.step', { type: 'button', title: locked ? lockReason() : step.label }, [
      el('span', { text: step.label }),
    ]);
    btn.classList.toggle('is-active', active);
    btn.classList.toggle('is-done', !active && !locked && step.done());
    btn.classList.toggle('is-todo', locked);
    btn.addEventListener('click', () => {
      if (step.id !== 'export') { setTool(step.id); return; }
      if (studioLocked()) notify.info(lockReason(), { duration: 4200 });
      else runExport('pdf');
    });
    li.append(btn);
    children.push(li);
    if (i < STEPS.length - 1) children.push(el('li.step-sep', { 'aria-hidden': 'true', text: '→' }));
  });
  fill(strip, children);
}

/**
 * Everything that changes when the studio opens up or closes again: the
 * right-hand panel goes quiet, export waits, and a panel that has just
 * become unavailable hands over to the step that will reopen it.
 */
function syncLock() {
  const locked = studioLocked();
  studioEl()?.classList.toggle('is-locked', locked);
  const right = $('#right-panel');
  if (right) {
    if (locked) right.dataset.lock = lockReason();
    else delete right.dataset.lock;
  }
  for (const id of ['#export-png-btn', '#export-pdf-btn']) {
    const btn = $(id);
    if (btn) btn.disabled = locked;
  }
  if (toolLocked(state.activeTool)) set({ activeTool: state.studyArea ? 'start' : 'area' }, { history: false });
}

/* ------------------------------------------------------------------ */
/* map controls                                                        */
/* ------------------------------------------------------------------ */
function renderMapControls() {
  const host = $('#map-controls');
  if (!host) return;

  // Twelve basemaps is too many to park on the map as a row of buttons, so
  // this card carries the handful you switch between while working — one
  // quiet, one detailed, one photographic — and the full grouped list lives in
  // the Templates panel where the rest of the map's appearance is decided.
  const QUICK = ['positron', 'liberty', 'satellite-labels'];
  const basemapCard = el('div.control-card', {}, QUICK.map((key) => {
    const base = BASEMAPS[key];
    const btn = el('button.control-btn', { type: 'button', text: base.label, title: base.hint });
    btn.classList.toggle('is-active', state.basemap === key);
    btn.addEventListener('click', () => setBasemap(key));
    return btn;
  }).concat((() => {
    const btn = el('button.control-btn', {
      type: 'button', text: 'More…', title: 'Every basemap, in the Templates panel',
    });
    btn.classList.toggle('is-active', !QUICK.includes(state.basemap));
    btn.addEventListener('click', () => setTool('templates'));
    return btn;
  })()));

  const viewCard = el('div.control-card', {}, [
    (() => {
      const btn = el('button.control-btn.control-btn--pan', {
        type: 'button',
        'aria-pressed': String(state.panMode),
        title: state.panMode
          ? 'Pan mode is on — drag anywhere to move the map. Click to go back to arranging the page (Esc).'
          : 'Drag the map from anywhere, even through page elements. You can also hold Space.',
      }, [
        el('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>' }),
        state.panMode ? 'Panning' : 'Pan map',
      ]);
      btn.classList.toggle('is-active', state.panMode);
      btn.addEventListener('click', () => {
        const on = !state.panMode;
        setPanMode(on);
        if (on) hint('<b>Pan mode</b> — drag anywhere to move the map. Press <b>Esc</b> or click <b>Panning</b> to arrange the page again.', 5200);
      });
      return btn;
    })(),
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
  const { label, orientation } = paperDims();
  const paper = PAPER_SIZES[state.page.size] ?? PAPER_SIZES.a4;
  const bits = [
    `${APP.name} ${APP.version}`,
    `${label} · ${paperDimsLabel(paper, orientation === 'portrait')} · ${state.page.dpi} dpi`,
    state.studyArea ? `${state.studyArea.name} · ${formatArea(state.studyArea.areaKm2)}` : 'No study area',
    `${state.layers.length} layer${state.layers.length === 1 ? '' : 's'}`,
    attributionFor(state.basemap),
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
    status.update(`<b>${kind.toUpperCase()} saved</b> — ${out.width} × ${out.height} px at ${state.page.dpi} dpi`, { tone: 'ok', duration: 5000 });
    exported = true;
    renderSteps();
  } catch (err) {
    console.error(err);
    status.update(`Export failed: ${err.message}`, { tone: 'error', duration: 8000 });
  }
}

/** Save into the project library, with a thumbnail for the home page. */
async function saveNow() {
  const status = notify.busy('Saving…');
  let thumbnail;
  try {
    if (state.elements.length) thumbnail = await thumbnailDataUrl();
  } catch { /* a project without a picture still saves */ }

  const result = saveProject({ thumbnail });
  if (result.ok) status.update(`<b>${state.projectName}</b> saved to your projects.`, { tone: 'ok', duration: 3500 });
  else status.update(result.error, { tone: 'error', duration: 9000 });
  return result;
}

function initHeader(onHome, onSignOut) {
  const name = $('#project-name');
  if (name) {
    name.value = state.projectName;
    name.addEventListener('input', () => set({ projectName: name.value }, { history: false }));
  }

  // A visible Save sits next to undo/redo so the project library is
  // discoverable; autosave and Ctrl+S write to the same place.
  const undoBtn = $('#undo-btn');
  if (undoBtn && !$('#save-btn')) {
    const save = el('button.icon-btn#save-btn', { type: 'button', title: 'Save to your projects (Ctrl+S)', 'aria-label': 'Save project', text: '⤓' });
    save.addEventListener('click', saveNow);
    undoBtn.before(save);
    undoBtn.before(themeToggle());
  }

  // Who is signed in, and the way out.
  const user = currentUser();
  const exportBtn = $('#export-pdf-btn');
  if (user && exportBtn && !$('#account-chip')) {
    const out = el('button.btn-ghost#sign-out-btn', { type: 'button', text: 'Sign out' });
    out.addEventListener('click', onSignOut);
    exportBtn.after(
      el('span.header-sep'),
      el('span.account-chip#account-chip', { title: `${user.name} · ${user.email}`, role: 'img', 'aria-label': `Signed in as ${user.name}`, text: initials(user) }),
      out,
    );
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
    else if (key === 's') { event.preventDefault(); saveNow(); }
    else if (key === 'e') { event.preventDefault(); runExport('pdf'); }
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
export function initChrome({ onHome, onSignOut }) {
  initHeader(onHome, onSignOut);
  renderRail();
  showPane();
  renderSteps();
  renderMapControls();
  renderFooter();
  renderHeader();
  syncLock();

  subscribe(['activeTool'], () => { renderRail(); showPane(); renderSteps(); resizeSoon(); });
  subscribe(['studyArea', 'mapStarted'], () => { syncLock(); renderRail(); renderSteps(); });
  subscribe(['basemap', 'panMode'], renderMapControls);

  // On a narrow screen the inspector is a sheet, so it has to be summoned by
  // the thing it inspects and dismissed when nothing is selected.
  subscribe(['selectedElementId', 'selectedLayerId'], () => {
    if (!narrow()) return;
    const selected = Boolean(state.selectedElementId || state.selectedLayerId);
    if (selected) setPanelOpen(false);
    setInspectorOpen(selected);
  });

  // Touching the map is how you get back to the map.
  $('#canvas-wrap')?.addEventListener('pointerdown', () => {
    if (!narrow()) return;
    setPanelOpen(false);
    setInspectorOpen(false);
  }, { capture: true });

  // Coming back to a wide window must not leave a sheet class behind.
  window.matchMedia('(max-width: 760px)').addEventListener('change', (e) => {
    if (e.matches) return;
    studioEl()?.classList.remove('is-panel-open', 'is-inspector-open');
    resizeSoon();
  });
  subscribe(['studyArea', 'layers', 'analysisRuns', 'elements', 'templateId', 'page'], () => {
    renderSteps();
    renderFooter();
    renderHeader();
  });
  subscribe(['history'], renderHeader);

  // Autosave — a refresh should never lose a design. It deliberately does
  // not *create* a project until there is something worth keeping, or
  // browsing the template gallery would litter the home page with stubs.
  const save = debounce(() => { if (hasWork()) saveProject(); }, 900);
  subscribe(['elements', 'page', 'layers', 'studyArea', 'templateId', 'mapLook', 'basemap', 'mapView', 'projectName', 'terrain', 'buildings3d', 'mapStarted'], save);
}
